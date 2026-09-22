"""
ClAIssify Fleet Telemetry Client
Manages outbound DSPM/DLP fleet telemetry reporting to the TrustFabric licensing platform.

Privacy Contract:
- Zero file content or PII values ever leave the device.
- File paths default to salted sha256 hashes (sha256:<salt + lowercase(normalized_path)>).
  Literal paths are transmitted ONLY if the company administrator enabled syncFullPaths.
- User override justifications (free text) and entity summaries NEVER leave the device.
- Enforcement events are aggregated locally into 15-minute UTC-aligned windows.
- Outbox pattern: scans and enforcement windows are enqueued locally in history.db and
  flushed asynchronously. Offline failures never raise and never block scanning or UI.
- Standalone / unlicensed mode: zero network calls.
"""

import json
import logging
import os
import re
import secrets
import hashlib
import platform
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from backend.config import get_app_dir
from backend.database import db_manager
from backend.license_client import (
    _validate_backend_url,
    _load_state,
    _authorized_headers,
    get_backend_url,
    is_registered,
    enforcement_status,
    update_policy_status,
    AGENT_VERSION,
)

logger = logging.getLogger("pii_sentinel.telemetry")

TELEMETRY_STATE_FILE = "telemetry_state.json"
DEFAULT_PING_INTERVAL_SECONDS = 180
MIN_PING_INTERVAL_SECONDS = 60
MAX_PING_INTERVAL_SECONDS = 900
MAX_PER_FILE_FINDINGS = 200
REQUEST_TIMEOUT_SECONDS = 10

# Sensitivity tier ordering (Restricted > Highly Confidential > Confidential > General > Public)
TIER_ORDER = {
    "Restricted": 5,
    "Highly Confidential": 4,
    "Confidential": 3,
    "General": 2,
    "Public": 1,
}

_WINDOWS_PATH_REGEX = re.compile(r"^[A-Za-z]:\\|\\\\")
_ENTITY_TYPE_REGEX = re.compile(r"^[A-Z0-9_]{2,40}$")

_cached_telemetry_state: Optional[Dict[str, Any]] = None


def get_telemetry_state_file_path() -> Path:
    """Return path to %APPDATA%\\PIISentinel\\telemetry_state.json."""
    return get_app_dir() / TELEMETRY_STATE_FILE


def _load_telemetry_state() -> Dict[str, Any]:
    global _cached_telemetry_state
    if _cached_telemetry_state is not None:
        return _cached_telemetry_state

    path = get_telemetry_state_file_path()
    if path.exists():
        try:
            _cached_telemetry_state = json.loads(path.read_text(encoding="utf-8"))
            return _cached_telemetry_state
        except Exception as e:
            logger.debug(f"Could not load telemetry state, initializing fresh: {e}")

    _cached_telemetry_state = {
        "installation_salt": secrets.token_hex(16),
        "telemetry_config": {
            "enabled": True,
            "intervalSeconds": DEFAULT_PING_INTERVAL_SECONDS,
            "syncFullPaths": False,
        },
        "last_sync_time": None,
        "enforcement_high_water_mark": 0,
        "processed_command_ids": [],
    }
    _save_telemetry_state(_cached_telemetry_state)
    return _cached_telemetry_state


def _save_telemetry_state(state: Dict[str, Any]) -> None:
    global _cached_telemetry_state
    _cached_telemetry_state = state
    path = get_telemetry_state_file_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to persist telemetry state: {e}")


def get_installation_salt() -> str:
    state = _load_telemetry_state()
    salt = state.get("installation_salt")
    if not salt:
        salt = secrets.token_hex(16)
        state["installation_salt"] = salt
        _save_telemetry_state(state)
    return salt


def compute_path_reference(raw_path: str, sync_full_paths: bool = False) -> str:
    """
    Computes a path reference per §3 of the privacy contract:
    - If sync_full_paths is True: returns the literal normalized path.
    - If False (default): returns sha256:<hex> = sha256(salt + lowercase(normalized_path)).
    """
    normalized = os.path.normpath(raw_path).replace("/", "\\")
    if sync_full_paths:
        return normalized

    salt = get_installation_salt()
    salted = f"{salt}:{normalized.lower()}".encode("utf-8")
    return f"sha256:{hashlib.sha256(salted).hexdigest()}"


def compute_policy_hash() -> str:
    """
    Computes a 12-hex hash of local classification rules / tier action map only.
    No file paths, content, or user IDs.
    """
    try:
        from backend.classifier import PIIClassifier
        # Stable digest of the default tier configuration
        keys = sorted(TIER_ORDER.keys())
        return hashlib.sha256(",".join(keys).encode("utf-8")).hexdigest()[:12]
    except Exception:
        return "default12hex"


# ─── Payload Firewall ────────────────────────────────────────────────────────

_ALLOWED_KEYS = {
    "ping": {
        "clientTime",
        "serviceRunning",
        "watcherActive",
        "serviceStartedAt",
        "policyHash",
        "agentVersion",
        "applicationVersion",
        "outboxDepth",
    },
    "scan_summary": {
        "clientScanId",
        "scanSource",
        "targetSummary",
        "startedAt",
        "completedAt",
        "status",
        "durationSeconds",
        "filesScanned",
        "filesWithPii",
        "totalFindings",
        "highestTier",
        "tierCounts",
        "entityTypeTotals",
        "files",
        "filesTruncated",
    },
    "scan_file_item": {
        "pathRef",
        "tier",
        "entityTypeCounts",
        "watermarkStatus",
    },
    "enforcement_summary": {
        "windows",
    },
    "enforcement_window_item": {
        "windowStart",
        "windowEnd",
        "source",
        "actionCounts",
        "tierCounts",
        "overrideCount",
    },
    "command_ack": {
        "commandId",
        "result",
        "detail",
    },
}


def _assert_payload_safe(kind: str, payload: Any, sync_full_paths: bool = False) -> bool:
    """
    Strict payload firewall (§7).
    Validates outbound payloads against recursive key allowlists, string length bounds,
    and guarantees no Windows paths leak when syncFullPaths is off.
    Returns True if valid, False on any violation (logs warning with reason, never values).
    """
    if not isinstance(payload, dict):
        logger.warning(f"Payload firewall: payload for '{kind}' must be a dict")
        return False

    allowed = _ALLOWED_KEYS.get(kind)
    if not allowed:
        logger.warning(f"Payload firewall: unknown payload kind '{kind}'")
        return False

    # 1. No unknown keys
    for k in payload.keys():
        if k not in allowed:
            logger.warning(f"Payload firewall: disallowed key '{k}' found in '{kind}' payload")
            return False

    # 2. Key-specific validation
    if kind == "ping":
        for str_key in ["agentVersion", "applicationVersion"]:
            val = payload.get(str_key)
            if not isinstance(val, str) or len(val) > 32:
                logger.warning(f"Payload firewall: ping '{str_key}' invalid length or type")
                return False
        if not isinstance(payload.get("outboxDepth"), int) or payload.get("outboxDepth") < 0:
            logger.warning("Payload firewall: ping outboxDepth must be non-negative int")
            return False

    elif kind == "scan_summary":
        target = payload.get("targetSummary")
        if target is not None:
            if not isinstance(target, str) or len(target) > 128:
                logger.warning("Payload firewall: targetSummary exceeds 128 chars")
                return False
            if not sync_full_paths and _WINDOWS_PATH_REGEX.search(target):
                logger.warning("Payload firewall: targetSummary contains literal Windows path while syncFullPaths is false")
                return False

        # tierCounts <= 5 keys
        tier_counts = payload.get("tierCounts")
        if tier_counts is not None:
            if not isinstance(tier_counts, dict) or len(tier_counts) > 5:
                logger.warning("Payload firewall: tierCounts must be dict with <= 5 keys")
                return False
            for val in tier_counts.values():
                if not isinstance(val, int) or val < 0:
                    logger.warning("Payload firewall: tierCounts value must be non-negative int")
                    return False

        # entityTypeTotals <= 64 keys, key regex
        ent_totals = payload.get("entityTypeTotals")
        if ent_totals is not None:
            if not isinstance(ent_totals, dict) or len(ent_totals) > 64:
                logger.warning("Payload firewall: entityTypeTotals must be dict with <= 64 keys")
                return False
            for k, val in ent_totals.items():
                if not _ENTITY_TYPE_REGEX.match(k):
                    logger.warning(f"Payload firewall: entityType key format invalid")
                    return False
                if not isinstance(val, int) or val < 0:
                    logger.warning("Payload firewall: entityType count must be non-negative int")
                    return False

        # files array <= 200 items
        files = payload.get("files")
        if files is not None:
            if not isinstance(files, list) or len(files) > MAX_PER_FILE_FINDINGS:
                logger.warning("Payload firewall: files array exceeds max 200 items")
                return False
            for f in files:
                if not _assert_payload_safe("scan_file_item", f, sync_full_paths):
                    return False

    elif kind == "scan_file_item":
        path_ref = payload.get("pathRef", "")
        if not isinstance(path_ref, str) or len(path_ref) > 512:
            logger.warning("Payload firewall: pathRef invalid")
            return False
        if not sync_full_paths and _WINDOWS_PATH_REGEX.search(path_ref):
            logger.warning("Payload firewall: literal path detected in pathRef while syncFullPaths is off")
            return False

    elif kind == "enforcement_summary":
        windows = payload.get("windows")
        if not isinstance(windows, list) or len(windows) > 96:
            logger.warning("Payload firewall: windows array exceeds max 96 items")
            return False
        for w in windows:
            if not _assert_payload_safe("enforcement_window_item", w, sync_full_paths):
                return False

    elif kind == "enforcement_window_item":
        if payload.get("source") not in {"Word", "Excel", "Filesystem Watcher"}:
            logger.warning("Payload firewall: invalid enforcement source")
            return False
        if not isinstance(payload.get("overrideCount"), int) or payload.get("overrideCount") < 0:
            logger.warning("Payload firewall: overrideCount must be non-negative int")
            return False

    elif kind == "command_ack":
        detail = payload.get("detail")
        if detail is not None and len(str(detail)) > 2048:
            logger.warning("Payload firewall: command ack detail exceeds 2048 chars")
            return False

    return True


# ─── Telemetry Client Operations ─────────────────────────────────────────────

def send_ping(
    service_running: bool = True,
    watcher_active: bool = True,
    service_started_at: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Sends periodic telemetry ping (default interval: 180s) to the TrustFabric API.
    - Zero network calls if unlicensed / standalone.
    - Never raises to callers; failures are logged at debug level.
    - Dispatches returned commands and updates local server-supplied telemetry config.
    """
    if not is_registered():
        return None

    allowed, _ = enforcement_status()
    if not allowed:
        return None

    state = _load_state()
    base_url = get_backend_url()
    url = f"{base_url}/agent/telemetry/ping"

    outbox_depth = db_manager.get_telemetry_outbox_depth()

    payload = {
        "clientTime": datetime.now(timezone.utc).isoformat(),
        "serviceRunning": service_running,
        "watcherActive": watcher_active,
        "serviceStartedAt": service_started_at,
        "policyHash": compute_policy_hash(),
        "agentVersion": AGENT_VERSION,
        "applicationVersion": AGENT_VERSION,
        "outboxDepth": outbox_depth,
    }

    if not _assert_payload_safe("ping", payload):
        return None

    try:
        resp = requests.post(
            url,
            json=payload,
            headers=_authorized_headers(state),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        if resp.status_code in (401, 403):
            logger.warning(f"Ping rejected with {resp.status_code} (revoked/unauthorized). Halting telemetry.")
            update_policy_status("REVOKED", revoked=True)
            return None

        if resp.status_code != 200:
            logger.debug(f"Ping returned unexpected status {resp.status_code}")
            return None

        data = resp.json()

        # Update local license policy if installation status returned
        inst_status = data.get("installationStatus")
        if inst_status:
            update_policy_status(
                status=inst_status,
                suspended=(inst_status == "SUSPENDED"),
                revoked=(inst_status == "REVOKED"),
            )

        # Update local server telemetry config
        telemetry_config = data.get("telemetry", {})
        telem_state = _load_telemetry_state()
        if telemetry_config:
            interval = telemetry_config.get("intervalSeconds", DEFAULT_PING_INTERVAL_SECONDS)
            clamped_interval = max(MIN_PING_INTERVAL_SECONDS, min(MAX_PING_INTERVAL_SECONDS, interval))
            telem_state["telemetry_config"] = {
                "enabled": telemetry_config.get("enabled", True),
                "intervalSeconds": clamped_interval,
                "syncFullPaths": telemetry_config.get("syncFullPaths", False),
            }
        telem_state["last_sync_time"] = datetime.now(timezone.utc).isoformat()
        _save_telemetry_state(telem_state)

        # Dispatch commands if any
        commands = data.get("commands", [])
        if commands:
            dispatch_commands(commands)

        return data

    except Exception as e:
        logger.debug(f"Telemetry ping failed (offline/unreachable): {e}")
        return None


def enqueue_scan_summary(scan_data: Dict[str, Any], findings: List[Dict[str, Any]]) -> None:
    """
    Enqueues completed/cancelled/failed scan summary into the local outbox in history.db.
    Zero network calls, non-blocking.
    Applies privacy contract (§3) and caps per-file findings to 200 rows (tier >= Confidential).
    """
    if not is_registered():
        return

    telem_state = _load_telemetry_state()
    sync_full_paths = telem_state.get("telemetry_config", {}).get("syncFullPaths", False)

    # 1. Summarize target
    raw_target = scan_data.get("target_folder", "")
    target_summary = None
    if sync_full_paths:
        target_summary = str(raw_target)[:128]
    else:
        # Coarse drive letters only (e.g. "Full system: C:")
        drives = re.findall(r"[A-Za-z]:", str(raw_target))
        if drives:
            target_summary = f"Drives: {', '.join(sorted(set(drives)))}"
        else:
            target_summary = "Custom directory scan"

    # 2. Count findings by tier and entity type
    tier_counts: Dict[str, int] = {}
    entity_type_totals: Dict[str, int] = {}

    file_findings_map: Dict[str, Dict[str, Any]] = {}

    for f in findings:
        tier = f.get("classification") or "General"
        entity = f.get("entity", "")
        tier_counts[tier] = tier_counts.get(tier, 0) + 1

        if entity and _ENTITY_TYPE_REGEX.match(entity):
            entity_type_totals[entity] = entity_type_totals.get(entity, 0) + 1

        file_path = f.get("file", "")
        if file_path:
            if file_path not in file_findings_map:
                file_findings_map[file_path] = {
                    "file_path": file_path,
                    "tier": tier,
                    "entity_counts": {},
                    "watermark_status": f.get("watermark_status", "none").upper(),
                }
            cur = file_findings_map[file_path]
            # Keep highest tier for the file
            if TIER_ORDER.get(tier, 0) > TIER_ORDER.get(cur["tier"], 0):
                cur["tier"] = tier
            if entity:
                cur["entity_counts"][entity] = cur["entity_counts"].get(entity, 0) + 1

    # Filter files: tier >= Confidential (Confidential, Highly Confidential, Restricted)
    eligible_files = [
        item for item in file_findings_map.values()
        if TIER_ORDER.get(item["tier"], 0) >= TIER_ORDER.get("Confidential", 3)
    ]

    # Sort highest tier first
    eligible_files.sort(key=lambda x: TIER_ORDER.get(x["tier"], 0), reverse=True)

    files_truncated = len(eligible_files) > MAX_PER_FILE_FINDINGS
    capped_files = eligible_files[:MAX_PER_FILE_FINDINGS]

    formatted_files = []
    for item in capped_files:
        path_ref = compute_path_reference(item["file_path"], sync_full_paths)
        wm_status = item["watermark_status"] if item["watermark_status"] in {"APPLIED", "PENDING"} else None
        formatted_files.append({
            "pathRef": path_ref,
            "tier": item["tier"],
            "entityTypeCounts": item["entity_counts"],
            "watermarkStatus": wm_status,
        })

    # Highest tier in scan
    highest_tier = None
    if tier_counts:
        highest_tier = max(tier_counts.keys(), key=lambda t: TIER_ORDER.get(t, 0))

    client_scan_id = scan_data.get("client_scan_id") or scan_data.get("scan_id")

    payload = {
        "clientScanId": str(client_scan_id),
        "scanSource": scan_data.get("scan_source", "directory_scan"),
        "targetSummary": target_summary,
        "startedAt": scan_data.get("started_at") or datetime.now(timezone.utc).isoformat(),
        "completedAt": scan_data.get("completed_at"),
        "status": scan_data.get("status", "completed"),
        "durationSeconds": int(round(scan_data.get("duration_seconds", 0.0))),
        "filesScanned": int(scan_data.get("files_scanned", 0)),
        "filesWithPii": int(scan_data.get("files_with_pii", 0)),
        "totalFindings": int(scan_data.get("total_findings", 0)),
        "highestTier": highest_tier,
        "tierCounts": tier_counts,
        "entityTypeTotals": entity_type_totals,
        "files": formatted_files,
        "filesTruncated": files_truncated,
    }

    if not _assert_payload_safe("scan_summary", payload, sync_full_paths):
        return

    try:
        db_manager.enqueue_telemetry_outbox("scan_summary", json.dumps(payload))
        logger.debug(f"Enqueued scan summary {client_scan_id} to outbox")
    except Exception as e:
        logger.error(f"Failed to enqueue scan summary: {e}")


def aggregate_enforcement_windows() -> None:
    """
    Aggregates enforcement events from history.db into closed 15-minute UTC-aligned windows.
    Strict privacy contract:
    - Never reads or sends file_path, override_reason, or entity_summary.
    - Only closed windows (windowEnd <= current UTC time) are enqueued.
    - Advances high-water mark of enforcement_events.id.
    """
    if not is_registered():
        return

    telem_state = _load_telemetry_state()
    hwm = telem_state.get("enforcement_high_water_mark", 0)

    try:
        with db_manager._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, timestamp, tier, action_taken, user_override, app_source
                FROM enforcement_events
                WHERE id > ?
                ORDER BY id ASC
                """,
                (hwm,),
            )
            rows = cursor.fetchall()
            if not rows:
                return

            now_utc = datetime.now(timezone.utc)
            buckets: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
            max_id_seen = hwm

            for r in rows:
                row_id = r["id"]
                if row_id > max_id_seen:
                    max_id_seen = row_id

                ts_str = r["timestamp"]
                try:
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue

                # Align to 15-minute UTC bucket
                minute = (dt.minute // 15) * 15
                window_start = dt.replace(minute=minute, second=0, microsecond=0)
                window_end = window_start + timedelta(minutes=15)

                # CLOSED windows only
                if window_end > now_utc:
                    continue

                source = r["app_source"]
                if source not in {"Word", "Excel", "Filesystem Watcher"}:
                    source = "Filesystem Watcher"

                w_start_iso = window_start.isoformat()
                w_end_iso = window_end.isoformat()
                bucket_key = (w_start_iso, w_end_iso, source)

                if bucket_key not in buckets:
                    buckets[bucket_key] = {
                        "windowStart": w_start_iso,
                        "windowEnd": w_end_iso,
                        "source": source,
                        "actionCounts": {},
                        "tierCounts": {},
                        "overrideCount": 0,
                    }

                b = buckets[bucket_key]
                action = str(r["action_taken"]).lower()
                b["actionCounts"][action] = b["actionCounts"].get(action, 0) + 1

                tier = r["tier"] or "General"
                b["tierCounts"][tier] = b["tierCounts"].get(tier, 0) + 1

                if r["user_override"]:
                    b["overrideCount"] += 1

            if buckets:
                windows_list = list(buckets.values())[:96]
                payload = {"windows": windows_list}
                if _assert_payload_safe("enforcement_summary", payload):
                    db_manager.enqueue_telemetry_outbox("enforcement_summary", json.dumps(payload))
                    logger.debug(f"Enqueued {len(windows_list)} enforcement windows to outbox")

            # Advance high water mark
            if max_id_seen > hwm:
                telem_state["enforcement_high_water_mark"] = max_id_seen
                _save_telemetry_state(telem_state)

    except Exception as e:
        logger.error(f"Failed to aggregate enforcement windows: {e}")


def flush_outbox() -> None:
    """
    Flushes queued scan and enforcement summaries to the backend API.
    - If company turned telemetry off in last config, summaries are not sent.
    - Idempotent: safe if network drops and retry occurs.
    - Never raises to callers.
    """
    if not is_registered():
        return

    allowed, _ = enforcement_status()
    if not allowed:
        return

    telem_state = _load_telemetry_state()
    if not telem_state.get("telemetry_config", {}).get("enabled", True):
        return

    items = db_manager.claim_telemetry_outbox(limit=20)
    if not items:
        return

    base_url = get_backend_url()
    state = _load_state()
    headers = _authorized_headers(state)

    for item in items:
        item_id = item["id"]
        kind = item["kind"]
        try:
            payload = json.loads(item["payload_json"])
            if kind == "scan_summary":
                url = f"{base_url}/agent/telemetry/scan-summary"
            elif kind == "enforcement_summary":
                url = f"{base_url}/agent/telemetry/enforcement-summary"
            else:
                db_manager.ack_telemetry_outbox([item_id])
                continue

            resp = requests.post(url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
            if resp.status_code in (200, 201):
                db_manager.ack_telemetry_outbox([item_id])
            elif resp.status_code in (401, 403):
                # Revoked or non-active: stop
                if resp.status_code == 401:
                    update_policy_status("REVOKED", revoked=True)
                db_manager.release_telemetry_outbox([item_id])
                break
            else:
                db_manager.release_telemetry_outbox([item_id])
        except Exception as e:
            logger.debug(f"Outbox send failed for item {item_id}: {e}")
            db_manager.release_telemetry_outbox([item_id])


# ─── Command Dispatcher ──────────────────────────────────────────────────────

def dispatch_commands(commands: List[Dict[str, Any]]) -> None:
    """
    Processes administrative commands received in the ping response.
    Acknowledges before executing disruptive actions.
    Deduplicates commands by ID.
    """
    telem_state = _load_telemetry_state()
    processed_ids = set(telem_state.get("processed_command_ids", []))

    for cmd in commands:
        cmd_id = cmd.get("id")
        cmd_type = cmd.get("type")

        if not cmd_id or cmd_id in processed_ids:
            continue

        logger.info(f"Received fleet command: {cmd_type} ({cmd_id})")

        if cmd_type == "force_policy_refresh":
            try:
                from backend.license_client import get_policy
                get_policy()
                acknowledge_command(cmd_id, "success", "Policy refreshed successfully")
            except Exception as e:
                acknowledge_command(cmd_id, "failed", f"Refresh failed: {str(e)[:100]}")

        elif cmd_type == "request_service_restart":
            # Acknowledge success BEFORE restarting
            acknowledge_command(cmd_id, "success", "Restart accepted by agent")
            try:
                from service.service_controller import restart_service
                restart_service()
            except Exception as e:
                logger.error(f"Service restart failed: {e}")

        elif cmd_type == "request_diagnostic_snapshot":
            snapshot = _collect_diagnostic_snapshot()
            acknowledge_command(cmd_id, "success", json.dumps(snapshot)[:2000])

        else:
            acknowledge_command(cmd_id, "unsupported", f"Command type {cmd_type} not supported")

        processed_ids.add(cmd_id)

    telem_state["processed_command_ids"] = list(processed_ids)[-100:]  # keep last 100
    _save_telemetry_state(telem_state)


def acknowledge_command(command_id: str, result: str, detail: Optional[str] = None) -> bool:
    """Sends command acknowledgement back to backend."""
    if not is_registered():
        return False

    base_url = get_backend_url()
    url = f"{base_url}/agent/telemetry/command-ack"
    state = _load_state()

    payload = {
        "commandId": command_id,
        "result": result,
        "detail": detail[:2000] if detail else None,
    }

    if not _assert_payload_safe("command_ack", payload):
        return False

    try:
        resp = requests.post(url, json=payload, headers=_authorized_headers(state), timeout=REQUEST_TIMEOUT_SECONDS)
        return resp.status_code == 200
    except Exception as e:
        logger.debug(f"Command ack failed: {e}")
        return False


def _collect_diagnostic_snapshot() -> Dict[str, Any]:
    """
    Collects opaque diagnostic snapshot <= 2KB.
    No file contents, paths, usernames, or PII values.
    """
    outbox_depth = db_manager.get_telemetry_outbox_depth()
    last_sync = _load_telemetry_state().get("last_sync_time")

    return {
        "agentVersion": AGENT_VERSION,
        "os": "Windows",
        "osBuild": platform.version(),
        "pythonVersion": platform.python_version(),
        "outboxDepth": outbox_depth,
        "lastSyncTime": last_sync,
        "licenseStatus": "OK" if enforcement_status()[0] else "GATED",
    }

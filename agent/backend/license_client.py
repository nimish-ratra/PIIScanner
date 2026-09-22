"""
TrustFabric Licensing Client for PII Sentinel
Implements the agent side of TrustFabric's Agent Protocol (register / heartbeat /
policy / release) with the same offline-tolerant grace-period model the backend
expects: cache the last known-good policy locally and keep enforcing it for a
bounded window if the backend is unreachable, but honor a known suspended/revoked
state immediately regardless of how recently we last checked in.

State is persisted to %APPDATA%\\PIISentinel\\license.json, following the same
per-user local-file pattern already used by backend/service_auth.py for the
loopback service token.
"""

import os
import ipaddress
import json
import logging
import hashlib
import platform
import socket
import uuid as uuid_module
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit

import requests
import win32crypt

from backend.config import get_app_dir

logger = logging.getLogger("pii_sentinel.license")

LICENSE_FILE_NAME = "license.json"
DEFAULT_BACKEND_URL = "http://localhost:3001/api/v1"  # local dev TrustFabric API; overridden for real deployments
AGENT_VERSION = "1.1.0"
REQUEST_TIMEOUT_SECONDS = 10

_cached_state: Optional[Dict[str, Any]] = None


class LicenseError(Exception):
    """A definitive licensing rejection (bad/expired/exhausted token, revoked credential, etc.),
    as distinct from a network/connectivity failure — callers should treat those differently
    per the protocol's offline-grace-period rules."""


class LicenseConfigError(LicenseError):
    """The configured backend URL fails the transport-security check (see _validate_backend_url) —
    a misconfiguration, not a server rejection, but treated as a LicenseError so existing callers'
    except LicenseError handlers already surface it correctly."""


_LOCALHOST_NAMES = {"localhost", "127.0.0.1", "::1"}


def _is_loopback_or_private_host(hostname: str) -> bool:
    """Check if the hostname is a local loopback name or private RFC 1918 / RFC 4193 IP."""
    if hostname in _LOCALHOST_NAMES:
        return True
    try:
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def _validate_backend_url(url: str) -> str:
    """
    Refuse to send licensing credentials (enrollment tokens, installation
    secrets) to anything but an HTTPS endpoint. The only exception is
    localhost and private LAN IPs (e.g. mobile hotspot / test lab), for local
    development against a plain-HTTP dev API server — never appropriate for a
    real deployment, where PIISENTINEL_LICENSE_BACKEND_URL or the persisted
    config must be an https:// URL.
    """
    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme == "https":
        return url.rstrip("/")
    if parsed.scheme == "http" and _is_loopback_or_private_host(hostname):
        return url.rstrip("/")
    raise LicenseConfigError(
        f"Refusing to send licensing credentials to a non-HTTPS backend URL ({url!r}). "
        "Only https:// is permitted outside of localhost/private LAN development."
    )


def get_license_file_path() -> Path:
    """Return the path to license.json in %APPDATA%\\PIISentinel."""
    return get_app_dir() / LICENSE_FILE_NAME


def get_backend_url() -> str:
    """Resolve the TrustFabric backend base URL: env var (installer-set) > persisted
    config (Settings) > local dev default. Every source is validated the same way —
    see _validate_backend_url. Only the *lookup* of the persisted config is best-effort
    (it may not be available during early bootstrapping); an invalid URL value itself
    must still raise LicenseConfigError rather than silently falling back to the default."""
    env_url = os.getenv("PIISENTINEL_LICENSE_BACKEND_URL")
    if env_url:
        return _validate_backend_url(env_url)

    configured = ""
    try:
        from backend.config import config_manager
        configured = config_manager.get("license_backend_url", "")
    except Exception:
        pass
    if configured:
        return _validate_backend_url(configured)

    return _validate_backend_url(DEFAULT_BACKEND_URL)


_DPAPI_DESCRIPTION = "PIISentinel license state"


def _load_state() -> Dict[str, Any]:
    """Reads and DPAPI-decrypts license.json. DPAPI ties the ciphertext to the
    current Windows user account, so the installation credential can't just be
    copied off disk and read by another account or machine. Falls back to
    plain-JSON parsing for a pre-encryption file left over from local testing
    before this was added — never a real migration path, just graceful decay."""
    global _cached_state
    if _cached_state is not None:
        return _cached_state
    path = get_license_file_path()
    if path.exists():
        try:
            encrypted = path.read_bytes()
            _, decrypted = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
            _cached_state = json.loads(decrypted.decode("utf-8"))
            return _cached_state
        except Exception as e:
            logger.debug(f"DPAPI decrypt failed, trying legacy plaintext format: {e}")
            try:
                _cached_state = json.loads(path.read_text(encoding="utf-8"))
                return _cached_state
            except Exception as e2:
                logger.warning(f"Could not read license state, treating as unlicensed: {e2}")
    _cached_state = {}
    return _cached_state


def _save_state(state: Dict[str, Any]) -> None:
    global _cached_state
    _cached_state = state
    path = get_license_file_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps(state, indent=2).encode("utf-8")
        encrypted = win32crypt.CryptProtectData(plaintext, _DPAPI_DESCRIPTION, None, None, None, 0)
        path.write_bytes(encrypted)
    except Exception as e:
        logger.error(f"Failed to persist license state: {e}")


def is_registered() -> bool:
    state = _load_state()
    return bool(state.get("installationId") and state.get("credential"))


def compute_device_fingerprint() -> str:
    """
    Derive a stable, opaque device identifier. Reads the machine's BIOS/SMBIOS
    UUID via WMI (pywin32 is already a project dependency) rather than trusting
    an easily-spoofed self-reported value, and hashes it locally so the raw
    hardware serial itself is never sent over the network — fitting for a
    product whose whole premise is not leaking identifying data unnecessarily.
    Falls back to a MAC-address-derived id if WMI is unavailable.
    """
    raw_id = None
    try:
        import win32com.client
        wmi = win32com.client.GetObject("winmgmts:")
        for item in wmi.InstancesOf("Win32_ComputerSystemProduct"):
            candidate = getattr(item, "UUID", None)
            # Some virtualized/OEM images ship the well-known all-zero/placeholder UUID.
            if candidate and candidate.strip("0-") and candidate != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF":
                raw_id = candidate
                break
    except Exception as e:
        logger.debug(f"WMI UUID lookup unavailable, falling back to MAC-derived id: {e}")

    if not raw_id:
        raw_id = str(uuid_module.getnode())

    return hashlib.sha256(raw_id.encode("utf-8")).hexdigest()[:32]


def _device_metadata() -> Dict[str, str]:
    return {
        "deviceId": compute_device_fingerprint(),
        "hostname": socket.gethostname(),
        "os": "Windows",
        "osVersion": platform.version(),
        "architecture": platform.machine(),
        "applicationVersion": AGENT_VERSION,
        "agentVersion": AGENT_VERSION,
    }


def _authorized_headers(state: Dict[str, Any]) -> Dict[str, str]:
    # state['credential'] is already the full "<installationId>.<secret>" string
    # returned by POST /agent/register (see docs/agent-protocol.md) — do not
    # prepend installationId again here, or AgentAuthGuard's split-on-first-dot
    # parsing extracts the wrong secret and every authenticated call is
    # rejected as an "invalid credential" that looks identical to a real revoke.
    return {"Authorization": f"Bearer {state['credential']}"}


def register(enrollment_token: str, employee_name: str = "", employee_email: str = "") -> Dict[str, Any]:
    """
    Redeem an enrollment token against POST /agent/register, consuming one seat
    and creating this device's Installation. Raises LicenseError on a definitive
    rejection (invalid/expired/exhausted token; a plain/legacy token also
    requires employee_name/employee_email — the backend is the source of truth
    on when that's required, this client just passes through what it's given);
    network failures raise requests.RequestException so the caller can tell
    "offline" apart from "bad token."
    """
    url = f"{get_backend_url()}/agent/register"
    payload = {"enrollmentToken": enrollment_token.strip(), **_device_metadata()}
    if employee_name.strip():
        payload["employeeName"] = employee_name.strip()
    if employee_email.strip():
        payload["employeeEmail"] = employee_email.strip()

    resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("message", resp.text)
        except Exception:
            detail = resp.text
        raise LicenseError(f"Activation failed: {detail}")

    data = resp.json()
    state = {
        "installationId": data["installationId"],
        "credential": data["credential"],
        "companyId": data.get("companyId"),
        "heartbeatIntervalSeconds": data.get("heartbeatIntervalSeconds", 86400),
        "gracePeriodDays": data.get("gracePeriodDays", 14),
        "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
        "lastPolicy": {
            "status": data.get("status", "ACTIVE"),
            "suspended": False,
            "revoked": False,
        },
    }
    _save_state(state)
    logger.info(f"Activated installation {state['installationId']} against {url}")
    return state


def heartbeat() -> Dict[str, Any]:
    """
    Check in with POST /agent/heartbeat. On success, refreshes the cached policy
    and lastCheckinAt. A rejected credential (401/403 — revoked) is recorded as
    a definitive bad state immediately; any other failure (network, 5xx) is
    left for enforcement_status()'s grace-period logic to handle and is
    re-raised so the caller (the heartbeat loop) knows to retry sooner.
    """
    state = _load_state()
    if not is_registered():
        raise LicenseError("Not activated — no installation credential on file")

    url = f"{get_backend_url()}/agent/heartbeat"
    body = {"agentVersion": AGENT_VERSION, "applicationVersion": AGENT_VERSION}
    resp = requests.post(url, json=body, headers=_authorized_headers(state), timeout=REQUEST_TIMEOUT_SECONDS)

    if resp.status_code in (401, 403):
        state["lastPolicy"] = {"status": "REVOKED", "suspended": False, "revoked": True}
        _save_state(state)
        raise LicenseError("Installation credential rejected by server (revoked?)")
    resp.raise_for_status()

    data = resp.json()
    state["lastCheckinAt"] = datetime.now(timezone.utc).isoformat()
    state["heartbeatIntervalSeconds"] = data.get("heartbeatIntervalSeconds", state.get("heartbeatIntervalSeconds", 86400))
    state["gracePeriodDays"] = data.get("gracePeriodDays", state.get("gracePeriodDays", 14))
    state["lastPolicy"] = {
        "status": data.get("status"),
        "suspended": bool(data.get("suspended")),
        "revoked": bool(data.get("revoked")),
    }
    _save_state(state)
    return state


def get_policy() -> Dict[str, Any]:
    """Read-only GET /agent/policy — does not advance lastCheckinAt server-side,
    but still refreshes our local cache on success like heartbeat() does."""
    state = _load_state()
    if not is_registered():
        raise LicenseError("Not activated — no installation credential on file")

    url = f"{get_backend_url()}/agent/policy"
    resp = requests.get(url, headers=_authorized_headers(state), timeout=REQUEST_TIMEOUT_SECONDS)
    if resp.status_code in (401, 403):
        state["lastPolicy"] = {"status": "REVOKED", "suspended": False, "revoked": True}
        _save_state(state)
        raise LicenseError("Installation credential rejected by server (revoked?)")
    resp.raise_for_status()

    data = resp.json()
    state["lastPolicy"] = {
        "status": data.get("status"),
        "suspended": bool(data.get("suspended")),
        "revoked": bool(data.get("revoked")),
    }
    _save_state(state)
    return state


def update_policy_status(status: str, suspended: bool = False, revoked: bool = False) -> None:
    """
    Updates lastPolicy in license_state.json based on server-reported status.
    Ensures that real-time status transitions (e.g. from telemetry pings) immediately
    update local enforcement.
    """
    state = _load_state()
    if not is_registered():
        return
    current_policy = state.get("lastPolicy", {})
    new_policy = {
        "status": status,
        "suspended": suspended or status == "SUSPENDED",
        "revoked": revoked or status == "REVOKED",
    }
    if current_policy != new_policy:
        state["lastPolicy"] = new_policy
        _save_state(state)
        logger.info(
            f"License policy updated from server: status={status}, "
            f"suspended={new_policy['suspended']}, revoked={new_policy['revoked']}"
        )


def refresh_policy(timeout_seconds: float = 3.0) -> Tuple[bool, str]:
    """
    Actively queries the TrustFabric server to refresh the policy cache.
    - If 401/403: records REVOKED state immediately.
    - If 200: updates cached status, suspended, revoked flags.
    - If unreachable/timeout: gracefully falls back to cached grace-period logic.
    Returns (allowed, reason) per enforcement_status().
    """
    if not is_registered():
        return False, "Not activated"

    state = _load_state()
    url = f"{get_backend_url()}/agent/policy"
    try:
        resp = requests.get(url, headers=_authorized_headers(state), timeout=timeout_seconds)
        if resp.status_code in (401, 403):
            update_policy_status("REVOKED", revoked=True)
            return False, "License revoked"
        if resp.ok:
            data = resp.json()
            update_policy_status(
                status=data.get("status", "ACTIVE"),
                suspended=bool(data.get("suspended")),
                revoked=bool(data.get("revoked")),
            )
    except Exception as e:
        logger.debug(f"Live policy refresh failed (using cached state): {e}")

    return enforcement_status()


def release() -> None:
    """Self-release the seat (e.g. on uninstall) via POST /agent/release. Best-effort:
    the local credential is cleared either way so a stale/offline release attempt
    never leaves the device stuck thinking it still holds a seat."""
    state = _load_state()
    if not is_registered():
        return
    try:
        url = f"{get_backend_url()}/agent/release"
        requests.post(url, headers=_authorized_headers(state), timeout=REQUEST_TIMEOUT_SECONDS)
    except Exception as e:
        logger.warning(f"Best-effort seat release failed (clearing local state anyway): {e}")
    finally:
        _save_state({})


def enforcement_status() -> Tuple[bool, str]:
    """
    Decide whether the agent may keep enforcing right now, per the protocol's
    grace-period rules:
      1. Never activated -> not allowed.
      2. A cached policy known to be suspended/revoked -> not allowed, immediately,
         regardless of how recently we checked in (grace period only covers
         *unreachability*, never a known-bad state).
      3. A cached policy still PENDING (a plain-token registration awaiting
         Company Admin approval — see docs/activation-domain.md's self-service
         flow) -> not allowed, immediately, same as suspended/revoked. This is
         not a bad state, just not yet a granted one; the next heartbeat will
         pick up ACTIVE once approved.
      4. Otherwise allowed until heartbeatIntervalSeconds + gracePeriodDays have
         elapsed since the last successful check-in.
    Returns (allowed, reason).
    """
    state = _load_state()
    if not is_registered():
        return False, "Not activated"

    policy = state.get("lastPolicy", {})
    if policy.get("revoked"):
        return False, "License revoked"
    if policy.get("suspended"):
        return False, "License suspended"
    if policy.get("status") == "PENDING":
        return False, "Awaiting admin approval"

    last_checkin = state.get("lastCheckinAt")
    if not last_checkin:
        return False, "Never checked in"

    try:
        last_dt = datetime.fromisoformat(last_checkin)
    except Exception:
        return False, "Corrupt license state"

    interval_s = state.get("heartbeatIntervalSeconds", 86400)
    grace_s = state.get("gracePeriodDays", 14) * 86400
    elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()

    if elapsed > interval_s + grace_s:
        return False, "Grace period expired — reconnect to TrustFabric required"
    return True, "OK"

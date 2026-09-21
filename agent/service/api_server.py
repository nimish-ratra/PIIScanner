"""
PII Sentinel Real-Time Enforcement Service API Server (Phase 2)
FastAPI microservice strictly bound to 127.0.0.1 (loopback only).
Exposes classification endpoints for Office Add-in and File Watcher.
Reuses existing backend/presidio_detector.py, backend/classifier.py,
backend/tika_extractor.py, and backend/database.py.
Air-gapped & local-first.
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Literal

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict

# Ensure project root is in python path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.config import get_logs_dir, config_manager
from backend.service_auth import TOKEN_HEADER, verify_service_token
from backend.presidio_detector import PresidioDetector, redact_value
from backend.classifier import classify_document, classify_finding, SensitivityTier
from backend.tika_extractor import TikaExtractor
from backend.database import db_manager
from service.enforcement_policy import policy_manager, EnforcementAction

# Set up rotating enforcement logger
enforcement_log_dir = get_logs_dir()
enforcement_log_dir.mkdir(parents=True, exist_ok=True)
log_file = enforcement_log_dir / "enforcement.log"

logger = logging.getLogger("pii_sentinel.enforcement")
logger.setLevel(logging.INFO)
if not logger.handlers:
    from logging.handlers import RotatingFileHandler
    handler = RotatingFileHandler(str(log_file), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)


# -------------------------------------------------------------
# Request & Response Pydantic Schemas
# -------------------------------------------------------------

class FindingItem(BaseModel):
    entity_type: str
    redacted_value: str
    confidence: float
    start: int = 0
    end: int = 0


class TextClassificationRequest(BaseModel):
    text: str = Field(..., description="Document content text extracted in memory")
    source_hint: str = Field(default="Office", description="Origin application hint (e.g. Word, Excel, Notepad)")


class TextClassificationResponse(BaseModel):
    tier: str
    level: int
    badge: str
    findings: List[FindingItem]
    recommended_action: str
    rationale: str
    total_findings: int


class FileClassificationRequest(BaseModel):
    path: str = Field(..., description="Absolute path to file on disk")
    source_hint: str = Field(default="Watcher", description="Caller identifier")


class FileClassificationResponse(BaseModel):
    tier: str
    level: int
    badge: str
    findings: List[FindingItem]
    recommended_action: str
    rationale: str
    total_findings: int
    file_path: str


class EnforcementLogRequest(BaseModel):
    file_path: str
    tier: str
    action_taken: str
    user_override: bool = False
    override_reason: Optional[str] = ""
    entity_summary: Optional[str] = ""
    source: Optional[str] = "Office Add-in"
    detection_types: Optional[str] = ""
    app_source: Optional[str] = None


class PolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    realtime_selected_entities: Optional[List[str]] = None
    tier_actions: Optional[Dict[str, str]] = None
    fail_open: Optional[bool] = None
    fail_safe_mode: Optional[Literal["fail-closed", "fail-open"]] = None
    watched_folders: Optional[List[str]] = None
    quarantine_archive_path: Optional[str] = None
    quarantine_password: Optional[str] = None
    enforce_office: Optional[bool] = None
    enforce_watcher: Optional[bool] = None
    toast_notifications: Optional[bool] = None
    api_port: Optional[int] = None


class RealtimeEntitiesUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    realtime_selected_entities: List[str]


SECRET_POLICY_FIELDS = {"quarantine_password"}


def redact_policy_dict(policy_data: Dict[str, Any]) -> Dict[str, Any]:
    """Strip or mask secret fields before returning to callers."""
    redacted = dict(policy_data)
    for field in SECRET_POLICY_FIELDS:
        if field in redacted:
            val = redacted[field]
            if val:
                redacted[field] = "********"
            else:
                redacted[field] = None
    return redacted


# -------------------------------------------------------------
# FastAPI App & Security Middleware
# -------------------------------------------------------------

app = FastAPI(
    title="PII Sentinel Real-Time Enforcement API",
    version="2.0.0",
    description="Local classification microservice for Office add-ins and filesystem save enforcement.",
    docs_url=None,   # Disable public OpenAPI docs in production
    redoc_url=None
)

# CORS restricted strictly to localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def verify_loopback_and_auth(request: Request, call_next):
    """
    Two-Tier Security Gate:
    1. Loopback IP Enforcement: Guarantee 100% air-gapped local confinement.
    2. Shared-Secret Bearer Token Enforcement: Prevent unauthorized browser JS / local process CSRF.
       Requires X-PIISentinel-Token matching %APPDATA%\\PIISentinel\\service_token.
    """
    # Defense 1: Loopback IP verification
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        logger.warning(f"Rejected non-loopback connection attempt from IP: {client_host}")
        return Response(
            content='{"error": "Access Denied: Non-loopback client rejected. PII Sentinel is 100% local."}',
            status_code=status.HTTP_403_FORBIDDEN,
            media_type="application/json"
        )

    # Defense 2: Shared-secret token verification (required on all endpoints including /health)
    provided_token = request.headers.get(TOKEN_HEADER)
    if not verify_service_token(provided_token):
        logger.warning(f"Rejected request to {request.url.path} from {client_host}: Missing or invalid {TOKEN_HEADER}")
        return Response(
            content='{"error": "Access Denied: Non-loopback client rejected. PII Sentinel is 100% local."}',
            status_code=status.HTTP_403_FORBIDDEN,
            media_type="application/json"
        )

    return await call_next(request)


# -------------------------------------------------------------
# Endpoints
# -------------------------------------------------------------

@app.get("/health")
def health():
    """Liveness probe used by Office Add-in and File Watcher."""
    return {
        "status": "healthy",
        "service": "PII Sentinel Classification Microservice",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0",
        "port": policy_manager.api_port,
        "fail_open": policy_manager.fail_open
    }


@app.post("/classify/text", response_model=TextClassificationResponse)
def classify_text(req: TextClassificationRequest):
    """
    Classify in-memory text extracted from Word or Excel before disk write.
    Returns sensitivity tier, findings list, recommended action, and rationale.
    """
    text = req.text
    if not text or not text.strip():
        return TextClassificationResponse(
            tier=SensitivityTier.GENERAL.value,
            level=2,
            badge="⚪ General",
            findings=[],
            recommended_action=EnforcementAction.ALLOW.value,
            rationale="Empty document or no text content detected.",
            total_findings=0
        )

    detector = PresidioDetector.get_instance()
    raw_findings = detector.analyze_text(text, score_threshold=0.40)

    # Filter findings to real-time configured entity types
    allowed_types = set(config_manager.realtime_selected_entities)
    filtered_findings = [f for f in raw_findings if f.get("entity") in allowed_types]

    # Classify document
    classification = classify_document(filtered_findings)
    tier = classification["tier"]
    level = classification["level"]
    badge = classification["badge"]
    rationale = classification["rationale"]

    # Evaluate action
    is_office = "office" in req.source_hint.lower() or "word" in req.source_hint.lower() or "excel" in req.source_hint.lower()
    recommended_action = policy_manager.get_action_for_tier(tier, is_office=is_office)

    # Format findings with safe redacted values
    findings_list: List[FindingItem] = []
    entity_counts: Dict[str, int] = {}
    for f in filtered_findings:
        ent = f.get("entity", "PII")
        entity_counts[ent] = entity_counts.get(ent, 0) + 1
        findings_list.append(FindingItem(
            entity_type=ent,
            redacted_value=f.get("value_redacted", redact_value(f.get("value", ""))),
            confidence=float(f.get("confidence", 0.0)),
            start=int(f.get("start", 0)),
            end=int(f.get("end", 0))
        ))

    # Log safe summary without plaintext PII
    summary_str = ", ".join([f"{k} ({v})" for k, v in entity_counts.items()])
    logger.info(
        f"Classified text from '{req.source_hint}': Tier={tier} (Level {level}) | "
        f"Action={recommended_action} | Findings={len(findings_list)} [{summary_str}]"
    )

    return TextClassificationResponse(
        tier=tier,
        level=level,
        badge=badge,
        findings=findings_list,
        recommended_action=recommended_action,
        rationale=rationale,
        total_findings=len(findings_list)
    )


@app.post("/classify/file", response_model=FileClassificationResponse)
def classify_file(req: FileClassificationRequest):
    """
    Classify a saved file on disk (used by File Watcher).
    Runs Tika text extraction followed by Presidio NLP + Purview classification.
    """
    file_path = Path(req.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")

    # Extract text
    extractor = TikaExtractor()
    extracted_text, _ = extractor.extract_text(str(file_path))

    if not extracted_text or not extracted_text.strip():
        return FileClassificationResponse(
            tier=SensitivityTier.GENERAL.value,
            level=2,
            badge="⚪ General",
            findings=[],
            recommended_action=EnforcementAction.ALLOW.value,
            rationale="No parseable text extracted from document.",
            total_findings=0,
            file_path=str(file_path)
        )

    detector = PresidioDetector.get_instance()
    raw_findings = detector.analyze_text(extracted_text, score_threshold=0.40)

    # Filter findings to real-time configured entity types
    allowed_types = set(config_manager.realtime_selected_entities)
    filtered_findings = [f for f in raw_findings if f.get("entity") in allowed_types]

    classification = classify_document(filtered_findings)
    tier = classification["tier"]
    level = classification["level"]
    badge = classification["badge"]
    rationale = classification["rationale"]

    recommended_action = policy_manager.get_action_for_tier(tier, is_office=False)

    findings_list: List[FindingItem] = []
    entity_counts: Dict[str, int] = {}
    for f in filtered_findings:
        ent = f.get("entity", "PII")
        entity_counts[ent] = entity_counts.get(ent, 0) + 1
        findings_list.append(FindingItem(
            entity_type=ent,
            redacted_value=f.get("value_redacted", redact_value(f.get("value", ""))),
            confidence=float(f.get("confidence", 0.0)),
            start=int(f.get("start", 0)),
            end=int(f.get("end", 0))
        ))

    summary_str = ", ".join([f"{k} ({v})" for k, v in entity_counts.items()])
    logger.info(
        f"Classified file '{file_path.name}': Tier={tier} (Level {level}) | "
        f"Action={recommended_action} | Findings={len(findings_list)} [{summary_str}]"
    )

    return FileClassificationResponse(
        tier=tier,
        level=level,
        badge=badge,
        findings=findings_list,
        recommended_action=recommended_action,
        rationale=rationale,
        total_findings=len(findings_list),
        file_path=str(file_path)
    )


@app.post("/enforcement/log")
def log_enforcement_event(req: EnforcementLogRequest):
    """
    Log an enforcement action (block, quarantine, warn, override) to history.db.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    app_src = req.app_source or req.source or "Generic"
    event_data = {
        "timestamp": timestamp,
        "file_path": req.file_path,
        "tier": req.tier,
        "action_taken": req.action_taken,
        "user_override": 1 if req.user_override else 0,
        "override_reason": req.override_reason or "",
        "entity_summary": req.entity_summary or "",
        "source": req.source or "Generic",
        "detection_types": req.detection_types or "",
        "app_source": app_src
    }

    event_id = db_manager.insert_enforcement_event(event_data)
    logger.info(
        f"Enforcement Event Logged: ID={event_id} | Action={req.action_taken} | "
        f"Tier={req.tier} | Override={req.user_override} | Source={app_src} | File={req.file_path}"
    )

    return {"success": True, "event_id": event_id, "timestamp": timestamp}


@app.get("/policy")
def get_policy():
    """Retrieve active enforcement policy including real-time entity selection with secret fields redacted."""
    data = policy_manager.to_dict()
    data["realtime_selected_entities"] = config_manager.realtime_selected_entities
    return redact_policy_dict(data)


@app.post("/policy")
def update_policy(req: PolicyUpdateRequest):
    """Update active enforcement policy with strict schema validation and forbidden extra fields."""
    updates = req.model_dump(exclude_unset=True)

    # Translate fail_safe_mode string if supplied
    if "fail_safe_mode" in updates:
        mode = updates.pop("fail_safe_mode")
        updates["fail_open"] = (mode == "fail-open")

    if "realtime_selected_entities" in updates and isinstance(updates["realtime_selected_entities"], list):
        config_manager.realtime_selected_entities = updates["realtime_selected_entities"]
        logger.info(f"Real-time selected entities updated via /policy: {len(updates['realtime_selected_entities'])} active.")
        updates.pop("realtime_selected_entities")

    policy_manager.update_from_dict(updates)
    logger.info("Enforcement policy updated via API.")

    # Hot-reload file watcher observer with updated watched folders / settings
    if hasattr(app.state, "runner") and app.state.runner:
        try:
            app.state.runner.reload_watcher()
        except Exception as e:
            logger.warning(f"Could not hot-reload file watcher: {e}")

    data = policy_manager.to_dict()
    data["realtime_selected_entities"] = config_manager.realtime_selected_entities
    return {"success": True, "policy": redact_policy_dict(data)}


@app.get("/policy/realtime-entities")
def get_realtime_entities():
    """Retrieve active real-time entity selection."""
    return {"realtime_selected_entities": config_manager.realtime_selected_entities}


@app.post("/policy/realtime-entities")
def update_realtime_entities(req: RealtimeEntitiesUpdateRequest):
    """Update active real-time entity selection."""
    entities = req.realtime_selected_entities
    config_manager.realtime_selected_entities = entities
    logger.info(f"Real-time selected entities updated via /policy/realtime-entities: {len(entities)} active.")
    return {"success": True, "realtime_selected_entities": config_manager.realtime_selected_entities}


@app.post("/service/stop")
def stop_service():
    """
    Gracefully stop the background service (Uvicorn + Watchdog).
    Idempotent and safe to invoke repeatedly.
    """
    def _shutdown():
        import time
        time.sleep(0.2)
        if hasattr(app.state, "runner") and app.state.runner:
            try:
                app.state.runner.stop()
            except Exception as e:
                logger.warning(f"Error stopping runner: {e}")

    import threading
    threading.Thread(target=_shutdown, daemon=True, name="StopServiceThread").start()
    return {"success": True, "message": "Service shutdown initiated"}


if __name__ == "__main__":
    import uvicorn
    print(f"Starting PII Sentinel Classification Microservice on http://127.0.0.1:{policy_manager.api_port} (Loopback Only)...")
    uvicorn.run("service.api_server:app", host="127.0.0.1", port=policy_manager.api_port, reload=False)



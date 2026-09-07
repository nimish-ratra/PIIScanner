"""
Quarantine Bridge for PII Sentinel File Watcher (Phase 2)
Encapsulates immediate post-write remediation for sensitive files.
Reuses backend/file_ops.py AES-256 encrypted quarantine archive logic.
Deletes original plaintext files and logs enforcement events to history.db.
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.file_ops import quarantine_flagged_files
from backend.database import db_manager
from service.enforcement_policy import policy_manager

logger = logging.getLogger("pii_sentinel.quarantine_bridge")


def quarantine_file(
    file_path: str,
    tier: str,
    findings: List[Dict[str, Any]],
    source: str = "File Watcher"
) -> Dict[str, Any]:
    """
    Quarantine a sensitive file:
    1. Package file into an AES-256 encrypted zip archive using backend/file_ops.py.
    2. Permanently delete the original plaintext file from disk.
    3. Log enforcement event into history.db.
    """
    path_obj = Path(file_path).resolve()
    if not path_obj.exists():
        return {"success": False, "error": f"File does not exist: {file_path}"}

    archive_dest = policy_manager.quarantine_archive_path
    password = policy_manager.quarantine_password

    # Summarize entity findings
    entity_counts: Dict[str, int] = {}
    for f in findings:
        ent = f.get("entity", f.get("entity_type", "PII"))
        entity_counts[ent] = entity_counts.get(ent, 0) + 1
    entity_summary = ", ".join([f"{k} ({v})" for k, v in entity_counts.items()]) or f"{len(findings)} PII findings"

    logger.info(f"Initiating quarantine for '{path_obj.name}' [Tier: {tier}, Findings: {entity_summary}]")

    # Reuse backend/file_ops.py
    res = quarantine_flagged_files(
        files=[str(path_obj)],
        zip_destination_path=archive_dest,
        root_scan_folder=str(path_obj.parent),
        password=password,
        rename_originals=False,
        delete_originals=True  # Ensure plaintext file is deleted
    )

    if res.get("success"):
        # Log to database
        event_id = db_manager.insert_enforcement_event({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "file_path": str(path_obj),
            "tier": tier,
            "action_taken": "quarantine",
            "user_override": 0,
            "override_reason": "",
            "entity_summary": entity_summary,
            "source": source
        })

        logger.info(f"Successfully quarantined '{path_obj.name}' to '{archive_dest}'. Event ID: {event_id}")
        return {
            "success": True,
            "archive_path": archive_dest,
            "event_id": event_id,
            "entity_summary": entity_summary,
            "original_deleted": not path_obj.exists()
        }
    else:
        err = res.get("error", "Unknown error during quarantine packaging")
        logger.error(f"Failed to quarantine '{path_obj.name}': {err}")
        return {"success": False, "error": err}

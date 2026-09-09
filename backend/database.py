"""
Database Manager for PII Sentinel
Manages SQLite storage for past scan history, scan metadata, and granular findings.
Database path: %APPDATA%/PIISentinel/history.db
"""

import sqlite3
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from backend.config import get_db_path

import contextlib

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manages SQLite scan history and findings."""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or get_db_path()
        self.init_db()

    @contextlib.contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def init_db(self) -> None:
        """Initialize database schema if it doesn't already exist."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Scans table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS scans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scan_id TEXT UNIQUE NOT NULL,
                    target_folder TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    duration_seconds REAL DEFAULT 0.0,
                    files_scanned INTEGER DEFAULT 0,
                    files_with_pii INTEGER DEFAULT 0,
                    total_findings INTEGER DEFAULT 0,
                    confidence_threshold REAL DEFAULT 0.6,
                    report_csv TEXT,
                    report_json TEXT,
                    report_html TEXT,
                    status TEXT DEFAULT 'completed'
                )
            """)

            # Findings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS findings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scan_id TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    value_redacted TEXT NOT NULL,
                    value_raw TEXT,
                    confidence REAL NOT NULL,
                    start_idx INTEGER,
                    end_idx INTEGER,
                    file_size_bytes INTEGER DEFAULT 0,
                    last_modified TEXT,
                    FOREIGN KEY (scan_id) REFERENCES scans (scan_id) ON DELETE CASCADE
                )
            """)

            # Schema migration: ensure value_raw and classification columns exist in existing databases
            cursor.execute("PRAGMA table_info(findings)")
            cols = [row[1] for row in cursor.fetchall()]
            if cols and "value_raw" not in cols:
                try:
                    cursor.execute("ALTER TABLE findings ADD COLUMN value_raw TEXT")
                except Exception:
                    pass
            if cols and "classification" not in cols:
                try:
                    cursor.execute("ALTER TABLE findings ADD COLUMN classification TEXT")
                except Exception:
                    pass

            # Enforcement Events table (Phase 2 Real-Time Save Enforcement)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS enforcement_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    tier TEXT NOT NULL,
                    action_taken TEXT NOT NULL,
                    user_override INTEGER DEFAULT 0,
                    override_reason TEXT,
                    entity_summary TEXT,
                    source TEXT DEFAULT 'Generic',
                    detection_types TEXT,
                    app_source TEXT DEFAULT 'Generic'
                )
            """)

            # Schema migration: ensure detection_types and app_source exist in existing enforcement_events tables
            cursor.execute("PRAGMA table_info(enforcement_events)")
            enf_cols = [row[1] for row in cursor.fetchall()]
            if enf_cols and "detection_types" not in enf_cols:
                try:
                    cursor.execute("ALTER TABLE enforcement_events ADD COLUMN detection_types TEXT")
                except Exception:
                    pass
            if enf_cols and "app_source" not in enf_cols:
                try:
                    cursor.execute("ALTER TABLE enforcement_events ADD COLUMN app_source TEXT DEFAULT 'Generic'")
                except Exception:
                    pass

            # Indices
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_findings_scan_id ON findings(scan_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_findings_entity ON findings(entity_type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_scans_started_at ON scans(started_at DESC)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_enforcement_timestamp ON enforcement_events(timestamp DESC)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_enforcement_tier ON enforcement_events(tier)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_enforcement_action ON enforcement_events(action_taken)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_enforcement_app_source ON enforcement_events(app_source)")
            conn.commit()

    def insert_scan(self, scan_data: Dict[str, Any], findings: List[Dict[str, Any]]) -> None:
        """Insert a completed scan and its associated findings."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO scans (
                    scan_id, target_folder, started_at, completed_at,
                    duration_seconds, files_scanned, files_with_pii,
                    total_findings, confidence_threshold,
                    report_csv, report_json, report_html, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                scan_data.get("scan_id"),
                scan_data.get("target_folder"),
                scan_data.get("started_at"),
                scan_data.get("completed_at"),
                scan_data.get("duration_seconds", 0.0),
                scan_data.get("files_scanned", 0),
                scan_data.get("files_with_pii", 0),
                scan_data.get("total_findings", 0),
                scan_data.get("confidence_threshold", 0.6),
                scan_data.get("report_csv", ""),
                scan_data.get("report_json", ""),
                scan_data.get("report_html", ""),
                scan_data.get("status", "completed")
            ))

            scan_id = scan_data.get("scan_id")
            # Batch insert findings
            finding_rows = [
                (
                    scan_id,
                    f.get("file", ""),
                    f.get("entity", ""),
                    f.get("value_redacted", f.get("value", "")),
                    f.get("value", f.get("value_redacted", "")),
                    float(f.get("confidence", 0.0)),
                    int(f.get("start", 0)),
                    int(f.get("end", 0)),
                    int(f.get("file_size_bytes", 0)),
                    str(f.get("last_modified", "")),
                    str(f.get("classification", "Confidential"))
                )
                for f in findings
            ]

            if finding_rows:
                cursor.executemany("""
                    INSERT INTO findings (
                        scan_id, file_path, entity_type, value_redacted, value_raw,
                        confidence, start_idx, end_idx, file_size_bytes, last_modified,
                        classification
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, finding_rows)

            conn.commit()

    def get_all_scans(self) -> List[Dict[str, Any]]:
        """Retrieve list of all scans ordered by most recent first."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM scans ORDER BY started_at DESC")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def get_scan(self, scan_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve single scan by scan_id."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM scans WHERE scan_id = ?", (scan_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_findings_for_scan(self, scan_id: str) -> List[Dict[str, Any]]:
        """Retrieve all findings for a particular scan."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT file_path as file, entity_type as entity,
                       value_redacted, COALESCE(value_raw, value_redacted) as value,
                       confidence, start_idx as start,
                       end_idx as end, file_size_bytes, last_modified,
                       COALESCE(classification, 'Confidential') as classification
                FROM findings WHERE scan_id = ?
            """, (scan_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def delete_scan(self, scan_id: str) -> bool:
        """Delete a scan record and its findings."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM findings WHERE scan_id = ?", (scan_id,))
            cursor.execute("DELETE FROM scans WHERE scan_id = ?", (scan_id,))
            conn.commit()
            return cursor.rowcount > 0

    def clear_history(self) -> None:
        """Clear all historical scans."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM findings")
            cursor.execute("DELETE FROM scans")
            conn.commit()

    # ---------------------------------------------------------
    # Real-Time Enforcement Events (Phase 2)
    # ---------------------------------------------------------

    def insert_enforcement_event(self, event_data: Dict[str, Any]) -> int:
        """Insert a real-time enforcement event (block, quarantine, warn, allow, override)."""
        det_types = event_data.get("detection_types")
        if not det_types:
            summary = event_data.get("entity_summary", "")
            if summary:
                parts = [p.split(":")[0].strip() for p in summary.split(",") if p.strip()]
                det_types = ", ".join(parts)
            else:
                det_types = ""

        app_src = event_data.get("app_source") or event_data.get("source", "Generic")

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO enforcement_events (
                    timestamp, file_path, tier, action_taken,
                    user_override, override_reason, entity_summary, source,
                    detection_types, app_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event_data.get("timestamp"),
                event_data.get("file_path", ""),
                event_data.get("tier", "General"),
                event_data.get("action_taken", "allow"),
                1 if event_data.get("user_override") else 0,
                event_data.get("override_reason", ""),
                event_data.get("entity_summary", ""),
                event_data.get("source", "Generic"),
                det_types,
                app_src
            ))
            conn.commit()
            return cursor.lastrowid

    def get_enforcement_events(
        self,
        limit: int = 100,
        action: Optional[str] = None,
        tier: Optional[str] = None,
        source: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve recent enforcement events with optional action, tier, source, and search filters."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            query = "SELECT * FROM enforcement_events"
            params = []
            conditions = []
            if action and action.lower() != "all actions":
                conditions.append("UPPER(action_taken) = ?")
                params.append(action.upper())
            if tier and tier.lower() != "all tiers":
                conditions.append("UPPER(tier) = ?")
                params.append(tier.upper())
            if source and source.lower() not in ("all", "all sources"):
                conditions.append("(UPPER(app_source) LIKE ? OR UPPER(source) LIKE ?)")
                params.append(f"%{source.upper()}%")
                params.append(f"%{source.upper()}%")
            if search and search.strip():
                conditions.append("file_path LIKE ?")
                params.append(f"%{search.strip()}%")

            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)

            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def export_enforcement_events_csv(
        self,
        filepath: str,
        events: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """Export enforcement events to a CSV audit log."""
        import csv
        import os
        try:
            os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
            if events is None:
                events = self.get_enforcement_events(limit=5000)

            with open(filepath, "w", newline="", encoding="utf-8") as f:
                fieldnames = [
                    "id", "timestamp", "file_path", "app_source", "tier",
                    "action_taken", "detection_types", "user_override",
                    "override_reason", "entity_summary"
                ]
                writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
                writer.writeheader()
                for row in events:
                    row_copy = dict(row)
                    row_copy["user_override"] = "YES" if row_copy.get("user_override") else "NO"
                    writer.writerow(row_copy)
            return True
        except Exception:
            return False

    def delete_enforcement_event(self, event_id: int) -> bool:
        """Delete a single enforcement event by id."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM enforcement_events WHERE id = ?", (event_id,))
            conn.commit()
            return cursor.rowcount > 0

    def clear_enforcement_events(self) -> None:
        """Clear all enforcement events."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM enforcement_events")
            conn.commit()


# Singleton instance
db_manager = DatabaseManager()

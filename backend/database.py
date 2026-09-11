"""
Database Manager for PII Sentinel
Manages SQLite storage for past scan history, scan metadata, and granular findings.
Database path: %APPDATA%/PIISentinel/history.db
"""

import sqlite3
import logging
from datetime import datetime
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
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA synchronous=NORMAL;")
        except Exception:
            pass
        try:
            yield conn
        finally:
            conn.close()

    def init_db(self) -> None:
        """Initialize database schema if it doesn't already exist."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Enable Write-Ahead Logging (WAL) and NORMAL synchronous mode for high concurrent throughput
            try:
                cursor.execute("PRAGMA journal_mode=WAL;")
                cursor.execute("PRAGMA synchronous=NORMAL;")
            except Exception as e:
                logger.warning(f"Could not enable SQLite WAL mode (fallback to default journal mode): {e}")

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
                    status TEXT DEFAULT 'completed',
                    scan_source TEXT DEFAULT 'directory_scan'
                )
            """)

            # Scans table migration: ensure scan_source exists
            cursor.execute("PRAGMA table_info(scans)")
            scan_cols = [row[1] for row in cursor.fetchall()]
            if scan_cols and "scan_source" not in scan_cols:
                try:
                    cursor.execute("ALTER TABLE scans ADD COLUMN scan_source TEXT DEFAULT 'directory_scan'")
                except Exception:
                    pass

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
                    classification TEXT,
                    watermark_status TEXT DEFAULT 'none',
                    watermark_method TEXT,
                    watermark_applied_at TEXT,
                    watermark_backup_path TEXT,
                    content_hash_sha256 TEXT,
                    FOREIGN KEY (scan_id) REFERENCES scans (scan_id) ON DELETE CASCADE
                )
            """)

            # Schema migration: ensure value_raw, classification, and watermark columns exist in existing databases
            cursor.execute("PRAGMA table_info(findings)")
            cols = [row[1] for row in cursor.fetchall()]
            for col_name, col_type in [
                ("value_raw", "TEXT"),
                ("classification", "TEXT"),
                ("watermark_status", "TEXT DEFAULT 'none'"),
                ("watermark_method", "TEXT"),
                ("watermark_applied_at", "TEXT"),
                ("watermark_backup_path", "TEXT"),
                ("content_hash_sha256", "TEXT")
            ]:
                if cols and col_name not in cols:
                    try:
                        cursor.execute(f"ALTER TABLE findings ADD COLUMN {col_name} {col_type}")
                    except Exception:
                        pass

            # File Watermarks Table (Registry for fast idempotency lookups and cross-scan watermark state)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS file_watermarks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT UNIQUE NOT NULL,
                    content_hash_sha256 TEXT NOT NULL,
                    watermark_status TEXT NOT NULL DEFAULT 'none',
                    watermark_method TEXT,
                    watermark_applied_at TEXT,
                    watermark_backup_path TEXT,
                    tier TEXT,
                    last_error TEXT
                )
            """)

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
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_findings_file_path ON findings(file_path)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_findings_watermark_status ON findings(watermark_status)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_scans_started_at ON scans(started_at DESC)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_watermarks_path ON file_watermarks(file_path)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_watermarks_hash ON file_watermarks(content_hash_sha256)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_watermarks_status ON file_watermarks(watermark_status)")
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
                    report_csv, report_json, report_html, status, scan_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                scan_data.get("status", "completed"),
                scan_data.get("scan_source", "directory_scan")
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
                    str(f.get("classification", "Confidential")),
                    str(f.get("watermark_status", "none")),
                    f.get("watermark_method"),
                    f.get("watermark_applied_at"),
                    f.get("watermark_backup_path"),
                    f.get("content_hash_sha256")
                )
                for f in findings
            ]

            if finding_rows:
                cursor.executemany("""
                    INSERT INTO findings (
                        scan_id, file_path, entity_type, value_redacted, value_raw,
                        confidence, start_idx, end_idx, file_size_bytes, last_modified,
                        classification, watermark_status, watermark_method,
                        watermark_applied_at, watermark_backup_path, content_hash_sha256
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                       COALESCE(classification, 'Confidential') as classification,
                       COALESCE(watermark_status, 'none') as watermark_status,
                       watermark_method, watermark_applied_at,
                       watermark_backup_path, content_hash_sha256
                FROM findings WHERE scan_id = ?
            """, (scan_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    # ---------------------------------------------------------
    # Watermark Registry & Lifecycle (Phase 3A)
    # ---------------------------------------------------------

    def get_watermark_record(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Retrieve the watermark registry record for a specific file path."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM file_watermarks WHERE file_path = ?", (file_path,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            # Fallback check findings table
            cursor.execute("""
                SELECT watermark_status, watermark_method, watermark_applied_at,
                       watermark_backup_path, content_hash_sha256, classification as tier
                FROM findings
                WHERE file_path = ? AND watermark_status IS NOT NULL AND watermark_status != 'none'
                ORDER BY id DESC LIMIT 1
            """, (file_path,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def record_watermark_applied(
        self,
        file_path: str,
        content_hash: str,
        method: str,
        backup_path: str,
        tier: str
    ) -> None:
        """Record a successful watermark application in the registry and findings."""
        now_iso = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO file_watermarks (
                    file_path, content_hash_sha256, watermark_status,
                    watermark_method, watermark_applied_at, watermark_backup_path,
                    tier, last_error
                ) VALUES (?, ?, 'applied', ?, ?, ?, ?, NULL)
                ON CONFLICT(file_path) DO UPDATE SET
                    content_hash_sha256 = excluded.content_hash_sha256,
                    watermark_status = 'applied',
                    watermark_method = excluded.watermark_method,
                    watermark_applied_at = excluded.watermark_applied_at,
                    watermark_backup_path = excluded.watermark_backup_path,
                    tier = excluded.tier,
                    last_error = NULL
            """, (file_path, content_hash, method, now_iso, backup_path, tier))

            cursor.execute("""
                UPDATE findings
                SET watermark_status = 'applied',
                    watermark_method = ?,
                    watermark_applied_at = ?,
                    watermark_backup_path = ?,
                    content_hash_sha256 = ?
                WHERE file_path = ?
            """, (method, now_iso, backup_path, content_hash, file_path))
            conn.commit()

    def record_watermark_reverted(self, file_path: str) -> None:
        """Update registry and findings when a watermark is reverted (rolled back)."""
        now_iso = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE file_watermarks
                SET watermark_status = 'reverted',
                    watermark_applied_at = ?
                WHERE file_path = ?
            """, (now_iso, file_path))

            cursor.execute("""
                UPDATE findings
                SET watermark_status = 'reverted',
                    watermark_applied_at = ?
                WHERE file_path = ?
            """, (now_iso, file_path))
            conn.commit()

    def record_watermark_failed(self, file_path: str, error: str, content_hash: str = "") -> None:
        """Record watermark failure in registry and findings."""
        now_iso = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO file_watermarks (
                    file_path, content_hash_sha256, watermark_status,
                    watermark_applied_at, last_error
                ) VALUES (?, ?, 'failed', ?, ?)
                ON CONFLICT(file_path) DO UPDATE SET
                    watermark_status = 'failed',
                    watermark_applied_at = excluded.watermark_applied_at,
                    last_error = excluded.last_error
            """, (file_path, content_hash, now_iso, error))

            cursor.execute("""
                UPDATE findings
                SET watermark_status = 'failed'
                WHERE file_path = ?
            """, (file_path,))
            conn.commit()

    def get_watermark_candidates(
        self,
        scan_id: Optional[str] = None,
        min_tier: str = "Confidential"
    ) -> List[Dict[str, Any]]:
        """
        Retrieve distinct files eligible for watermarking based on sensitivity tier.
        Tiers ordered by sensitivity: Public < General < Confidential < Highly Confidential < Restricted.
        """
        tier_hierarchy = {
            "PUBLIC": 1,
            "GENERAL": 2,
            "CONFIDENTIAL": 3,
            "HIGHLY CONFIDENTIAL": 4,
            "RESTRICTED": 5
        }
        min_level = tier_hierarchy.get(min_tier.upper(), 3)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            query = """
                SELECT f.file_path,
                       COALESCE(f.classification, 'Confidential') as tier,
                       COUNT(f.id) as finding_count,
                       GROUP_CONCAT(DISTINCT f.entity_type) as entities,
                       MAX(f.file_size_bytes) as file_size_bytes,
                       COALESCE(fw.watermark_status, f.watermark_status, 'none') as watermark_status,
                       COALESCE(fw.watermark_method, f.watermark_method) as watermark_method,
                       COALESCE(fw.watermark_backup_path, f.watermark_backup_path) as watermark_backup_path,
                       COALESCE(fw.content_hash_sha256, f.content_hash_sha256) as content_hash_sha256
                FROM findings f
                LEFT JOIN file_watermarks fw ON f.file_path = fw.file_path
            """
            params = []
            if scan_id:
                query += " WHERE f.scan_id = ?"
                params.append(scan_id)

            query += " GROUP BY f.file_path"
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()

            candidates = []
            for row in rows:
                row_dict = dict(row)
                t = row_dict.get("tier", "Confidential").upper()
                if tier_hierarchy.get(t, 0) >= min_level:
                    candidates.append(row_dict)
            return candidates

    def get_watermark_status_for_files(self, file_paths: List[str]) -> Dict[str, Dict[str, Any]]:
        """Batch query watermark status for a list of file paths."""
        if not file_paths:
            return {}
        with self._get_connection() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" for _ in file_paths)
            cursor.execute(f"""
                SELECT file_path, watermark_status, watermark_method,
                       watermark_applied_at, watermark_backup_path, content_hash_sha256
                FROM file_watermarks WHERE file_path IN ({placeholders})
            """, tuple(file_paths))
            rows = cursor.fetchall()
            return {row["file_path"]: dict(row) for row in rows}

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

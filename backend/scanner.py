"""
PII Directory Scanner Engine
Multi-threaded directory walker with pause, resume, and cancellation support.
Integrates TikaExtractor and PresidioDetector, collecting findings and file metadata.
Auto-generates reports upon scan completion and persists to SQLite.
"""

import os
import time
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable, Set

from backend.config import get_reports_dir, DEFAULT_EXTENSIONS
from backend.tika_extractor import TikaExtractor
from backend.presidio_detector import PresidioDetector
from backend.reporter import write_csv, write_json, write_html_dashboard
from backend.database import db_manager

logger = logging.getLogger(__name__)


class Scanner:
    """
    Core scanning engine that inspects a directory recursively for PII.
    Thread-safe execution with pause, resume, and stop controls.
    """

    def __init__(
        self,
        target_folder: str,
        supported_extensions: Optional[List[str]] = None,
        confidence_threshold: float = 0.6,
        selected_entities: Optional[List[str]] = None,
        max_file_size_mb: int = 50,
        ocr_enabled: bool = False,
        reports_dir: Optional[str] = None
    ):
        self.target_folder = str(Path(target_folder).resolve())
        self.supported_extensions: Set[str] = {
            ext.lower() if ext.startswith(".") else f".{ext.lower()}"
            for ext in (supported_extensions or DEFAULT_EXTENSIONS)
        }
        self.confidence_threshold = confidence_threshold
        self.selected_entities = selected_entities
        self.max_file_size_mb = max_file_size_mb
        self.ocr_enabled = ocr_enabled
        self.reports_dir = Path(reports_dir) if reports_dir else get_reports_dir()

        # Threading controls
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._pause_event.set()  # Not paused initially

        # State tracking
        self.scan_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.files_scanned = 0
        self.files_with_pii = 0
        self.findings: List[Dict[str, Any]] = []
        self.flagged_files: Set[str] = set()
        self.skipped_files: List[Dict[str, str]] = []

        self.start_time: float = 0.0
        self.duration_seconds: float = 0.0
        self.is_running = False

        # Callbacks
        self.on_progress: Optional[Callable[[int, int, str, float], None]] = None
        self.on_finding: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_log: Optional[Callable[[str, str], None]] = None
        self.on_finished: Optional[Callable[[Dict[str, Any]], None]] = None

        # Components
        self.extractor = TikaExtractor(
            max_file_size_mb=self.max_file_size_mb,
            ocr_enabled=self.ocr_enabled
        )
        self.detector = PresidioDetector.get_instance()

    def pause(self) -> None:
        """Pause the active scan."""
        if self._pause_event.is_set():
            self._pause_event.clear()
            self._log_info("Scan paused by user.")

    def resume(self) -> None:
        """Resume a paused scan."""
        if not self._pause_event.is_set():
            self._pause_event.set()
            self._log_info("Scan resumed.")

    def cancel(self) -> None:
        """Cancel and terminate the scan."""
        self._stop_event.set()
        self._pause_event.set()  # Unblock if currently paused
        self._log_info("Scan cancellation requested.")

    def is_paused(self) -> bool:
        return not self._pause_event.is_set()

    def is_cancelled(self) -> bool:
        return self._stop_event.is_set()

    def _log_info(self, msg: str) -> None:
        logger.info(msg)
        if self.on_log:
            self.on_log(msg, "INFO")

    def _log_warning(self, msg: str) -> None:
        logger.warning(msg)
        if self.on_log:
            self.on_log(msg, "WARNING")

    def _count_eligible_files(self) -> List[str]:
        """Pre-collect eligible file paths for accurate progress tracking."""
        eligible = []
        try:
            for dirpath, _, filenames in os.walk(self.target_folder):
                if self._stop_event.is_set():
                    break
                for filename in filenames:
                    ext = os.path.splitext(filename)[1].lower()
                    if ext in self.supported_extensions:
                        eligible.append(os.path.join(dirpath, filename))
        except Exception as e:
            self._log_warning(f"Error enumerating folder {self.target_folder}: {e}")
        return eligible

    def run(self) -> Dict[str, Any]:
        """
        Execute the scanning workflow.
        Returns summary dictionary.
        """
        self.is_running = True
        self.start_time = time.time()
        self._stop_event.clear()
        self._pause_event.set()

        self._log_info(f"Starting scan of folder: {self.target_folder}")
        self._log_info(f"Target extensions: {sorted(list(self.supported_extensions))}")
        self._log_info(f"Confidence threshold: {self.confidence_threshold}")

        # 1. Discover all matching files
        all_files = self._count_eligible_files()
        total_files = len(all_files)
        self._log_info(f"Discovered {total_files} eligible files to scan.")

        # 2. Iterate through files
        for filepath in all_files:
            # Check for cancellation
            if self._stop_event.is_set():
                self._log_info("Scan aborted by user.")
                break

            # Handle pause
            self._pause_event.wait()
            if self._stop_event.is_set():
                break

            self.files_scanned += 1
            elapsed = time.time() - self.start_time

            if self.on_progress:
                self.on_progress(self.files_scanned, total_files, filepath, elapsed)

            # File metadata
            try:
                stat = os.stat(filepath)
                file_size = stat.st_size
                mtime_str = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                file_size = 0
                mtime_str = ""

            # Text extraction
            text, err = self.extractor.extract_text(filepath)
            if err:
                self.skipped_files.append({"file": filepath, "reason": err})
                self._log_warning(f"Skipped {filepath}: {err}")
                continue

            if not text:
                continue

            # Presidio detection
            try:
                results = self.detector.analyze_text(
                    text=text,
                    entities=self.selected_entities,
                    score_threshold=self.confidence_threshold
                )

                if results:
                    self.files_with_pii += 1
                    self.flagged_files.add(filepath)

                    for r in results:
                        finding = {
                            "scan_id": self.scan_id,
                            "file": filepath,
                            "entity": r["entity"],
                            "value": r["value"],
                            "value_redacted": r["value_redacted"],
                            "confidence": r["confidence"],
                            "start": r["start"],
                            "end": r["end"],
                            "file_size_bytes": file_size,
                            "last_modified": mtime_str
                        }
                        self.findings.append(finding)
                        if self.on_finding:
                            self.on_finding(finding)

            except Exception as e:
                self._log_warning(f"Error detecting PII in {filepath}: {e}")

        self.duration_seconds = round(time.time() - self.start_time, 2)
        self.is_running = False

        status = "cancelled" if self._stop_event.is_set() else "completed"

        # 3. Generate Reports
        scan_reports_dir = self.reports_dir / self.scan_id
        scan_reports_dir.mkdir(parents=True, exist_ok=True)

        csv_path = str(scan_reports_dir / "report.csv")
        json_path = str(scan_reports_dir / "report.json")
        html_path = str(scan_reports_dir / "report.html")

        scan_meta = {
            "scan_id": self.scan_id,
            "target_folder": self.target_folder,
            "started_at": datetime.fromtimestamp(self.start_time).strftime("%Y-%m-%d %H:%M:%S"),
            "completed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "duration_seconds": self.duration_seconds,
            "files_scanned": self.files_scanned,
            "files_with_pii": self.files_with_pii,
            "total_findings": len(self.findings),
            "confidence_threshold": self.confidence_threshold,
            "report_csv": csv_path,
            "report_json": json_path,
            "report_html": html_path,
            "status": status
        }

        write_csv(self.findings, csv_path)
        write_json(self.findings, json_path, metadata=scan_meta)
        write_html_dashboard(
            findings=self.findings,
            files_scanned=self.files_scanned,
            files_with_pii=self.files_with_pii,
            filepath=html_path,
            scan_metadata=scan_meta
        )

        # 4. Save to SQLite database
        try:
            db_manager.insert_scan(scan_meta, self.findings)
            self._log_info("Scan results stored in local history database.")
        except Exception as e:
            self._log_warning(f"Failed to record scan in database: {e}")

        summary = {
            **scan_meta,
            "flagged_files": list(self.flagged_files),
            "skipped_files": self.skipped_files
        }

        self._log_info(
            f"Scan finished ({status}). Scanned: {self.files_scanned}, "
            f"Files with PII: {self.files_with_pii}, Total findings: {len(self.findings)}."
        )

        if self.on_finished:
            self.on_finished(summary)

        return summary

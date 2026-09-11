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
import concurrent.futures
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable, Set, Union

from backend.config import get_reports_dir, DEFAULT_EXTENSIONS
from backend.tika_extractor import TikaExtractor
from backend.presidio_detector import PresidioDetector
from backend.reporter import write_csv, write_json, write_html_dashboard
from backend.database import db_manager
from backend.classifier import classify_document, SensitivityTier

logger = logging.getLogger(__name__)


class Scanner:
    """
    Core scanning engine that inspects directory trees or full local drives recursively for PII.
    Thread-safe execution with pause, resume, and stop controls.
    """

    def __init__(
        self,
        target_folder: Union[str, List[str]],
        supported_extensions: Optional[List[str]] = None,
        confidence_threshold: float = 0.6,
        selected_entities: Optional[List[str]] = None,
        max_file_size_mb: int = 50,
        max_workers: int = 2,
        ocr_enabled: bool = False,
        reports_dir: Optional[str] = None,
        scan_source: str = "directory_scan",
        exclusion_patterns: Optional[List[str]] = None
    ):
        if isinstance(target_folder, list):
            self.target_folders = [str(Path(f).resolve()) for f in target_folder]
            self.target_folder = ", ".join(self.target_folders) if len(self.target_folders) > 1 else self.target_folders[0]
        else:
            self.target_folders = [str(Path(target_folder).resolve())]
            self.target_folder = self.target_folders[0]

        self.scan_source = scan_source
        self.exclusion_patterns = exclusion_patterns
        self.supported_extensions: Set[str] = {
            ext.lower() if ext.startswith(".") else f".{ext.lower()}"
            for ext in (supported_extensions or DEFAULT_EXTENSIONS)
        }
        self.confidence_threshold = confidence_threshold
        self.selected_entities = selected_entities
        self.max_file_size_mb = max_file_size_mb
        self.max_workers = max(1, min(int(max_workers), 8))
        self.ocr_enabled = ocr_enabled
        self.reports_dir = Path(reports_dir) if reports_dir else get_reports_dir()

        # Threading controls
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._pause_event.set()  # Not paused initially
        self._lock = threading.Lock()
        self._executor: Optional[concurrent.futures.ThreadPoolExecutor] = None

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
        if self._executor:
            try:
                self._executor.shutdown(wait=False, cancel_futures=True)
            except Exception:
                pass
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
        """Pre-collect eligible file paths for accurate progress tracking across all target folders."""
        from backend.drive_scanner import is_path_excluded

        eligible = []
        for folder in self.target_folders:
            if not os.path.exists(folder):
                continue
            try:
                for dirpath, dirnames, filenames in os.walk(folder):
                    if self._stop_event.is_set():
                        break

                    # Prune excluded directories in-place so os.walk skips descending into them
                    if self.exclusion_patterns:
                        dirnames[:] = [
                            d for d in dirnames
                            if not is_path_excluded(os.path.join(dirpath, d), self.exclusion_patterns)
                        ]

                    for filename in filenames:
                        ext = os.path.splitext(filename)[1].lower()
                        if ext in self.supported_extensions:
                            full_path = os.path.join(dirpath, filename)
                            if not (self.exclusion_patterns and is_path_excluded(full_path, self.exclusion_patterns)):
                                eligible.append(full_path)
            except Exception as e:
                self._log_warning(f"Error enumerating folder {folder}: {e}")
        return eligible

    def _scan_single_file(self, filepath: str, total_files: int) -> None:
        """Scan a single file for PII and update findings safely under lock."""
        if self._stop_event.is_set():
            return

        # Handle pause before starting extraction
        self._pause_event.wait()
        if self._stop_event.is_set():
            return

        # File metadata
        try:
            stat = os.stat(filepath)
            file_size = stat.st_size
            mtime_str = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            file_size = 0
            mtime_str = ""

        # Text extraction via Apache Tika
        text, err = self.extractor.extract_text(filepath)
        if err:
            with self._lock:
                self.files_scanned += 1
                scanned = self.files_scanned
                elapsed = time.time() - self.start_time
                self.skipped_files.append({"file": filepath, "reason": err})
                self._log_warning(f"Skipped {filepath}: {err}")
                if self.on_progress:
                    self.on_progress(scanned, total_files, filepath, elapsed)
            return

        if not text:
            with self._lock:
                self.files_scanned += 1
                scanned = self.files_scanned
                elapsed = time.time() - self.start_time
                if self.on_progress:
                    self.on_progress(scanned, total_files, filepath, elapsed)
            return

        if self._stop_event.is_set():
            return

        # Presidio entity detection
        new_findings = []
        try:
            self._pause_event.wait()
            if self._stop_event.is_set():
                return

            results = self.detector.analyze_text(
                text=text,
                entities=self.selected_entities,
                score_threshold=self.confidence_threshold
            )

            if results:
                for r in results:
                    new_findings.append({
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
                    })
        except Exception as e:
            with self._lock:
                self._log_warning(f"Error detecting PII in {filepath}: {e}")

        # Thread-safe state update and signal notifications
        with self._lock:
            self.files_scanned += 1
            scanned = self.files_scanned
            elapsed = time.time() - self.start_time

            if new_findings:
                # Classify document using Microsoft Purview 5-tier classification engine
                doc_class = classify_document(new_findings)
                for f in new_findings:
                    f["classification"] = doc_class["tier"]
                    f["classification_level"] = doc_class["level"]
                    f["classification_badge"] = doc_class["badge"]
                    f["classification_color"] = doc_class["color"]
                    f["classification_rationale"] = doc_class["rationale"]

                self.files_with_pii += 1
                self.flagged_files.add(filepath)
                self.findings.extend(new_findings)
                for f in new_findings:
                    if self.on_finding:
                        self.on_finding(f)

            if self.on_progress:
                self.on_progress(scanned, total_files, filepath, elapsed)

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
        self._log_info(f"Concurrent workers: {self.max_workers}")

        # 1. Discover all matching files
        all_files = self._count_eligible_files()
        total_files = len(all_files)
        self._log_info(f"Discovered {total_files} eligible files to scan.")

        # Ensure Tika is initialized once silently before spawning parallel tasks
        if total_files > 0:
            try:
                self.extractor._ensure_tika()
            except Exception as e:
                self._log_warning(f"Tika pre-warm notice: {e}")

        # 2. Iterate through files concurrently
        if total_files > 0:
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                self._executor = executor
                futures = [executor.submit(self._scan_single_file, fp, total_files) for fp in all_files]
                for f in concurrent.futures.as_completed(futures):
                    if self._stop_event.is_set():
                        break
                    try:
                        f.result()
                    except Exception as exc:
                        self._log_warning(f"Worker task error: {exc}")
                self._executor = None

        self.duration_seconds = round(time.time() - self.start_time, 2)
        self.is_running = False

        status = "cancelled" if self._stop_event.is_set() else "completed"

        # 3. Generate Reports
        scan_reports_dir = self.reports_dir / self.scan_id
        scan_reports_dir.mkdir(parents=True, exist_ok=True)

        csv_path = str(scan_reports_dir / "report.csv")
        json_path = str(scan_reports_dir / "report.json")
        html_path = str(scan_reports_dir / "dashboard.html")
        # Aggregate classification metrics across flagged files
        file_classes = {}
        for f in self.findings:
            fl = f.get("file")
            if fl and fl not in file_classes:
                file_classes[fl] = f.get("classification", SensitivityTier.CONFIDENTIAL.value)

        classification_counts = {
            SensitivityTier.RESTRICTED.value: sum(1 for c in file_classes.values() if c == SensitivityTier.RESTRICTED.value),
            SensitivityTier.HIGHLY_CONFIDENTIAL.value: sum(1 for c in file_classes.values() if c == SensitivityTier.HIGHLY_CONFIDENTIAL.value),
            SensitivityTier.CONFIDENTIAL.value: sum(1 for c in file_classes.values() if c == SensitivityTier.CONFIDENTIAL.value),
            SensitivityTier.GENERAL.value: max(0, self.files_scanned - len(file_classes))
        }

        if classification_counts[SensitivityTier.RESTRICTED.value] > 0:
            highest_tier = SensitivityTier.RESTRICTED.value
        elif classification_counts[SensitivityTier.HIGHLY_CONFIDENTIAL.value] > 0:
            highest_tier = SensitivityTier.HIGHLY_CONFIDENTIAL.value
        elif classification_counts[SensitivityTier.CONFIDENTIAL.value] > 0:
            highest_tier = SensitivityTier.CONFIDENTIAL.value
        else:
            highest_tier = SensitivityTier.GENERAL.value

        scan_meta = {
            "scan_id": self.scan_id,
            "target_folder": self.target_folder,
            "scan_source": self.scan_source,
            "started_at": datetime.fromtimestamp(self.start_time).strftime("%Y-%m-%d %H:%M:%S"),
            "completed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "duration_seconds": self.duration_seconds,
            "files_scanned": self.files_scanned,
            "files_with_pii": self.files_with_pii,
            "total_findings": len(self.findings),
            "confidence_threshold": self.confidence_threshold,
            "classification_counts": classification_counts,
            "highest_classification": highest_tier,
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

"""
Background Scan Worker Thread
Wraps backend.scanner.Scanner in a QThread and exposes Qt signals for UI updates.
Ensures zero GUI freezing during heavy document extraction and NLP analysis.
"""

from typing import List, Optional
from PySide6.QtCore import QThread, Signal
from backend.scanner import Scanner


class ScanWorker(QThread):
    """Worker thread running directory scan and emitting thread-safe Qt signals."""

    # Signals
    progress_updated = Signal(int, int, str, float)  # (scanned, total, current_file, elapsed)
    finding_discovered = Signal(dict)               # finding dict
    log_emitted = Signal(str, str)                  # (message, level)
    scan_finished = Signal(dict)                    # summary dict
    scan_error = Signal(str)                        # error string

    def __init__(
        self,
        target_folder: str,
        confidence_threshold: float = 0.6,
        selected_entities: Optional[List[str]] = None,
        supported_extensions: Optional[List[str]] = None,
        max_file_size_mb: int = 50,
        max_workers: int = 2,
        ocr_enabled: bool = False,
        parent=None
    ):
        super().__init__(parent)
        self.target_folder = target_folder
        self.confidence_threshold = confidence_threshold
        self.selected_entities = selected_entities
        self.supported_extensions = supported_extensions
        self.max_file_size_mb = max_file_size_mb
        self.max_workers = max_workers
        self.ocr_enabled = ocr_enabled

        self.scanner = Scanner(
            target_folder=self.target_folder,
            supported_extensions=self.supported_extensions,
            confidence_threshold=self.confidence_threshold,
            selected_entities=self.selected_entities,
            max_file_size_mb=self.max_file_size_mb,
            max_workers=self.max_workers,
            ocr_enabled=self.ocr_enabled
        )

        # Wire scanner callbacks to Qt signals
        self.scanner.on_progress = self._on_scanner_progress
        self.scanner.on_finding = self._on_scanner_finding
        self.scanner.on_log = self._on_scanner_log
        self.scanner.on_finished = self._on_scanner_finished

    def _on_scanner_progress(self, scanned: int, total: int, current_file: str, elapsed: float) -> None:
        self.progress_updated.emit(scanned, total, current_file, elapsed)

    def _on_scanner_finding(self, finding: dict) -> None:
        self.finding_discovered.emit(finding)

    def _on_scanner_log(self, message: str, level: str) -> None:
        self.log_emitted.emit(message, level)

    def _on_scanner_finished(self, summary: dict) -> None:
        self.scan_finished.emit(summary)

    def pause(self) -> None:
        """Pause running scan."""
        if self.scanner:
            self.scanner.pause()

    def resume(self) -> None:
        """Resume paused scan."""
        if self.scanner:
            self.scanner.resume()

    def cancel(self) -> None:
        """Cancel running scan."""
        if self.scanner:
            self.scanner.cancel()

    def is_paused(self) -> bool:
        return self.scanner.is_paused() if self.scanner else False

    def run(self) -> None:
        """Execute scan in background thread."""
        try:
            self.scanner.run()
        except Exception as e:
            self.scan_error.emit(str(e))

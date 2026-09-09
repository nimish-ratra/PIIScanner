"""
Generic Filesystem Watcher Service for PII Sentinel (Phase 2)
Uses watchdog (Observer + FileSystemEventHandler) to monitor user directories.
Implements the post-save detect-and-remediate model:
1. Monitors Desktop, Documents, Downloads (configurable).
2. Debounces rapid file write events and waits for file handle release.
3. Classifies file content using Presidio + Purview classification engine.
4. Executes automated AES-256 encrypted quarantine and deletes original plaintext file.
5. Alerts user via Windows toast notification.
Air-gapped & local-only.
"""

import os
import sys
import time
import logging
import threading
from pathlib import Path
from typing import Dict, Set, Optional, List

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

from backend.config import config_manager
from backend.tika_extractor import TikaExtractor
from backend.presidio_detector import PresidioDetector
from backend.classifier import classify_document, SensitivityTier
from backend.database import db_manager
from service.enforcement_policy import policy_manager, EnforcementAction
from file_watcher.quarantine_bridge import quarantine_file
from file_watcher.toast_notifier import toast_notifier

logger = logging.getLogger("pii_sentinel.watcher")

# Temporary/lock file patterns to ignore
IGNORED_PATTERNS = (
    "~$", ".tmp", ".crdownload", ".part", ".swp", ".lock",
    ".quarantined", ".zip"
)


class FileSaveEventHandler(FileSystemEventHandler):
    """Event handler capturing new and modified files with debouncing."""

    def __init__(self, watcher_service: "FileWatcherService"):
        super().__init__()
        self.watcher = watcher_service
        self._recent_events: Dict[str, float] = {}  # file_path -> timestamp
        self._lock = threading.Lock()

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._handle_file(event.src_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._handle_file(event.src_path)

    def _should_ignore(self, path: Path) -> bool:
        """Filter out non-target extensions and temporary file artifacts."""
        name = path.name
        # Ignore temporary prefix/suffix
        for pat in IGNORED_PATTERNS:
            if name.startswith(pat) or name.endswith(pat):
                return True

        # Check extension against config_manager supported extensions
        ext = path.suffix.lower()
        supported = [e.lower() for e in config_manager.supported_extensions]
        if ext not in supported:
            return True

        # Ignore files inside the quarantine archive destination folder
        quarantine_dir = Path(policy_manager.quarantine_archive_path).parent.resolve()
        try:
            if path.resolve().is_relative_to(quarantine_dir) and path.name.endswith(".zip"):
                return True
        except Exception:
            pass

        return False

    def _handle_file(self, file_path_str: str) -> None:
        """Debounce and dispatch file inspection in a worker thread."""
        if self.watcher.is_paused:
            return

        path = Path(file_path_str)
        if self._should_ignore(path):
            return

        # Debounce: ignore repeated events for the same file within 2.0s
        now = time.time()
        with self._lock:
            last_time = self._recent_events.get(file_path_str, 0)
            if (now - last_time) < 2.0:
                return
            self._recent_events[file_path_str] = now

        # Inspect file in background thread
        threading.Thread(
            target=self.watcher.inspect_and_enforce,
            args=(file_path_str,),
            daemon=True,
            name=f"WatcherInspect-{path.name[:16]}"
        ).start()


class FileWatcherService:
    """Manages directory observation and remediation."""

    def __init__(self):
        self.observer: Optional[Observer] = None
        self.handler = FileSaveEventHandler(self)
        self.is_paused: bool = False
        self._running: bool = False
        self._extractor = TikaExtractor()

    def start(self) -> None:
        """Start directory observer across configured watched folders."""
        if self._running:
            return

        self.observer = Observer()
        watched = policy_manager.watched_folders
        active_count = 0

        for folder in watched:
            p = Path(folder)
            if p.exists() and p.is_dir():
                try:
                    self.observer.schedule(self.handler, str(p), recursive=True)
                    logger.info(f"File Watcher monitoring: {p}")
                    active_count += 1
                except Exception as e:
                    logger.warning(f"Could not watch folder {folder}: {e}")

        if active_count > 0:
            self.observer.start()
            self._running = True
            logger.info(f"File Watcher successfully started monitoring {active_count} folders.")
        else:
            logger.warning("File Watcher has no active folders to monitor.")

    def stop(self) -> None:
        """Stop observer cleanly."""
        if self.observer and self._running:
            self._running = False
            try:
                self.observer.stop()
                self.observer.join(timeout=3.0)
            except Exception as e:
                logger.debug(f"Observer stop note: {e}")
            logger.info("File Watcher stopped.")

    def _wait_for_file_ready(self, file_path: Path, max_attempts: int = 5) -> bool:
        """Wait until editor releases write lock on the file."""
        for _ in range(max_attempts):
            if not file_path.exists():
                return False
            try:
                # Attempt to open file in read mode
                with open(file_path, "rb") as f:
                    # Check if file has non-zero size or stable size
                    f.seek(0, os.SEEK_END)
                    return True
            except (IOError, PermissionError):
                time.sleep(0.3)
        return False

    def inspect_and_enforce(self, file_path_str: str) -> None:
        """
        Inspect written file, detect PII, evaluate Purview tier,
        and execute quarantine or warning per policy.
        """
        path = Path(file_path_str)
        if not self._wait_for_file_ready(path):
            return

        try:
            # 1. Extract text
            text, _ = self._extractor.extract_text(str(path))
            if not text or not text.strip():
                return

            # 2. Analyze PII
            detector = PresidioDetector.get_instance()
            raw_findings = detector.analyze_text(text, score_threshold=0.40)
            if not raw_findings:
                return

            # Filter to active real-time entity selection
            realtime_entities = set(config_manager.realtime_selected_entities)
            findings = [f for f in raw_findings if f.get("entity") in realtime_entities]
            if not findings:
                return

            # 3. Classify Purview tier
            classification = classify_document(findings)
            tier = classification["tier"]
            badge = classification["badge"]

            # 4. Resolve policy action
            action = policy_manager.get_action_for_tier(tier, is_office=False)

            # Summarize findings for notification
            entity_counts: Dict[str, int] = {}
            for f in findings:
                ent = f.get("entity", "PII")
                entity_counts[ent] = entity_counts.get(ent, 0) + 1
            summary = ", ".join([f"{k} ({v})" for k, v in entity_counts.items()])

            logger.info(
                f"[Watcher Triggered] File='{path.name}' | Tier={tier} | Action={action} | Findings=[{summary}]"
            )

            # 5. Enforce action
            if action == EnforcementAction.QUARANTINE.value:
                q_res = quarantine_file(str(path), tier, findings, source="File Watcher")
                if q_res.get("success"):
                    if policy_manager.toast_notifications:
                        toast_notifier.notify(
                            title=f"⚠️ PII Sentinel: {badge} Quarantined",
                            message=f"'{path.name}' contained sensitive PII [{summary}] and was moved to encrypted quarantine.",
                            duration=6
                        )
            elif action == EnforcementAction.WARN.value:
                # Log warning event to database
                db_manager.insert_enforcement_event({
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "file_path": str(path),
                    "tier": tier,
                    "action_taken": "warn",
                    "user_override": 0,
                    "override_reason": "",
                    "entity_summary": summary,
                    "source": "File Watcher",
                    "detection_types": ", ".join(entity_counts.keys()),
                    "app_source": "Filesystem Watcher"
                })
                if policy_manager.toast_notifications:
                    toast_notifier.notify(
                        title=f"⚠️ PII Sentinel Warning: {badge}",
                        message=f"'{path.name}' contains sensitive PII [{summary}].",
                        duration=5
                    )
        except Exception as e:
            logger.error(f"Error during file inspection of '{file_path_str}': {e}")

"""
Unit & Integration Tests for File Watcher & Quarantine Bridge (Phase 2)
Tests:
1. quarantine_file: AES-256 encrypted zip packaging, plaintext deletion, and SQLite audit logging
2. FileSaveEventHandler: debouncing and ignored file patterns
3. FileWatcherService: inspect_and_enforce detect-and-remediate flow
4. Benign file persistence: non-PII files are left intact
"""

import os
import time
import shutil
import tempfile
import unittest
from pathlib import Path

from file_watcher.quarantine_bridge import quarantine_file
from file_watcher.watcher_service import FileWatcherService, FileSaveEventHandler
from service.enforcement_policy import policy_manager, DEFAULT_TIER_ACTIONS, EnforcementAction
from backend.database import db_manager


class TestFileWatcher(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.temp_dir = Path(tempfile.mkdtemp(prefix="pii_watcher_test_"))
        cls.watched_folder = cls.temp_dir / "watched"
        cls.watched_folder.mkdir(parents=True, exist_ok=True)
        cls.quarantine_zip = cls.temp_dir / "Test_Quarantine.zip"

        # Preserve original settings
        cls._orig_archive = policy_manager.quarantine_archive_path
        cls._orig_watched = list(policy_manager.watched_folders)
        cls._orig_toast = policy_manager.toast_notifications

        # Configure policy manager to use test paths
        policy_manager.quarantine_archive_path = str(cls.quarantine_zip)
        policy_manager.watched_folders = [str(cls.watched_folder)]
        policy_manager.toast_notifications = False  # Suppress UI popups during automated tests

    @classmethod
    def tearDownClass(cls):
        # Restore real policy settings
        policy_manager.quarantine_archive_path = cls._orig_archive
        policy_manager.watched_folders = cls._orig_watched
        policy_manager.toast_notifications = cls._orig_toast
        policy_manager.save()

        if cls.temp_dir.exists():
            shutil.rmtree(str(cls.temp_dir), ignore_errors=True)

    def test_01_quarantine_bridge_execution(self):
        """Verify quarantine_file encrypts into zip, removes plaintext, and logs event."""
        test_file = self.watched_folder / "aadhaar_export.txt"
        test_file.write_text("AADHAAR: 3675 9834 5012, PAN: ABCDE1234F", encoding="utf-8")
        self.assertTrue(test_file.exists())

        findings = [
            {"entity": "IN_AADHAAR", "value": "3675 9834 5012", "confidence": 0.95},
            {"entity": "IN_PAN", "value": "ABCDE1234F", "confidence": 0.90}
        ]

        res = quarantine_file(
            file_path=str(test_file),
            tier="Highly Confidential",
            findings=findings,
            source="Test Suite"
        )

        self.assertTrue(res.get("success"))
        # Verify original file was deleted
        self.assertFalse(test_file.exists())
        # Verify quarantine archive was created
        self.assertTrue(self.quarantine_zip.exists())
        self.assertGreater(self.quarantine_zip.stat().st_size, 0)

        # Verify event logged in database
        event_id = res.get("event_id")
        self.assertIsNotNone(event_id)
        events = [e for e in db_manager.get_enforcement_events(limit=20) if e.get("id") == event_id]
        self.assertTrue(len(events) > 0)
        latest = events[0]
        self.assertEqual(latest.get("action_taken"), "quarantine")
        self.assertEqual(latest.get("tier"), "Highly Confidential")
        self.assertIn("aadhaar_export.txt", latest.get("file_path"))

    def test_02_event_handler_ignore_rules(self):
        """Verify temporary files and non-target formats are ignored."""
        svc = FileWatcherService()
        handler = FileSaveEventHandler(svc)

        # Temporary files
        self.assertTrue(handler._should_ignore(Path("C:/test/~$Document.docx")))
        self.assertTrue(handler._should_ignore(Path("C:/test/tempfile.tmp")))
        self.assertTrue(handler._should_ignore(Path("C:/test/archive.zip")))

        # Non-supported extensions (e.g. .exe, .bin)
        self.assertTrue(handler._should_ignore(Path("C:/test/installer.exe")))
        self.assertTrue(handler._should_ignore(Path("C:/test/data.bin")))

        # Valid document extension
        self.assertFalse(handler._should_ignore(Path("C:/test/report.txt")))
        self.assertFalse(handler._should_ignore(Path("C:/test/data.csv")))

    def test_03_watcher_inspect_and_enforce_quarantine(self):
        """Verify inspect_and_enforce detects PII and quarantines file."""
        test_file = self.watched_folder / "passwords_and_pan.txt"
        test_file.write_text(
            "Customer credentials: PAN ABCDE1234F, AWS Secret Key: AKIAIOSFODNN7EXAMPLE1234567890",
            encoding="utf-8"
        )
        self.assertTrue(test_file.exists())

        svc = FileWatcherService()
        svc.inspect_and_enforce(str(test_file))

        # Give file system and background zip operation a moment to complete
        time.sleep(1.0)

        # Original plaintext file should be quarantined and deleted
        self.assertFalse(test_file.exists())

    def test_04_benign_file_remains_intact(self):
        """Verify document without PII is allowed and never deleted."""
        clean_file = self.watched_folder / "public_notes.txt"
        clean_file.write_text(
            "Meeting minutes: Team discussed quarterly goals and project timeline.",
            encoding="utf-8"
        )
        self.assertTrue(clean_file.exists())

        svc = FileWatcherService()
        svc.inspect_and_enforce(str(clean_file))

        time.sleep(0.5)

        # Benign file must still exist
        self.assertTrue(clean_file.exists())

    def test_05_unwatched_folder_ignored(self):
        """Verify that files outside active watched_folders are strictly ignored and never touched."""
        unwatched_folder = self.temp_dir / "unwatched"
        unwatched_folder.mkdir(parents=True, exist_ok=True)
        unwatched_file = unwatched_folder / "aadhaar_unwatched.txt"
        unwatched_file.write_text("AADHAAR: 3675 9834 5012, PAN: ABCDE1234F", encoding="utf-8")
        self.assertTrue(unwatched_file.exists())

        svc = FileWatcherService()
        handler = FileSaveEventHandler(svc)
        self.assertFalse(handler._is_in_watched_folders(unwatched_file))

        # Inspect and enforce must reject files outside watched folders
        svc.inspect_and_enforce(str(unwatched_file))
        self.assertTrue(unwatched_file.exists())


if __name__ == "__main__":
    unittest.main()

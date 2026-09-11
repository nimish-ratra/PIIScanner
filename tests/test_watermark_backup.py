"""
Unit tests for Watermark Backup & Rollback Safety Net
"""

import unittest
import tempfile
import os
import shutil
import time
from pathlib import Path

from backend.watermark_backup import (
    compute_file_sha256,
    create_watermark_backup,
    restore_watermark_backup,
    prune_watermark_backups
)
from backend.database import DatabaseManager


class TestWatermarkBackup(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.backup_dir = Path(self.temp_dir) / "backups"
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = Path(self.temp_dir) / "test_backup.db"
        self.db = DatabaseManager(db_path=self.db_path)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_compute_sha256(self):
        test_file = Path(self.temp_dir) / "test.txt"
        test_file.write_text("Confidential financial statement: 1234-5678", encoding="utf-8")

        h1 = compute_file_sha256(test_file)
        self.assertTrue(len(h1) == 64)

        # Content change produces different hash
        test_file.write_text("Modified content", encoding="utf-8")
        h2 = compute_file_sha256(test_file)
        self.assertNotEqual(h1, h2)

    def test_create_and_restore_backup(self):
        # 1. Create target file
        original_text = "CONFIDENTIAL INTERNAL MEMO: Patient record 998811"
        test_file = Path(self.temp_dir) / "memo.txt"
        test_file.write_text(original_text, encoding="utf-8")
        orig_hash = compute_file_sha256(test_file)

        # 2. Create pre-mutation backup
        content_hash, backup_path = create_watermark_backup(test_file, backup_dir=self.backup_dir)
        self.assertEqual(content_hash, orig_hash)
        self.assertTrue(os.path.exists(backup_path))

        # Record in DB
        self.db.record_watermark_applied(
            file_path=str(test_file),
            content_hash=orig_hash,
            method="test_method",
            backup_path=backup_path,
            tier="Confidential"
        )

        # 3. Simulate watermarking mutation
        test_file.write_text("WATERMARKED: " + original_text, encoding="utf-8")
        wm_hash = compute_file_sha256(test_file)
        self.assertNotEqual(orig_hash, wm_hash)

        # 4. Perform restore
        success, msg = restore_watermark_backup(
            filepath=test_file,
            backup_path=backup_path,
            expected_watermark_hash=wm_hash
        )
        self.assertTrue(success)
        restored_hash = compute_file_sha256(test_file)
        self.assertEqual(restored_hash, orig_hash)
        self.assertEqual(test_file.read_text(encoding="utf-8"), original_text)

    def test_restore_modification_collision_guard(self):
        # Target file
        test_file = Path(self.temp_dir) / "document.txt"
        test_file.write_text("Original text", encoding="utf-8")
        orig_hash = compute_file_sha256(test_file)

        content_hash, backup_path = create_watermark_backup(test_file, backup_dir=self.backup_dir)

        # Watermarked
        test_file.write_text("Watermarked text", encoding="utf-8")
        wm_hash = compute_file_sha256(test_file)

        # User further modified file AFTER watermarking
        test_file.write_text("User manual modifications made later", encoding="utf-8")

        # Attempt restore with expected_watermark_hash
        success, msg = restore_watermark_backup(
            filepath=test_file,
            backup_path=backup_path,
            expected_watermark_hash=wm_hash
        )
        self.assertFalse(success)
        self.assertIn("hash mismatch", msg)
        # Content remains user's modified text, not overwritten
        self.assertEqual(test_file.read_text(encoding="utf-8"), "User manual modifications made later")

    def test_restore_missing_target_file(self):
        test_file = Path(self.temp_dir) / "deleted.txt"
        test_file.write_text("Will be deleted", encoding="utf-8")

        _, backup_path = create_watermark_backup(test_file, backup_dir=self.backup_dir)
        os.remove(test_file)

        success, msg = restore_watermark_backup(test_file, backup_path=backup_path)
        self.assertFalse(success)
        self.assertIn("moved or deleted", msg)

    def test_prune_old_backups(self):
        # Create an old backup directory (35 days old)
        old_dir = self.backup_dir / "oldhash123456"
        old_dir.mkdir(parents=True, exist_ok=True)
        old_file = old_dir / "old_doc.txt"
        old_file.write_text("Old backup content", encoding="utf-8")

        # Set mtime to 35 days ago
        old_time = time.time() - (35 * 86400)
        os.utime(str(old_dir), (old_time, old_time))
        os.utime(str(old_file), (old_time, old_time))

        # Create a fresh backup directory (today)
        new_dir = self.backup_dir / "newhash123456"
        new_dir.mkdir(parents=True, exist_ok=True)
        new_file = new_dir / "new_doc.txt"
        new_file.write_text("New backup content", encoding="utf-8")

        # Prune with 30-day retention
        pruned = prune_watermark_backups(retention_days=30, backup_dir=self.backup_dir)
        self.assertEqual(pruned, 1)
        self.assertFalse(old_dir.exists())
        self.assertTrue(new_dir.exists())


if __name__ == "__main__":
    unittest.main()

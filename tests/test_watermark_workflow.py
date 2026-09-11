"""
Unit tests for Watermark Approval Workflow, Batch Review Dialog,
and Classification Registry Lifecycle (Phase 3A).
"""

import unittest
import tempfile
import os
import shutil
from pathlib import Path
from PySide6.QtWidgets import QApplication

from backend.config import ConfigManager
from backend.database import DatabaseManager
from backend.classifier import SensitivityTier
from backend.watermark_engine import WatermarkStatus
from ui.views.watermark_review_dialog import WatermarkReviewDialog

# Ensure QApplication is initialized for UI tests
app = QApplication.instance() or QApplication([])


class TestWatermarkWorkflow(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.config_path = Path(self.temp_dir) / "config.json"
        self.config = ConfigManager(config_path=self.config_path)

        self.db_path = Path(self.temp_dir) / "test_workflow.db"
        self.db = DatabaseManager(db_path=self.db_path)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_01_config_keys_roundtrip(self):
        """Verify all new Phase 3A config keys persist and load correctly."""
        self.assertEqual(self.config.get("watermark_approval_mode"), "manual")
        self.assertEqual(self.config.get("watermark_min_tier"), "Confidential")
        self.assertEqual(self.config.get("watermark_backup_retention_days"), 30)

        # Update values
        self.config.set("watermark_approval_mode", "auto")
        self.config.set("watermark_min_tier", "Highly Confidential")
        self.config.set("watermark_backup_retention_days", 45)
        self.config.set("system_scan_exclusions", ["Windows", "CustomDir"])
        self.config.save()

        # Reload from disk
        reloaded = ConfigManager(config_path=self.config_path)
        self.assertEqual(reloaded.get("watermark_approval_mode"), "auto")
        self.assertEqual(reloaded.get("watermark_min_tier"), "Highly Confidential")
        self.assertEqual(reloaded.get("watermark_backup_retention_days"), 45)
        self.assertIn("CustomDir", reloaded.get("system_scan_exclusions"))

    def test_02_database_watermark_candidates_threshold(self):
        """Verify database only returns candidates at or above min_tier."""
        scan_id = "test_scan_101"
        scan_meta = {
            "scan_id": scan_id,
            "target_folder": "C:\\test",
            "started_at": "2026-09-11 10:00:00",
            "completed_at": "2026-09-11 10:01:00",
            "files_scanned": 4,
            "files_with_pii": 4,
            "total_findings": 4,
            "status": "completed",
            "scan_source": "directory_scan"
        }
        findings = [
            {"file": "C:\\data\\public.txt", "entity": "URL", "confidence": 0.8, "classification": "Public"},
            {"file": "C:\\data\\general.txt", "entity": "PERSON", "confidence": 0.8, "classification": "General"},
            {"file": "C:\\data\\conf.docx", "entity": "EMAIL_ADDRESS", "confidence": 0.9, "classification": "Confidential"},
            {"file": "C:\\data\\restricted.pdf", "entity": "IN_PAN", "confidence": 0.95, "classification": "Restricted"},
        ]
        self.db.insert_scan(scan_meta, findings)

        # Default min_tier: Confidential
        candidates = self.db.get_watermark_candidates(scan_id=scan_id, min_tier="Confidential")
        candidate_files = [c["file_path"] for c in candidates]

        self.assertIn("C:\\data\\conf.docx", candidate_files)
        self.assertIn("C:\\data\\restricted.pdf", candidate_files)
        self.assertNotIn("C:\\data\\public.txt", candidate_files)
        self.assertNotIn("C:\\data\\general.txt", candidate_files)

        # Higher threshold: Restricted only
        restricted_candidates = self.db.get_watermark_candidates(scan_id=scan_id, min_tier="Restricted")
        self.assertEqual(len(restricted_candidates), 1)
        self.assertEqual(restricted_candidates[0]["file_path"], "C:\\data\\restricted.pdf")

    def test_03_database_watermark_lifecycle_transitions(self):
        """Verify status transitions: none -> applied -> reverted."""
        test_file = "C:\\docs\\patient_record.docx"
        dummy_hash = "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
        backup_path = "C:\\backups\\abc123456\\patient_record.docx"

        # 1. Apply
        self.db.record_watermark_applied(
            file_path=test_file,
            content_hash=dummy_hash,
            method="docx_wordart_and_footer",
            backup_path=backup_path,
            tier="Confidential"
        )
        rec = self.db.get_watermark_record(test_file)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["watermark_status"], "applied")
        self.assertEqual(rec["content_hash_sha256"], dummy_hash)
        self.assertEqual(rec["watermark_backup_path"], backup_path)

        # 2. Revert
        self.db.record_watermark_reverted(test_file)
        rec_reverted = self.db.get_watermark_record(test_file)
        self.assertEqual(rec_reverted["watermark_status"], "reverted")

    def test_04_review_dialog_selection_and_toggles(self):
        """Test WatermarkReviewDialog batch selection, per-tier toggles, and filters."""
        candidates = [
            {
                "file_path": str(Path(self.temp_dir) / "doc1.docx"),
                "tier": "Confidential",
                "finding_count": 2,
                "entities": "EMAIL_ADDRESS, PHONE_NUMBER",
                "file_size_bytes": 10240,
                "watermark_status": "none"
            },
            {
                "file_path": str(Path(self.temp_dir) / "doc2.xlsx"),
                "tier": "Highly Confidential",
                "finding_count": 3,
                "entities": "US_SSN",
                "file_size_bytes": 20480,
                "watermark_status": "none"
            },
            {
                "file_path": str(Path(self.temp_dir) / "doc3.txt"),
                "tier": "Restricted",
                "finding_count": 1,
                "entities": "IN_PAN",
                "file_size_bytes": 5120,
                "watermark_status": "none"
            },
        ]

        dlg = WatermarkReviewDialog(candidates)

        # Initial state: all selected (default)
        selected = dlg._get_selected_candidates()
        self.assertEqual(len(selected), 3)

        # Deselect all
        dlg._deselect_all()
        self.assertEqual(len(dlg._get_selected_candidates()), 0)

        # Select all
        dlg._select_all()
        self.assertEqual(len(dlg._get_selected_candidates()), 3)

        # Toggle Confidential only (should deselect doc1)
        dlg._toggle_tier("Confidential")
        selected_after_toggle = dlg._get_selected_candidates()
        self.assertEqual(len(selected_after_toggle), 2)
        tiers_selected = [s["tier"] for s in selected_after_toggle]
        self.assertNotIn("Confidential", tiers_selected)
        self.assertIn("Highly Confidential", tiers_selected)
        self.assertIn("Restricted", tiers_selected)

        # Search filter
        dlg._filter_rows("doc2")
        self.assertTrue(dlg.table.isRowHidden(0))
        self.assertFalse(dlg.table.isRowHidden(1))
        self.assertTrue(dlg.table.isRowHidden(2))

        dlg._filter_rows("")
        self.assertFalse(dlg.table.isRowHidden(0))
        self.assertFalse(dlg.table.isRowHidden(1))
        self.assertFalse(dlg.table.isRowHidden(2))

        dlg.close()

    def test_05_batch_dry_run_creates_no_backups(self):
        """Verify that a dry-run pass over candidates does not create any files in the backup directory."""
        from backend.watermark_engine import WatermarkEngine, WatermarkStatus
        from backend.watermark_backup import get_watermark_backup_dir

        test_dir = Path(self.temp_dir) / "dry_run_batch"
        test_dir.mkdir(parents=True, exist_ok=True)
        backup_dir = Path(self.temp_dir) / "backups_dry_run"
        backup_dir.mkdir(parents=True, exist_ok=True)

        engine = WatermarkEngine(min_tier="Confidential", backup_dir=backup_dir, db=self.db)

        files = []
        for i in range(3):
            f = test_dir / f"candidate_{i}.txt"
            f.write_text(f"Patient record {i} PAN: ABCDE123{i}F", encoding="utf-8")
            files.append(f)

        for f in files:
            res = engine.apply_watermark(f, tier="Highly Confidential", dry_run=True)
            self.assertEqual(res.status, WatermarkStatus.PENDING)
            self.assertIsNone(res.backup_path)

        # Assert no files exist in backup directory
        backups = [b for b in backup_dir.rglob("*") if b.is_file()]
        self.assertEqual(len(backups), 0)


if __name__ == "__main__":
    unittest.main()

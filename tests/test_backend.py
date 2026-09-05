"""
Comprehensive Backend Test Suite for PII Sentinel
Tests Config, Database, Tika Extractor, Presidio Detector, Scanner, Reporter, and File Operations.
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from backend.config import ConfigManager
from backend.database import DatabaseManager
from backend.tika_extractor import TikaExtractor, configure_java_environment
from backend.presidio_detector import PresidioDetector, redact_value
from backend.reporter import write_csv, write_json, write_html_dashboard
from backend.file_ops import extract_flagged_files, quarantine_flagged_files
from backend.scanner import Scanner
from tests.create_test_samples import create_test_samples


class TestBackend(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Configure Java environment
        configure_java_environment()
        # Create temp folder for tests
        cls.test_dir = Path(tempfile.mkdtemp(prefix="pii_sentinel_test_"))
        cls.samples_dir = cls.test_dir / "samples"
        create_test_samples(str(cls.samples_dir))

    @classmethod
    def tearDownClass(cls):
        # Clean up temporary test files
        if cls.test_dir.exists():
            try:
                shutil.rmtree(str(cls.test_dir))
            except Exception:
                pass

    def test_01_config_manager(self):
        cfg_path = self.test_dir / "test_config.json"
        cfg = ConfigManager(config_path=cfg_path)
        self.assertEqual(cfg.confidence_threshold, 0.6)
        cfg.confidence_threshold = 0.75
        self.assertEqual(cfg.confidence_threshold, 0.75)

        # Test max_workers property and persistence
        self.assertEqual(cfg.max_workers, 2)
        cfg.max_workers = 4
        self.assertEqual(cfg.max_workers, 4)

        # Reload from disk
        cfg_reloaded = ConfigManager(config_path=cfg_path)
        self.assertEqual(cfg_reloaded.confidence_threshold, 0.75)
        self.assertEqual(cfg_reloaded.max_workers, 4)
        print("[OK] ConfigManager test passed.")

    def test_02_database_manager(self):
        db_path = self.test_dir / "test_history.db"
        db = DatabaseManager(db_path=db_path)

        scan_meta = {
            "scan_id": "test_scan_001",
            "target_folder": str(self.samples_dir),
            "started_at": "2026-09-04 12:00:00",
            "completed_at": "2026-09-04 12:01:00",
            "duration_seconds": 60.0,
            "files_scanned": 5,
            "files_with_pii": 2,
            "total_findings": 4,
            "confidence_threshold": 0.6,
            "status": "completed"
        }
        findings = [
            {
                "file": "test.txt",
                "entity": "EMAIL_ADDRESS",
                "value_redacted": "te***xt",
                "confidence": 0.85,
                "start": 0,
                "end": 10,
                "file_size_bytes": 100,
                "last_modified": "2026-09-04"
            }
        ]
        db.insert_scan(scan_meta, findings)

        scans = db.get_all_scans()
        self.assertEqual(len(scans), 1)
        self.assertEqual(scans[0]["scan_id"], "test_scan_001")

        loaded_findings = db.get_findings_for_scan("test_scan_001")
        self.assertEqual(len(loaded_findings), 1)
        self.assertEqual(loaded_findings[0]["entity"], "EMAIL_ADDRESS")

        db.delete_scan("test_scan_001")
        self.assertEqual(len(db.get_all_scans()), 0)
        print("[OK] DatabaseManager test passed.")

    def test_03_redaction_helper(self):
        self.assertEqual(redact_value(""), "")
        self.assertEqual(redact_value("ab"), "**")
        self.assertEqual(redact_value("abcd"), "a**d")
        masked = redact_value("alice.smith@sentinelcorp.com")
        self.assertTrue(masked.startswith("al"))
        self.assertTrue(masked.endswith("om"))
        self.assertIn("*", masked)
        print(f"[OK] Redaction test passed: {masked}")

    def test_04_presidio_detector(self):
        detector = PresidioDetector.get_instance()
        entities = detector.get_supported_entities()
        self.assertTrue(len(entities) > 0)
        self.assertIn("EMAIL_ADDRESS", entities)
        self.assertIn("PHONE_NUMBER", entities)

        sample_text = (
            "Contact John Doe at john.doe@acme.com or call +1-555-432-1098. "
            "Credit card number is 4532 0150 1234 5678."
        )
        findings = detector.analyze_text(sample_text, score_threshold=0.5)
        found_entities = {f["entity"] for f in findings}
        self.assertTrue(any("EMAIL" in e for e in found_entities))
        print(f"[OK] Presidio detection passed. Found: {found_entities}")

    def test_05_tika_extractor(self):
        extractor = TikaExtractor(max_file_size_mb=10)
        # Test clean text file
        clean_file = self.samples_dir / "clean_project_notes.txt"
        text, err = extractor.extract_text(str(clean_file))
        self.assertIsNone(err)
        self.assertIn("Project Architecture", text)

        # Test corrupted file (must not crash)
        corrupt_file = self.samples_dir / "corrupted_archive.docx"
        _, _ = extractor.extract_text(str(corrupt_file))
        # Result may be empty text or error message, but must not raise exception
        print("[OK] TikaExtractor test passed.")

    def test_06_file_operations(self):
        pii_file = self.samples_dir / "customer_inquiry_ticket.txt"
        nested_file = self.samples_dir / "confidential_archive" / "2026" / "executive_payroll_notes.txt"

        # 1. Test extraction (copy mode) preserving relative path
        extract_dest = self.test_dir / "extracted_output"
        result = extract_flagged_files(
            files=[str(pii_file), str(nested_file)],
            destination_folder=str(extract_dest),
            root_scan_folder=str(self.samples_dir),
            move_files=False
        )
        self.assertEqual(result["successful_count"], 2)
        # Check that relative structure is preserved
        expected_nested = extract_dest / "confidential_archive" / "2026" / "executive_payroll_notes.txt"
        self.assertTrue(expected_nested.exists())

        # 2. Test quarantine (zip archive)
        quarantine_zip = self.test_dir / "quarantine_archive.zip"
        q_result = quarantine_flagged_files(
            files=[str(pii_file), str(nested_file)],
            zip_destination_path=str(quarantine_zip),
            root_scan_folder=str(self.samples_dir),
            password="SafePassword123!",
            rename_originals=False
        )
        self.assertTrue(q_result["success"])
        self.assertTrue(quarantine_zip.exists())
        print("[OK] File operations test passed.")

    def test_07_full_scanner_and_reports(self):
        reports_dir = self.test_dir / "reports"
        scanner = Scanner(
            target_folder=str(self.samples_dir),
            confidence_threshold=0.5,
            reports_dir=str(reports_dir)
        )
        summary = scanner.run()

        self.assertGreater(summary["files_scanned"], 0)
        self.assertGreater(summary["files_with_pii"], 0)
        self.assertGreater(summary["total_findings"], 0)

        # Check reports generated
        self.assertTrue(Path(summary["report_csv"]).exists())
        self.assertTrue(Path(summary["report_json"]).exists())
        self.assertTrue(Path(summary["report_html"]).exists())

        print(f"[OK] Scanner and reporter test passed. Summary: Scanned={summary['files_scanned']}, PII={summary['files_with_pii']}, Findings={summary['total_findings']}")

    def test_08_multi_worker_scanner(self):
        reports_dir = self.test_dir / "reports_multi"
        scanner = Scanner(
            target_folder=str(self.samples_dir),
            confidence_threshold=0.5,
            max_workers=4,
            reports_dir=str(reports_dir)
        )
        self.assertEqual(scanner.max_workers, 4)
        summary = scanner.run()

        self.assertGreater(summary["files_scanned"], 0)
        self.assertGreater(summary["files_with_pii"], 0)
        self.assertGreater(summary["total_findings"], 0)
        self.assertTrue(Path(summary["report_csv"]).exists())
        self.assertTrue(Path(summary["report_html"]).exists())
        print(f"[OK] Multi-worker (4 workers) scanner test passed. Scanned: {summary['files_scanned']}, Findings: {summary['total_findings']}")


if __name__ == "__main__":
    unittest.main()

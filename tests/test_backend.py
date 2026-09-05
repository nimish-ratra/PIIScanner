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
from backend.classifier import SensitivityTier, TIER_METADATA, classify_document, classify_finding
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

    def test_09_india_pii_and_secrets(self):
        detector = PresidioDetector.get_instance()
        text = (
            "Taxpayer PAN: ABCPK1234F. "
            "Valid Aadhaar: 3675 9832 4152. "
            "Corrupted Aadhaar: 3675 9832 4159. "
            "GSTIN: 27ABCDE1234F1Z5. "
            "IFSC: HDFC0001234. "
            "AWS Key: AKIAIOSFODNN7EXAMPLE. "
            "GitHub Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz. "
            "OpenAI: sk-proj-1234567890abcdefghijklmnopqrstuvwxyz1234567890. "
            "-----BEGIN RSA PRIVATE KEY-----"
        )
        findings = detector.analyze_text(text, score_threshold=0.5)
        found_types = {f["entity"] for f in findings}

        self.assertIn("IN_PAN", found_types)
        self.assertIn("IN_AADHAAR", found_types)
        self.assertIn("IN_GSTIN", found_types)
        self.assertIn("IN_IFSC", found_types)
        self.assertIn("AWS_ACCESS_KEY", found_types)
        self.assertIn("GITHUB_TOKEN", found_types)
        self.assertIn("OPENAI_API_KEY", found_types)
        self.assertIn("PRIVATE_KEY", found_types)

        # Confirm invalid Aadhaar was rejected by Verhoeff check
        aadhaar_vals = [f["value"] for f in findings if f["entity"] == "IN_AADHAAR"]
        self.assertIn("3675 9832 4152", aadhaar_vals)
        self.assertNotIn("3675 9832 4159", aadhaar_vals)
        print(f"[OK] India PII and Developer Secrets tests passed. Verified {len(found_types)} entities.")

    def test_10_sensitivity_classification(self):
        # 1. Test finding classification
        f_secret = classify_finding("AWS_ACCESS_KEY")
        self.assertEqual(f_secret["tier"], SensitivityTier.RESTRICTED.value)
        self.assertEqual(f_secret["level"], 5)

        f_aadhaar = classify_finding("IN_AADHAAR")
        self.assertEqual(f_aadhaar["tier"], SensitivityTier.HIGHLY_CONFIDENTIAL.value)
        self.assertEqual(f_aadhaar["level"], 4)

        f_email = classify_finding("EMAIL_ADDRESS")
        self.assertEqual(f_email["tier"], SensitivityTier.CONFIDENTIAL.value)
        self.assertEqual(f_email["level"], 3)

        f_unknown = classify_finding("UNKNOWN_CUSTOM")
        self.assertEqual(f_unknown["tier"], SensitivityTier.GENERAL.value)
        self.assertEqual(f_unknown["level"], 2)

        # 2. Test document classification & bulk escalation
        doc_empty = classify_document([])
        self.assertEqual(doc_empty["tier"], SensitivityTier.GENERAL.value)

        doc_single_email = classify_document([{"entity": "EMAIL_ADDRESS"}])
        self.assertEqual(doc_single_email["tier"], SensitivityTier.CONFIDENTIAL.value)

        # Bulk 15 emails -> escalates to Highly Confidential
        doc_bulk_15 = classify_document([{"entity": "EMAIL_ADDRESS"}] * 15)
        self.assertEqual(doc_bulk_15["tier"], SensitivityTier.HIGHLY_CONFIDENTIAL.value)
        self.assertIn(">=10 volume threshold", doc_bulk_15["rationale"])

        # Bulk 55 emails -> escalates to Restricted
        doc_bulk_55 = classify_document([{"entity": "EMAIL_ADDRESS"}] * 55)
        self.assertEqual(doc_bulk_55["tier"], SensitivityTier.RESTRICTED.value)
        self.assertIn(">=50 volume threshold", doc_bulk_55["rationale"])

        # Mixed secrets + email -> highest tier wins (Restricted)
        doc_mixed = classify_document([{"entity": "EMAIL_ADDRESS"}, {"entity": "GITHUB_TOKEN"}])
        self.assertEqual(doc_mixed["tier"], SensitivityTier.RESTRICTED.value)

        # 3. Database persistence of classification column
        db_path = self.test_dir / "test_classification.db"
        db = DatabaseManager(db_path=db_path)
        scan_meta = {
            "scan_id": "class_scan_001",
            "target_folder": str(self.samples_dir),
            "started_at": "2026-09-05 12:00:00",
            "completed_at": "2026-09-05 12:01:00",
            "duration_seconds": 10.0,
            "files_scanned": 1,
            "files_with_pii": 1,
            "total_findings": 1,
            "confidence_threshold": 0.5,
            "status": "completed"
        }
        test_finding = [{
            "file": "test.txt",
            "entity": "AWS_ACCESS_KEY",
            "classification": "Restricted",
            "value_redacted": "AK***LE",
            "confidence": 0.99,
            "start": 0,
            "end": 20,
            "file_size_bytes": 128,
            "last_modified": "2026-09-05"
        }]
        db.insert_scan(scan_meta, test_finding)
        loaded = db.get_findings_for_scan("class_scan_001")
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0]["classification"], "Restricted")

        # 4. Scanner end-to-end classification
        reports_dir = self.test_dir / "reports_class"
        scanner = Scanner(
            target_folder=str(self.samples_dir),
            confidence_threshold=0.5,
            max_workers=2,
            reports_dir=str(reports_dir)
        )
        summary = scanner.run()
        self.assertIn("highest_classification", summary)
        self.assertIn("classification_counts", summary)
        self.assertIn("Restricted", summary["classification_counts"])
        self.assertIn("Highly Confidential", summary["classification_counts"])

        # Check CSV contains classification column
        csv_path = summary["report_csv"]
        with open(csv_path, "r", encoding="utf-8") as f:
            header_line = f.readline()
            self.assertIn("classification", header_line)

        print(f"[OK] Microsoft 5-Tier Sensitivity Classification test passed. Highest Tier: {summary['highest_classification']}")


if __name__ == "__main__":
    unittest.main()


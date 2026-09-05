"""
UI Integration & Functional Tests for PII Sentinel
Uses Qt offscreen platform to verify all views, widget states, signal connections, and tab navigation.
"""

import os
import sys
import unittest
from pathlib import Path

# Ensure offscreen rendering for automated testing
os.environ["QT_QPA_PLATFORM"] = "offscreen"

from PySide6.QtWidgets import QApplication, QMessageBox
from PySide6.QtCore import Qt

# Prevent blocking modal dialogs during automated tests
QMessageBox.information = lambda *args, **kwargs: QMessageBox.Ok
QMessageBox.warning = lambda *args, **kwargs: QMessageBox.Ok
QMessageBox.critical = lambda *args, **kwargs: QMessageBox.Ok
QMessageBox.question = lambda *args, **kwargs: QMessageBox.Yes

from ui.main_window import MainWindow
from backend.config import config_manager


class TestUI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Create singleton QApplication if not already existing
        cls.app = QApplication.instance()
        if not cls.app:
            cls.app = QApplication(sys.argv)
        # Avoid blocking modal on test startup
        config_manager.first_run_complete = True
        cls.window = MainWindow()

    def test_01_window_components_initialized(self):
        self.assertIsNotNone(self.window.view_scan)
        self.assertIsNotNone(self.window.view_results)
        self.assertIsNotNone(self.window.view_history)
        self.assertIsNotNone(self.window.view_settings)
        self.assertEqual(self.window.stack.count(), 4)
        print("[OK] MainWindow and 4 views initialized.")

    def test_02_navigation_switching(self):
        # Switch to Results (tab index 1)
        self.window.btn_nav_results.click()
        self.assertEqual(self.window.stack.currentIndex(), 1)

        # Switch to History (tab index 2)
        self.window.btn_nav_history.click()
        self.assertEqual(self.window.stack.currentIndex(), 2)

        # Switch to Settings (tab index 3)
        self.window.btn_nav_settings.click()
        self.assertEqual(self.window.stack.currentIndex(), 3)

        # Switch back to Scan (tab index 0)
        self.window.btn_nav_scan.click()
        self.assertEqual(self.window.stack.currentIndex(), 0)
        print("[OK] Sidebar navigation and tab switching passed.")

    def test_03_results_view_population_and_filter(self):
        summary = {
            "target_folder": "C:/TestScan",
            "files_with_pii": 1,
            "total_findings": 2,
            "report_html": ""
        }
        findings = [
            {
                "file": "C:/TestScan/doc1.txt",
                "entity": "EMAIL_ADDRESS",
                "value_redacted": "us***om",
                "confidence": 0.85,
                "file_size_bytes": 1024,
                "last_modified": "2026-09-04 12:00:00"
            },
            {
                "file": "C:/TestScan/doc2.txt",
                "entity": "PHONE_NUMBER",
                "value_redacted": "+1***99",
                "confidence": 0.70,
                "file_size_bytes": 2048,
                "last_modified": "2026-09-04 12:05:00"
            }
        ]

        self.window.view_results.set_scan_results(summary, findings)
        self.assertEqual(self.window.view_results.table.rowCount(), 2)

        # Test filter by entity
        self.window.view_results.combo_entity.setCurrentText("EMAIL_ADDRESS")
        self.assertEqual(self.window.view_results.table.rowCount(), 1)

        # Reset entity filter
        self.window.view_results.combo_entity.setCurrentText("All Entities")
        self.assertEqual(self.window.view_results.table.rowCount(), 2)

        # Test search box
        self.window.view_results.search_box.setText("doc2")
        self.assertEqual(self.window.view_results.table.rowCount(), 1)
        self.window.view_results.search_box.clear()
        self.assertEqual(self.window.view_results.table.rowCount(), 2)

        print("[OK] Results view table and filter tests passed.")

    def test_04_settings_view_persistence(self):
        # Change slider in settings
        self.window.view_settings.slider_thresh.setValue(85)
        self.window.view_settings.save_settings()
        self.assertEqual(config_manager.confidence_threshold, 0.85)

        # Restore
        self.window.view_settings.slider_thresh.setValue(60)
        self.window.view_settings.save_settings()
        self.assertEqual(config_manager.confidence_threshold, 0.60)
        print("[OK] Settings persistence test passed.")

    def test_05_live_scan_via_ui(self):
        from tests.create_test_samples import create_test_samples
        samples_dir = create_test_samples()

        self.window.view_scan.edit_folder.setText(str(samples_dir))
        self.window.view_scan.slider_threshold.setValue(50)
        self.window.view_scan._on_start_scan()

        # Wait for worker thread to finish
        worker = self.window.view_scan.worker
        self.assertIsNotNone(worker)
        worker.wait(15000)  # Wait up to 15 seconds

        # Process any pending Qt events
        QApplication.processEvents()

        # Verify results in ResultsView
        self.assertGreater(self.window.view_results.table.rowCount(), 0)
        self.assertGreater(int(self.window.view_scan.card_findings.get_value()), 0)
        print(f"[OK] Live UI scan test passed. Table rows populated: {self.window.view_results.table.rowCount()}")


if __name__ == "__main__":
    unittest.main()

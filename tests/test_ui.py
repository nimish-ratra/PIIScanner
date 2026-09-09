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
        self.assertIsNotNone(self.window.view_live)
        self.assertIsNotNone(self.window.view_settings)
        self.assertEqual(self.window.stack.count(), 5)
        print("[OK] MainWindow and 5 views initialized.")

    def test_02_navigation_switching(self):
        # Switch to Results (tab index 1)
        self.window.btn_nav_results.click()
        self.assertEqual(self.window.stack.currentIndex(), 1)

        # Switch to History (tab index 2)
        self.window.btn_nav_history.click()
        self.assertEqual(self.window.stack.currentIndex(), 2)

        # Switch to Live Monitoring (tab index 3)
        self.window.btn_nav_live.click()
        self.assertEqual(self.window.stack.currentIndex(), 3)

        # Switch to Settings (tab index 4)
        self.window.btn_nav_settings.click()
        self.assertEqual(self.window.stack.currentIndex(), 4)

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
                "classification": "Confidential",
                "classification_badge": "🟠 Confidential",
                "value_redacted": "us***om",
                "confidence": 0.85,
                "file_size_bytes": 1024,
                "last_modified": "2026-09-04 12:00:00"
            },
            {
                "file": "C:/TestScan/doc2.txt",
                "entity": "PHONE_NUMBER",
                "classification": "Restricted",
                "classification_badge": "🟣 Restricted",
                "value_redacted": "+1***99",
                "confidence": 0.70,
                "file_size_bytes": 2048,
                "last_modified": "2026-09-04 12:05:00"
            }
        ]

        self.window.view_results.set_scan_results(summary, findings)
        self.assertEqual(self.window.view_results.table.rowCount(), 2)
        self.assertEqual(self.window.view_results.table.columnCount(), 7)

        # Verify sensitivity badges in column 2
        self.assertIn("Confidential", self.window.view_results.table.item(0, 2).text())
        self.assertIn("Restricted", self.window.view_results.table.item(1, 2).text())

        # Test filter by entity
        self.window.view_results.combo_entity.setCurrentText("EMAIL_ADDRESS")
        self.assertEqual(self.window.view_results.table.rowCount(), 1)

        # Reset entity filter
        self.window.view_results.combo_entity.setCurrentText("All Entities")
        self.assertEqual(self.window.view_results.table.rowCount(), 2)

        # Test filter by classification
        self.window.view_results.combo_classification.setCurrentText("🟣 Restricted")
        self.assertEqual(self.window.view_results.table.rowCount(), 1)
        self.assertEqual(self.window.view_results.table.item(0, 1).text(), "PHONE_NUMBER")

        self.window.view_results.combo_classification.setCurrentText("All Classifications")
        self.assertEqual(self.window.view_results.table.rowCount(), 2)

        # Test search box
        self.window.view_results.search_box.setText("doc2")
        self.assertEqual(self.window.view_results.table.rowCount(), 1)
        self.window.view_results.search_box.clear()
        self.assertEqual(self.window.view_results.table.rowCount(), 2)

        print("[OK] Results view table and filter tests passed.")

    def test_04_settings_view_persistence(self):
        # Change slider and workers in settings
        self.window.view_settings.slider_thresh.setValue(85)
        self.window.view_settings.spin_workers.setValue(4)
        self.window.view_settings.save_settings()
        self.assertEqual(config_manager.confidence_threshold, 0.85)
        self.assertEqual(config_manager.max_workers, 4)

        # Restore
        self.window.view_settings.slider_thresh.setValue(60)
        self.window.view_settings.spin_workers.setValue(2)
        self.window.view_settings.save_settings()
        self.assertEqual(config_manager.confidence_threshold, 0.60)
        self.assertEqual(config_manager.max_workers, 2)
        print("[OK] Settings persistence test passed.")

    def test_05_live_scan_via_ui(self):
        from tests.create_test_samples import create_test_samples
        samples_dir = create_test_samples()

        # Ensure full entity scanning enabled for live test
        self.window.view_scan._select_all_entities()

        self.window.view_scan.edit_folder.setText(str(samples_dir))
        self.window.view_scan.slider_threshold.setValue(50)
        self.window.view_scan.slider_workers.setValue(4)
        self.window.view_scan._on_start_scan()

        # Wait for worker thread to finish
        worker = self.window.view_scan.worker
        self.assertIsNotNone(worker)
        self.assertEqual(worker.max_workers, 4)
        self.assertEqual(worker.scanner.max_workers, 4)
        worker.wait(15000)  # Wait up to 15 seconds

        # Process any pending Qt events
        QApplication.processEvents()

        # Verify results in ResultsView
        self.assertGreater(self.window.view_results.table.rowCount(), 0)
        self.assertGreater(int(self.window.view_scan.card_findings.get_value()), 0)
        print(f"[OK] Live UI scan test passed. Table rows populated: {self.window.view_results.table.rowCount()}")

    def test_06_pii_dialogs_and_unmask_toggle(self):
        from ui.components.pii_selector_dialog import PiiSelectorDialog, PiiViewerDialog, FileViewerDialog

        all_ents = self.window.view_scan.all_supported_entities
        self.assertGreaterEqual(len(all_ents), 23)

        # 1. Test PiiSelectorDialog
        dlg = PiiSelectorDialog(all_ents, ["IN_PAN", "AWS_ACCESS_KEY"])
        self.assertEqual(len(dlg.get_selected_entities()), 2)
        self.assertEqual(dlg.lbl_counter_badge.text(), f"2 of {len(all_ents)} Selected")

        # Test interactive checkbox click toggling
        dlg.checkbox_map["IN_AADHAAR"].click()
        self.assertIn("IN_AADHAAR", dlg.get_selected_entities())
        self.assertEqual(len(dlg.get_selected_entities()), 3)

        dlg.checkbox_map["IN_PAN"].click()
        self.assertNotIn("IN_PAN", dlg.get_selected_entities())
        self.assertEqual(len(dlg.get_selected_entities()), 2)

        # Test category checkbox click toggling
        india_cb = dlg.category_checkboxes.get("India PII")
        if india_cb:
            india_cb.click()  # Check all in India PII
            self.assertIn("IN_PAN", dlg.get_selected_entities())
            self.assertIn("IN_AADHAAR", dlg.get_selected_entities())

        dlg._select_all()
        self.assertEqual(len(dlg.get_selected_entities()), len(all_ents))
        dlg._deselect_all()
        self.assertEqual(len(dlg.get_selected_entities()), 0)
        self.assertIn("0 of", dlg.lbl_counter_badge.text())

        dlg._select_recommended()
        self.assertIn("IN_PAN", dlg.get_selected_entities())
        self.assertIn("AWS_ACCESS_KEY", dlg.get_selected_entities())
        dlg.close()

        # Test reopening dialog retains previously selected subset without resetting to all 36
        dlg2 = PiiSelectorDialog(all_ents, ["IN_PAN", "IN_AADHAAR"])
        self.assertEqual(dlg2.get_selected_entities(), ["IN_AADHAAR", "IN_PAN"])
        self.assertEqual(dlg2.lbl_counter_badge.text(), f"2 of {len(all_ents)} Selected")
        dlg2.close()

        # 2. Test PiiViewerDialog
        view_dlg = PiiViewerDialog(["IN_AADHAAR", "IN_PAN", "CREDIT_CARD"])
        self.assertEqual(len(view_dlg.active_set), 3)
        view_dlg.close()

        # 3. Test FileViewerDialog
        test_files = ["doc1.pdf", "subfolder/doc2.docx", "data.csv"]
        file_dlg = FileViewerDialog(test_files, "C:/TestScan")
        self.assertEqual(file_dlg.table.rowCount(), 3)
        file_dlg.close()

        # 4. Test ResultsView Unmasked Values Toggle
        results = self.window.view_results
        sample_findings = [
            {
                "file": "C:/TestScan/secret.txt",
                "entity": "AWS_ACCESS_KEY",
                "value": "AKIAIOSFODNN7EXAMPLE",
                "value_redacted": "AK****************LE",
                "confidence": 1.0,
                "file_size_bytes": 512,
                "last_modified": "2026-09-05"
            }
        ]
        results.set_scan_results({"target_folder": "C:/TestScan", "files_with_pii": 1}, sample_findings)

        # Initial state: masked
        self.assertFalse(results.is_unmasked)
        self.assertEqual(results.table.item(0, 3).text(), "AK****************LE")
        self.assertIn("Redacted", results.table.horizontalHeaderItem(3).text())

        # Toggle ON -> Reveal Full Values
        results.btn_toggle_reveal.setChecked(True)
        self.assertTrue(results.is_unmasked)
        self.assertEqual(results.table.item(0, 3).text(), "AKIAIOSFODNN7EXAMPLE")
        self.assertIn("Full / Unmasked", results.table.horizontalHeaderItem(3).text())

        # Toggle OFF -> Masked
        results.btn_toggle_reveal.setChecked(False)
        self.assertFalse(results.is_unmasked)
        self.assertEqual(results.table.item(0, 3).text(), "AK****************LE")
        self.assertIn("Redacted", results.table.horizontalHeaderItem(3).text())

        print("[OK] PII Dialogs and Unmasked Values Toggle test passed.")

    def test_07_pii_entity_selection_persistence_and_sync(self):
        """Verify that selecting a subset of entities persists across dialog opens, saves to config, and reflects in UI."""
        from ui.components.pii_selector_dialog import PiiSelectorDialog

        scan_view = self.window.view_scan
        total_ents = len(scan_view.all_supported_entities)

        # 1. Select only 2 entities
        custom_subset = ["IN_PAN", "IN_AADHAAR"]
        scan_view.selected_entities = list(custom_subset)
        config_manager.selected_entities = scan_view.selected_entities
        scan_view._update_selected_count_label()
        scan_view._update_category_summary()

        self.assertEqual(scan_view.lbl_selected_count.text(), f"2 of {total_ents} Types Active")
        self.assertEqual(config_manager.selected_entities, ["IN_PAN", "IN_AADHAAR"])
        self.assertEqual(scan_view._get_active_entities(), ["IN_PAN", "IN_AADHAAR"])

        # 2. Open dialog with this selection - must NOT reset to all 36
        dlg = PiiSelectorDialog(scan_view.all_supported_entities, scan_view.selected_entities)
        self.assertEqual(dlg.get_selected_entities(), ["IN_AADHAAR", "IN_PAN"])
        self.assertEqual(dlg.lbl_counter_badge.text(), f"2 of {total_ents} Selected")

        # 3. Interactively add a third entity
        dlg.checkbox_map["AWS_ACCESS_KEY"].click()
        self.assertEqual(dlg.lbl_counter_badge.text(), f"3 of {total_ents} Selected")
        self.assertIn("AWS_ACCESS_KEY", dlg.get_selected_entities())

        # 4. Save and verify ScanView updates
        scan_view.selected_entities = dlg.get_selected_entities()
        config_manager.selected_entities = scan_view.selected_entities
        scan_view._update_selected_count_label()
        scan_view._update_category_summary()
        dlg.close()

        self.assertEqual(scan_view.lbl_selected_count.text(), f"3 of {total_ents} Types Active")
        self.assertEqual(config_manager.selected_entities, ["AWS_ACCESS_KEY", "IN_AADHAAR", "IN_PAN"])

        # 5. Clean up by selecting all
        scan_view._select_all_entities()
        self.assertEqual(scan_view.lbl_selected_count.text(), f"All {total_ents} Types Active")
        self.assertIsNone(scan_view._get_active_entities())
        print("[OK] PII entity selection persistence, category sync, and dialog state test passed.")


if __name__ == "__main__":
    unittest.main()

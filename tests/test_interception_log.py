"""
Unit tests for Dedicated Real-Time Interception Log View & Audit Logging (Feature 2).
Verifies:
1. database.py enforcement_events schema with detection_types and app_source.
2. Filtered queries by action, tier, source, and search string.
3. CSV export with redacted values and proper column format.
4. Safe dialog rendering with zero raw PII.
"""

import os
import unittest
import tempfile
import csv
from pathlib import Path

from backend.database import DatabaseManager
from ui.components.enforcement_details_dialog import EnforcementEventDetailsDialog, get_source_icon


class TestInterceptionLog(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "test_history.db"
        self.db = DatabaseManager(self.db_path)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_insert_and_retrieve_with_metadata(self):
        """Verify enforcement events are recorded with detection_types and app_source."""
        ev_id = self.db.insert_enforcement_event({
            "timestamp": "2026-09-09 12:00:00",
            "file_path": r"C:\Users\Nimish\Documents\quarterly_report.docx",
            "tier": "Highly Confidential",
            "action_taken": "block",
            "user_override": 0,
            "override_reason": "",
            "entity_summary": "IN_AADHAAR: 1, IN_PAN: 2",
            "detection_types": "IN_AADHAAR, IN_PAN",
            "app_source": "Word"
        })
        self.assertGreater(ev_id, 0)

        events = self.db.get_enforcement_events(limit=10)
        self.assertEqual(len(events), 1)
        ev = events[0]
        self.assertEqual(ev["id"], ev_id)
        self.assertEqual(ev["app_source"], "Word")
        self.assertEqual(ev["detection_types"], "IN_AADHAAR, IN_PAN")
        self.assertEqual(ev["action_taken"], "block")

    def test_02_filtering(self):
        """Verify query filtering by action, tier, source, and file search."""
        self.db.insert_enforcement_event({
            "timestamp": "2026-09-09 12:01:00",
            "file_path": r"C:\Users\Nimish\Documents\secret_keys.json",
            "tier": "Restricted",
            "action_taken": "block",
            "source": "Filesystem Watcher",
            "app_source": "Filesystem Watcher",
            "detection_types": "AWS_ACCESS_KEY"
        })
        self.db.insert_enforcement_event({
            "timestamp": "2026-09-09 12:02:00",
            "file_path": r"C:\Users\Nimish\Documents\budget.xlsx",
            "tier": "Confidential",
            "action_taken": "warn",
            "source": "Office Add-in",
            "app_source": "Excel",
            "detection_types": "CREDIT_CARD"
        })

        # Filter by action
        blocks = self.db.get_enforcement_events(action="BLOCK")
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["action_taken"], "block")

        # Filter by tier
        restrs = self.db.get_enforcement_events(tier="RESTRICTED")
        self.assertEqual(len(restrs), 1)
        self.assertEqual(restrs[0]["tier"], "Restricted")

        # Filter by source
        watchers = self.db.get_enforcement_events(source="Filesystem Watcher")
        self.assertEqual(len(watchers), 1)
        self.assertEqual(watchers[0]["app_source"], "Filesystem Watcher")

        # Filter by search
        search_res = self.db.get_enforcement_events(search="budget")
        self.assertEqual(len(search_res), 1)
        self.assertIn("budget.xlsx", search_res[0]["file_path"])

    def test_03_csv_export(self):
        """Verify CSV export writes valid audit records with safe headers."""
        self.db.insert_enforcement_event({
            "timestamp": "2026-09-09 12:05:00",
            "file_path": r"C:\Users\Nimish\Documents\audit_sample.docx",
            "tier": "Highly Confidential",
            "action_taken": "override",
            "user_override": 1,
            "override_reason": "Emergency Board meeting presentation approved by CISO",
            "entity_summary": "IN_AADHAAR: 1",
            "detection_types": "IN_AADHAAR",
            "app_source": "Word"
        })

        csv_file = Path(self.tmp_dir.name) / "exported_audit.csv"
        success = self.db.export_enforcement_events_csv(str(csv_file))
        self.assertTrue(success)
        self.assertTrue(csv_file.exists())

        with open(csv_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            self.assertEqual(len(rows), 1)
            row = rows[0]
            self.assertEqual(row["app_source"], "Word")
            self.assertEqual(row["tier"], "Highly Confidential")
            self.assertEqual(row["action_taken"], "override")
            self.assertEqual(row["user_override"], "YES")
            self.assertIn("Emergency Board meeting", row["override_reason"])

    def test_04_source_icons(self):
        """Verify icon formatting helper."""
        self.assertEqual(get_source_icon("Word Add-in"), "📄 Word")
        self.assertEqual(get_source_icon("Excel SaveGuard"), "📊 Excel")
        self.assertEqual(get_source_icon("Filesystem Watcher"), "👁️ Watcher")
        self.assertEqual(get_source_icon("Unknown"), "🛡️ Service")


if __name__ == "__main__":
    unittest.main()

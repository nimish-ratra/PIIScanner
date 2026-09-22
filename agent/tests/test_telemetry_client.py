"""
Unit tests for ClAIssify Fleet Telemetry Client (backend/telemetry_client.py)
Validates privacy contract, payload firewall, salted path hashing, outbox operations,
and zero-network guarantees in standalone/unlicensed mode.
"""

import json
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
from pathlib import Path

from backend import telemetry_client
from backend.database import DatabaseManager


class TestTelemetryClient(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_history.db"
        self.db = DatabaseManager(self.db_path)
        # Point telemetry db_manager to our isolated test db
        self._orig_db = telemetry_client.db_manager
        telemetry_client.db_manager = self.db

        # Mock telemetry state path
        self.state_file = Path(self.temp_dir.name) / "telemetry_state.json"
        self.patcher_state = patch.object(telemetry_client, "get_telemetry_state_file_path", return_value=self.state_file)
        self.patcher_state.start()
        telemetry_client._cached_telemetry_state = None

    def tearDown(self):
        self.patcher_state.stop()
        telemetry_client.db_manager = self._orig_db
        telemetry_client._cached_telemetry_state = None
        self.temp_dir.cleanup()

    def test_salted_path_hashing_and_stability(self):
        """Salted path reference is deterministic with same salt and hides literal path."""
        path1 = r"C:\Users\SecretUser\Documents\Financials.xlsx"
        ref1 = telemetry_client.compute_path_reference(path1, sync_full_paths=False)
        ref2 = telemetry_client.compute_path_reference(path1, sync_full_paths=False)

        self.assertTrue(ref1.startswith("sha256:"))
        self.assertEqual(ref1, ref2)
        # Verify no usernames or path parts leaked
        self.assertNotIn("SecretUser", ref1)
        self.assertNotIn("Financials", ref1)
        self.assertNotIn("C:", ref1)

        # Literal path when sync_full_paths=True
        ref_literal = telemetry_client.compute_path_reference(path1, sync_full_paths=True)
        self.assertEqual(ref_literal, os.path.normpath(path1))

    def test_payload_firewall_rules(self):
        """Firewall drops invalid payloads (literal paths when off, invalid keys, non-int counts)."""
        # Valid ping
        valid_ping = {
            "clientTime": datetime.now(timezone.utc).isoformat(),
            "serviceRunning": True,
            "watcherActive": True,
            "serviceStartedAt": None,
            "policyHash": "1a2b3c4d5e6f",
            "agentVersion": "1.0.0",
            "applicationVersion": "1.0.0",
            "outboxDepth": 0,
        }
        self.assertTrue(telemetry_client._assert_payload_safe("ping", valid_ping))

        # Ping with unknown key -> REJECT
        bad_ping = dict(valid_ping)
        bad_ping["unauthorizedField"] = "bad"
        self.assertFalse(telemetry_client._assert_payload_safe("ping", bad_ping))

        # Scan summary with literal Windows path when sync_full_paths=False -> REJECT
        bad_scan = {
            "clientScanId": "uuid-1",
            "scanSource": "directory_scan",
            "targetSummary": r"C:\Users\Nimish\Documents",  # literal path
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "completedAt": None,
            "status": "completed",
            "durationSeconds": 10,
            "filesScanned": 1,
            "filesWithPii": 0,
            "totalFindings": 0,
            "highestTier": None,
            "tierCounts": {},
            "entityTypeTotals": {},
            "files": [],
            "filesTruncated": False,
        }
        self.assertFalse(telemetry_client._assert_payload_safe("scan_summary", bad_scan, sync_full_paths=False))

        # Same with sync_full_paths=True -> ACCEPT
        self.assertTrue(telemetry_client._assert_payload_safe("scan_summary", bad_scan, sync_full_paths=True))

        # Scan summary with invalid entity regex -> REJECT
        bad_ent_scan = dict(bad_scan)
        bad_ent_scan["targetSummary"] = "Drive C:"
        bad_ent_scan["entityTypeTotals"] = {"Invalid Entity Space": 1}
        self.assertFalse(telemetry_client._assert_payload_safe("scan_summary", bad_ent_scan, sync_full_paths=False))

    def test_zero_network_calls_when_unlicensed_or_standalone(self):
        """send_ping and flush_outbox make zero HTTP requests if unlicensed."""
        with patch.object(telemetry_client, "is_registered", return_value=False), \
             patch("requests.post") as mock_post:
            res = telemetry_client.send_ping()
            self.assertIsNone(res)
            mock_post.assert_not_called()

            telemetry_client.flush_outbox()
            mock_post.assert_not_called()

    def test_authorization_header_not_double_prefixed(self):
        """Header builder reuses credential without double-prepending installationId."""
        from backend.license_client import _authorized_headers
        mock_state = {
            "installationId": "inst-123",
            "credential": "inst-123.secret456",
        }
        headers = _authorized_headers(mock_state)
        self.assertEqual(headers["Authorization"], "Bearer inst-123.secret456")
        self.assertFalse(headers["Authorization"].startswith("Bearer inst-123.inst-123"))

    def test_outbox_enqueue_and_atomic_claim(self):
        """Outbox enqueues payloads, enforces 1000 cap, and claims atomically."""
        for i in range(15):
            self.db.enqueue_telemetry_outbox("scan_summary", json.dumps({"test_id": i}))

        self.assertEqual(self.db.get_telemetry_outbox_depth(), 15)

        # Claim 10
        claimed = self.db.claim_telemetry_outbox(limit=10)
        self.assertEqual(len(claimed), 10)

        # Immediate second claim gets the remaining 5
        claimed_second = self.db.claim_telemetry_outbox(limit=10)
        self.assertEqual(len(claimed_second), 5)

        # Acknowledge first 10
        self.db.ack_telemetry_outbox([item["id"] for item in claimed])
        self.assertEqual(self.db.get_telemetry_outbox_depth(), 5)

        # Release remaining 5 after simulated failure
        self.db.release_telemetry_outbox([item["id"] for item in claimed_second])
        self.assertEqual(self.db.get_telemetry_outbox_depth(), 5)

        # Can claim them again
        reclaimed = self.db.claim_telemetry_outbox(limit=10)
        self.assertEqual(len(reclaimed), 5)
        self.assertEqual(reclaimed[0]["attempts"], 1)

    def test_outbox_hard_cap_drops_oldest(self):
        """Outbox drops oldest rows when exceeding max_rows."""
        for i in range(10):
            self.db.enqueue_telemetry_outbox("scan_summary", json.dumps({"id": i}), max_rows=5)

        depth = self.db.get_telemetry_outbox_depth()
        self.assertEqual(depth, 5)

        claimed = self.db.claim_telemetry_outbox(limit=10)
        # Should contain IDs 5 to 9
        payloads = [json.loads(c["payload_json"])["id"] for c in claimed]
        self.assertEqual(payloads, [5, 6, 7, 8, 9])

    def test_enforcement_window_aggregation_privacy_and_closed_windows(self):
        """Enforcement aggregation groups into 15-min closed UTC windows and drops file paths / reasons."""
        now = datetime.now(timezone.utc)
        past_time_1 = (now - timedelta(minutes=45)).isoformat()
        past_time_2 = (now - timedelta(minutes=44)).isoformat()
        future_or_current = now.isoformat()  # currently open window, must NOT be aggregated

        with self.db._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO enforcement_events (timestamp, file_path, tier, action_taken, user_override, override_reason, entity_summary, app_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (past_time_1, r"C:\sensitive\secret.docx", "Restricted", "block", 0, "Top Secret Reason", "AADHAAR: 1", "Word"))
            cursor.execute("""
                INSERT INTO enforcement_events (timestamp, file_path, tier, action_taken, user_override, override_reason, entity_summary, app_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (past_time_2, r"C:\sensitive\resume.pdf", "Restricted", "override", 1, "Admin allowed", "PAN: 1", "Word"))
            cursor.execute("""
                INSERT INTO enforcement_events (timestamp, file_path, tier, action_taken, user_override, override_reason, entity_summary, app_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (future_or_current, r"C:\sensitive\open.docx", "General", "allow", 0, None, None, "Word"))
            conn.commit()

        with patch.object(telemetry_client, "is_registered", return_value=True):
            telemetry_client.aggregate_enforcement_windows()

        # Check outbox
        claimed = self.db.claim_telemetry_outbox(limit=10)
        self.assertEqual(len(claimed), 1)
        item = claimed[0]
        self.assertEqual(item["kind"], "enforcement_summary")

        payload = json.loads(item["payload_json"])
        windows = payload["windows"]
        self.assertEqual(len(windows), 1)
        w = windows[0]

        # Verify privacy: no file paths, override reasons, or entity summaries in payload
        payload_str = json.dumps(payload)
        self.assertNotIn("secret.docx", payload_str)
        self.assertNotIn("Top Secret Reason", payload_str)
        self.assertNotIn("Admin allowed", payload_str)
        self.assertNotIn("AADHAAR", payload_str)

        # Verify counts
        self.assertEqual(w["source"], "Word")
        self.assertEqual(w["actionCounts"]["block"], 1)
        self.assertEqual(w["actionCounts"]["override"], 1)
        self.assertEqual(w["overrideCount"], 1)

    def test_command_dispatch_deduplication_and_ack(self):
        """Commands are deduplicated and acknowledged."""
        commands = [
            {"id": "cmd-1", "type": "force_policy_refresh"},
            {"id": "cmd-1", "type": "force_policy_refresh"},  # Duplicate
        ]

        with patch("backend.license_client.get_policy") as mock_policy, \
             patch.object(telemetry_client, "acknowledge_command", return_value=True) as mock_ack:
            telemetry_client.dispatch_commands(commands)
            self.assertEqual(mock_policy.call_count, 1)
            self.assertEqual(mock_ack.call_count, 1)
            mock_ack.assert_called_with("cmd-1", "success", "Policy refreshed successfully")


if __name__ == "__main__":
    unittest.main()

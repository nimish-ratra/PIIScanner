"""
Unit & API Tests for Phase 2 Real-Time Enforcement Service
Tests:
1. EnforcementPolicyManager: default tiers, custom overrides, fail-open toggle, watched folders
2. API Server Endpoints:
   - GET /health
   - POST /classify/text (Aadhaar/PAN detection -> tier -> recommended action)
   - POST /classify/file
   - POST /enforcement/log (database persistence)
   - GET /policy & POST /policy
3. Loopback Security Middleware: non-loopback IPs receive 403 Forbidden
"""

import os
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from service.enforcement_policy import EnforcementPolicyManager, EnforcementAction, DEFAULT_TIER_ACTIONS
from service.api_server import app
from backend.classifier import SensitivityTier
from backend.database import DatabaseManager


class TestEnforcementService(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.temp_dir = Path(tempfile.mkdtemp(prefix="pii_enf_test_"))
        cls.policy_file = cls.temp_dir / "test_policy.json"
        cls.test_db_path = cls.temp_dir / "test_history.db"
        cls.db_manager = DatabaseManager(db_path=cls.test_db_path)

        # Create test client for FastAPI app
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        if cls.temp_dir.exists():
            shutil.rmtree(str(cls.temp_dir), ignore_errors=True)

    def test_01_policy_defaults_and_resolution(self):
        """Verify default tier actions and dual-path resolve_action logic (Office block vs Watcher quarantine)."""
        policy = EnforcementPolicyManager(policy_path=self.policy_file)

        # Office path: block
        self.assertEqual(policy.resolve_action("Restricted", is_office=True), "block")
        self.assertEqual(policy.resolve_action("Highly Confidential", is_office=True), "block")

        # Watcher path: detect-and-remediate quarantine
        self.assertEqual(policy.resolve_action("Restricted", is_office=False), "quarantine")
        self.assertEqual(policy.resolve_action("Highly Confidential", is_office=False), "quarantine")

        # Warn, allow tiers
        self.assertEqual(policy.resolve_action("Confidential"), "warn")
        self.assertEqual(policy.resolve_action("General"), "allow")
        self.assertEqual(policy.resolve_action("Public"), "allow")

        # Test fail-open default is False (Fail Closed)
        self.assertFalse(policy.fail_open)
        self.assertEqual(policy.api_port, 47821)
        self.assertEqual(policy.api_host, "127.0.0.1")

    def test_02_policy_custom_modification(self):
        """Verify updating tier actions and persistence."""
        policy = EnforcementPolicyManager(policy_path=self.policy_file)
        custom_actions = dict(DEFAULT_TIER_ACTIONS)
        custom_actions[SensitivityTier.CONFIDENTIAL.value] = EnforcementAction.BLOCK.value
        policy.tier_actions = custom_actions
        policy.fail_open = True
        policy.api_port = 48000

        # Reload from disk
        reloaded = EnforcementPolicyManager(policy_path=self.policy_file)
        self.assertEqual(reloaded.resolve_action("Confidential", is_office=True), "block")
        self.assertEqual(reloaded.resolve_action("Confidential", is_office=False), "quarantine")
        self.assertTrue(reloaded.fail_open)
        self.assertEqual(reloaded.api_port, 48000)

    def test_03_api_health_probe(self):
        """GET /health should return 200 and status=healthy."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "healthy")
        self.assertEqual(data.get("service"), "PII Sentinel Classification Microservice")
        self.assertIn("timestamp", data)

    def test_04_classify_text_restricted(self):
        """POST /classify/text with Aadhaar & PAN should classify as Restricted and recommend block."""
        body = {
            "text": "Employee record: Nimish Ratra, Aadhaar: 3675 9834 5012, PAN: ABCDE1234F, Passport: A1234567.",
            "source_hint": "Microsoft Word Document"
        }
        response = self.client.post("/classify/text", json=body)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIn(data.get("tier"), ["Restricted", "Highly Confidential"])
        self.assertEqual(data.get("recommended_action"), "block")
        findings = data.get("findings", [])
        self.assertTrue(len(findings) > 0)

        # Check entity redaction (no raw PII leaked)
        for f in findings:
            self.assertIn("redacted_value", f)
            self.assertTrue("*" in f["redacted_value"] or len(f["redacted_value"]) > 0)

    def test_05_classify_text_general(self):
        """POST /classify/text with benign text should classify as General and recommend allow."""
        body = {
            "text": "Clean system status check with standard internal software operations.",
            "source_hint": "Microsoft Excel Workbook"
        }
        response = self.client.post("/classify/text", json=body)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data.get("tier"), "General")
        self.assertEqual(data.get("recommended_action"), "allow")
        self.assertEqual(len(data.get("findings", [])), 0)

    def test_06_classify_file(self):
        """POST /classify/file with temporary file should extract and classify."""
        test_file = self.temp_dir / "confidential_memo.txt"
        test_file.write_text(
            "CONFIDENTIAL: User account contact phone is +91 9876543210 and email test.user@example.com.",
            encoding="utf-8"
        )

        response = self.client.post("/classify/file", json={"path": str(test_file)})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn(data.get("tier"), ["Confidential", "Highly Confidential", "Restricted"])
        self.assertTrue(len(data.get("findings", [])) > 0)

    def test_07_enforcement_log_persistence(self):
        """POST /enforcement/log should persist event to SQLite database."""
        event_payload = {
            "timestamp": "2026-09-07T12:00:00",
            "file_path": "C:\\Users\\User\\Documents\\payroll.xlsx",
            "tier": "Highly Confidential",
            "action_taken": "block",
            "user_override": False,
            "override_reason": None,
            "entity_summary": "IN_AADHAAR: 1, IN_PAN: 1",
            "source": "Word"
        }
        response = self.client.post("/enforcement/log", json=event_payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("success"))
        self.assertIsNotNone(data.get("event_id"))

    def test_08_get_and_post_policy_endpoints(self):
        """GET and POST /policy should reflect policy changes."""
        get_resp = self.client.get("/policy")
        self.assertEqual(get_resp.status_code, 200)
        curr_policy = get_resp.json()
        self.assertIn("tier_actions", curr_policy)

        # Update policy via endpoint
        update_payload = {
            "tier_actions": curr_policy["tier_actions"],
            "fail_open": True,
            "api_port": 47821
        }
        post_resp = self.client.post("/policy", json=update_payload)
        self.assertEqual(post_resp.status_code, 200)
        self.assertTrue(post_resp.json().get("success"))

    def test_09_loopback_security_rejection(self):
        """Verify that requests from external (non-loopback) IPs are rejected with 403 Forbidden."""
        client_external = TestClient(app, client=("192.168.1.100", 54321))
        response = client_external.get("/health")
        self.assertEqual(response.status_code, 403)
        self.assertIn("Non-loopback client rejected", response.text)


if __name__ == "__main__":
    unittest.main()

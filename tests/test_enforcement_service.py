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

        from backend.config import config_manager
        from backend.custom_recognizers import get_all_supported_entities
        from backend.service_auth import get_or_create_service_token, TOKEN_HEADER
        cls._orig_rt_entities = config_manager.realtime_selected_entities
        config_manager.realtime_selected_entities = get_all_supported_entities()

        # Create test client for FastAPI app configured with genuine service authentication token
        cls.token = get_or_create_service_token()
        cls.client = TestClient(app, headers={TOKEN_HEADER: cls.token})

    @classmethod
    def tearDownClass(cls):
        from backend.config import config_manager
        if hasattr(cls, "_orig_rt_entities"):
            config_manager.realtime_selected_entities = cls._orig_rt_entities
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

    def test_10_enforcement_log_override_persistence(self):
        """Regression test for Feature 3: POST /enforcement/log with override records user_override=1 and rationale."""
        from backend.database import db_manager
        override_payload = {
            "file_path": r"C:\Users\Nimish\Documents\quarterly_override.docx",
            "tier": "Highly Confidential",
            "action_taken": "override",
            "user_override": True,
            "override_reason": "Executive business rationale approved by CISO",
            "entity_summary": "IN_AADHAAR: 1",
            "source": "Office Add-in (Word)",
            "app_source": "Word",
            "detection_types": "IN_AADHAAR"
        }
        resp = self.client.post("/enforcement/log", json=override_payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("success"))
        ev_id = data.get("event_id")
        self.assertIsNotNone(ev_id)

        # Query database and verify exact override fields
        events = db_manager.get_enforcement_events(limit=50, action="override")
        matched = [e for e in events if e.get("id") == ev_id]
        self.assertEqual(len(matched), 1)
        ev = matched[0]
        self.assertEqual(ev["user_override"], 1)
        self.assertEqual(ev["action_taken"], "override")
        self.assertEqual(ev["override_reason"], "Executive business rationale approved by CISO")
        self.assertEqual(ev["app_source"], "Word")
        self.assertEqual(ev["detection_types"], "IN_AADHAAR")

    def test_11_service_stop_endpoint(self):
        """Verify POST /service/stop returns 200 and triggers shutdown sequence."""
        resp = self.client.post("/service/stop")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("message"), "Service shutdown initiated")

    def test_12_service_controller_methods(self):
        """Verify ServiceController port check, health check, and idempotent stop."""
        from service.service_controller import ServiceController
        # Unused port 59999
        unused_port = 59999
        self.assertFalse(ServiceController.is_port_bound(unused_port))
        self.assertFalse(ServiceController.is_running(unused_port))
        # Idempotent stop on stopped port should return True
        self.assertTrue(ServiceController.stop(unused_port))

    def test_13_token_authentication_enforcement(self):
        """Verify Tier 1 (S1): Microservice rejects requests missing or having invalid shared-secret token."""
        from backend.service_auth import TOKEN_HEADER

        # 1. Loopback request with missing token header (e.g. malicious browser fetch) -> 403 Forbidden
        client_no_token = TestClient(app, client=("127.0.0.1", 52000))
        resp_no_token = client_no_token.post("/service/stop")
        self.assertEqual(resp_no_token.status_code, 403)
        self.assertIn("Non-loopback client rejected", resp_no_token.text)

        # 2. Loopback health probe with missing token -> 403 Forbidden
        resp_health_no_token = client_no_token.get("/health")
        self.assertEqual(resp_health_no_token.status_code, 403)

        # 3. Loopback request with invalid token -> 403 Forbidden
        client_bad_token = TestClient(
            app,
            client=("127.0.0.1", 52000),
            headers={TOKEN_HEADER: "forged_malicious_token_abc123"}
        )
        resp_bad = client_bad_token.get("/policy")
        self.assertEqual(resp_bad.status_code, 403)

        # 4. External IP with valid token -> 403 Forbidden (both defenses must hold)
        client_external_valid = TestClient(
            app,
            client=("192.168.1.150", 52000),
            headers={TOKEN_HEADER: self.token}
        )
        resp_ext = client_external_valid.get("/health")
        self.assertEqual(resp_ext.status_code, 403)

        # 5. Loopback request with valid token -> 200 OK
        client_valid = TestClient(
            app,
            client=("127.0.0.1", 52000),
            headers={TOKEN_HEADER: self.token}
        )
        resp_ok = client_valid.get("/health")
        self.assertEqual(resp_ok.status_code, 200)
        self.assertEqual(resp_ok.json().get("status"), "healthy")

    def test_14_quarantine_password_dpapi_and_redaction(self):
        """Verify Tier 2 (S2): Quarantine password is DPAPI-encrypted on disk and redacted on GET /policy."""
        policy = EnforcementPolicyManager(policy_path=self.policy_file)
        raw_secret = "SecurePassphrase987!#$"
        policy.quarantine_password = raw_secret

        # 1. Getter decrypts password correctly
        self.assertEqual(policy.quarantine_password, raw_secret)

        # 2. Raw JSON on disk must NOT contain plaintext password
        disk_content = self.policy_file.read_text(encoding="utf-8")
        self.assertNotIn(raw_secret, disk_content)
        self.assertIn("dpapi:", disk_content)

        # 3. GET /policy must redact password to '********'
        resp_get = self.client.get("/policy")
        self.assertEqual(resp_get.status_code, 200)
        policy_data = resp_get.json()
        self.assertNotIn(raw_secret, json.dumps(policy_data))
        if policy_data.get("quarantine_password"):
            self.assertEqual(policy_data["quarantine_password"], "********")

        # 4. POST /policy with new password encrypts on write and redacts in response
        new_secret = "AnotherSecretPassword456!@"
        resp_post = self.client.post("/policy", json={"quarantine_password": new_secret})
        self.assertEqual(resp_post.status_code, 200)
        post_data = resp_post.json()
        self.assertEqual(post_data["policy"]["quarantine_password"], "********")
        self.assertNotIn(new_secret, json.dumps(post_data))

    def test_15_policy_update_schema_validation_and_forbid_extras(self):
        """Verify Tier 2 (S3): POST /policy strictly validates schema and rejects unknown fields with 422."""
        # 1. Injection of unknown key -> 422 Unprocessable Entity
        bad_payload = {"malicious_extra_field": "injected_val"}
        resp_bad = self.client.post("/policy", json=bad_payload)
        self.assertEqual(resp_bad.status_code, 422)

        # 2. Valid fields succeed
        valid_payload = {
            "fail_safe_mode": "fail-open",
            "enforce_office": True,
            "toast_notifications": False
        }
        resp_valid = self.client.post("/policy", json=valid_payload)
        self.assertEqual(resp_valid.status_code, 200)
        self.assertTrue(resp_valid.json().get("success"))
        self.assertTrue(resp_valid.json()["policy"]["fail_open"])
        self.assertFalse(resp_valid.json()["policy"]["toast_notifications"])


if __name__ == "__main__":
    unittest.main()


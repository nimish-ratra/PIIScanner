"""
Unit tests for Scoped Real-Time PII Entity Selection (Feature 1).
Verifies:
1. config_manager.realtime_selected_entities defaults to 36 entities.
2. realtime_selected_entities is strictly independent from selected_entities.
3. Microservice /classify/text filters findings to realtime_selected_entities.
4. /policy and /policy/realtime-entities GET/POST endpoints work properly.
"""

import os
import unittest
import tempfile
import json
from pathlib import Path
from fastapi.testclient import TestClient

from backend.config import ConfigManager
from backend.custom_recognizers import get_all_supported_entities
from backend.service_auth import get_or_create_service_token, TOKEN_HEADER
from service.api_server import app
from service.enforcement_policy import policy_manager, EnforcementAction


class TestRealtimeEntities(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.config_path = Path(self.tmp_dir.name) / "config.json"
        self.cfg = ConfigManager(self.config_path)
        token = get_or_create_service_token()
        self.client = TestClient(app, headers={TOKEN_HEADER: token})

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_01_default_realtime_entities(self):
        """Verify realtime_selected_entities defaults to canonical 36 entities."""
        all_ents = get_all_supported_entities()
        self.assertEqual(len(all_ents), 36)
        self.assertEqual(len(self.cfg.realtime_selected_entities), 36)
        self.assertEqual(sorted(self.cfg.realtime_selected_entities), sorted(all_ents))

    def test_02_independent_scoping(self):
        """Verify realtime_selected_entities and selected_entities are independent."""
        # Modify batch entities
        self.cfg.selected_entities = ["EMAIL_ADDRESS", "PHONE_NUMBER"]
        self.cfg.save()

        # Reload from disk
        cfg2 = ConfigManager(self.config_path)
        self.assertEqual(cfg2.selected_entities, ["EMAIL_ADDRESS", "PHONE_NUMBER"])
        self.assertEqual(len(cfg2.realtime_selected_entities), 36)

        # Modify realtime entities
        cfg2.realtime_selected_entities = ["IN_AADHAAR", "IN_PAN"]
        cfg2.save()

        # Reload again
        cfg3 = ConfigManager(self.config_path)
        self.assertEqual(cfg3.selected_entities, ["EMAIL_ADDRESS", "PHONE_NUMBER"])
        self.assertEqual(cfg3.realtime_selected_entities, ["IN_AADHAAR", "IN_PAN"])

    def test_03_classify_text_scoped_filtering(self):
        """
        Verify /classify/text respects realtime_selected_entities.
        When only IN_AADHAAR is selected:
        - Text with EMAIL only -> 0 findings, allowed.
        - Text with Aadhaar -> 1 finding, blocked/quarantined per policy.
        """
        from backend.config import config_manager
        orig_rt = config_manager.realtime_selected_entities
        orig_batch = config_manager.selected_entities

        try:
            # Configure realtime to only IN_AADHAAR
            config_manager.realtime_selected_entities = ["IN_AADHAAR"]
            # Batch scan has EMAIL_ADDRESS
            config_manager.selected_entities = ["EMAIL_ADDRESS"]

            # Test text with only email
            res_email = self.client.post("/classify/text", json={
                "text": "Please contact test.user@example.com for assistance.",
                "source_hint": "Word Add-In"
            })
            self.assertEqual(res_email.status_code, 200)
            data_email = res_email.json()
            self.assertEqual(data_email["total_findings"], 0)
            self.assertEqual(data_email["recommended_action"], EnforcementAction.ALLOW.value)

            # Test text with Aadhaar (valid Verhoeff)
            res_aadhaar = self.client.post("/classify/text", json={
                "text": "Resident Aadhaar: 3675 9832 4152",
                "source_hint": "Word Add-In"
            })
            self.assertEqual(res_aadhaar.status_code, 200)
            data_aadhaar = res_aadhaar.json()
            self.assertGreater(data_aadhaar["total_findings"], 0)
            self.assertEqual(data_aadhaar["findings"][0]["entity_type"], "IN_AADHAAR")
            self.assertEqual(data_aadhaar["recommended_action"], EnforcementAction.BLOCK.value)
        finally:
            config_manager.realtime_selected_entities = orig_rt
            config_manager.selected_entities = orig_batch

    def test_04_policy_realtime_endpoints(self):
        """Verify GET/POST /policy/realtime-entities and /policy endpoints."""
        from backend.config import config_manager
        orig_rt = config_manager.realtime_selected_entities
        try:
            # Direct endpoint
            res = self.client.get("/policy/realtime-entities")
            self.assertEqual(res.status_code, 200)
            self.assertIn("realtime_selected_entities", res.json())

            # Update via /policy/realtime-entities
            res_post = self.client.post("/policy/realtime-entities", json={
                "realtime_selected_entities": ["IN_PAN", "CREDIT_CARD"]
            })
            self.assertEqual(res_post.status_code, 200)
            self.assertEqual(res_post.json()["realtime_selected_entities"], ["IN_PAN", "CREDIT_CARD"])
            self.assertEqual(config_manager.realtime_selected_entities, ["IN_PAN", "CREDIT_CARD"])

            # Verify GET /policy returns it
            res_policy = self.client.get("/policy")
            self.assertEqual(res_policy.status_code, 200)
            self.assertEqual(res_policy.json()["realtime_selected_entities"], ["IN_PAN", "CREDIT_CARD"])

            # Update via POST /policy
            res_policy_post = self.client.post("/policy", json={
                "realtime_selected_entities": ["IN_AADHAAR", "US_SSN"]
            })
            self.assertEqual(res_policy_post.status_code, 200)
            self.assertEqual(config_manager.realtime_selected_entities, ["IN_AADHAAR", "US_SSN"])
        finally:
            config_manager.realtime_selected_entities = orig_rt


if __name__ == "__main__":
    unittest.main()

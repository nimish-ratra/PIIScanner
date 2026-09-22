"""
License Client Test Suite for PII Sentinel
Tests the TrustFabric licensing client (backend/license_client.py): backend-URL
transport-security validation, DPAPI-encrypted local state persistence, the
offline grace-period enforcement decision, device fingerprinting, and the
register/heartbeat/policy/release network calls (mocked — no real backend or
network access is used).

Run from the agent/ directory (matching this repo's other test modules), e.g.:
    cd agent
    python -m pytest tests/test_license_client.py -v
"""

import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import backend.license_client as license_client
from backend.license_client import LicenseConfigError, LicenseError, _authorized_headers, _validate_backend_url


class TestLicenseClient(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="pii_sentinel_license_test_"))

    @classmethod
    def tearDownClass(cls):
        if cls.test_dir.exists():
            try:
                shutil.rmtree(str(cls.test_dir))
            except Exception:
                pass

    def setUp(self):
        # Isolate license.json under a per-test temp app dir (never the real
        # %APPDATA%\PIISentinel), and reset the module-level in-memory cache
        # so tests never leak state into each other.
        self._app_dir_patch = patch("backend.license_client.get_app_dir", return_value=self.test_dir)
        self._app_dir_patch.start()
        license_client._cached_state = None

    def tearDown(self):
        self._app_dir_patch.stop()
        license_client._cached_state = None
        license_path = self.test_dir / license_client.LICENSE_FILE_NAME
        if license_path.exists():
            license_path.unlink()

    # ─── Backend URL transport-security validation (fix #1) ────────────────

    def test_01_https_url_accepted(self):
        url = "https://licensing.example.com/api/v1"
        self.assertEqual(_validate_backend_url(url), url)
        print("[OK] HTTPS URL accepted test passed.")

    def test_02_https_trailing_slash_stripped(self):
        self.assertEqual(
            _validate_backend_url("https://licensing.example.com/api/v1/"),
            "https://licensing.example.com/api/v1",
        )
        print("[OK] Trailing slash stripped test passed.")

    def test_03_http_localhost_carveout_accepted(self):
        self.assertEqual(
            _validate_backend_url("http://localhost:3001/api/v1"),
            "http://localhost:3001/api/v1",
        )
        self.assertEqual(
            _validate_backend_url("http://127.0.0.1:3001/api/v1"),
            "http://127.0.0.1:3001/api/v1",
        )
        print("[OK] HTTP localhost carve-out test passed.")

    def test_03b_http_private_lan_ip_carveout_accepted(self):
        self.assertEqual(
            _validate_backend_url("http://10.197.56.244:3001/api/v1"),
            "http://10.197.56.244:3001/api/v1",
        )
        self.assertEqual(
            _validate_backend_url("http://192.168.1.50:3001/api/v1"),
            "http://192.168.1.50:3001/api/v1",
        )
        print("[OK] HTTP private LAN IP carve-out test passed.")

    def test_04_http_non_localhost_rejected(self):
        with self.assertRaises(LicenseConfigError):
            _validate_backend_url("http://licensing.example.com/api/v1")
        with self.assertRaises(LicenseConfigError):
            _validate_backend_url("http://8.8.8.8:3001/api/v1")
        print("[OK] HTTP non-localhost rejected test passed.")

    def test_05_non_http_scheme_rejected(self):
        with self.assertRaises(LicenseConfigError):
            _validate_backend_url("ftp://licensing.example.com/api/v1")
        print("[OK] Non-HTTP(S) scheme rejected test passed.")

    def test_06_get_backend_url_env_var_takes_priority(self):
        with patch.dict(os.environ, {"PIISENTINEL_LICENSE_BACKEND_URL": "https://env.example.com/api/v1"}):
            self.assertEqual(license_client.get_backend_url(), "https://env.example.com/api/v1")
        print("[OK] Env var priority test passed.")

    def test_07_get_backend_url_rejects_bad_env_var_rather_than_falling_back(self):
        # A misconfigured explicit URL must fail loudly, never silently fall
        # through to the dev default — that would defeat the whole point.
        with patch.dict(os.environ, {"PIISENTINEL_LICENSE_BACKEND_URL": "http://not-localhost.example.com"}):
            with self.assertRaises(LicenseConfigError):
                license_client.get_backend_url()
        print("[OK] Bad env var fails loudly (no silent fallback) test passed.")

    def test_08_get_backend_url_falls_back_to_dev_default(self):
        with patch.dict(os.environ):
            os.environ.pop("PIISENTINEL_LICENSE_BACKEND_URL", None)
            with patch("backend.config.config_manager.get", return_value=""):
                self.assertEqual(license_client.get_backend_url(), license_client.DEFAULT_BACKEND_URL)
        print("[OK] Dev default fallback test passed.")

    # ─── DPAPI-encrypted local state persistence (fix #2) ───────────────────

    def test_10_save_and_load_state_roundtrip(self):
        state = {
            "installationId": "install-123",
            "credential": "super-secret-credential",
            "companyId": "comp-acme-in",
            "heartbeatIntervalSeconds": 86400,
            "gracePeriodDays": 14,
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        }
        license_client._save_state(state)
        license_client._cached_state = None  # force a genuine re-read + DPAPI decrypt from disk
        loaded = license_client._load_state()
        self.assertEqual(loaded, state)
        print("[OK] DPAPI save/load round-trip test passed.")

    def test_11_state_file_is_not_plaintext_on_disk(self):
        state = {"installationId": "install-456", "credential": "another-secret-value"}
        license_client._save_state(state)
        raw_bytes = license_client.get_license_file_path().read_bytes()
        self.assertNotIn(b"another-secret-value", raw_bytes)
        print("[OK] Encrypted-at-rest (no plaintext secret in file) test passed.")

    def test_12_legacy_plaintext_file_still_readable(self):
        # Graceful decay for a file written before DPAPI encryption was added
        # during local testing — not a real migration path.
        legacy_state = {"installationId": "legacy-install", "credential": "legacy-secret"}
        license_client.get_license_file_path().write_text(json.dumps(legacy_state), encoding="utf-8")
        license_client._cached_state = None
        loaded = license_client._load_state()
        self.assertEqual(loaded, legacy_state)
        print("[OK] Legacy plaintext fallback test passed.")

    def test_13_corrupted_file_treated_as_unlicensed(self):
        license_client.get_license_file_path().write_bytes(b"not valid dpapi ciphertext or json")
        license_client._cached_state = None
        loaded = license_client._load_state()
        self.assertEqual(loaded, {})
        print("[OK] Corrupted state file graceful-degradation test passed.")

    def test_14_is_registered_reflects_saved_state(self):
        license_client._save_state({})
        license_client._cached_state = None
        self.assertFalse(license_client.is_registered())

        license_client._save_state({"installationId": "x", "credential": "y"})
        license_client._cached_state = None
        self.assertTrue(license_client.is_registered())
        print("[OK] is_registered() test passed.")

    # ─── Offline grace-period enforcement decision ──────────────────────────

    def test_20_enforcement_status_not_activated(self):
        license_client._save_state({})
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "Not activated")
        print("[OK] Not-activated enforcement test passed.")

    def test_21_enforcement_status_revoked_wins_immediately(self):
        state = {
            "installationId": "x", "credential": "y",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "REVOKED", "suspended": False, "revoked": True},
        }
        license_client._save_state(state)
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "License revoked")
        print("[OK] Revoked-wins-immediately enforcement test passed.")

    def test_22_enforcement_status_suspended_wins_immediately(self):
        state = {
            "installationId": "x", "credential": "y",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "SUSPENDED", "suspended": True, "revoked": False},
        }
        license_client._save_state(state)
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "License suspended")
        print("[OK] Suspended-wins-immediately enforcement test passed.")

    def test_23_enforcement_status_within_grace_period(self):
        state = {
            "installationId": "x", "credential": "y",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        }
        license_client._save_state(state)
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertTrue(allowed)
        self.assertEqual(reason, "OK")
        print("[OK] Within-grace-period enforcement test passed.")

    def test_24_enforcement_status_grace_period_expired(self):
        stale_checkin = datetime.now(timezone.utc) - timedelta(days=20)  # > 1 day interval + 14 day grace
        state = {
            "installationId": "x", "credential": "y",
            "lastCheckinAt": stale_checkin.isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        }
        license_client._save_state(state)
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertIn("Grace period expired", reason)
        print("[OK] Grace-period-expired enforcement test passed.")

    def test_25_enforcement_status_never_checked_in(self):
        state = {"installationId": "x", "credential": "y", "lastPolicy": {}}
        license_client._save_state(state)
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "Never checked in")
        print("[OK] Never-checked-in enforcement test passed.")

    def test_26_enforcement_status_pending_is_not_allowed(self):
        # A plain-token self-service registration awaiting Company Admin
        # approval — not suspended, not revoked, but also not yet granted.
        state = {
            "installationId": "x", "credential": "y",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "PENDING", "suspended": False, "revoked": False},
        }
        license_client._save_state(state)
        license_client._cached_state = None
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "Awaiting admin approval")
        print("[OK] Pending-not-allowed enforcement test passed.")

    # ─── Device fingerprint ──────────────────────────────────────────────────

    def test_30_device_fingerprint_is_stable_hashed_and_opaque(self):
        fp1 = license_client.compute_device_fingerprint()
        fp2 = license_client.compute_device_fingerprint()
        self.assertEqual(fp1, fp2)
        self.assertEqual(len(fp1), 32)
        # Must be a hex digest, never the raw WMI UUID format (which contains hyphens).
        self.assertNotIn("-", fp1)
        print("[OK] Device fingerprint stability/opacity test passed.")

    # ─── Authorization header construction ──────────────────────────────────
    # Regression test for a real bug caught by manual end-to-end testing: state
    #['credential'] is already the full "<installationId>.<secret>" string per
    # docs/agent-protocol.md, so _authorized_headers must NOT prepend
    # installationId again — doing so silently produced a malformed bearer
    # token that the server rejected as if the credential had been revoked,
    # even though registration itself succeeded. Mocked network tests alone
    # never caught this because they never inspected the actual header value.

    def test_35_authorized_headers_do_not_double_prefix_installation_id(self):
        state = {
            "installationId": "install-999",
            "credential": "install-999.the-actual-secret-value",
        }
        headers = _authorized_headers(state)
        self.assertEqual(headers["Authorization"], "Bearer install-999.the-actual-secret-value")
        print("[OK] Authorization header format (no double-prefix) test passed.")

    # ─── Network calls (mocked — no real backend or network access) ────────

    @patch("backend.license_client.requests.post")
    def test_40_register_success_persists_state(self, mock_post):
        mock_post.return_value = MagicMock(
            status_code=201,
            json=lambda: {
                "installationId": "install-789",
                "credential": "cred-abc",
                "companyId": "comp-acme-in",
                "status": "ACTIVE",
                "heartbeatIntervalSeconds": 86400,
                "gracePeriodDays": 14,
            },
        )
        state = license_client.register("some-enrollment-token")
        self.assertEqual(state["installationId"], "install-789")
        self.assertTrue(license_client.is_registered())
        print("[OK] register() success test passed.")

    @patch("backend.license_client.requests.post")
    def test_40c_register_pending_response_is_not_yet_enforcement_allowed(self, mock_post):
        # A plain-token registration lands PENDING until a Company Admin
        # approves it — register() itself must not treat that as a green light.
        mock_post.return_value = MagicMock(
            status_code=201,
            json=lambda: {
                "installationId": "install-pending",
                "credential": "cred-pending",
                "companyId": "comp-acme-in",
                "status": "PENDING",
                "heartbeatIntervalSeconds": 86400,
                "gracePeriodDays": 14,
            },
        )
        state = license_client.register("tok", employee_name="Jane Doe", employee_email="jane@acme.com")
        self.assertEqual(state["lastPolicy"]["status"], "PENDING")
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "Awaiting admin approval")
        print("[OK] register() PENDING response test passed.")

    @patch("backend.license_client.requests.post")
    def test_40b_register_includes_employee_identity_only_when_given(self, mock_post):
        mock_post.return_value = MagicMock(
            status_code=201,
            json=lambda: {"installationId": "install-x", "credential": "cred-x"},
        )
        license_client.register("tok", employee_name="Jane Doe", employee_email="jane@acme.com")
        sent_payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(sent_payload["employeeName"], "Jane Doe")
        self.assertEqual(sent_payload["employeeEmail"], "jane@acme.com")

        license_client.register("tok2")
        sent_payload_2 = mock_post.call_args.kwargs["json"]
        self.assertNotIn("employeeName", sent_payload_2)
        self.assertNotIn("employeeEmail", sent_payload_2)
        print("[OK] register() employee-identity payload test passed.")

    @patch("backend.license_client.requests.post")
    def test_41_register_rejected_token_raises_license_error(self, mock_post):
        mock_post.return_value = MagicMock(status_code=401, json=lambda: {"message": "Invalid enrollment token"})
        with self.assertRaises(LicenseError):
            license_client.register("bad-token")
        self.assertFalse(license_client.is_registered())
        print("[OK] register() rejection test passed.")

    @patch("backend.license_client.requests.post")
    def test_42_heartbeat_revoked_credential_updates_cached_policy(self, mock_post):
        license_client._save_state({
            "installationId": "install-1", "credential": "cred-1",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        })
        license_client._cached_state = None
        mock_post.return_value = MagicMock(status_code=403, json=lambda: {"message": "revoked"})
        with self.assertRaises(LicenseError):
            license_client.heartbeat()
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "License revoked")
        print("[OK] heartbeat() revoked-credential test passed.")

    @patch("backend.license_client.requests.post")
    def test_43_heartbeat_success_refreshes_checkin_and_policy(self, mock_post):
        # credential deliberately realistic ("<installationId>.<secret>", not
        # a bare secret) so a reintroduced double-prefix bug would be caught here.
        license_client._save_state({
            "installationId": "install-2", "credential": "install-2.the-real-secret",
            "lastCheckinAt": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        })
        license_client._cached_state = None
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                "status": "ACTIVE", "suspended": False, "revoked": False,
                "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            },
        )
        state = license_client.heartbeat()
        self.assertEqual(state["lastPolicy"]["status"], "ACTIVE")
        allowed, reason = license_client.enforcement_status()
        self.assertTrue(allowed)

        sent_headers = mock_post.call_args.kwargs["headers"]
        self.assertEqual(sent_headers["Authorization"], "Bearer install-2.the-real-secret")
        print("[OK] heartbeat() success test passed.")

    @patch("backend.license_client.requests.post", side_effect=Exception("network down"))
    def test_44_release_clears_local_state_even_if_network_fails(self, mock_post):
        license_client._save_state({"installationId": "install-3", "credential": "cred-3"})
        license_client._cached_state = None
        license_client.release()
        self.assertFalse(license_client.is_registered())
        print("[OK] release() best-effort local-clear test passed.")

    def test_45_update_policy_status_immediate_enforcement(self):
        license_client._save_state({
            "installationId": "install-45", "credential": "cred-45",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        })
        license_client._cached_state = None

        allowed, _ = license_client.enforcement_status()
        self.assertTrue(allowed)

        # Update to SUSPENDED
        license_client.update_policy_status("SUSPENDED")
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "License suspended")

        # Update to REVOKED
        license_client.update_policy_status("REVOKED")
        allowed, reason = license_client.enforcement_status()
        self.assertFalse(allowed)
        self.assertEqual(reason, "License revoked")

        # Update back to ACTIVE
        license_client.update_policy_status("ACTIVE")
        allowed, reason = license_client.enforcement_status()
        self.assertTrue(allowed)
        self.assertEqual(reason, "OK")
        print("[OK] update_policy_status immediate enforcement test passed.")

    @patch("backend.license_client.requests.get")
    def test_46_refresh_policy_catches_server_revocation_and_suspension(self, mock_get):
        license_client._save_state({
            "installationId": "install-46", "credential": "cred-46",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        })
        license_client._cached_state = None

        # 1. Server returns 401 Unauthorized (revoked)
        mock_get.return_value = MagicMock(status_code=401, ok=False)
        allowed, reason = license_client.refresh_policy(timeout_seconds=1.0)
        self.assertFalse(allowed)
        self.assertEqual(reason, "License revoked")

        # 2. Server returns 200 with suspended: true
        mock_get.return_value = MagicMock(
            status_code=200, ok=True,
            json=lambda: {"status": "SUSPENDED", "suspended": True, "revoked": False}
        )
        allowed, reason = license_client.refresh_policy(timeout_seconds=1.0)
        self.assertFalse(allowed)
        self.assertEqual(reason, "License suspended")
        print("[OK] refresh_policy catches revocation and suspension test passed.")

    @patch("backend.license_client.requests.get", side_effect=Exception("network timeout"))
    def test_47_refresh_policy_graceful_fallback_on_network_error(self, mock_get):
        license_client._save_state({
            "installationId": "install-47", "credential": "cred-47",
            "lastCheckinAt": datetime.now(timezone.utc).isoformat(),
            "heartbeatIntervalSeconds": 86400, "gracePeriodDays": 14,
            "lastPolicy": {"status": "ACTIVE", "suspended": False, "revoked": False},
        })
        license_client._cached_state = None

        allowed, reason = license_client.refresh_policy(timeout_seconds=1.0)
        self.assertTrue(allowed)
        self.assertEqual(reason, "OK")
        print("[OK] refresh_policy graceful offline fallback test passed.")


if __name__ == "__main__":
    unittest.main()

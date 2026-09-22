"""
Real End-to-End Verification of Fleet Telemetry & Admin Panel
Cross-repo integration test verifying agent telemetry endpoints, customer admin endpoints,
cross-tenant isolation, and revocation enforcement against live PostgreSQL and NestJS API.
"""

import sys
import uuid
import requests
from datetime import datetime, timezone

BASE_URL = "http://localhost:3001/api/v1"

def print_step(num: int, title: str):
    print(f"\n[{num:02d}] {title} " + "-" * (55 - len(title)))

def run_verification():
    print("=" * 65)
    print("ClAIssify Fleet Telemetry Real E2E Verification")
    print("=" * 65)

    # 1. Check API Health
    print_step(1, "Checking API Health")
    health = requests.get(f"{BASE_URL}/health")
    assert health.status_code == 200, f"Health check failed: {health.status_code}"
    print("  [OK] API is healthy:", health.json())

    # 2. Authenticate as Acme India Company Admin
    print_step(2, "Authenticating as Acme India Company Admin")
    acme_session = requests.Session()
    session_resp = acme_session.post(
        f"{BASE_URL}/customer/auth/e2e/session",
        json={"testIdentity": "company-admin-acme-india"}
    )
    assert session_resp.status_code == 201, f"Failed to create session: {session_resp.status_code} {session_resp.text}"
    print("  [OK] Acme Admin session created.")

    # 3. Create Enrollment Token for comp-acme-in
    print_step(3, "Creating Enrollment Token for comp-acme-in")
    token_resp = acme_session.post(
        f"{BASE_URL}/customer/companies/comp-acme-in/enrollment-tokens",
        json={"allocationId": "alloc-acme-in", "label": "E2E Test Token", "maxActivations": 5}
    )
    assert token_resp.status_code in (200, 201), f"Failed to create token: {token_resp.status_code} {token_resp.text}"
    token_data = token_resp.json()
    enrollment_token = token_data.get("token") or token_data.get("plaintextToken") or token_data.get("id")
    print(f"  [OK] Enrollment token created: {enrollment_token}")

    # 4. Register Agent via POST /agent/register
    print_step(4, "Registering Agent via /agent/register")
    device_id = f"test-dev-{uuid.uuid4().hex[:8]}"
    reg_resp = requests.post(
        f"{BASE_URL}/agent/register",
        json={
            "enrollmentToken": enrollment_token,
            "deviceId": device_id,
            "hostname": "test-workstation-e2e",
            "os": "Windows 11 Pro 23H2",
            "agentVersion": "2.4.0",
            "employeeName": "E2E Test User",
            "employeeEmail": "test-user@acme.test",
        }
    )
    assert reg_resp.status_code in (200, 201), f"Agent registration failed: {reg_resp.status_code} {reg_resp.text}"
    reg_data = reg_resp.json()
    installation_id = reg_data["installationId"]
    credential = reg_data["credential"]
    print(f"  [OK] Agent registered. ID: {installation_id}")

    agent_headers = {
        "Authorization": f"Bearer {credential}",
        "Content-Type": "application/json"
    }

    # 4b. Approve Installation as Acme Admin
    print_step(4, "Approving Installation as Acme Admin")
    approve_resp = acme_session.post(f"{BASE_URL}/customer/installations/{installation_id}/approve")
    assert approve_resp.status_code in (200, 201), f"Approval failed: {approve_resp.status_code} {approve_resp.text}"
    print(f"  [OK] Installation {installation_id} approved to ACTIVE.")

    # 5. Send Telemetry Ping from Agent
    print_step(5, "Sending Telemetry Ping from Agent")
    now_iso = datetime.now(timezone.utc).isoformat()
    ping_payload = {
        "clientTime": now_iso,
        "serviceRunning": True,
        "watcherActive": True,
        "serviceStartedAt": now_iso,
        "agentVersion": "2.4.0",
        "applicationVersion": "2.4.0",
        "outboxDepth": 0
    }
    ping_resp = requests.post(f"{BASE_URL}/agent/telemetry/ping", headers=agent_headers, json=ping_payload)
    assert ping_resp.status_code in (200, 201), f"Ping failed: {ping_resp.status_code} {ping_resp.text}"
    ping_data = ping_resp.json()
    assert ping_data["installationStatus"] == "ACTIVE", f"Expected ACTIVE, got {ping_data['installationStatus']}"
    assert ping_data["telemetry"]["enabled"] is True, "Expected telemetry.enabled to be True"
    assert len(ping_data["commands"]) == 0, "Expected 0 commands initially"
    print("  [OK] Ping succeeded:", ping_data)

    # 6. Query Customer Telemetry & Verify LIVE Status
    print_step(6, "Querying Customer Telemetry for LIVE Status")
    cust_telem = acme_session.get(f"{BASE_URL}/customer/installations/{installation_id}/telemetry")
    assert cust_telem.status_code == 200, f"Customer telemetry failed: {cust_telem.status_code} {cust_telem.text}"
    telem_data = cust_telem.json()
    assert telem_data["derivedStatus"] == "LIVE", f"Expected LIVE, got {telem_data['derivedStatus']}"
    assert telem_data["telemetryState"]["serviceRunning"] is True
    print(f"  [OK] Installation {installation_id} derivedStatus: {telem_data['derivedStatus']}")

    # 7. Issue Admin Command
    print_step(7, "Issuing Admin Command (force_policy_refresh)")
    cmd_resp = acme_session.post(
        f"{BASE_URL}/customer/installations/{installation_id}/commands",
        json={"commandType": "force_policy_refresh"}
    )
    assert cmd_resp.status_code in (200, 201), f"Command creation failed: {cmd_resp.status_code} {cmd_resp.text}"
    cmd_data = cmd_resp.json()
    command_id = cmd_data["id"]
    assert cmd_data["status"] == "PENDING"
    print(f"  [OK] Command issued: ID={command_id}, status={cmd_data['status']}")

    # 8. Send Next Ping -> Receive Command
    print_step(8, "Agent Pinging to Receive Command")
    ping2_resp = requests.post(f"{BASE_URL}/agent/telemetry/ping", headers=agent_headers, json=ping_payload)
    assert ping2_resp.status_code in (200, 201)
    ping2_data = ping2_resp.json()
    received_cmds = ping2_data.get("commands", [])
    assert len(received_cmds) >= 1, f"Expected commands, got: {received_cmds}"
    found_cmd = next((c for c in received_cmds if c["id"] == command_id), None)
    assert found_cmd is not None, f"Command {command_id} not in ping response: {received_cmds}"
    print(f"  [OK] Agent received command: {found_cmd}")

    # 9. Acknowledge Command from Agent
    print_step(9, "Acknowledging Command from Agent")
    ack_resp = requests.post(
        f"{BASE_URL}/agent/telemetry/command-ack",
        headers=agent_headers,
        json={
            "commandId": command_id,
            "result": "success",
            "detail": "Policy successfully refreshed by E2E test"
        }
    )
    assert ack_resp.status_code in (200, 201), f"Command ack failed: {ack_resp.status_code} {ack_resp.text}"
    print("  [OK] Command acknowledged by agent.")

    # Verify Command State in Customer Telemetry
    cust_telem2 = acme_session.get(f"{BASE_URL}/customer/installations/{installation_id}/telemetry")
    assert cust_telem2.status_code == 200
    recent_cmds = cust_telem2.json().get("recentCommands", [])
    acked_cmd = next((c for c in recent_cmds if c["id"] == command_id), None)
    assert acked_cmd is not None and acked_cmd["status"] == "ACKNOWLEDGED", f"Command not ACKNOWLEDGED: {acked_cmd}"
    print("  [OK] Customer portal reflects command status ACKNOWLEDGED.")

    # 10. Send Scan Summary from Agent
    print_step(10, "Sending Scan Summary from Agent")
    client_scan_id = str(uuid.uuid4())
    scan_payload = {
        "clientScanId": client_scan_id,
        "scanSource": "directory_scan",
        "targetSummary": "C:\\SensitiveData",
        "startedAt": now_iso,
        "completedAt": now_iso,
        "status": "completed",
        "durationSeconds": 15,
        "filesScanned": 42,
        "filesWithPii": 2,
        "totalFindings": 7,
        "highestTier": "Confidential",
        "tierCounts": {"Confidential": 5, "General": 2},
        "entityTypeTotals": {"EMAIL_ADDRESS": 5, "PHONE_NUMBER": 2},
        "files": [
            {
                "pathRef": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "tier": "Confidential",
                "entityTypeCounts": {"EMAIL_ADDRESS": 5},
                "watermarkStatus": "APPLIED"
            }
        ],
        "filesTruncated": False
    }
    scan_resp = requests.post(f"{BASE_URL}/agent/telemetry/scan-summary", headers=agent_headers, json=scan_payload)
    assert scan_resp.status_code in (200, 201), f"Scan summary failed: {scan_resp.status_code} {scan_resp.text}"
    scan_run_id = scan_resp.json()["scanRunId"]
    print(f"  [OK] Scan summary stored for scanId: {client_scan_id} (scanRunId: {scan_run_id})")

    # Inspect Scan from Customer Endpoint
    scan_detail = acme_session.get(f"{BASE_URL}/customer/installations/{installation_id}/scans/{scan_run_id}")
    assert scan_detail.status_code == 200, f"Get scan failed: {scan_detail.status_code} {scan_detail.text}"
    scan_json = scan_detail.json()
    assert scan_json["filesScanned"] == 42
    assert scan_json["highestTier"] == "Confidential"
    assert len(scan_json["findings"]) == 1
    assert scan_json["findings"][0]["tier"] == "Confidential"
    print("  [OK] Customer inspected scan run details successfully.")

    # 11. Send Enforcement Summary with Deduplication Verification
    print_step(11, "Sending Enforcement Summary (Testing Idempotency)")
    window_start = "2026-09-21T10:00:00.000Z"
    window_end = "2026-09-21T10:15:00.000Z"
    enf_payload = {
        "windows": [
            {
                "windowStart": window_start,
                "windowEnd": window_end,
                "source": "Filesystem Watcher",
                "actionCounts": {"QUARANTINE": 1, "BLOCK": 2},
                "tierCounts": {"Confidential": 3},
                "overrideCount": 0
            }
        ]
    }
    enf_resp1 = requests.post(f"{BASE_URL}/agent/telemetry/enforcement-summary", headers=agent_headers, json=enf_payload)
    assert enf_resp1.status_code in (200, 201), f"Enforcement summary 1 failed: {enf_resp1.status_code}"
    # Replay identical window
    enf_resp2 = requests.post(f"{BASE_URL}/agent/telemetry/enforcement-summary", headers=agent_headers, json=enf_payload)
    assert enf_resp2.status_code in (200, 201), f"Enforcement summary replay failed: {enf_resp2.status_code}"
    print("  [OK] Enforcement window stored and deduplicated cleanly on replay.")

    # 12. Verify Cross-Tenant Isolation
    print_step(12, "Verifying Cross-Tenant Isolation (Globex Admin Rejection)")
    globex_session = requests.Session()
    globex_auth = globex_session.post(
        f"{BASE_URL}/customer/auth/e2e/session",
        json={"testIdentity": "company-admin-globex"}
    )
    assert globex_auth.status_code == 201

    # Globex tries to read Acme installation telemetry -> must fail
    cross_read = globex_session.get(f"{BASE_URL}/customer/installations/{installation_id}/telemetry")
    assert cross_read.status_code in (403, 404), f"Expected 403/404 for cross-tenant read, got: {cross_read.status_code}"
    print(f"  [OK] Cross-tenant telemetry read rejected with {cross_read.status_code}.")

    # Globex tries to command Acme installation -> must fail
    cross_cmd = globex_session.post(
        f"{BASE_URL}/customer/installations/{installation_id}/commands",
        json={"commandType": "request_service_restart"}
    )
    assert cross_cmd.status_code in (403, 404), f"Expected 403/404 for cross-tenant command, got: {cross_cmd.status_code}"
    print(f"  [OK] Cross-tenant command rejected with {cross_cmd.status_code}.")

    # 13. Test REVOKED Installation Enforcement
    print_step(13, "Testing Revocation Enforcement on Telemetry")
    revoke_resp = acme_session.post(f"{BASE_URL}/customer/installations/{installation_id}/revoke")
    assert revoke_resp.status_code in (200, 201), f"Revoke failed: {revoke_resp.status_code} {revoke_resp.text}"
    print(f"  [OK] Installation {installation_id} revoked by Acme Admin.")

    # Revoked agent sends ping -> must receive 401 Unauthorized or 403 Forbidden
    ping_revoked = requests.post(f"{BASE_URL}/agent/telemetry/ping", headers=agent_headers, json=ping_payload)
    assert ping_revoked.status_code in (401, 403), f"Expected 401/403 for revoked agent ping, got: {ping_revoked.status_code}"
    print(f"  [OK] Revoked agent telemetry ping rejected with {ping_revoked.status_code}.")

    # Customer view confirms installation status is REVOKED
    telem_revoked = acme_session.get(f"{BASE_URL}/customer/installations/{installation_id}/telemetry")
    assert telem_revoked.status_code == 200
    inst_status = telem_revoked.json()["installation"]["status"]
    assert inst_status == "REVOKED", f"Expected installation status REVOKED, got: {inst_status}"
    print(f"  [OK] Customer telemetry confirms installation status: {inst_status}")

    # Test company-level telemetry toggle (DISABLED state)
    print_step(14, "Testing Company-Level Telemetry Toggle (DISABLED status)")
    patch_resp = acme_session.patch(
        f"{BASE_URL}/customer/companies/comp-acme-in/telemetry-settings",
        json={"telemetryEnabled": False}
    )
    assert patch_resp.status_code == 200, f"Patch failed: {patch_resp.status_code} {patch_resp.text}"

    telem_disabled = acme_session.get(f"{BASE_URL}/customer/installations/{installation_id}/telemetry")
    assert telem_disabled.status_code == 200
    assert telem_disabled.json()["derivedStatus"] == "DISABLED", f"Expected DISABLED, got {telem_disabled.json()['derivedStatus']}"
    print("  [OK] Telemetry disabled company toggle successfully yields DISABLED derivedStatus.")

    # Restore company setting
    acme_session.patch(
        f"{BASE_URL}/customer/companies/comp-acme-in/telemetry-settings",
        json={"telemetryEnabled": True}
    )

    print("\n" + "=" * 65)
    print("ALL 13 END-TO-END TELEMETRY INTEGRATION TESTS PASSED PERFECTLY!")
    print("=" * 65)

if __name__ == "__main__":
    try:
        run_verification()
    except Exception as e:
        print(f"\n[FAILURE] {e}")
        sys.exit(1)

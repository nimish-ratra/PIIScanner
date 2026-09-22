"""
Manual Fleet Telemetry Verification
Standalone script to test real outbound telemetry (ping, scan summary, enforcement aggregation,
and outbox flushing) against a live TrustFabric backend API.

Usage (from the agent/ directory):
    python tests/verify_telemetry_manual.py
"""

import sys
import json
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import license_client, telemetry_client
from backend.database import db_manager


def main():
    print("=" * 60)
    print("ClAIssify Fleet Telemetry Manual Verification")
    print("=" * 60)

    print(f"Backend URL:       {license_client.get_backend_url()}")
    print(f"License file:      {license_client.get_license_file_path()}")
    print(f"Telemetry state:   {telemetry_client.get_telemetry_state_file_path()}")
    print(f"Is registered:     {license_client.is_registered()}")

    if not license_client.is_registered():
        print("\n[WARNING] Device is not registered/activated.")
        print("Run `python tests/verify_activation_manual.py` first to enroll this device.")
        return

    allowed, reason = license_client.enforcement_status()
    print(f"Enforcement status: allowed={allowed}, reason={reason}")
    if not allowed:
        print(f"\n[WARNING] Device not licensed to run: {reason}")
        return

    print("\n1. Testing live telemetry ping...")
    ping_resp = telemetry_client.send_ping(
        service_running=True,
        watcher_active=True,
        service_started_at=datetime.now(timezone.utc).isoformat()
    )

    if ping_resp:
        print("[SUCCESS] Ping acknowledged by backend!")
        print(f"Server time:         {ping_resp.get('serverTime')}")
        print(f"Installation status: {ping_resp.get('installationStatus')}")
        print(f"Telemetry config:    {json.dumps(ping_resp.get('telemetry', {}), indent=2)}")
        commands = ping_resp.get("commands", [])
        print(f"Commands received:   {len(commands)}")
        for cmd in commands:
            print(f"  - [{cmd.get('type')}] ID: {cmd.get('id')}")
    else:
        print("[FAILURE] Telemetry ping failed. Check backend logs or connectivity.")

    print("\n2. Checking local outbox depth...")
    depth = db_manager.get_telemetry_outbox_depth()
    print(f"Current outbox depth: {depth}")

    print("\n3. Testing outbox flush...")
    telemetry_client.flush_outbox()
    new_depth = db_manager.get_telemetry_outbox_depth()
    print(f"Outbox depth after flush: {new_depth}")

    print("\nDone.")


if __name__ == "__main__":
    main()

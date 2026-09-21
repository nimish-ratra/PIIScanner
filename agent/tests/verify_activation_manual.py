"""
Manual Licensing Connection Verification
Standalone script to verify the TrustFabric licensing connection in isolation —
deliberately does NOT import MainWindow or anything from the scanning engine
(Presidio/spaCy/Tika), since verifying activation has nothing to do with them.

Usage (from the agent/ directory):
    python tests/verify_activation_manual.py

Shows the real ActivationDialog against the real backend/license_client.py.
Enter a live TrustFabric enrollment token to verify the full register() flow;
after it closes, this prints the resulting local license state so you can
confirm the credential, policy, and grace-period fields all look right.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from PySide6.QtWidgets import QApplication

from backend import license_client
from ui.views.activation_dialog import ActivationDialog


def main():
    app = QApplication(sys.argv)

    print(f"License file: {license_client.get_license_file_path()}")
    print(f"Backend URL:  {license_client.get_backend_url()}")
    print(f"Already registered: {license_client.is_registered()}")
    print("-" * 60)

    dialog = ActivationDialog(allow_skip=True)
    result = dialog.exec()

    print("-" * 60)
    if result:
        print("Dialog accepted (activation succeeded).")
    else:
        print("Dialog closed/skipped without activating.")

    print(f"is_registered(): {license_client.is_registered()}")
    if license_client.is_registered():
        allowed, reason = license_client.enforcement_status()
        print(f"enforcement_status(): allowed={allowed}, reason={reason!r}")

        print("\nAttempting a live heartbeat against the backend...")
        try:
            state = license_client.heartbeat()
            print(f"Heartbeat OK. Cached policy: {state['lastPolicy']}")
        except Exception as e:
            print(f"Heartbeat failed: {e}")


if __name__ == "__main__":
    main()

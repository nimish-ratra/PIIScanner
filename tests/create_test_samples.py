"""
Generate test sample documents for PII Sentinel verification.
Creates clean files, PII-laden files, nested folders, and corrupted files.
"""

import os
import json
import csv
from pathlib import Path


def create_test_samples(base_dir: str = "tests/test_data") -> Path:
    """Create diverse test files inside base_dir."""
    target_dir = Path(base_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    nested_dir = target_dir / "confidential_archive" / "2026"
    nested_dir.mkdir(parents=True, exist_ok=True)

    # 1. Clean file (No PII)
    clean_path = target_dir / "clean_project_notes.txt"
    with open(clean_path, "w", encoding="utf-8") as f:
        f.write(
            "Project Architecture Overview\n"
            "This document describes the software structure and subsystem communication protocols.\n"
            "All components operate locally using asynchronous event handling.\n"
            "No personal customer details are maintained in this technical guide.\n"
        )

    # 2. PII Document (Text)
    pii_path = target_dir / "customer_inquiry_ticket.txt"
    with open(pii_path, "w", encoding="utf-8") as f:
        f.write(
            "Customer Support Ticket #48291\n"
            "Client: Alice Smith\n"
            "Email Address: alice.smith@sentinelcorp.com\n"
            "Contact Phone: +1-555-019-2834\n"
            "Billing Credit Card: 4532-0150-1234-5678\n"
            "IP Address: 192.168.1.105\n"
            "Social Security Number: 123-45-6789\n"
            "Resident Location: Chicago, Illinois\n"
            "Date of Incident: September 04, 2026\n"
        )

    # 3. CSV Dataset with PII
    csv_path = target_dir / "billing_export.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["ID", "Name", "Email", "Phone", "Status"])
        writer.writerow(["101", "Robert Johnson", "robert.j@example.org", "+1-202-555-0143", "Active"])
        writer.writerow(["102", "Elena Rostova", "elena.rostova@domain.net", "+1-312-555-0199", "Pending"])
        writer.writerow(["103", "System Admin", "support@system.internal", "+1-800-555-0177", "Verified"])

    # 4. JSON Dataset with PII
    json_path = target_dir / "user_profile.json"
    user_data = {
        "user_id": "usr_99182",
        "full_name": "Marcus Aurelius Vance",
        "email": "marcus.vance@securegateway.io",
        "mobile": "+1-415-555-2671",
        "backup_email": "m.vance.personal@gmail.com",
        "registered_ip": "10.0.4.22"
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(user_data, f, indent=2)

    # 5. Nested folder PII
    nested_path = nested_dir / "executive_payroll_notes.txt"
    with open(nested_path, "w", encoding="utf-8") as f:
        f.write(
            "Confidential Executive Summary\n"
            "Chief Executive: Gregory House\n"
            "Direct Contact: gregory.house@hospital.org\n"
            "Emergency Phone: +1-609-555-0130\n"
            "Wire Transfer IBAN: US64SVVE12345678901234\n"
        )

    # 6. Corrupted file to verify error resilience
    corrupt_path = target_dir / "corrupted_archive.docx"
    with open(corrupt_path, "wb") as f:
        f.write(b"NOT_A_VALID_DOCX_OR_ZIP_HEADER_CORRUPTED_BYTES_1234567890")

    print(f"Sample test files created successfully in: {target_dir}")
    return target_dir


if __name__ == "__main__":
    create_test_samples()

# ClAIssify Fleet Telemetry & Admin Panel — Handoff Document

**Target Component:** ClAIssify Windows Desktop DLP Agent (`PIIScanner`)  
**Branch:** `feature/fleet-telemetry`  
**Paired Backend Repo:** `licensing-software-` (branch: `feature/dspm-telemetry`)  
**Date:** September 2026  
**Status:** Complete, Verified & Tested End-to-End  

---

## 1. Executive Summary

This branch implements outbound, privacy-preserving DSPM/DLP fleet telemetry reporting from the **ClAIssify** desktop agent to the **TrustFabric** licensing platform. It provides company administrators with real-time fleet health, sensitivity findings rollups, and remote administrative command dispatching, while strictly guaranteeing user data privacy.

---

## 2. Privacy & Air-Gap Contract (Non-Negotiables)

1. **Zero File Content & Zero PII Values**:
   - Scanning, OCR, Presidio recognition, and regex matching execute **100% on the local device**.
   - No extracted text snippets, sample PII strings, or user-entered override justifications ever leave the machine.
2. **Hashed File Paths by Default**:
   - File paths default to salted SHA-256 references:
     `sha256:<salt + lowercase(normalized_path)>`
   - The salt is generated uniquely on device activation and stored in `%APPDATA%\PIISentinel\telemetry_state.json`.
   - Literal file paths are transmitted **only if** the company administrator explicitly enables `syncFullPaths: true` in the portal policy.
3. **Payload Firewall (`_assert_payload_safe`)**:
   - Every outbound payload passes through an internal inspection gate before network dispatch.
   - Any payload containing Windows path roots (`C:\`, `\\`) when `syncFullPaths` is false, forbidden keys (`pii_samples`, `content`, `text`), or non-whitelisted entity keys is immediately dropped.
4. **Standalone & Unlicensed Mode**:
   - If the agent is not registered or licensed, telemetry operates in completely air-gapped standalone mode. Zero HTTP telemetry requests are dispatched.

---

## 3. Architecture & Key Changes

### A. Telemetry Client (`agent/backend/telemetry_client.py`)
- **State Store**: `%APPDATA%\PIISentinel\telemetry_state.json` maintains:
  - `installation_salt`: Unique device salt for path hashing.
  - `telemetry_config`: Server-pushed configuration (`enabled`, `intervalSeconds`, `syncFullPaths`).
  - `enforcement_high_water_mark`: Tracks aggregated DLP interception events.
  - `processed_command_ids`: De-duplicates received remote commands.
- **Heartbeat / Ping (`send_ping`)**:
  - Periodically sends agent version, OS, service running state, watcher active state, service started timestamp, and outbox depth.
  - Receives server time, installation status (`ACTIVE`, `SUSPENDED`, `REVOKED`), pushed telemetry config, and pending remote commands.
- **Command Dispatcher**:
  - Automatically executes acknowledged commands:
    - `force_policy_refresh`: Triggers `license_client.check_policy()`.
    - `request_service_restart`: Requests graceful restart of background runner.
    - `request_diagnostic_snapshot`: Collects system/environment diagnostics without PII.
  - Acknowledges command execution status (`success`, `failed`, `unsupported`) via `POST /agent/telemetry/command-ack`.
- **Enforcement Aggregation**:
  - Reads `interception_log` rows and groups events into 15-minute UTC-aligned buckets (`windowStart`, `windowEnd`, `source`, `actionCounts`, `tierCounts`, `overrideCount`).

### B. Outbox Pattern (`agent/backend/database.py`)
- Added table `telemetry_outbox`:
  - `id`: Autoincrement primary key.
  - `payload_type`: `scan_summary` or `enforcement_summary`.
  - `payload`: JSON text string.
  - `created_at`: Enqueue timestamp.
  - `claimed_at`: Atomic claim timestamp (`UPDATE ... WHERE claimed_at IS NULL`) to safely coordinate between PySide6 GUI and service runner.
  - `retry_count`: Exponential backoff counter (max 10 retries before drop).
- Maximum outbox cap: 1,000 rows (oldest pruned on overflow to prevent runaway disk usage).
- SQLite runs in `WAL` mode with 30-second busy timeout for concurrent process safety.

### C. Background Daemon Loop (`agent/service/service_runner.py`)
- Spawns background thread running telemetry loop:
  - Sends ping every `intervalSeconds` (default 180s, clamped between 60s and 900s).
  - Enqueues 15-minute aggregated enforcement windows.
  - Flushes outbox periodically.
- Sends graceful shutdown ping (`serviceRunning: false`) when service terminates.

### D. Scanning Integration (`agent/backend/scanner.py`)
- Upon scan completion, cancellation, or error, automatically computes tier totals, entity type counts, and capped file findings (max 200 files), then enqueues to outbox via `telemetry_client.enqueue_scan_summary()`.
- Non-blocking: outbox enqueue never delays or interrupts user scanning workflow.

### E. User Interface Transparency
- **Live Monitoring View (`agent/ui/views/live_monitoring_view.py`)**:
  - Displays "Fleet Reporting" status indicator pill and last sync timestamp.
- **Settings View (`agent/ui/views/settings_view.py`)**:
  - "Fleet Reporting & Telemetry" card explaining the privacy guarantees (no content leaves endpoint, path hashing status, sync interval).

### F. Handbook & Documentation
- **`CONTEXT.md`**: Fully updated §1, §3 directory structure, §7 Rules 3 & 10, §11, and added comprehensive Section 15 documenting the complete Fleet Telemetry architecture.

---

## 4. Test & Verification Results

| Test Suite | Location | Tests | Status |
| :--- | :--- | :--- | :--- |
| **Telemetry Client Unit Tests** | `agent/tests/test_telemetry_client.py` | 8/8 | **PASSED** |
| **Agent Full Regression Suite** | `agent/tests/` | 112/112 | **PASSED** |
| **Real E2E Telemetry Integration** | `agent/tests/verify_telemetry_e2e.py` | 13/13 | **PASSED** |

### Verified E2E Flow (`verify_telemetry_e2e.py`):
1. API Health Check -> `200 OK`.
2. Company Admin Authentication -> `comp-acme-in` session created.
3. Enrollment Token Creation -> Token issued.
4. Agent Self-Registration (`/agent/register`) -> Registered with `installationId` and DPAPI credentials.
5. Admin Approval -> Installation transitioned to `ACTIVE`.
6. Telemetry Ping (`/agent/telemetry/ping`) -> Returns 200/201 with server time, `ACTIVE` status, and empty commands.
7. Customer Portal Telemetry Read -> Status derived as `LIVE`.
8. Remote Command Issuance (`force_policy_refresh`) -> Status `PENDING`.
9. Agent Command Polling -> Received via next ping.
10. Agent Command ACK (`/agent/telemetry/command-ack`) -> Status transitioned to `ACKNOWLEDGED`.
11. Scan Summary Ingestion (`/agent/telemetry/scan-summary`) -> Stored with tier breakdown and findings, verified via customer scan endpoint.
12. Enforcement Summary Aggregation -> Deduplicated cleanly on replay.
13. Cross-Tenant IDOR Protection -> Globex Company Admin rejected with `404 Not Found` when trying to read or command Acme installation.
14. Revocation Enforcement -> Revoked installation immediately rejected with `401 Unauthorized` on ping; company toggle immediately derives `DISABLED`.

---

## 5. Modified & Created Files in `PIIScanner`

```
agent/
├── backend/
│   ├── database.py                 (telemetry_outbox table, enqueue, claim, prune)
│   ├── scanner.py                  (scan summary enqueueing hook)
│   └── telemetry_client.py         (NEW: payload firewall, ping, outbox, commands)
├── service/
│   └── service_runner.py           (telemetry daemon thread, shutdown ping)
├── ui/views/
│   ├── live_monitoring_view.py     (Fleet Reporting status indicator)
│   └── settings_view.py            (Fleet Reporting info card)
├── tests/
│   ├── test_telemetry_client.py    (NEW: unit tests for client & firewall)
│   ├── verify_telemetry_manual.py  (NEW: manual ping test)
│   └── verify_telemetry_e2e.py     (NEW: complete automated integration test)
├── CONTEXT.md                      (Updated §1, §3, §7, §11, and added Section 15)
└── TELEMETRY_HANDOFF.md            (NEW: this document)
```

---

## 6. Deployment & Runtime Notes

- **Configuration**: Set `TRUSTFABRIC_BACKEND_URL` environment variable (or registry / config file) to point to the licensing API endpoint (e.g. `http://localhost:3001/api/v1` in dev, or the production URL).
- **Credentials**: Stored in `%APPDATA%\PIISentinel\license_state.json` (DPAPI-encrypted under current Windows user context).
- **Outbox Database**: Stored in `%APPDATA%\PIISentinel\history.db`.

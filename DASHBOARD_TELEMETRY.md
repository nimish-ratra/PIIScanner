# PII Sentinel — Desktop Agent to Server & Dashboard Telemetry Specification

## 1. System Architecture

`mermaid
flowchart TD
    subgraph Endpoint [Endpoint Workstation (agent/)]
        Office[Office Word & Excel (VSTO SaveGuard)]
        Watcher[Filesystem Watcher (Desktop, Downloads, Docs)]
        Scanner[Batch & On-Demand Directory Scanner]
        Service[Local Microservice (Port 47821)]
        AuditDB[(Local SQLite Audit (history.db))]
        
        Office -->|In-Memory Pre-Save Hook| Service
        Watcher -->|Debounced File Write| Service
        Scanner -->|Deep Content Extraction| Service
        Service --> AuditDB
    end

    subgraph Backend [Enterprise Cloud Backend (server/)]
        IngestAPI[Telemetry Ingestion Gateway (/api/v1/telemetry)]
        RiskEngine[Fleet Risk & Alert Aggregator]
        CloudDB[(Enterprise Central Storage)]
        
        IngestAPI --> RiskEngine
        RiskEngine --> CloudDB
    end

    subgraph Frontend [Admin Web Portal (client/)]
        Dashboard[Executive Security Dashboard]
        LiveFeed[Live Incident & Threat Feed]
        AuditPortal[Compliance & Insider Threat Reports]
        PolicyUI[Remote Policy Manager]
        
        CloudDB --> Dashboard
        CloudDB --> LiveFeed
        CloudDB --> AuditPortal
        PolicyUI --> RiskEngine
    end

    Service -->|HTTPS / mTLS Telemetry| IngestAPI
    RiskEngine -.->|Remote Policy Updates| Service
`

---

## 2. Telemetry Ingestion Schemas (Agent -> Server)

### 2.1 Real-Time Enforcement Events (POST /api/v1/telemetry/enforcement)
Sent immediately when a document save or file creation triggers an enforcement rule.

`json
{
  event_id: enf-98a4b2c1-6789-4def-b123-abcdef012345,
  timestamp: 2026-09-09T11:20:00.123+05:30,
  endpoint: {
    hostname: DEL-LAPTOP-042,
    os_username: nimish.ratra,
    ip_address: 10.0.4.18,
    agent_version: 2.0.0
  },
  source_application: Microsoft Word,
  source_type: OfficeCOM,
  file_info: {
    file_path: C:\\Users\\Nimish\\Documents\\Q3_Financial_Payroll_Draft.docx,
    file_name: Q3_Financial_Payroll_Draft.docx,
    extension: .docx,
    size_bytes: 148520
  },
  classification: {
    tier: Restricted,
    confidence_level: 0.94,
    total_violations: 18,
    entities_found: [
      {
        entity_type: IN_AADHAAR,
        count: 12,
        sample_masked: 3675 **** 5012,
        confidence: 0.95
      },
      {
        entity_type: IN_PAN,
        count: 5,
        sample_masked: ABCDE****F,
        confidence: 0.92
      },
      {
        entity_type: CREDIT_CARD,
        count: 1,
        sample_masked: 4111-****-****-1111,
        confidence: 0.96
      }
    ]
  },
  enforcement: {
    action_taken: BLOCK,
    policy_rule_id: POL-RESTRICTED-BLOCK-V1,
    fail_safe_mode: Fail-Closed,
    user_override: true,
    override_reason: Urgent board review requested by CFO for payroll signoff.
  }
}
`

---

### 2.2 Endpoint Scan Results (POST /api/v1/telemetry/scans)
Sent at the completion of an automated or admin-initiated directory scan.

`json
{
  scan_id: scan-20260909-110022-7718,
  started_at: 2026-09-09T11:00:22.000+05:30,
  completed_at: 2026-09-09T11:04:15.000+05:30,
  duration_seconds: 233.0,
  endpoint: {
    hostname: DEL-LAPTOP-042,
    os_username: nimish.ratra
  },
  scan_configuration: {
    target_directory: C:\\Users\\Nimish\\Documents,
    confidence_threshold: 0.60,
    ocr_enabled: true
  },
  summary: {
    files_scanned: 1420,
    files_with_pii: 28,
    total_findings: 194,
    risk_breakdown: {
      restricted: 4,
      highly_confidential: 9,
      confidential: 15,
      general: 0,
      public: 0
    }
  },
  violations_sample: [
    {
      file_name: vendor_tax_records.xlsx,
      tier: Restricted,
      findings_count: 86,
      dominant_pii: IN_PAN
    }
  ]
}
`

---

### 2.3 Agent Liveness & Policy Heartbeat (POST /api/v1/telemetry/heartbeat)
Periodic heartbeat sent every 60 seconds.

`json
{
  endpoint_id: EP-DEL-LAPTOP-042,
  timestamp: 2026-09-09T11:21:00.000+05:30,
  status: Healthy,
  service_state: {
    microservice_running: true,
    system_tray_active: true,
    office_word_hook_registered: true,
    office_excel_hook_registered: true,
    filesystem_watcher_running: true,
    watched_directories: [
      C:\\Users\\Nimish\\Desktop,
      C:\\Users\\Nimish\\Documents,
      C:\\Users\\Nimish\\Downloads
    ]
  },
  policy_sync: {
    active_policy_hash: a4f891b72e61,
    fail_safe_mode: Fail-Closed
  },
  agent_version: 2.0.0
}
`

---

## 3. Data Privacy & Zero-Trust Guarantees

1. **Zero Raw PII Egress**:
   - The desktop agent **never** sends unmasked PII over the wire.
   - All sample values are redacted locally using regex and Presidio anonymization (e.g. 3675 **** 5012, ABCDE****F, ****@company.com).
2. **Local Quarantine Isolation**:
   - Quarantined files remain stored locally on the endpoint in an AES-256 encrypted zip vault (%APPDATA%\PIISentinel\quarantine\).
   - Only the metadata and audit events are pushed to the central server.
3. **mTLS & Authenticated Transport**:
   - Communication between gent/ and server/ uses mutual TLS with unique device certificates and machine-specific JWT tokens.

---

## 4. Admin Dashboard Widgets (client/)

| UI Component | Data Source from Telemetry | Visualization / Behavior |
| :--- | :--- | :--- |
| **Fleet Health Banner** | Heartbeat Telemetry | Total endpoints protected, online/offline count, out-of-date agents. |
| **Data Leak Prevention KPI** | Enforcement Telemetry | Total files blocked, quarantined, and warned in the last 24h / 7d / 30d. |
| **Sensitivity Tier Distribution** | Enforcement & Scan Telemetry | Donut chart rendering Microsoft Purview 5-tier classification distribution. |
| **Top Exposed PII Types** | Findings Telemetry | Bar graph highlighting top PII entities (Aadhaar, PAN, Passports, Secrets). |
| **Real-Time Threat Stream** | Live Enforcement Feed | Chronological live table with instant alerts, machine name, file, and tier. |
| **Insider Threat Override Table** | user_override == true | Dedicated audit view showing employees who bypassed blocks with justifications. |
| **One-Click Compliance Export** | Central Cloud DB | Export compliance readiness reports for India DPDP Act 2023, GDPR, and ISO 27001. |

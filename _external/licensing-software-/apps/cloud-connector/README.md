# clAIssify — Office 365 / Microsoft 365 Cloud Connector (`apps/cloud-connector`)

A centralized NestJS service for enterprise organizations running clAIssify to detect, audit, and remediate sensitive PII and cryptographic secrets across Microsoft 365 services (SharePoint Online and OneDrive for Business).

---

## 1. Architectural Model & Protection Boundary

### Detect-and-Remediate (Honest Caveat)
- **Local Endpoint vs Cloud Boundary:** The clAIssify desktop Office add-in (`agent/office_addin/`) intercepts saves natively inside Word/Excel processes and cancels them synchronously (`Cancel = true`) before bytes reach disk.
- **Cloud Reality:** Neither Office Online nor direct web uploads to SharePoint / OneDrive provide a public API for third-party pre-commit cancellation. Only Microsoft's native Purview DLP kernel can block cloud saves mid-flight.
- **Core Principle:** The O365 Cloud Connector operates strictly on a **detect-and-remediate** model (the exact same architecture as the Windows Filesystem Watcher).
- **Honesty Rule:** Never promise or claim pre-save blocking for Office 365 or SharePoint content in the UI, customer portal, or documentation.

---

## 2. High-Leverage Synthetic Installation Architecture (§1.1)

Rather than maintaining parallel database tables for cloud scans and findings, the connector provisions a single synthetic `Installation` row per company:
- `deviceId`: `"o365-connector-<companyId>"`
- `hostname`: `"cloud-connector"`
- `os`: `"cloud"`
- `applicationVersion`: `"1.1.0"`

### Schema Leverage
All existing infrastructure works immediately without parallel schema tables:
- `ScanRun` rows (with `scanSource: "o365_sharepoint" | "o365_onedrive" | "o365_exchange"`)
- `ScanFindingSummary` rows (with salted `pathRef: sha256:...` unless `syncFullPaths` is enabled)
- `EnforcementWindow` rows (`source: "o365_watcher"`)
- Customer Portal installation details and fleet-wide rollups

---

## 3. Technology Stack & Key Libraries

- **Framework:** NestJS (TypeScript)
- **Database / ORM:** Prisma (`@prisma/client`) sharing the common database with `apps/api`
- **Authentication:** Official `@azure/msal-node` (client-credentials flow)
- **Graph SDK:** Official `@microsoft/microsoft-graph-client` (with automatic backoff and 429 Retry-After handling)
- **Encryption:** AES-256-GCM for tenant client secrets at rest
- **Scheduler:** `@nestjs/schedule` for configurable delta polling

---

## 4. Classification Pipeline Reuse (§1.3)

The connector does **not** reimplement Presidio NER or Apache Tika extraction in TypeScript. Instead, it reuses the proven Python classification engine:
1. **Primary (FastAPI HTTP Daemon):** Streams file bytes to `POST http://127.0.0.1:47821/classify/bytes` for ultra-fast in-memory classification.
2. **Fallback (CLI Subprocess):** If the daemon is unreachable, it invokes `python -m backend.classifier_cli --json-stdin` to guarantee zero operational interruption.

---

## 5. Remediation Capabilities

- **Cloud Quarantine (§1.5):** Strips public/anonymous sharing links via Microsoft Graph, moves the item to a restricted `clAIssify-Quarantine` folder, and preserves complete version history.
- **Format-Aware Watermarking (§1.6):** Downloads files, executes format-aware watermarks via `agent/backend/watermark_engine.py`, and uploads back as a new version via `PUT /items/{id}/content`. Plaintext files are tagged via custom SharePoint metadata fields.
- **Dry-Run Safe:** Enabled by default (`dryRunMode: true`). Actions are simulated and findings logged without modifying documents in the customer tenant until explicitly approved.

---

## 6. Configuration & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `CLOUD_CONNECTOR_PORT` | HTTP port for connector microservice | `3004` |
| `CLASSIFIER_API_URL` | clAIssify local Python FastAPI server | `http://127.0.0.1:47821` |
| `PYTHON_BIN` | Python binary executable path | `python` |
| `CONNECTOR_SECRET_KEY` | Hex or passphrase for AES-256-GCM credential encryption | Configured / fallback |
| `LOG_LEVEL` | Logging verbosity (`log`, `debug`, `warn`, `error`) | `log` |

---

## 7. Development & Running

```bash
# Build
npm run build

# Run in development mode
npm run start:dev

# Run in production mode
npm run start:prod
```

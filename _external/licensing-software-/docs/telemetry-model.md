# Fleet Telemetry Model

## Concept
The Fleet Telemetry domain provides DSPM/DLP operational visibility across licensed ClAIssify agents without compromising client data privacy. While existing licensing endpoints (`/agent/heartbeat`) monitor commercial seat consumption, the telemetry domain monitors protection status, scan activities, enforcement events, and enables asynchronous administrative command dispatch.

Communication is strictly outbound from the agent over HTTPS. The backend never opens incoming network connections to client machines; administrative commands are queued in PostgreSQL and ride back in the response to the agent's periodic telemetry ping.

## Privacy Contract
The telemetry protocol enforces a strict privacy boundary:
- **Never leaves the device**: File contents, PII values (raw or masked), free-text user inputs, user override justification notes, `entity_summary`, or Windows usernames.
- **Paths**: Default to a local salted SHA-256 reference `sha256:<hex> = sha256(local_salt + lowercase(normalized_path))`. Literal file paths are transmitted only if the company administrator explicitly enables `syncFullPaths` in company settings.
- **Aggregated metrics**: Scan findings are reported as counts per sensitivity tier and entity type. Enforcement events are aggregated locally into 15-minute UTC-aligned windows.

## Core Entities

### 1. InstallationTelemetryState (Hot State)
A 1:1 relation with `Installation` storing the latest snapshot updated on every telemetry ping (default interval: 180s):
- `serverTime`: Authoritative receive timestamp used for status evaluation.
- `clientTime`: Device clock timestamp recorded for skew diagnostics.
- `serviceRunning`, `watcherActive`: Boolean flags representing daemon health.
- `serviceStartedAt`: Process start time.
- `policyHash`: 12-hex hash of local classification rules.
- `agentVersion`, `applicationVersion`: Client runtime versions.
- `outboxDepth`: Count of queued offline telemetry payloads.
- `lastScanAt`, `lastEnforcementAt`: High-water marks for activity.

### 2. ServiceStatusEvent (Cold History)
Append-only log of service/watcher state changes or periodic snapshots (recorded at most once every 15 minutes). Rows older than 30 days are automatically pruned by a daily retention job.

### 3. ScanRun & ScanFindingSummary
- `ScanRun`: Record of completed, cancelled, or failed scans. Deduplicated idempotently by `(installationId, clientScanId)`. Stores aggregate metrics: duration, files scanned, findings count, highest tier, `tierCounts` (JSON), and `entityTypeTotals` (JSON).
- `ScanFindingSummary`: Capped per-file findings (up to 200 items, highest sensitivity first, tier $\ge$ Confidential) containing `pathRef`, `tier`, `entityTypeCounts` (JSON), and watermark status.

### 4. EnforcementWindow
15-minute UTC-aligned buckets of DLP actions by source (`Word`, `Excel`, `Filesystem Watcher`). Idempotent upsert by `(installationId, windowStart, source)`. Stores `actionCounts` (block, quarantine, override, warn, allow), `tierCounts`, and `overrideCount`. Rows older than 180 days are pruned by retention jobs.

### 5. AgentCommand
Asynchronous command queue delivering instructions to agents during ping calls:
- **Types**: `force_policy_refresh`, `request_diagnostic_snapshot`, `request_service_restart`.
- **Lifecycle**: `PENDING` $\rightarrow$ `DELIVERED` (with 10-minute redelivery timeout) $\rightarrow$ `ACKNOWLEDGED` (or `EXPIRED` after 24h / `CANCELLED` by admin).
- Single open command limit per `(installationId, commandType)`.

## Server-Derived Telemetry Status
To eliminate dependence on client clocks or browser time zones, status is evaluated on the server using `deriveTelemetryStatus`:
- `DISABLED`: Company administrator disabled telemetry (`telemetryEnabled = false`).
- `NO_DATA`: Installation has never reported telemetry (`serverTime` is null).
- `OFFLINE`: More than 30 minutes since the last ping.
- `STOPPED`: Last ping reported `serviceRunning = false` (within 30 minutes).
- `LIVE`: Last ping reported `serviceRunning = true` within $2 \times \text{interval}$ (e.g. $\le 360\text{s}$).
- `STALE`: Last ping reported `serviceRunning = true` between $2 \times \text{interval}$ and 30 minutes ago.

## RBAC & Tenant Isolation
All admin queries and mutations enforce multi-tenant scoping via `allowedCompanyIds`:
- `installation.read`: View installation telemetry, scan runs, fleet overview KPIs, and paginated fleet lists.
- `installation.manage`: Issue and cancel agent commands.
- `company.manage`: Toggle `telemetryEnabled` and `syncFullPaths` settings.

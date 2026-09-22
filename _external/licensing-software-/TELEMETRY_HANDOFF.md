# TrustFabric Licensing & Telemetry Platform — Handoff Document

**Target Component:** TrustFabric Monorepo (`licensing-software-`)  
**Branch:** `feature/dspm-telemetry`  
**Paired Agent Repo:** `PIIScanner` (branch: `feature/fleet-telemetry`)  
**Date:** September 2026  
**Status:** Complete, Verified & Tested End-to-End  

---

## 1. Executive Summary

This branch implements the complete **DSPM/DLP Fleet Telemetry & Protection** suite across the TrustFabric monorepo:
1. **NestJS API (`apps/api`)**: High-performance, multi-tenant ingestion pipeline with rate limiting, idempotent upserts, RBAC-guarded customer endpoints, vendor fleet health rollup, and background data pruning.
2. **Prisma ORM**: Data models and migration for installation telemetry state, historical status events, scan runs, capped finding summaries, 15-minute enforcement windows, and remote agent commands.
3. **Customer Portal (`apps/customer-portal`)**: Overview KPIs, dedicated `/telemetry` Fleet Protection dashboard, rich device Protection tab (live status badge, recent scans inspector, Recharts enforcement activity, remote command dispatch with diagnostics viewer), and policy settings.
4. **Vendor Admin Portal (`apps/trustfabric-admin`)**: Privacy-preserving `/fleet-health` rollup dashboard showing global agent version distribution, live device ratios, and per-company fleet health without exposing raw file paths or findings.

---

## 2. Database Models & Migration

Migration created at `apps/api/prisma/migrations/20260921160800_add_fleet_telemetry/migration.sql`:

### Model Summary
- **`Company` Extensions**:
  - `telemetryEnabled` (Boolean, default `true`): Master switch allowing tenant to disable telemetry collection.
  - `syncFullPaths` (Boolean, default `false`): Governs whether the agent hashes file paths (`sha256`) or transmits literal paths.
- **`InstallationTelemetryState`**:
  - 1:1 table linked to `Installation`.
  - Hot state updated on every ping: `clientTime`, `serverTime`, `serviceRunning`, `watcherActive`, `serviceStartedAt`, `policyHash`, `agentVersion`, `applicationVersion`, `outboxDepth`, `lastScanAt`, `lastEnforcementAt`.
- **`ServiceStatusEvent`**:
  - Historical transitions (`SERVICE_STARTED`, `SERVICE_STOPPED`, `WATCHER_ENABLED`, `WATCHER_DISABLED`).
  - Auto-pruned after 30 days via daily `@Cron`.
- **`ScanRun`**:
  - Tracks scan executions (`directory_scan`, `full_system_scan`) with `clientScanId` idempotent key on `(installationId, clientScanId)`.
  - Captures duration, files scanned, files with PII, total findings, highest tier, `tierCounts` (JSON), `entityTypeTotals` (JSON), and `filesTruncated`.
- **`ScanFindingSummary`**:
  - Capped per-file finding summaries (max 200 per scan run) storing `pathRef` (hashed or literal), `tier`, `entityTypeCounts` (JSON), and `watermarkStatus`.
- **`EnforcementWindow`**:
  - 15-minute UTC-aligned DLP interception aggregation uniquely indexed on `(installationId, windowStart, source)`.
  - Stores `actionCounts` (JSON), `tierCounts` (JSON), and `overrideCount`.
  - Auto-pruned after 180 days via daily `@Cron`.
- **`AgentCommand`**:
  - Remote commands (`force_policy_refresh`, `request_service_restart`, `request_diagnostic_snapshot`).
  - Lifecycle: `PENDING` -> `DELIVERED` (on ping) -> `ACKNOWLEDGED` (on agent ack) or `EXPIRED` / `CANCELLED`.

---

## 3. API Module Structure (`apps/api/src/agent-telemetry`)

```
apps/api/src/agent-telemetry/
├── agent-telemetry.constants.ts       # Durations, intervals (180s default, [60, 900] clamp), allowed commands
├── derive-telemetry-status.util.ts    # Pure status derivation: NO_DATA, LIVE, STOPPED, STALE, OFFLINE, DISABLED
├── agent-telemetry.dto.ts             # Validation pipes with regex & tier count constraints
├── agent-telemetry.service.ts         # Ingestion, rate limiting, queries, commands, cron pruning
├── agent-telemetry.controller.ts      # Agent ingestion routes (@Public() + AgentAuthGuard)
├── customer-telemetry.controller.ts   # Tenant-scoped admin endpoints (RequirePermissions)
├── vendor-telemetry.controller.ts     # Vendor fleet health rollup (@RequirePermissions('*'))
└── agent-telemetry.module.ts          # Module export with Prisma and Audit dependencies
```

### Endpoints Implemented

#### Agent Ingestion (`/api/v1/agent/telemetry`) — Protected by `AgentAuthGuard`
- `POST /ping`: Ingests heartbeat, updates hot state, returns server time, installation status, telemetry policy, and pending commands.
- `POST /scan-summary`: Idempotent upsert of scan metadata and capped finding summaries.
- `POST /enforcement-summary`: Idempotent upsert of 15-minute enforcement windows.
- `POST /command-ack`: Records command execution status (`success`, `failed`, `unsupported`) and logs audit trail.

#### Customer Admin (`/api/v1/customer`) — Scoped by `req.user.allowedCompanyIds`
- `GET /telemetry/summary?companyId=&days=`: Fleet KPIs (protected devices, files audited, findings by tier, DLP action totals).
- `GET /telemetry/installations`: Paginated, filterable fleet table with derived status calculation.
- `GET /installations/:id/telemetry`: Deep installation detail: live telemetry state, derived status, recent scans, 7-day enforcement windows, and command history.
- `GET /installations/:id/scans/:scanRunId`: Detail of an individual scan run with per-file findings.
- `POST /installations/:id/commands`: Issue command (`installation.manage` required).
- `DELETE /installations/:id/commands/:commandId`: Cancel pending command (`installation.manage` required).
- `PATCH /companies/:id/telemetry-settings`: Toggle `telemetryEnabled` and `syncFullPaths` (`company.manage` required).

#### Vendor Admin (`/api/v1/vendor/telemetry`)
- `GET /fleet-health`: Global fleet metrics, version distribution, and per-company aggregates without revealing file paths or findings.

---

## 4. Frontend Portals

### Customer Portal (`apps/customer-portal`)
- **Fleet Protection Page (`/telemetry`)**: Filter by derived status (LIVE, STALE, STOPPED, OFFLINE, NO_DATA, DISABLED), sensitivity tier, or hostname search.
- **Protection Tab in Installation Dialog**:
  - Live status indicator with pulse animation for LIVE devices.
  - Device uptime and last reported timestamp.
  - Recent scans table with direct drill-down into file findings.
  - 7-day DLP enforcement area chart powered by `recharts`.
  - Remote command dispatch bar (Policy Refresh, Service Restart, Diagnostic Snapshot) with confirmation modals and diagnostic JSON viewer.
- **Overview Dashboard (`/overview`)**: Added 4-card Fleet Protection KPI grid.
- **Settings (`/settings`)**: "Fleet Reporting & Telemetry Policy" card with security warning confirmation modal before enabling literal file path sharing.

### Vendor Admin Portal (`apps/trustfabric-admin`)
- **Fleet Health Page (`/fleet-health`)**: Global rollup of active installations, stale/offline devices, version distribution bar, and per-tenant device count table.

---

## 5. Security & Multi-Tenancy Invariants

1. **Authentication Boundary**:
   - Agent endpoints accept only valid `Bearer <installationId>.<secret>` credentials issued during registration.
   - Any revoked installation receives immediate `401 Unauthorized` / `403 Forbidden`.
2. **Tenant Scoping & IDOR Prevention**:
   - All customer routes enforce `req.user.allowedCompanyIds`.
   - Access attempts across enterprise/company boundaries return `404 Not Found` (never leaking existence of other tenants' installations).
3. **In-Memory Rate Limiting**:
   - Pings and summaries are rate-limited per installation (`10 req / min`) to protect against misconfigured or runaway endpoints.

---

## 6. Verification Results

| Test Target | Command / Path | Count | Result |
| :--- | :--- | :--- | :--- |
| **API Unit Tests** | `npm run test` (in `apps/api`) | 35 tests | **ALL PASSED** |
| **Full API E2E Suite** | `npm run test:e2e` (in `apps/api`) | 10 suites / 131 tests | **ALL PASSED** |
| **Real E2E Integration** | `verify_telemetry_e2e.py` | 13 assertions | **ALL PASSED** |
| **Customer Portal Build** | `next build` (in `apps/customer-portal`) | 14 routes | **COMPILED (0 errors)** |
| **Vendor Portal Build** | `next build` (in `apps/trustfabric-admin`) | 14 routes | **COMPILED (0 errors)** |

---

## 7. Notes for Kavyansh (Backend Maintainer)

1. **Database Migration**:
   - The Prisma migration `20260921160800_add_fleet_telemetry` is non-destructive and adds columns with defaults (`telemetryEnabled: true`, `syncFullPaths: false`). Safe to run via `npx prisma migrate deploy` in staging and production.
2. **Scheduled Pruning**:
   - `AgentTelemetryService` includes `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` tasks for pruning `ServiceStatusEvent` (> 30 days) and `EnforcementWindow` (> 180 days). Ensure `@nestjs/schedule` remains imported in `AppModule`.
3. **Derived Status vs Server Clock**:
   - `deriveTelemetryStatus()` deliberately relies on `serverTime` (recorded by PostgreSQL) rather than client-reported clock timestamps, completely immune to skewed endpoint RTC clocks.
4. **Git Safety**:
   - All work is committed locally on branch `feature/dspm-telemetry`. No commits were pushed to remote origins.

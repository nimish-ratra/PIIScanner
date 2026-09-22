# Comprehensive Comparison & Audit Report: TrustFabric Licensing Platform

**Upstream Repository:** [https://github.com/Kavyansh786/licensing-software-](https://github.com/Kavyansh786/licensing-software-)  
**Base Commit:** `228ea5f` (*"Initial commit: enterprise licensing platform"*)  
**Current Active Branch:** `feature/dspm-telemetry` (Integrated with PII Sentinel / ClAIssify)  
**Date:** September 22, 2026  

---

## 1. Executive Summary of Changes

The original `Kavyansh786/licensing-software-` repository provided an enterprise licensing and entitlement management platform (NestJS API + PostgreSQL/Prisma + Next.js Customer Portal + Next.js Vendor Admin Portal). However, it lacked:
1. **Fleet Telemetry & Data Security Posture Management (DSPM):** There was no mechanism to monitor endpoint security health, document scan statistics, sensitive PII counts, or DLP enforcement events.
2. **Multi-Device / LAN Network Access:** The backend API and Next.js portals were hard-coded to `localhost` / `127.0.0.1`, which prevented multi-laptop network testing over Wi-Fi or Mobile Hotspots.
3. **React 19 / Next.js Hydration & Form Compatibility:** The login pages used `React.use(searchParams)` on plain objects, breaking client-side hydration in Next.js 15+ and triggering unauthenticated browser GET query-string submissions.
4. **Proxy Route Normalization:** The client API abstraction did not handle route prefix duplication, causing 404 "Resource not found" errors when components requested routes like `/customer/telemetry/installations`.
5. **Air-Gap Privacy Safeguards:** No protocol existed for endpoints to report coarse metadata while guaranteeing zero PII leakage.

Our enhanced repository adds a complete **DSPM Fleet Protection & Telemetry subsystem**, fixes network routing for multi-laptop demonstrations, hardens authentication and form hydration, and introduces real-time policy and command dispatching.

---

## 2. File-by-File Detailed Change Breakdown

| Category | File Path | Status | Summary of Modifications |
| :--- | :--- | :--- | :--- |
| **Database** | `apps/api/prisma/schema.prisma` | **Modified** | Added 4 new models (`CompanyTelemetryConfig`, `InstallationScanSummary`, `InstallationEnforcementEvent`, `InstallationProtectionCommand`), 1 new enum (`TelemetryStatus`), and relations on `Company` and `Installation`. |
| **Database** | `apps/api/prisma/migrations/20260921160800_add_fleet_telemetry/migration.sql` | **New** | SQL migration script creating telemetry tables, indexes, and foreign keys. |
| **API Module** | `apps/api/src/agent-telemetry/agent-telemetry.module.ts` | **New** | NestJS module registering controllers, services, and Prisma providers for fleet telemetry. |
| **API Service** | `apps/api/src/agent-telemetry/agent-telemetry.service.ts` | **New** | Core business logic: privacy validation, scan rollup calculation, command queueing, and health evaluation. |
| **API Controller** | `apps/api/src/agent-telemetry/agent-telemetry.controller.ts` | **New** | Agent-facing endpoints: `POST /agent/telemetry/ping`, `/scan-summary`, `/enforcement-events`, and `/commands/:id/ack`. |
| **API Controller** | `apps/api/src/agent-telemetry/customer-telemetry.controller.ts` | **New** | Customer Portal endpoints: `GET /customer/telemetry/summary`, `/installations`, `/scans`, `/enforcements`, and `POST .../command`. |
| **API Controller** | `apps/api/src/agent-telemetry/vendor-telemetry.controller.ts` | **New** | Vendor Admin endpoints: `GET /vendor/telemetry/summary`, `/installations` for cross-enterprise global monitoring. |
| **API DTOs** | `apps/api/src/agent-telemetry/agent-telemetry.dto.ts` | **New** | Strict validation DTOs with Pydantic/class-validator rules enforcing privacy bounds. |
| **API Utilities** | `apps/api/src/agent-telemetry/derive-telemetry-status.util.ts` | **New** | Deterministic state machine deriving `HEALTHY`, `STALE`, `DEGRADED`, or `OFFLINE` status. |
| **API Constants** | `apps/api/src/agent-telemetry/agent-telemetry.constants.ts` | **New** | Defines timeout thresholds, intervals, and data-retention constants. |
| **API Core** | `apps/api/src/app.module.ts` | **Modified** | Imported and wired `AgentTelemetryModule` into root application. |
| **API Server** | `apps/api/src/main.ts` | **Modified** | Bound server to `0.0.0.0` instead of `localhost` to allow LAN/hotspot requests; updated CORS policy. |
| **API Auth** | `apps/api/src/auth/auth.guard.ts` | **Modified** | Added `telemetry.read` and `telemetry.manage` permissions to RBAC role mappings. |
| **API Companies**| `apps/api/src/companies/companies.controller.ts` | **Modified** | Added endpoints to read and update company telemetry policies. |
| **API Companies**| `apps/api/src/companies/companies.service.ts` | **Modified** | Added database operations for `CompanyTelemetryConfig` initialization and updates. |
| **API Deps** | `apps/api/package.json` & `package-lock.json` | **Modified** | Added dependencies for telemetry validation and testing. |
| **Customer Portal** | `apps/customer-portal/next.config.ts` | **Modified** | Added `allowedDevOrigins` (`10.197.56.244`, etc.) for cross-laptop dev server support. |
| **Customer Portal** | `apps/customer-portal/src/lib/api-client.ts` | **Modified** | Added self-healing endpoint normalization to prevent double-prefixed (`/customer/customer/...`) 404 errors. |
| **Customer Portal** | `apps/customer-portal/src/lib/types.ts` | **Modified** | Added TypeScript interfaces for telemetry summaries, scan metrics, and commands. |
| **Customer Portal** | `apps/customer-portal/src/app/login/page.tsx` | **Modified** | Fixed React 19 hydration bug (`useSearchParams` in `<Suspense>`), disabled native HTML GET submissions. |
| **Customer Portal** | `apps/customer-portal/src/components/providers/auth-provider.tsx` | **Modified** | Bypassed authentication check on `/login` to prevent recursive redirect loops. |
| **Customer Portal** | `apps/customer-portal/src/middleware.ts` | **Modified** | Hardened session verification for LAN requests. |
| **Customer Portal** | `apps/customer-portal/src/components/layout/sidebar.tsx` | **Modified** | Added "Fleet Protection" navigation item with shield icon. |
| **Customer Portal** | `apps/customer-portal/src/app/telemetry/page.tsx` | **New** | Dedicated DSPM Fleet Protection dashboard (health metrics, severity charts, device table). |
| **Customer Portal** | `apps/customer-portal/src/app/overview/page.tsx` | **Modified** | Integrated live fleet protection KPIs into main overview. |
| **Customer Portal** | `apps/customer-portal/src/app/settings/page.tsx` | **Modified** | Added Telemetry Policy tab to configure reporting intervals, path privacy, and severity thresholds. |
| **Customer Portal** | `apps/customer-portal/src/app/installations/installation-details-dialog.tsx` | **Modified** | Integrated Protection tab into device inspection dialog. |
| **Customer Portal** | `apps/customer-portal/src/app/installations/installation-protection-tab.tsx` | **New** | Component showing device-level scan rollups and real-time DLP enforcement logs. |
| **Customer Portal** | `apps/customer-portal/src/app/installations/telemetry-status.ts` | **New** | Helper utilities for status pill badges and formatting. |
| **Customer Portal** | `apps/customer-portal/src/app/audit/page.tsx` | **Modified** | Added event formatting for telemetry and policy actions. |
| **Admin Portal** | `apps/trustfabric-admin/next.config.ts` | **Modified** | Added `allowedDevOrigins` for LAN IP testing. |
| **Admin Portal** | `apps/trustfabric-admin/src/lib/api-client.ts` | **Modified** | Added endpoint route normalization to strip redundant `/vendor/` prefixes. |
| **Admin Portal** | `apps/trustfabric-admin/src/app/login/page.tsx` | **Modified** | Fixed React 19 hydration and native GET submission issues. |
| **Admin Portal** | `apps/trustfabric-admin/src/components/providers/auth-provider.tsx` | **Modified** | Bypassed session check on `/login`. |
| **Admin Portal** | `apps/trustfabric-admin/src/components/layout/sidebar.tsx` | **Modified** | Added "Fleet Health" sidebar navigation link. |
| **Admin Portal** | `apps/trustfabric-admin/src/app/fleet-health/page.tsx` | **New** | Global multi-tenant fleet health dashboard for vendor administrators. |
| **Documentation** | `docs/telemetry-model.md` | **New** | Complete specification of telemetry domain models and zero-PII privacy guarantee. |
| **Documentation** | `docs/agent-protocol.md` | **Modified** | Added telemetry protocol specification and payloads. |
| **Documentation** | `docs/architecture.md` & `docs/rbac.md` | **Modified** | Updated architecture and RBAC diagrams for telemetry roles. |
| **Documentation** | `TELEMETRY_HANDOFF.md` | **New** | Developer handoff document explaining telemetry design decisions and verify scripts. |
| **Unit/E2E Tests** | `apps/api/test/*.spec.ts` & `apps/customer-portal/e2e/telemetry.spec.ts` | **New** | 4 new test suites covering DTO validation, service logic, state machines, and portal UI. |

---

## 3. Deep Dive into Major Subsystems

### 3.1 Fleet Telemetry & DSPM Data Model (Prisma & PostgreSQL)
In the original repository, the backend only tracked licenses, allocations, and installations (`Installation.id`, `deviceId`, `hostname`). It had no visibility into what was happening on the machines.

We added:
1. **`CompanyTelemetryConfig`**:
   - `telemetryEnabled`: Boolean master toggle.
   - `syncFullPaths`: Determines whether file paths are sent as salted hashes or literal paths.
   - `scanSummaryIntervalMinutes`: Frequency of summary updates (default: 60 min).
   - `minSeverityReported`: Filters out low-severity findings from transmission.
2. **`InstallationScanSummary`**:
   - Captures scan run aggregates: `totalFilesScanned`, `filesWithPiiCount`, `totalFindingsCount`.
   - Stores JSON breakdown: `findingsByTier` (`Restricted`, `Highly Confidential`, etc.) and `findingsByType` (`AADHAAR`, `PAN`, `EMAIL`, etc.).
   - Stores performance data: `durationMs`, `scannedBytes`, `scanType` (`DIRECTORY` vs `FULL_SYSTEM`).
3. **`InstallationEnforcementEvent`**:
   - Captures real-time DLP blocks and quarantines: `actionTaken` (`BLOCK`, `QUARANTINE`, `WARN`), `sensitivityTier`, `sourceType` (`OFFICE_ADDIN`, `FILE_WATCHER`), and timestamp.
4. **`InstallationProtectionCommand`**:
   - Allows administrators to queue remote instructions for the endpoint (`FORCE_SCAN`, `UPDATE_POLICY`, `PURGE_CACHE`).
   - Tracks lifecycle: `PENDING` $\rightarrow$ `DISPATCHED` $\rightarrow$ `EXECUTED` / `FAILED`.

---

### 3.2 Endpoint Route Normalization in `apiClient`
In the original repository:
- In `apps/customer-portal`, `API_BASE` was set to `/api/v1/customer`.
- In `apps/trustfabric-admin`, `API_BASE` was set to `/api/v1/vendor`.

When front-end pages or hooks called routes formatted as `/customer/telemetry/installations` (or `/vendor/customers`), the client constructed:
`http://<host>:3000/api/v1/customer/customer/telemetry/installations`
This produced HTTP 404 "Resource not found" errors on pages like Fleet Protection.

**Our Fix:**
Added an automatic prefix-stripping layer in `apiClient`:
```typescript
const normalizedEndpoint = endpoint.startsWith('/customer/')
  ? endpoint.slice('/customer'.length)
  : endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
```
This guarantees that regardless of whether a developer writes `/telemetry` or `/customer/telemetry`, the request reliably reaches `/api/v1/customer/telemetry`.

---

### 3.3 Multi-Laptop LAN & Mobile Hotspot Networking
The original repository was configured exclusively for local development on a single laptop (`localhost`):
1. **Host Binding (`main.ts`):** `app.listen(port)` bound to loopback only (`127.0.0.1`), rejecting connections from outside IP addresses. We updated `main.ts` to `app.listen(port, '0.0.0.0')`.
2. **Dev Server Origin Checks (`next.config.ts`):** Next.js 15+ dev servers block cross-origin WebSocket and asset requests when accessed via a LAN IP (e.g., `10.197.56.244:3000`). We added `allowedDevOrigins: ['10.197.56.244', '10.197.56.199', 'localhost:3000', '127.0.0.1:3000']`.
3. **Same-Origin Cookie Rewriting:** Browsers block unencrypted HTTP third-party cookies when calling port 3001 directly from port 3000 over LAN. We verified that all browser calls go through Next.js rewrites (`/api/v1/:path*` $\rightarrow$ `http://127.0.0.1:3001/api/v1/:path*`), allowing the `TF_SESSION` cookie to remain strictly first-party.

---

### 3.4 React 19 / Next.js Hydration & Form Submission Hardening
In the original repository's `login/page.tsx`:
- The component accessed search parameters using `React.use(searchParams)`.
- Under Next.js with React 19, this threw a hydration boundary mismatch when query parameters were not wrapped in `<Suspense>`.
- As a consequence, the React `onSubmit` handler failed to attach, causing the browser to fall back to a native HTML GET form submission:
  `/login?email=india-admin%40acme.test&password=DevPassword%21123`
  This appended passwords to the browser URL history and never invoked `apiClient`.

**Our Fix:**
1. Wrapped search parameter extraction inside `useSearchParams()` within a `<Suspense>` boundary.
2. Added `action="javascript:void(0);"` and `method="POST"` on the form.
3. Changed the submit button to `type="button"` with `onClick={handleSubmit}`.
4. Added direct DOM element fallback (`document.getElementById('email')`) to reliably capture credentials regardless of browser autofill timing.
5. Updated `auth-provider.tsx` to immediately render the login form without waiting for session validation.

---

### 3.5 Customer Portal "Fleet Protection" & Admin "Fleet Health" UI
The original repository had no user interface for monitoring endpoint security status.

We introduced:
1. **Fleet Protection Page (`apps/customer-portal/src/app/telemetry/page.tsx`):**
   - KPI Cards: Total Active Devices, Devices with PII, Protection Coverage %, Offline Devices.
   - Interactive Sensitivity Tier breakdown bar visualizing distribution of `Restricted`, `Highly Confidential`, and `Confidential` data across the fleet.
   - Comprehensive Device Table with real-time health badges (`HEALTHY`, `STALE`, `DEGRADED`, `OFFLINE`), operating system, employee email, last check-in, and total findings.
2. **Device Protection Modal Tab (`installation-protection-tab.tsx`):**
   - Enables administrators to inspect an individual laptop's scan history and DLP enforcement events directly from the Installations table.
3. **Settings Telemetry Policy Tab (`apps/customer-portal/src/app/settings/page.tsx`):**
   - Allows administrators to configure sync frequency, minimum severity threshold, and path obfuscation.
4. **Vendor Admin Fleet Health (`apps/trustfabric-admin/src/app/fleet-health/page.tsx`):**
   - Multi-tenant global fleet overview for vendor support teams.

---

## 4. Summary Table: Original vs. Our Enhanced Repo

| Dimension | Original Repository (`Kavyansh786/licensing-software-`) | Our Enhanced Repository |
| :--- | :--- | :--- |
| **Licensing Lifecycle** | Entitlements, Allocations, Activations, Tokens | Preserved 100% with full backward compatibility |
| **Fleet Monitoring** | None | Full DSPM Fleet Protection with health rollups |
| **Document Scan Visibility** | None | Aggregated counts by sensitivity tier and PII type |
| **DLP Enforcement Logs** | None | Captures Office Add-in blocks and Watcher quarantines |
| **Multi-Laptop Network Demo** | Broken (`127.0.0.1` binding, HMR blocks, CORS) | Fixed (`0.0.0.0`, `allowedDevOrigins`, First-Party Cookies) |
| **Login Form Reliability** | React 19 hydration mismatch; exposed credentials in GET URLs | Hardened with `<Suspense>`, DOM fallback, and POST enforcement |
| **API Client Prefix Handling** | Threw 404 on redundant `/customer/` paths | Automatic self-healing normalization |
| **Admin Fleet Control** | None | Remote command dispatch (`FORCE_SCAN`, `UPDATE_POLICY`) |
| **Privacy Safeguards** | N/A | Air-gap privacy firewall: zero file contents or PII transmitted |

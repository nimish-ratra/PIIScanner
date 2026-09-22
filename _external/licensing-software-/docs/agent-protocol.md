# Agent Protocol

## Model: Hybrid Online/Offline

The customer-facing software (e.g. PII Sentinel) is built air-gapped and local-first for its core scanning function — no scanned content ever leaves the device. Licensing is the one deliberate exception to that rule: the agent embedded in the software calls out to this API on a schedule to activate, heartbeat, and receive suspension/revocation policy.

To stay compatible with genuinely air-gapped or intermittently-connected customer sites, the agent is **offline-tolerant**: it caches the last policy response locally and keeps enforcing it for a bounded grace period if the backend is unreachable. This trades instant revocation for availability — see [Security](#security) for the tradeoff this implies.

## Interaction Model

The agent initiates all communication via HTTPS outbound. The backend never initiates connections to an agent.

## Identity & Credential Model

There is no separate "Device" entity — device attributes live directly on `Installation` (`deviceId`, `hostname`, `os`, `osVersion`, `architecture`).

1. **Enrollment token** — A Company Admin or Enterprise Admin issues an `EnrollmentToken` scoped to one `LicenseAllocation` (`POST /api/v1/customer/companies/:companyId/enrollment-tokens`, permission `installation.enroll`). The plaintext token is returned exactly once; only its sha256 hash is stored. It carries `maxActivations` (default 1) and `expiresAt` (default 30 days), and can be revoked early. An `EnrollmentToken` may also carry an `activationId` — see [docs/activation-domain.md](./activation-domain.md) for the approval-driven, named-employee flow that mints these; a token with no `activationId` follows the plain flow described here.
2. **Registration** — The agent redeems the enrollment token once (`POST /api/v1/agent/register`) to create its `Installation` and receive a per-installation credential: `installationId.secret`, again shown once and stored server-side only as a hash. Compromise of one installation's credential can only ever affect that one seat — it grants no access to any other installation, company, or the enrollment token itself. When the token is activation-bound, registration also deterministically links the `Installation` to that exact `Activation` — never by guessing which pending Activation "must" be the right one.
3. **Ongoing calls** authenticate with `Authorization: Bearer <installationId>.<secret>` against `AgentAuthGuard`, which is applied per-route rather than through the global session-based `AuthGuard`/`TenantGuard`/`PermissionsGuard` pipeline (agent principals are never Users).

## Seat Consumption Model

Seat accounting happens at two levels, both using the same optimistic-concurrency pattern:

- `Entitlement.allocatedQuantity` / `.version` — how much of the vendor's grant has been sub-allocated to companies (existing, unchanged).
- `LicenseAllocation.consumedQuantity` / `.version` — how many of a company's allocated seats are currently held by non-`REVOKED` Installations. Incremented on `/agent/register`, decremented on release/revoke.

A registration is only accepted while `consumedQuantity < quantity` on the allocation, enforced via the same read-version → conditional-update → `ConflictException`-on-zero-rows pattern used by `EntitlementsService.allocate()`.

## Endpoints

All under `/api/v1/agent`, unauthenticated at the global guard level (`@Public()`) and authenticated instead by `AgentAuthGuard` where noted.

### `POST /agent/register` (enrollment token, not an installation credential)
Body: `{ enrollmentToken, deviceId, hostname?, os?, osVersion?, architecture?, applicationVersion?, agentVersion? }`
Validates the token (not revoked, not expired, activations remaining), atomically consumes one seat from its allocation, creates the `Installation` in `ACTIVE` status, and returns:
```json
{
  "installationId": "...",
  "credential": "<installationId>.<secret>",
  "companyId": "...",
  "status": "ACTIVE",
  "heartbeatIntervalSeconds": 86400,
  "gracePeriodDays": 14
}
```
The agent must persist `credential` locally (e.g. alongside its other local state) — it is never recoverable from the server again.

### `POST /agent/heartbeat` (`AgentAuthGuard`)
Body: `{ agentVersion?, applicationVersion? }`. Updates `lastHeartbeatAt`, reactivates an `INACTIVE` installation to `ACTIVE`, and returns the same policy shape as below. Rejects with 403 if the installation is `REVOKED` (in practice this never happens — a revoked installation fails auth before reaching the handler).

### `GET /agent/policy` (`AgentAuthGuard`)
Read-only fetch of the current policy without touching `lastHeartbeatAt`. Response:
```json
{
  "installationId": "...",
  "status": "ACTIVE | SUSPENDED | INACTIVE | REVOKED",
  "suspended": false,
  "revoked": false,
  "heartbeatIntervalSeconds": 86400,
  "gracePeriodDays": 14,
  "serverTime": "..."
}
```

### `POST /agent/release` (`AgentAuthGuard`)
Self-release — the agent gives up its own seat (e.g. on uninstall). Sets the installation to `REVOKED`, frees the seat back to the allocation (`consumedQuantity` decrement), and is idempotent if already revoked.

---

## Agent Telemetry Protocol

All endpoints reside under `/api/v1/agent/telemetry` and authenticate via `AgentAuthGuard` (`Bearer <installationId>.<secret>`). See [docs/telemetry-model.md](./telemetry-model.md) for domain architecture and privacy guarantees.

### `POST /agent/telemetry/ping`
Default cadence: every 180s (configurable 60s–900s). Reports operational heartbeats and returns queued commands.
Request:
```json
{
  "clientTime": "2026-09-21T12:00:00.000Z",
  "serviceRunning": true,
  "watcherActive": true,
  "serviceStartedAt": "2026-09-21T10:00:00.000Z",
  "policyHash": "1a2b3c4d5e6f",
  "agentVersion": "1.0.0",
  "applicationVersion": "1.0.0",
  "outboxDepth": 0
}
```
Response:
```json
{
  "serverTime": "2026-09-21T12:00:00.123Z",
  "installationStatus": "ACTIVE",
  "telemetry": {
    "enabled": true,
    "intervalSeconds": 180,
    "syncFullPaths": false
  },
  "commands": [
    {
      "id": "uuid-v4",
      "type": "force_policy_refresh",
      "issuedAt": "2026-09-21T11:55:00.000Z",
      "expiresAt": "2026-09-22T11:55:00.000Z"
    }
  ]
}
```

### `POST /agent/telemetry/scan-summary`
Idempotent per `(installationId, clientScanId)`. Ingests scan metrics and capped per-file findings.
Request:
```json
{
  "clientScanId": "uuid-v4",
  "scanSource": "directory_scan",
  "targetSummary": "C:, D:",
  "startedAt": "2026-09-21T11:00:00.000Z",
  "completedAt": "2026-09-21T11:05:00.000Z",
  "status": "completed",
  "durationSeconds": 300,
  "filesScanned": 1250,
  "filesWithPii": 15,
  "totalFindings": 42,
  "highestTier": "Confidential",
  "tierCounts": { "Confidential": 10, "General": 32 },
  "entityTypeTotals": { "EMAIL_ADDRESS": 20, "CREDIT_CARD_NUMBER": 22 },
  "files": [
    {
      "pathRef": "sha256:abcd...",
      "tier": "Confidential",
      "entityTypeCounts": { "CREDIT_CARD_NUMBER": 2 },
      "watermarkStatus": "APPLIED"
    }
  ],
  "filesTruncated": false
}
```

### `POST /agent/telemetry/enforcement-summary`
Idempotent per `(installationId, windowStart, source)`. Ingests 15-minute UTC-aligned DLP event windows.
Request:
```json
{
  "windows": [
    {
      "windowStart": "2026-09-21T11:45:00.000Z",
      "windowEnd": "2026-09-21T12:00:00.000Z",
      "source": "Filesystem Watcher",
      "actionCounts": { "block": 1, "quarantine": 0, "override": 1, "allow": 20 },
      "tierCounts": { "Restricted": 1 },
      "overrideCount": 1
    }
  ]
}
```

### `POST /agent/telemetry/command-ack`
Acknowledges execution of an administrative command.
Request:
```json
{
  "commandId": "uuid-v4",
  "result": "success",
  "detail": "Optional diagnostics snapshot or failure message"
}
```

## Admin-Driven Lifecycle (separate from the agent's own calls)

A Company/Enterprise Admin can act on a single installation directly, independent of the agent:
- `POST /api/v1/customer/installations/:id/suspend` — permission `installation.manage`
- `POST /api/v1/customer/installations/:id/unsuspend`
- `POST /api/v1/customer/installations/:id/revoke` — also frees the seat

This is how "revoke a specific employee's installation" (docs/customer-workflow.md) is implemented, distinct from `/agent/release` which is agent-initiated.

## Grace Period Behavior (client-side, agent responsibility)

The agent should:
1. Call `/agent/heartbeat` (or `/agent/policy`) roughly every `heartbeatIntervalSeconds`.
2. On success, cache the returned policy with a timestamp.
3. If the call fails (network/offline), keep enforcing the last cached policy for up to `gracePeriodDays`.
4. If the grace period elapses without a successful check-in, the agent must stop functioning until it can reach the backend again.
5. If a cached policy says `suspended: true` or `revoked: true`, honor it immediately regardless of grace period — grace period only covers *unreachability*, not a known-bad state.

## Security

- The agent uses a rotating-in-principle, per-installation secret (`installationId.secret`), hashed at rest, compared with a timing-safe check.
- The agent cannot create, allocate, or approve licenses. Its role is purely consumption, heartbeat, and self-release.
- Compromise of the agent (or its credential) can only ever impact that specific installation's single seat — never the owning company, enterprise, or any other installation. It cannot forge another installation's credential, and it cannot mint new enrollment tokens.
- Revocation is not instant for an agent that's offline at the moment of revocation — it takes effect the next time that agent successfully checks in, bounded by `gracePeriodDays`. Shorten `GRACE_PERIOD_DAYS` (`apps/api/src/agent/agent.constants.ts`) to trade availability for faster enforcement, e.g. for a compliance-driven kill-switch requirement.

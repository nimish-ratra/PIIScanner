# Installation Model

## Concept
An Installation represents a physical or virtual machine where the software is deployed and consuming a seat from a `LicenseAllocation`. It is created by redeeming an `EnrollmentToken` via `POST /api/v1/agent/register` — see [Agent Protocol](./agent-protocol.md) for the full activation/heartbeat/revocation contract.

## Tracking Attributes
- `id`: Unique identifier (UUID), also the credential's key half (`installationId.secret`).
- `allocationId`: The `LicenseAllocation` this installation draws its seat from.
- `enrollmentTokenId`: Which enrollment token was redeemed to create it (audit trail).
- `companyId`: The owning company.
- `deviceId`: Hardware/OS identifier, captured directly on the record — there is no separate Device entity.
- `hostname`, `os`, `osVersion`, `architecture`: Device telemetry, self-reported at registration.
- `applicationVersion`, `agentVersion`: Software versions, refreshed on every heartbeat.
- `credentialHash`, `credentialRotatedAt`: The hashed per-installation agent secret. Plaintext exists only in the one `/agent/register` response.
- `status`: `PENDING`, `ACTIVE`, `INACTIVE`, `SUSPENDED`, `REVOKED`.
- `lastHeartbeatAt`: Timestamp of the last successful heartbeat.
- `releasedAt`: Set when the seat is freed back to the allocation (self-release via `/agent/release`, or admin revoke).

## Heartbeat Mechanism
The Installation record is kept alive by periodic heartbeats from the agent (`POST /agent/heartbeat`, default every 24h — see `apps/api/src/agent/agent.constants.ts`).
If `lastHeartbeatAt` exceeds a threshold, the status should transition to `INACTIVE`. This detection logic is not yet implemented server-side (it should be evaluated asynchronously, e.g. via BullMQ cron jobs, rather than relying on UI renders) — currently `INACTIVE` is only ever cleared back to `ACTIVE` by the agent's own next heartbeat, never set.

## Suspend vs. Revoke
`SUSPENDED` and `REVOKED` are both reachable two ways:
- **Admin-driven**, on a single installation directly: `POST /customer/installations/:id/{suspend,unsuspend,revoke}` (permission `installation.manage`).
- **Agent-driven** self-release only reaches `REVOKED`, via `POST /agent/release` (e.g. on uninstall).

Only `REVOKED` frees the seat back to the allocation's `consumedQuantity`. A revoked installation's credential is rejected outright by `AgentAuthGuard` — there is nothing left for it to authenticate to.

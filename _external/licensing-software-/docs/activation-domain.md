# Activation Domain

## Responsibility split: who does what

**Approval ≠ Activation. Activation ≠ Installation.** These are three distinct events, owned by three distinct actors, and the product must never blur them together:

```
Customer Admin
    ↓
Approve License Request
    ↓
Trustfabric Licensing Backend
    ↓
Activation Created
    ↓
Activation-bound Enrollment
    ↓
Windows Agent
    ↓
Installation
    ↓
Heartbeat / Validation
```

| Actor | Owns |
|---|---|
| **Customer Admin** | Reviews and approves (or rejects) a `LicenseRequest`. This is a statement that "this employee is approved to receive a license" — nothing more. There is no customer-facing "Activate" action for normal issuance, and no `POST /customer/activations` endpoint exists for a customer to manually create one. |
| **Trustfabric licensing backend** | Validates the approved request and, when it names one employee (`targetUserId`), issues the `Activation` and mints its activation-bound enrollment token — automatically, as a side effect of approval, inside the same transaction. This is the Trustfabric licensing system's own decision, not something the customer performs. |
| **Windows Agent / Employee** | Redeems the activation-bound enrollment authorization to register an `Installation`, which the backend links deterministically to that exact `Activation`. |

This split is enforced, not just documented: `LicenseRequestsService.approve()` is a Customer Admin action, audited as `APPROVE_LICENSE_REQUEST` with that admin as the actor; `ActivationsService.createFromApprovedRequest()` (called from inside that same method) is audited separately as `CREATE_ACTIVATION` with `actorType: 'SYSTEM'` — never attributed to the approving admin, even though their approval triggered it.

## What Activation is (and isn't)

`Activation` is a first-class domain object sitting between **Approval** and **Installation** in the licensing chain:

```
Product → Edition → Entitlement → LicenseAllocation → LicenseRequest → Approval
                                                                          ↓
                                                                      Activation
                                                                          ↓
                                                            Activation-bound Enrollment
                                                                          ↓
                                                                     Installation
                                                                          ↓
                                                          Consumption / Validation / Heartbeat
```

| Concept | Meaning |
|---|---|
| **LicenseRequest** | A request for licensing access — either a company asking for more seat *capacity* (no named individual, `targetUserId: null`), or a request naming exactly one employee (`targetUserId` set, `quantity` must be 1). |
| **Approval** | The management decision that a `LicenseRequest` is authorized (`LicenseRequest.status = APPROVED`). |
| **Activation** | The actual license right issued to one named employee (`Activation.userId`), created as a side effect of approving a `targetUserId` request. It is not a machine and not a renamed `Installation` — it can exist with `installationId: null` (issued but not yet installed anywhere). |
| **Installation** | The concrete machine/runtime instance actually running the software, created when the agent redeems an enrollment token. |
| **Consumption** | Seat usage tracked on `LicenseAllocation.consumedQuantity`. |
| **Heartbeat/Validation** | The agent's periodic check-in; the backend combines `Installation` and `Activation` state to decide whether access is currently allowed. |

## `requestedBy` vs `targetUserId`

`LicenseRequest.requestedBy` is who *filed* the request — an admin acting on someone's behalf, or an employee self-requesting. `LicenseRequest.targetUserId` is the employee who will actually *receive* the license. These are deliberately separate fields: `Activation.userId` is always copied from `targetUserId`, never from `requestedBy`. A request with no `targetUserId` is pure capacity provisioning (any `quantity`) and never produces an `Activation` — this preserves the original `LicenseRequest` behavior exactly for that case. A request with `targetUserId` set must have `quantity === 1` — there is no ambiguity to resolve about which seat of a multi-seat request would belong to the named employee.

## Seat consumption — the single authoritative point

Two distinct, pre-existing counters are involved, each still touched at exactly one point:

- **`Entitlement.allocatedQuantity`** — incremented by `LicensesService.allocate()` when any request is approved (capacity sub-allocated to a company). Unchanged by this feature.
- **`LicenseAllocation.consumedQuantity`** — previously incremented only when an `Installation` registered. This feature extends that meaning: it is now **also** incremented at **Activation creation** (approval time, via the same OCC idiom used everywhere else in this codebase: read `version` → validate → `updateMany({ where: { id, version }, ... })` → `ConflictException` if `count === 0`). Creating the `Activation` is the seat's single authoritative consumption point for this flow — linking an `Installation` to it later does **not** increment it again.

The **legacy** `EnrollmentToken → AgentService.register()` path (no `LicenseRequest` involved — an IT admin hands out a token directly) is completely unaffected and still consumes at registration time, exactly as before. These are two structurally separate provisioning paths, not two mechanisms for the same seat.

## Activation-bound enrollment (not a heuristic)

An earlier draft of this design considered "find the one `PENDING` Activation for this allocation and link it" at registration time. That was rejected as unacceptable for production — it's a guess, not a determination. Instead, `EnrollmentToken` gained a nullable `activationId` column. When an `Activation` is created, a bound `EnrollmentToken` is minted in the same transaction (`activationId` set, `maxActivations: 1`), reusing 100% of the existing token machinery (hashed at rest, expiring, single-use, revocable). `AgentService.register()` branches on whether the redeemed token has `activationId` set:

- **Set** → the exact `Activation` is loaded by that id, validated (`status IN (PENDING, DEACTIVATED)`, company match), and linked deterministically. No seat is consumed here (already done at Activation creation).
- **Null** → byte-for-byte identical legacy behavior; no `Activation` involved.

A dedicated e2e test (`activations.e2e-spec.ts`, test 6) proves this determinism directly: with two simultaneously-`PENDING` Activations sharing the same `LicenseAllocation`, registering with one's bound token links only that one and leaves the other completely untouched.

## Lifecycle

```
PENDING     → ACTIVE, REVOKED
ACTIVE      → SUSPENDED, DEACTIVATED, REVOKED, EXPIRED
SUSPENDED   → ACTIVE, REVOKED, DEACTIVATED
DEACTIVATED → ACTIVE, REVOKED
REVOKED     → terminal
EXPIRED     → terminal
```

`EXPIRED` is evaluated authoritatively at read/heartbeat time by comparing `Activation.expiresAt` to the server clock — no background scheduler, matching how `EnrollmentToken.expiresAt` is already checked inline elsewhere in this codebase.

**`DEACTIVATED` is not `REVOKED`.** `DEACTIVATED` means "this license right still exists, but is not currently linked to any machine" — the seat stays reserved. `REVOKED` means the right has been explicitly withdrawn, and is the only transition that frees the seat (`consumedQuantity: decrement`, guarded against being applied twice on retry).

## Device replacement

Two FK fields, serving different purposes, avoid needing to invent a new "replace this installation" concept:

- **`Installation.activationId`** (not unique) — immutable provenance: which `Activation`, if any, caused this `Installation` to be created. Never changes after creation. Multiple sequential installations (an employee replacing their laptop three times) can all carry the same value.
- **`Activation.installationId`** (unique, nullable) — the current *live* link. Cleared when that installation is revoked/released, set again once a replacement device registers.

When an `Installation` with a non-null `activationId` is revoked (admin-driven `POST /customer/installations/:id/revoke`, or the agent's own self-release `/agent/release`), the linked `Activation` moves `ACTIVE/SUSPENDED → DEACTIVATED` instead of the seat being freed. `POST /customer/activations/:id/reactivate-enrollment` then mints a fresh single-use bound `EnrollmentToken` for the same `Activation`; the replacement device's registration links it back to `ACTIVE` with **no additional seat consumption**. No duplicate `Activation` is ever created merely because an employee changed machines.

## API

```
GET  /customer/activations                          activation.read
GET  /customer/activations/:id                       activation.read
POST /customer/activations/:id/suspend               activation.manage
POST /customer/activations/:id/reactivate            activation.manage   (SUSPENDED -> ACTIVE)
POST /customer/activations/:id/revoke                activation.manage
POST /customer/activations/:id/reactivate-enrollment activation.manage   (DEACTIVATED -> mint replacement token)
```

There is no `POST /customer/activations` — creation is always a controlled side effect of `LicenseRequestsService.approve()`. The Agent API (`/agent/register`, `/agent/heartbeat`, `/agent/policy`, `/agent/release`) is unchanged in its request/response contract; Activation support is entirely internal to how `register()` and `buildPolicy()` behave.

## Security

- Tenant isolation follows the existing pattern exactly: 404 (not 403) on out-of-scope access, wildcard (`allowedCompanyIds.includes('*')`) principals still bounded by their own enterprise.
- Vendor sessions have no path to any `/customer/activations` route — `PermissionsGuard`'s existing principal-type isolation applies unchanged.
- Agent authentication (`AgentAuthGuard`, per-installation credential) remains entirely separate from customer/vendor sessions — Activation participates in the agent protocol only through the existing enrollment-token redemption and policy responses.
- No response from any Activation endpoint ever includes `credentialHash`, `credentialRotatedAt`, `passwordHash`, or a token's `tokenHash` — enrollment token plaintext is shown exactly once, at mint time, identical to the existing `EnrollmentTokensService` pattern.
- Every lifecycle change is audited: `CREATE_ACTIVATION`, `LINK_ACTIVATION_INSTALLATION`, `SUSPEND_ACTIVATION`, `REACTIVATE_ACTIVATION`, `REVOKE_ACTIVATION`, `DEACTIVATE_ACTIVATION`, `targetType: 'Activation'`.

## Migration / compatibility

This project uses `prisma db push` with no migration history (confirmed: no `prisma/migrations` directory). Adding `Activation`, `LicenseRequest.targetUserId`, `EnrollmentToken.activationId`, and `Installation.activationId` required no migration file.

- Every existing `LicenseRequest` row gets `targetUserId: null` — unaffected, remains pure capacity provisioning.
- Every existing `Installation`/`EnrollmentToken` row gets `activationId: null` — this is the **permanent, supported legacy state**, not a temporary gap to be backfilled. There is no reliable way to reconstruct which employee a historical installation was "for," and no backfill script exists or should be written for it.

## Customer Portal UI

The Customer Portal's License Requests page presents only "Approve"/"Reject" — never "Activate" — for exactly the reason described above. On a successful approval, the UI shows two separate facts rather than one collapsed "done" state: "Request Approved" (the Customer Admin's action) and, only when the backend actually issued one, a distinct "Activation Issued" panel naming the employee and status, with the one-time activation-bound enrollment code shown using the same one-time-secret discipline as every other credential in this app. A bulk capacity request's approval shows only "Request Approved," with an explicit note that no individual Activation was issued.

A dedicated **Activations** page (`/activations`) gives operational visibility into what the licensing backend has issued: employee, product, edition, status, activated/expires timestamps, and the linked installation (if any). Its description explicitly frames these as "issued by the Trustfabric licensing system," not customer-created. Suspend/reactivate/revoke remain available as lifecycle *management* actions (distinct from initial issuance), plus a "Generate Replacement Enrollment" action for a `DEACTIVATED` activation (device replacement), which mints a fresh bound token through the same one-time-display flow.

## Not built in this pass

An optional read-only Trustfabric Admin cross-customer Activation view has not been built — there is no vendor-side business requirement for it yet, and the plan explicitly avoids introducing unnecessary manual vendor steps into what is otherwise a fully automated Customer Approval → Backend Activation flow.

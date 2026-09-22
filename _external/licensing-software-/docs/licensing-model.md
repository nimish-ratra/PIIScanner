# Licensing Model

## Overview
The licensing architecture is designed to support both single-company and complex multi-company Enterprise customers through a clean, unified hierarchy.

## Terminology
1. **Entitlement**: The root commercial grant. Represents what the Enterprise purchased (e.g., 500 seats of Enterprise Security Suite).
2. **License Allocation**: A subset of the Entitlement distributed to a specific Company (e.g., Acme India gets 200 seats, Acme UK gets 150).
3. **License Request**: An internal workflow where users ask for seats from an Entitlement. Approval generates an Allocation.
4. **Enrollment Token**: A short-lived, limited-use credential a Company/Enterprise Admin issues against a specific Allocation, handed to an end-user device to authorize one activation. See [Agent Protocol](./agent-protocol.md).
5. **Activation / Installation**: A physical device consuming a single seat from a License Allocation, created by redeeming an Enrollment Token.

## Core Rules

### 1. Entitlement Capacity
The sum of all `LicenseAllocation.quantity` for a given `Entitlement` can **never** exceed the `Entitlement.quantity`.
This is strictly enforced at the database level using **Optimistic Concurrency Control (OCC)**. The Entitlement table has a `version` field. Any allocation transaction verifies this version and increments it atomically, rolling back on conflict.

The same pattern applies one level down: `LicenseAllocation.consumedQuantity` (seats actually held by live Installations) can never exceed `LicenseAllocation.quantity`, guarded by `LicenseAllocation.version`. Registering a new Installation (`POST /agent/register`) is the only thing that increments `consumedQuantity`; revoking one (admin action or agent self-release) decrements it.

### 2. State Machines
Entities transition through strict predefined states rather than accepting arbitrary PATCH updates.
- **License Request**: `PENDING` → `APPROVED` or `REJECTED` or `CANCELLED`.
- **License Allocation**: `CREATED` → `ALLOCATED` → `ACTIVE` ↔ `SUSPENDED` → `REVOKED` | `EXPIRED`.
- **Installation**: `PENDING` → `ACTIVE` ↔ `INACTIVE` / `SUSPENDED` → `REVOKED`. See [Agent Protocol](./agent-protocol.md).

### 3. Tenant Isolation
Even if an Enterprise has only one Company, the structural separation remains. All resources are explicitly bound to a `companyId` (except Entitlements which map to the `enterpriseId`).
A user's authentication context provides an `allowedCompanyIds` array, which the Domain Service uses as a strict bounding box for all `SELECT`, `UPDATE`, and `CREATE` operations. Direct resource queries check ownership and return `404 Not Found` if a tenant boundary is crossed (IDOR protection).

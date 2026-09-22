# Data Access Layer & Tenant Isolation

## Overview
Phase 2 establishes real database connectivity using PostgreSQL and Prisma. The architecture ensures that no component accidentally accesses data belonging to another tenant.

## Security Boundaries in the API
Authorization is layered to ensure deep defense:

1. **Authentication (Guard)**: Verifies the token and resolves Identity.
2. **Tenant Extraction**: `TenantGuard` extracts `companyId` from the route/body and ensures the User's `allowedCompanyIds` includes it.
3. **Permission Check**: `PermissionsGuard` verifies the user's role contains the `@RequirePermissions()` defined on the endpoint.
4. **Service-Level Resource Authorization**: 
   - The Controller extracts the User's authorized tenant context.
   - The Service receives this context (e.g., `allowedCompanyIds`).
   - The Service issues a Prisma query scoped with `where: { companyId: { in: allowedCompanyIds } }`.
   - If querying by an explicit Resource ID (like an Installation ID), the service fetches the resource and verifies its `companyId` matches the allowed context *before* returning it.

## IDOR Prevention
By implementing authorization deep in the Service layer, we prevent **Insecure Direct Object Reference (IDOR)** attacks.
Even if a Company Admin bypasses the controller by supplying a direct resource ID (e.g., `/api/v1/installations/inst-c1`), the Service layer will detect that `inst-c1` belongs to a Company they don't own and throw a `404 Not Found` (to avoid leaking resource existence).

## Database Indexing
Critical fields are indexed in `schema.prisma`:
- `companyId`: Highly utilized for multi-tenant querying.
- `status`: Utilized for filtering active/inactive installations or licenses.
- `createdAt`: Utilized for chronological queries (e.g., audit logs).

## Deterministic Seeding
Development environments utilize `apps/api/prisma/seed.ts` to provision standard entities via `.upsert()`. This ensures idempotent seeding and provides reliable UUIDs (e.g., `company-a`, `inst-a1`) for automated integration tests.

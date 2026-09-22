# Security Model

## The Four-Tiered Defense

1. **Authentication & Identity Type (`PrincipalGuard`)**
   - Identity must be proven.
   - Principal Type (`VENDOR` vs `CUSTOMER`) must match the requested API namespace (`/vendor` vs `/customer`).
   - Hard boundary: A Customer Admin can NEVER invoke a Vendor API, regardless of their role name.

2. **Role-Based Access Control (`PermissionsGuard`)**
   - Identity is evaluated for Role inclusion (`EnterpriseAdmin`, `CompanyAdmin`, `TrustfabricAdmin`).
   - Roles map to granular permissions (e.g., `license.allocate`).
   - Endpoint `@RequirePermissions(...)` decorators enforce this tier.

3. **Tenant & Scope Isolation**
   - The user's `companyId` or `allowedCompanyIds` are injected by the `AuthGuard`.
   - The API Controller never trusts the client-provided `companyId` as proof of authorization.
   - Context is injected into Prisma queries implicitly by the service layer.

4. **Service-Level Resource Validation**
   - The Service validates that the targeted resource (e.g., `entitlementId`) actually belongs to the caller's Enterprise.
   - Optimistic concurrency control (`@version`) prevents race conditions during writes.

# Tenant Model

## Multi-Tenancy Strategy
The platform utilizes a **Logical Isolation** strategy within a single PostgreSQL database.

Every tenant-specific table has a `companyId` (and often an `enterpriseId`).
All database queries must explicitly include these IDs to prevent cross-tenant data leakage.

## Scope Hierarchy
`Platform -> Enterprise -> Company -> Resource`

## Security Boundaries
1. **Frontend**: May hide UI elements, but is NEVER trusted for security.
2. **API Controllers**: Must extract the target `companyId` from the route/body.
3. **Guards/Interceptors**: Validate that the authenticated user holds a role granting access to the requested `companyId`.
4. **Services/Prisma**: Must ALWAYS append `where: { companyId: validatedCompanyId }` to database operations.

## Exploitation Prevention
A Company Admin attempting to access `/api/v1/companies/OTHER_ID/licenses` will be rejected at the Guard level because their `RoleAssignment` scope will not match `OTHER_ID`.

# Portal Architecture

The Trustfabric Enterprise Licensing Platform employs a two-portal architecture to ensure strict separation of concerns and robust security boundaries.

## 1. Trustfabric Admin Portal (Vendor)
- **Deployment**: `apps/trustfabric-admin` (Port 3002)
- **Audience**: Trustfabric Employees & Administrators
- **Capabilities**: Manage global customers, entitlements, products, global audit logs, and system policies.
- **API Boundary**: `/api/v1/vendor/...`
- **Identity Model**: `VendorUser` principal

## 2. Customer Portal
- **Deployment**: `apps/customer-portal` (Port 3000)
- **Audience**: Enterprise Administrators and Company Administrators
- **Capabilities**: Manage company-specific license allocations, approve requests, monitor installations, and view localized audit logs.
- **API Boundary**: `/api/v1/customer/...`
- **Identity Model**: `User` principal scoped to an `Enterprise` and `Company`.

## Shared Resources
- **Packages**:
  - `packages/ui`: Low-level UI primitives (buttons, inputs) shared across both portals, styled independently via Tailwind configs.
- **API Backend**: `apps/api` (Port 3001) serves both namespaces but enforces strict `PrincipalGuard` segregation.

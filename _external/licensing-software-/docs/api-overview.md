# API Overview

The backend uses a namespaced structure to enforce principal segregation.

## Vendor API (`/api/v1/vendor/...`)
*Accessible only by Trustfabric Employees*
- `/vendor/entitlements` - CRUD Entitlements globally
- `/vendor/customers` - Manage Enterprises and Companies
- `/vendor/products` - Manage Products
- `/vendor/audit` - View global audit trails

## Customer API (`/api/v1/customer/...`)
*Accessible only by Customer Users and Admins*
- `/customer/licenses` - Manage Allocations
- `/customer/license-requests` - Handle employee software requests
- `/customer/installations` - Manage active device installations (`:id/suspend`, `:id/unsuspend`, `:id/revoke`)
- `/customer/companies/:companyId/enrollment-tokens` - Issue/list/revoke the tokens an agent redeems to activate (permission `installation.enroll`)
- `/customer/audit` - View tenant-scoped audit logs

## Agent API (`/api/v1/agent/...`)
*Accessible only by a registered Installation's own credential — never a session-based principal. See [Agent Protocol](./agent-protocol.md).*
- `POST /agent/register` - Redeem an enrollment token, create an Installation, receive its credential
- `POST /agent/heartbeat` - Periodic check-in; returns current policy
- `GET /agent/policy` - Read-only policy fetch
- `POST /agent/release` - Self-release the seat (e.g. on uninstall)

# Role-Based Access Control (RBAC)

## Vendor Roles (TrustfabricAdmin)
- `*` (All vendor permissions)

## Customer Roles
### EnterpriseAdmin
- Scope: `allowedCompanyIds = ['*']`
- Permissions: `*` (All customer permissions)

### CompanyAdmin
- Scope: `allowedCompanyIds = ['company-id-1', ...]`
- Permissions: 
  - `company.read`, `company.manage`
  - `user.read`, `user.manage`
  - `entitlement.read`
  - `license.read`, `license.allocate`, `license.suspend`, `license.revoke`
  - `installation.read`, `installation.manage`, `installation.enroll`
  - `license_request.read`, `license_request.create`, `license_request.approve`, `license_request.reject`, `license_request.cancel`

### User
- Scope: `allowedCompanyIds = ['company-id-1']`
- Permissions:
  - `license.read`

## Fleet Telemetry Permissions Mapping
The telemetry domain reuses existing permissions without introducing new permission names:
- `installation.read`:
  - `GET /api/v1/customer/installations/:id/telemetry`
  - `GET /api/v1/customer/installations/:id/scans/:scanRunId`
  - `GET /api/v1/customer/telemetry/summary`
  - `GET /api/v1/customer/telemetry/installations`
- `installation.manage`:
  - `POST /api/v1/customer/installations/:id/commands`
  - `DELETE /api/v1/customer/installations/:id/commands/:commandId`
- `company.manage`:
  - `PATCH /api/v1/customer/companies/:id/telemetry-settings`


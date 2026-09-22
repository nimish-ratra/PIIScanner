# Customer Portal Authentication

## Model: Trustfabric-Managed Password Login

The Customer/Company Admin Portal authenticates via email + password against
Trustfabric-managed credentials stored on the `User` record. **OIDC/SSO
(Microsoft Entra ID) has been removed** from this portal — there is no
external identity provider in the current architecture, and no plan to
reintroduce one as part of this change.

This affects **only** Customer Portal login. It does not change:
- Vendor (Trustfabric Admin) authentication
- Agent authentication/enrollment (see [Agent Protocol](./agent-protocol.md))
- The authorization model (Principal Type → Role → Permission → Enterprise/Company Scope → Resource Authorization) — unchanged

## Flow

```
Customer Admin
      ↓
Customer Portal Login (email + password)
      ↓
POST /api/v1/customer/auth/login
      ↓
Verify argon2id password hash (User.passwordHash)
      ↓
Verify user.isActive
      ↓
Create iron-session cookie (httpOnly, sameSite=lax, secure in production)
      ↓
GET /api/v1/customer/auth/me
      ↓
Resolve roles/permissions/enterprise/company fresh from DB (IdentityService)
      ↓
Customer Portal
```

`enterpriseId`, `companyId`, `role`, `permissions`, and `principalType` are
never accepted from the client at login or at any point afterward — they are
always resolved server-side from the database, exactly as before this change.

## Endpoints

- `POST /api/v1/customer/auth/login` — `{ email, password }`. Always returns
  the same generic `401 Invalid email or password` for an unknown email, a
  wrong password, or a disabled account — never reveals which. Rate-limited
  (5 attempts / 15 minutes per IP+email pair, in-memory — see
  `LoginRateLimiterService`; move to a shared store like Redis if this API
  ever runs multi-instance).
- `POST /api/v1/customer/auth/logout` — destroys the session, clears the cookie.
- `GET /api/v1/customer/auth/me` — returns the authenticated principal's
  profile (id, email, roles, allowedCompanyIds, enterpriseId, companyId).
  Never returns `passwordHash` or any session-internal state.

## Password Storage

`User.passwordHash` stores an Argon2id hash (via the `argon2` package —
never a hand-rolled implementation, never MD5/SHA-1/plain SHA-256/reversible
encryption). It is `null` for any user without a provisioned credential
(e.g. regular employees who don't need portal access), and login for such a
user fails with the same generic error as a wrong password.

## User Provisioning (current state)

There is no admin UI for creating or resetting Customer Admin credentials
yet. Accounts are provisioned via the seed scripts (`prisma/seed.ts`,
`prisma/seed-e2e.ts`) for development, using a shared placeholder password
documented in each seed file. **Building a real provisioning/reset workflow
is future work** — see below.

## Password Reset: FUTURE

Not implemented. There is no "Forgot password" flow and none is exposed in
the UI — a fake recovery page would be worse than none. A future
implementation should use secure, single-use, short-lived expiring tokens
(e.g. a `PasswordResetToken` model with a hashed token and expiry), delivered
out-of-band (email), never a predictable or reusable link.

## Development / Test Login

`POST /api/v1/customer/auth/e2e/session` (see `e2e-auth.controller.ts`)
remains, strictly for automated tests. It is hard-blocked outside
`NODE_ENV !== 'production'` (both at the controller and, redundantly, at API
startup in `main.ts`). It is not exposed as a shortcut in the login UI — the
former "Development Login" button has been removed from the login page.
Playwright tests call this endpoint directly via `context.request`, not
through any UI control.

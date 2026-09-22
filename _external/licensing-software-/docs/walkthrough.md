# Phase 4A Walkthrough: Customer Admin Portal UI

We successfully built a production-grade Customer Admin Portal for managing Enterprise licensing, companies, users, and deployments! 

## Next.js Application Architecture
The UI was built using **Next.js 16 (App Router)** and **Tailwind CSS v4** in the `apps/web` workspace, establishing a robust foundation for future phases.

### Core Features Implementated:

- **Enterprise App Shell**: A professional sidebar and header layout utilizing `shadcn/ui` components and `lucide-react` iconography. The design is dense and optimized for enterprise administrators.
- **Global Context Switcher**: Located in the header, authorized users (Enterprise Admins) can toggle their view between "All Companies" and individual subsidiaries like "Acme India". The entire dashboard reacts to this selection, scoping data safely.
- **Role-Aware Navigation**: The sidebar intelligently hides restricted routes (e.g., Company Admin cannot see global audit settings).
- **Generic State Handling**: Reusable `LoadingState`, `ErrorState`, and `EmptyState` components ensure the UX never defaults to a blank screen or a generic unhandled crash.
- **Development Auth Switcher**: A floating development widget seamlessly manages injecting mock JWT tokens (`Bearer mock-token-admin`) into the centralized `api-client.ts`, allowing rapid UI iteration without hard-linking a production Identity Provider yet.

## Key Screens
> [!NOTE]  
> Data tables are utilizing clean layouts. While some sections are placeholders for Phase 5 (like Installations telemetry), the API connections to the core Phase 3 licensing models are active.

1. **Overview Dashboard**: High-level aggregated telemetry representing available Entitlement seats and consumption, separated contextually depending on the selected company scope.
2. **Licenses & Allocations**: Tabs separating Enterprise-level Entitlements vs Company-level Allocations and specific device Consumption.
3. **License Requests Workflow**: Managers can view PENDING requests and take action. Reject/Approve operations launch strict confirmation dialogs using `zod` and `react-hook-form` to ensure valid inputs (e.g. required rejection reasons) before submitting to the backend.

## Security Validations (E2E)
> [!IMPORTANT]  
> The UX is strictly an overlay for the authoritative backend. 
> 
> We wrote comprehensive Playwright E2E tests validating that even if a frontend user attempts to manually intercept or force `companyId` parameters outside their Role-Based Access Control list (e.g. `mock-token-company-admin` attempting to query `company-b1`), the backend safely returns `403 Forbidden` and the UI handles it gracefully with our `ErrorState`.

All builds, Next.js typings, ESLint constraints, and tests are passing. We are ready to proceed.

# Customer Workflow

1. **Authentication**: Customer Enterprise Admin logs into the Customer Portal (`/overview`).
2. **Allocation**: The Admin navigates to `/licenses`, views their available Entitlement pool granted by the vendor, and creates a License Allocation for a specific Company (e.g., 200 seats to Acme India).
3. **Distribution**: Employees in Acme India request licenses via the Employee Software, which appear in `/license-requests`.
4. **Approval**: A Company Admin approves the request. The backend atomically deducts 1 seat from the Company's Allocation and creates an `Installation`.
5. **Activation**: The Employee Software fetches the cryptographic license token based on the approved `Installation` and activates the software locally.
6. **Audit**: Customer Admins monitor consumption via `/audit` and can revoke specific user `Installations` if an employee leaves.

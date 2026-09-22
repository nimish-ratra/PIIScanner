# Domain Model

## Core Entities

- **Enterprise**: The top-level billing entity for a customer.
- **Company**: A subsidiary, region, or logical group under an Enterprise. (A single-company customer simply has 1 Company).
- **VendorUser**: A Trustfabric employee principal.
- **User**: A customer employee principal, strictly associated with a Company.
- **Product**: A licensable software product.
- **Entitlement**: A commercial grant of a Product to an Enterprise (e.g., "500 seats of Product X").
- **LicenseAllocation**: A sub-allocation of seats from an Entitlement dedicated to a specific Company.
- **LicenseRequest**: An employee request for a license seat.
- **EnrollmentToken**: A short-lived, limited-use token scoped to one LicenseAllocation, issued by a Company/Enterprise Admin and redeemed once by an agent to create an Installation.
- **Installation**: A physical or virtual device consuming 1 seat from a LicenseAllocation, authenticated by its own per-installation credential.
- **AuditEvent**: Immutable system event logging.

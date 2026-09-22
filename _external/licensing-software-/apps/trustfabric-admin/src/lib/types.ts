export interface Entitlement {
  id: string;
  enterpriseId: string;
  productId: string;
  editionId?: string | null;
  /** Human-readable commercial reference, e.g. "ENT-ACME-3F2A9C-2026-001". */
  reference?: string | null;
  quantity: number;
  allocatedQuantity: number;
  version: number;
  startDate: string;
  endDate: string;
  status: string;
  product: {
    id: string;
    name: string;
  };
  edition?: {
    id: string;
    name: string;
  } | null;
  // Enriched by EntitlementsService — see apps/api/src/entitlements/entitlements.service.ts
  enterprise?: {
    id: string;
    name: string;
  };
  // Present on GET /vendor/entitlements/:id only
  allocations?: Array<{
    id: string;
    companyId: string;
    entitlementId: string;
    quantity: number;
    consumedQuantity: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    company: { id: string; name: string };
  }>;
}

export interface Feature {
  id: string;
  editionId: string;
  name: string;
  key: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Edition {
  id: string;
  productId: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  features?: Feature[];
  _count?: { entitlements: number };
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  editions?: Edition[];
  _count?: { editions: number; entitlements: number };
}

export interface Customer {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { companies: number; entitlements: number };
  companies?: Array<{ id: string; name: string }>;
  entitlements?: Entitlement[];
}

/** Response shape from POST /vendor/customers only — the password is shown exactly once. */
export interface CustomerCreated extends Customer {
  initialAdmin: {
    userId: string;
    email: string;
    temporaryPassword: string;
  };
}

export interface Company {
  id: string;
  name: string;
  createdAt: string;
}

export interface LicenseAllocation {
  id: string;
  companyId: string;
  entitlementId: string;
  quantity: number;
  /** Seats currently held by non-REVOKED Installations. From LicenseAllocation.consumedQuantity. */
  consumedQuantity: number;
  version: number;
  status: string;
  createdAt: string;
  company: {
    id: string;
    name: string;
  };
  entitlement: {
    id: string;
    productId: string;
  };
}

export interface LicenseRequest {
  id: string;
  enterpriseId: string;
  companyId: string;
  entitlementId: string;
  requestedBy: string;
  quantity: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewedBy?: string;
  reviewReason?: string;
  createdAt: string;
}

export type InstallationStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface Installation {
  id: string;
  companyId: string;
  allocationId: string;
  enrollmentTokenId?: string | null;
  deviceId: string;
  hostname?: string | null;
  os?: string | null;
  osVersion?: string | null;
  architecture?: string | null;
  applicationVersion?: string | null;
  agentVersion?: string | null;
  status: InstallationStatus;
  lastHeartbeatAt?: string | null;
  releasedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched joins (returned by InstallationsService — vendor sees all tenants)
  company?: {
    id: string;
    name: string;
  };
  allocation?: {
    id: string;
    status: string;
    entitlementId: string;
  };
}

export type ActivationStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'REVOKED' | 'EXPIRED';

/**
 * The license right issued by the Trustfabric licensing backend for one
 * named employee, as a consequence of a Customer Admin approving a
 * targetUserId request — never created directly by the vendor. See
 * docs/activation-domain.md. Vendor scope (VendorActivationsController)
 * sees every customer's Activations globally; lifecycle actions
 * (suspend/reactivate/revoke) ARE exposed here, unlike Installations, since
 * vendor support/operations may need to act on a specific license right
 * directly.
 */
export interface Activation {
  id: string;
  requestId: string;
  allocationId: string;
  userId: string;
  companyId: string;
  productId: string;
  editionId?: string | null;
  installationId?: string | null;
  status: ActivationStatus;
  version: number;
  activatedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  request?: { id: string; requestedBy: string; reason?: string | null };
  allocation?: { id: string; status: string; entitlementId: string };
  user?: { id: string; email: string; name: string };
  company?: { id: string; name: string };
  product?: { id: string; name: string };
  edition?: { id: string; name: string } | null;
}

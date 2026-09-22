export interface Company {
  id: string;
  enterpriseId: string;
  name: string;
  createdAt: string;
}

export interface Entitlement {
  id: string;
  enterpriseId: string;
  productId: string;
  quantity: number;
  allocatedQuantity: number;
  startDate: string;
  endDate: string;
  status: string;
  product: {
    id: string;
    name: string;
  };
}

export interface LicenseAllocation {
  id: string;
  companyId: string;
  entitlementId: string;
  quantity: number;
  /** Seats currently held by non-REVOKED Installations. From LicenseAllocation.consumedQuantity. */
  consumedQuantity: number;
  /** OCC version — not used for display, present because the backend returns the full row. */
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

export type LicenseRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LicenseRequest {
  id: string;
  enterpriseId: string;
  companyId: string;
  entitlementId: string;
  requestedBy: string;
  /**
   * The employee this license is actually FOR, if the request names one
   * specific person — distinct from requestedBy (who filed it). Only set
   * when quantity === 1. A request approved with targetUserId set is the
   * only kind that produces an Activation; a bulk capacity request
   * (targetUserId null) never does.
   */
  targetUserId?: string | null;
  quantity: number;
  reason?: string;
  status: LicenseRequestStatus;
  reviewedBy?: string;
  reviewReason?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched joins (returned by the fixed backend)
  company?: {
    id: string;
    name: string;
  };
  entitlement?: {
    id: string;
    status: string;
    quantity: number;
    allocatedQuantity: number;
    product?: {
      id: string;
      name: string;
    };
  };
}

/**
 * Response shape from POST /customer/license-requests/:id/approve only.
 * Approving is a Customer Admin action (this request); issuing the
 * Activation that results from it is the Trustfabric licensing backend's
 * own decision, not something the customer performs — see
 * docs/activation-domain.md. `activation`/`enrollmentToken` are only
 * present when the approved request named a targetUserId; a bulk capacity
 * request's approval returns both as null. `enrollmentToken.token` is the
 * one-time plaintext — present only on the response that actually minted
 * it, never again on a retry.
 */
export interface LicenseRequestApproval extends LicenseRequest {
  activation: Activation | null;
  enrollmentToken: EnrollmentTokenCreated | null;
}

export type InstallationStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface Installation {
  id: string;
  companyId: string;
  allocationId: string;
  enrollmentTokenId?: string | null;
  deviceId: string;
  // Self-declared at agent registration for a plain/legacy token — null for
  // an activation-bound installation, where the real employee is already
  // known via the Activation it's linked to.
  employeeName?: string | null;
  employeeEmail?: string | null;
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
  // Enriched joins (returned by InstallationsService)
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
 * targetUserId request — never created directly by the customer. See
 * docs/activation-domain.md for the full Request -> Approval -> Activation
 * -> Installation distinction.
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
  // Enriched joins (returned by ActivationsService)
  request?: { id: string; requestedBy: string; reason?: string | null };
  allocation?: { id: string; status: string; entitlementId: string };
  user?: { id: string; email: string; name: string };
  company?: { id: string; name: string };
  product?: { id: string; name: string };
  edition?: { id: string; name: string } | null;
}

/**
 * Returned once, in full (including the plaintext `token`), only from the
 * create-enrollment-token response. Every other read (list) omits `token`
 * entirely — the backend never persists or returns the plaintext again.
 */
export interface EnrollmentToken {
  id: string;
  companyId: string;
  allocationId: string;
  /** Set when this token was minted for one specific Activation (approval-driven flow) rather than the general allocation-wide flow. */
  activationId?: string | null;
  label?: string | null;
  maxActivations: number;
  activationsUsed: number;
  createdBy: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
}

export interface EnrollmentTokenCreated extends EnrollmentToken {
  /** Plaintext enrollment token — shown exactly once, never retrievable again. */
  token: string;
}

export type TelemetryDerivedStatus = 'NO_DATA' | 'LIVE' | 'STOPPED' | 'STALE' | 'OFFLINE' | 'DISABLED';

export interface InstallationTelemetryState {
  id: string;
  installationId: string;
  companyId: string;
  lastPingAt: string;
  clientTime?: string | null;
  serviceRunning: boolean;
  watcherActive: boolean;
  serviceStartedAt?: string | null;
  policyHash?: string | null;
  agentVersion?: string | null;
  applicationVersion?: string | null;
  outboxDepth: number;
  lastScanAt?: string | null;
  lastEnforcementAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanRun {
  id: string;
  installationId: string;
  companyId: string;
  clientScanId: string;
  scanSource: string;
  targetSummary?: string | null;
  startedAt: string;
  completedAt?: string | null;
  status: string;
  durationSeconds: number;
  filesScanned: number;
  filesWithPii: number;
  totalFindings: number;
  highestTier?: string | null;
  tierCounts?: Record<string, number> | null;
  entityTypeTotals?: Record<string, number> | null;
  filesTruncated: boolean;
  createdAt: string;
  findings?: ScanFindingSummary[];
}

export interface ScanFindingSummary {
  id: string;
  scanRunId: string;
  pathRef: string;
  tier: string;
  entityTypeCounts: Record<string, number>;
  watermarkStatus?: string | null;
  createdAt: string;
}

export interface EnforcementWindow {
  id: string;
  installationId: string;
  companyId: string;
  windowStart: string;
  windowEnd: string;
  source: string;
  actionCounts: Record<string, number>;
  tierCounts: Record<string, number>;
  overrideCount: number;
  createdAt: string;
}

export interface AgentCommand {
  id: string;
  installationId: string;
  companyId: string;
  commandType: 'force_policy_refresh' | 'request_diagnostic_snapshot' | 'request_service_restart';
  status: 'PENDING' | 'DELIVERED' | 'ACKNOWLEDGED' | 'EXPIRED' | 'CANCELLED';
  payload?: any;
  issuedAt: string;
  expiresAt: string;
  deliveredAt?: string | null;
  acknowledgedAt?: string | null;
  result?: 'success' | 'failed' | 'unsupported' | null;
  resultDetail?: string | null;
  issuedByUserId?: string | null;
  issuedBy?: { id: string; email: string; name?: string | null } | null;
}

export interface InstallationTelemetryData {
  installation: Installation;
  telemetryState: InstallationTelemetryState | null;
  derivedStatus: TelemetryDerivedStatus;
  companyTelemetry: {
    enabled: boolean;
    syncFullPaths: boolean;
  };
  scans: ScanRun[];
  enforcementWindows: EnforcementWindow[];
  commands: AgentCommand[];
}

export interface TelemetrySummaryResponse {
  statusCounts: Record<TelemetryDerivedStatus, number>;
  totalProtected: number;
  totalDevices: number;
  staleOrOffline: number;
  filesScanned: number;
  findingsByTier: Record<string, number>;
  enforcementByAction: Record<string, number>;
  topEntityTypes: { entityType: string; count: number }[];
}

export interface FleetInstallationRow {
  id: string;
  companyId: string;
  companyName: string;
  employeeName: string | null;
  employeeEmail: string | null;
  hostname: string | null;
  licenseStatus: string;
  telemetryStatus: TelemetryDerivedStatus;
  lastPingAt: string | null;
  lastScanAt: string | null;
  highestTier: string | null;
  findingsByTier: Record<string, number>;
  serviceRunning: boolean;
  watcherActive: boolean;
}

export interface FleetInstallationsResponse {
  data: FleetInstallationRow[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

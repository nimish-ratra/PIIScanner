import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ActivationsService } from '../activations/activations.service.js';

/**
 * Legal admin-driven Installation status transitions. Mirrors LicenseAllocation's
 * own state machine. PENDING -> ACTIVE is the Company Admin's approval of a
 * plain-token self-service registration (see AgentService.register()) — the
 * seat was already reserved at PENDING-creation time, so approving does not
 * consume it again.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  INACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
};

/**
 * Explicit allow-list of Installation scalar fields safe to return to any
 * caller (customer or vendor). Deliberately excludes credentialHash and
 * credentialRotatedAt — neither portal has any reason to see even a hashed
 * agent credential, and an earlier `include`-based query was returning them.
 */
const SAFE_INSTALLATION_FIELDS = {
  id: true,
  companyId: true,
  allocationId: true,
  enrollmentTokenId: true,
  activationId: true,
  deviceId: true,
  employeeName: true,
  employeeEmail: true,
  hostname: true,
  os: true,
  osVersion: true,
  architecture: true,
  applicationVersion: true,
  agentVersion: true,
  status: true,
  lastHeartbeatAt: true,
  releasedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class InstallationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private activationsService: ActivationsService,
  ) {}

  async findAll(allowedCompanyIds: string[], filters: { companyId?: string, status?: string, version?: string } = {}) {
    // Service-level authorization: ensure we only fetch for allowed companies
    let whereClause: any = allowedCompanyIds.includes('*') 
      ? {} 
      : { companyId: { in: allowedCompanyIds } };

    if (filters.companyId && (allowedCompanyIds.includes('*') || allowedCompanyIds.includes(filters.companyId))) {
      whereClause.companyId = filters.companyId;
    }
    
    if (filters.status) {
      whereClause.status = filters.status;
    }
    
    if (filters.version) {
      whereClause.agentVersion = filters.version;
    }

    return this.prisma.installation.findMany({
      where: whereClause,
      select: { ...SAFE_INSTALLATION_FIELDS, company: { select: { id: true, name: true } }, allocation: { select: { id: true, status: true, entitlementId: true } } },
    });
  }

  async findOne(id: string, allowedCompanyIds: string[], userId: string) {
    const installation = await this.prisma.installation.findUnique({
      where: { id },
      select: { ...SAFE_INSTALLATION_FIELDS, company: { select: { id: true, name: true } }, allocation: { select: { id: true, status: true, entitlementId: true } } },
    });

    if (!installation) {
      throw new NotFoundException('Installation not found');
    }

    // Service-level resource authorization check
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(installation.companyId)) {
      await this.audit.logEvent({
        actorId: userId,
        actorType: 'USER',
        action: 'READ_INSTALLATION',
        targetType: 'Installation',
        targetId: id,
        result: 'DENIED',
        reason: 'IDOR attempt on installation belonging to another company'
      });
      // We throw NotFoundException to avoid leaking the existence of resources across tenants
      throw new NotFoundException('Installation not found');
    }

    await this.audit.logEvent({
      actorId: userId,
      actorType: 'USER',
      action: 'READ_INSTALLATION',
      targetType: 'Installation',
      targetId: id,
      result: 'SUCCESS',
      companyId: installation.companyId
    });

    return installation;
  }

  /**
   * Admin-driven single-installation lifecycle action (suspend/unsuspend/revoke).
   * Distinct from AgentService.release() (agent self-release on uninstall), but
   * REVOKED converges on the same terminal state and frees the seat identically.
   */
  async setStatus(id: string, allowedCompanyIds: string[], newStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', actorId: string) {
    const installation = await this.findOne(id, allowedCompanyIds, actorId);
    const wasPending = installation.status === 'PENDING';

    if (!VALID_TRANSITIONS[installation.status]?.includes(newStatus)) {
      throw new BadRequestException(`Invalid state transition from ${installation.status} to ${newStatus}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.installation.update({
        where: { id },
        data: {
          status: newStatus,
          releasedAt: newStatus === 'REVOKED' ? new Date() : undefined,
        },
      });

      // Revoking frees the seat back to the allocation's pool; suspend/unsuspend does not.
      // EXCEPT: an installation with a linked Activation (see
      // Activation.installationId) represents a still-valid license right
      // that's just changing machines (device replacement) — the seat stays
      // reserved to the Activation, which moves to DEACTIVATED instead of
      // the seat being freed here. Only an explicit Activation revoke frees
      // it. Legacy (non-activation) installations are unaffected.
      if (newStatus === 'REVOKED') {
        if (installation.activationId) {
          await this.activationsService.deactivateForInstallationRelease(tx, installation.activationId);
        } else {
          await tx.licenseAllocation.update({
            where: { id: installation.allocationId },
            data: { consumedQuantity: { decrement: 1 } },
          });
        }
      }

      return result;
    });

    const action = wasPending
      ? newStatus === 'ACTIVE'
        ? 'APPROVE_INSTALLATION'
        : 'REJECT_INSTALLATION'
      : newStatus === 'REVOKED'
        ? 'REVOKE_INSTALLATION'
        : newStatus === 'SUSPENDED'
          ? 'SUSPEND_INSTALLATION'
          : 'UNSUSPEND_INSTALLATION';

    await this.audit.logEvent({
      companyId: installation.companyId,
      actorId,
      actorType: 'USER',
      action,
      targetType: 'Installation',
      targetId: id,
      result: 'SUCCESS',
    });

    return updated;
  }
}

/**
 * ActivationsService
 *
 * Activation is the point at which an APPROVED LicenseRequest becomes an
 * actual issued license right for one named employee (LicenseRequest.targetUserId)
 * — distinct from the approval decision itself and from the concrete machine
 * that eventually uses it (Installation). See docs/activation-domain.md.
 *
 * There is no public "create an Activation" endpoint — creation is always a
 * controlled side effect of LicenseRequestsService.approve() (see
 * createFromApprovedRequest, called from inside that method's transaction).
 *
 * Seat accounting: creating an Activation consumes exactly one seat from its
 * LicenseAllocation (consumedQuantity/version, same OCC pattern as
 * AgentService.register()/LicensesService.allocate()) — the single
 * authoritative consumption point for this flow. Linking an Installation
 * later does NOT consume a second seat. Only REVOKED frees it again;
 * DEACTIVATED (device replacement) deliberately does not.
 */

import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma, LicenseRequest, LicenseAllocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { generateSecret, hashSecret } from '../agent/crypto.util.js';
import { DEFAULT_ENROLLMENT_TOKEN_TTL_DAYS } from '../agent/agent.constants.js';

/** Explicit lifecycle — see docs/activation-domain.md. No arbitrary status mutation. */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED', 'REVOKED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'REVOKED', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE', 'REVOKED'],
};

/** Statuses from which revoking has not already freed the seat (used to guard against double-release). */
const SEAT_HELD_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'];

const ACTIVATION_INCLUDE = {
  request: { select: { id: true, requestedBy: true, reason: true } },
  allocation: { select: { id: true, status: true, entitlementId: true } },
  user: { select: { id: true, email: true, name: true } },
  company: { select: { id: true, name: true } },
  product: { select: { id: true, name: true } },
  edition: { select: { id: true, name: true } },
} as const;

function omitTokenHash<T extends { tokenHash: string }>(token: T): Omit<T, 'tokenHash'> {
  const { tokenHash: _tokenHash, ...rest } = token;
  return rest;
}

@Injectable()
export class ActivationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(allowedCompanyIds: string[], enterpriseId?: string) {
    const where: any = allowedCompanyIds.includes('*')
      ? (enterpriseId ? { company: { enterpriseId } } : {})
      : { companyId: { in: allowedCompanyIds } };

    return this.prisma.activation.findMany({
      where,
      include: ACTIVATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, allowedCompanyIds: string[], enterpriseId?: string) {
    const activation = await this.prisma.activation.findUnique({
      where: { id },
      include: ACTIVATION_INCLUDE,
    });
    if (!activation) {
      throw new NotFoundException('Activation not found');
    }
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(activation.companyId)) {
      throw new NotFoundException('Activation not found'); // 404, not 403 — avoid IDOR leak
    }
    if (allowedCompanyIds.includes('*') && enterpriseId) {
      const company = await this.prisma.company.findUnique({ where: { id: activation.companyId } });
      if (company?.enterpriseId !== enterpriseId) {
        throw new NotFoundException('Activation not found');
      }
    }
    return activation;
  }

  /**
   * Called from inside LicenseRequestsService.approve()'s transaction — never
   * exposed as its own endpoint. Idempotent: a retried approval call for the
   * same request returns the existing Activation rather than creating a
   * second one or consuming a second seat.
   */
  async createFromApprovedRequest(
    tx: Prisma.TransactionClient,
    request: LicenseRequest,
    allocation: LicenseAllocation,
    actorId: string,
  ) {
    if (!request.targetUserId) {
      throw new BadRequestException('Cannot create an Activation for a request with no targetUserId');
    }
    if (request.quantity !== 1) {
      throw new BadRequestException('Activation creation requires a quantity of exactly 1');
    }

    const existing = await tx.activation.findUnique({ where: { requestId: request.id } });
    if (existing) {
      return { activation: existing, enrollmentToken: null };
    }

    const targetUser = await tx.user.findUnique({ where: { id: request.targetUserId } });
    if (!targetUser || targetUser.companyId !== request.companyId) {
      throw new BadRequestException('targetUserId does not belong to the requesting company');
    }

    // OCC seat consumption — mirrors AgentService.register()'s exact idiom.
    const occResult = await tx.licenseAllocation.updateMany({
      where: { id: allocation.id, version: allocation.version },
      data: { consumedQuantity: { increment: 1 }, version: { increment: 1 } },
    });
    if (occResult.count === 0) {
      throw new ConflictException('Concurrent seat consumption detected. Please retry.');
    }

    const entitlement = await tx.entitlement.findUnique({ where: { id: allocation.entitlementId } });
    if (!entitlement) {
      throw new NotFoundException('Entitlement not found for this allocation');
    }

    const activation = await tx.activation.create({
      data: {
        requestId: request.id,
        allocationId: allocation.id,
        userId: request.targetUserId,
        companyId: allocation.companyId,
        productId: entitlement.productId,
        editionId: entitlement.editionId,
        status: 'PENDING',
        // Deliberately NOT copying entitlement.endDate here: AgentService now
        // checks the entitlement's CURRENT end date live on every heartbeat
        // (via loadEntitlementEndDate(), keyed off the allocation, so it
        // covers this Activation's installation too) — a snapshot here would
        // go stale and wrongly stay "expired" forever if the entitlement is
        // later extended. expiresAt remains available for a future per-seat
        // custom-term override, just not wired to the entitlement's date.
      },
    });

    const enrollmentToken = await this.mintBoundToken(tx, activation, actorId);

    // Attributed to SYSTEM, not the approving Customer Admin: approving a
    // request is a customer action (audited separately as
    // APPROVE_LICENSE_REQUEST, actor = that admin), but issuing the
    // Activation itself is the Trustfabric licensing backend's own
    // decision — a consequence of the approval, not something the customer
    // manually performed. The triggering admin is still recorded in `reason`
    // for traceability, just not as the actor of this event.
    await this.audit.logEvent({
      companyId: activation.companyId,
      actorId: 'SYSTEM',
      actorType: 'SYSTEM',
      action: 'CREATE_ACTIVATION',
      targetType: 'Activation',
      targetId: activation.id,
      result: 'SUCCESS',
      reason: `Issued to user ${activation.userId} from request ${request.id} (approved by ${actorId})`,
    });

    return { activation, enrollmentToken };
  }

  /** Called only from AgentService.register() when redeeming an activation-bound EnrollmentToken. */
  async linkInstallation(tx: Prisma.TransactionClient, activationId: string, installationId: string) {
    const activation = await tx.activation.findUnique({ where: { id: activationId } });
    if (!activation) {
      throw new NotFoundException('Activation not found');
    }
    if (!['PENDING', 'DEACTIVATED'].includes(activation.status)) {
      throw new BadRequestException(`Cannot link an installation to an activation in ${activation.status} status`);
    }

    const updated = await tx.activation.update({
      where: { id: activationId },
      data: {
        installationId,
        status: 'ACTIVE',
        activatedAt: activation.activatedAt ?? new Date(),
      },
    });

    await this.audit.logEvent({
      companyId: activation.companyId,
      actorId: installationId,
      actorType: 'AGENT',
      action: 'LINK_ACTIVATION_INSTALLATION',
      targetType: 'Activation',
      targetId: activationId,
      result: 'SUCCESS',
      reason: `Linked installation ${installationId}`,
    });

    return updated;
  }

  /**
   * Called from InstallationsService.setStatus() when an installation with a
   * non-null activationId is revoked/released. The license right persists —
   * only the machine link is cleared. Does NOT touch consumedQuantity: the
   * seat stays reserved for this activation until it is explicitly revoked.
   */
  async deactivateForInstallationRelease(tx: Prisma.TransactionClient, activationId: string) {
    const activation = await tx.activation.findUnique({ where: { id: activationId } });
    if (!activation || !['ACTIVE', 'SUSPENDED'].includes(activation.status)) {
      return; // nothing to do — already terminal or already unlinked
    }

    await tx.activation.update({
      where: { id: activationId },
      data: { installationId: null, status: 'DEACTIVATED' },
    });

    await this.audit.logEvent({
      companyId: activation.companyId,
      actorId: 'SYSTEM',
      actorType: 'SYSTEM',
      action: 'DEACTIVATE_ACTIVATION',
      targetType: 'Activation',
      targetId: activationId,
      result: 'SUCCESS',
      reason: 'Linked installation was revoked/released',
    });
  }

  /** Device replacement: mint a fresh single-use activation-bound token for a DEACTIVATED activation. */
  async mintReplacementEnrollmentToken(id: string, allowedCompanyIds: string[], actorId: string) {
    const activation = await this.findOne(id, allowedCompanyIds);
    if (activation.status !== 'DEACTIVATED') {
      throw new BadRequestException('A replacement enrollment token can only be minted for a DEACTIVATED activation');
    }

    return this.prisma.$transaction(async (tx) => {
      const enrollmentToken = await this.mintBoundToken(tx, activation, actorId);
      return { activation, enrollmentToken };
    });
  }

  async setStatus(
    id: string,
    allowedCompanyIds: string[],
    newStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
    actorId: string,
  ) {
    const activation = await this.findOne(id, allowedCompanyIds);

    if (!VALID_TRANSITIONS[activation.status]?.includes(newStatus)) {
      throw new BadRequestException(`Invalid state transition from ${activation.status} to ${newStatus}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.activation.update({
        where: { id },
        data: {
          status: newStatus,
          revokedAt: newStatus === 'REVOKED' ? new Date() : undefined,
        },
      });

      // Only free the seat if it hadn't already been freed — guards against
      // a retried/duplicate revoke call double-releasing.
      if (newStatus === 'REVOKED' && SEAT_HELD_STATUSES.includes(activation.status)) {
        await tx.licenseAllocation.update({
          where: { id: activation.allocationId },
          data: { consumedQuantity: { decrement: 1 } },
        });
      }

      return result;
    });

    await this.audit.logEvent({
      companyId: activation.companyId,
      actorId,
      actorType: 'USER',
      action:
        newStatus === 'REVOKED' ? 'REVOKE_ACTIVATION' : newStatus === 'SUSPENDED' ? 'SUSPEND_ACTIVATION' : 'REACTIVATE_ACTIVATION',
      targetType: 'Activation',
      targetId: id,
      result: 'SUCCESS',
    });

    return updated;
  }

  private async mintBoundToken(
    tx: Prisma.TransactionClient,
    activation: { id: string; allocationId: string; companyId: string },
    actorId: string,
  ) {
    const plaintext = generateSecret();
    const expiresAt = new Date(Date.now() + DEFAULT_ENROLLMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const token = await tx.enrollmentToken.create({
      data: {
        companyId: activation.companyId,
        allocationId: activation.allocationId,
        activationId: activation.id,
        label: `Activation ${activation.id}`,
        tokenHash: hashSecret(plaintext),
        maxActivations: 1,
        createdBy: actorId,
        expiresAt,
      },
    });

    // Plaintext shown exactly once here — never persisted, never retrievable again.
    return { ...omitTokenHash(token), token: plaintext };
  }
}

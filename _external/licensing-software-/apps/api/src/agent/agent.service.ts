import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Installation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { generateSecret, hashSecret } from './crypto.util.js';
import { GRACE_PERIOD_DAYS, HEARTBEAT_INTERVAL_SECONDS } from './agent.constants.js';
import type { HeartbeatDto, RegisterAgentDto } from './agent.dto.js';
import { ActivationsService } from '../activations/activations.service.js';

@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activationsService: ActivationsService,
  ) {}

  /**
   * Redeem an enrollment token to create (or re-activate) an Installation and
   * consume one seat from its LicenseAllocation. Uses the same
   * read-version -> conditional-update OCC pattern as EntitlementsService,
   * scoped to LicenseAllocation.consumedQuantity/version instead.
   */
  async register(dto: RegisterAgentDto) {
    if (!dto.enrollmentToken?.trim()) {
      throw new BadRequestException('enrollmentToken is required');
    }
    if (!dto.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required');
    }

    const tokenHash = hashSecret(dto.enrollmentToken.trim());
    const enrollmentToken = await this.prisma.enrollmentToken.findUnique({ where: { tokenHash } });

    if (!enrollmentToken) {
      throw new UnauthorizedException('Invalid enrollment token');
    }
    if (enrollmentToken.revokedAt) {
      throw new UnauthorizedException('Enrollment token has been revoked');
    }
    if (enrollmentToken.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Enrollment token has expired');
    }
    if (enrollmentToken.activationsUsed >= enrollmentToken.maxActivations) {
      throw new UnauthorizedException('Enrollment token has no activations remaining');
    }

    const installationSecret = generateSecret();
    const isActivationBound = enrollmentToken.activationId !== null;

    // A plain/legacy token has no employee identity anywhere else in the
    // system — require the redeeming device to self-declare one so a bulk
    // batch of anonymous tokens still yields a record of who's using each
    // seat. An activation-bound token already has a real, admin-approved
    // identity via Activation.userId; asking again here would be redundant,
    // unverified data shadowing the authoritative source, so it's skipped.
    let employeeName: string | undefined;
    let employeeEmail: string | undefined;
    if (!isActivationBound) {
      employeeName = dto.employeeName?.trim();
      employeeEmail = dto.employeeEmail?.trim();
      if (!employeeName) {
        throw new BadRequestException('employeeName is required to redeem this enrollment token');
      }
      if (!employeeEmail) {
        throw new BadRequestException('employeeEmail is required to redeem this enrollment token');
      }
      const emailDomain = employeeEmail.split('@')[1]?.toLowerCase();
      if (!emailDomain) {
        throw new BadRequestException('employeeEmail must be a valid email address');
      }

      const company = await this.prisma.company.findUnique({ where: { id: enrollmentToken.companyId } });
      if (company?.allowedEmailDomains.length && !company.allowedEmailDomains.includes(emailDomain)) {
        throw new BadRequestException(
          `employeeEmail domain "${emailDomain}" is not an allowed domain for this company`,
        );
      }
    }

    const installation = await this.prisma.$transaction(async (tx) => {
      // A physical device's fingerprint (deviceId) should never hold two live
      // seats at once — without this, redeeming a second token on the same
      // machine silently created a second Installation, leaking a seat and
      // orphaning the first one's credential in the agent's local state (it
      // can only remember one credential at a time). This is a hygiene guard,
      // not a hard security boundary — like the codebase's other
      // deviceId-adjacent checks, a race between two concurrent registrations
      // for the exact same deviceId is a known, accepted narrow window, not
      // one protected by OCC the way seat-count consumption is.
      const existingInstallation = await tx.installation.findFirst({
        where: { deviceId: dto.deviceId.trim(), status: { not: 'REVOKED' } },
      });
      if (existingInstallation) {
        throw new ConflictException(
          `This device already holds an active installation (${existingInstallation.id}). ` +
            'It must be released (by the agent) or revoked (by an admin) before a new seat can be redeemed on it.',
        );
      }

      const allocation = await tx.licenseAllocation.findUnique({ where: { id: enrollmentToken.allocationId } });
      if (!allocation) {
        throw new NotFoundException('License allocation not found');
      }
      if (!['ALLOCATED', 'ACTIVE'].includes(allocation.status)) {
        throw new BadRequestException(`Cannot activate against a ${allocation.status} allocation`);
      }

      // The allocation itself never expires, but the commercial entitlement
      // it draws from does — a stale allocation with capacity left must not
      // let a brand-new device register once that contract's end date has
      // passed, even though LicensesService.allocate() already blocks new
      // allocations from an expired entitlement (this covers one created
      // before expiry, still being redeemed after).
      const entitlement = await tx.entitlement.findUnique({ where: { id: allocation.entitlementId } });
      if (entitlement && entitlement.endDate.getTime() < Date.now()) {
        throw new BadRequestException('Cannot register — the entitlement backing this allocation has expired');
      }

      // Activation-bound registrations (this token was minted for one exact
      // Activation at approval time) already consumed their seat when that
      // Activation was created — consuming again here would double-count it.
      // Legacy tokens (no activationId) consume at registration exactly as
      // before, unchanged.
      if (!isActivationBound) {
        const available = allocation.quantity - allocation.consumedQuantity;
        if (available <= 0) {
          throw new ConflictException('No seats available on this allocation');
        }

        // Optimistic Concurrency Control — mirrors EntitlementsService.allocate()
        const occResult = await tx.licenseAllocation.updateMany({
          where: { id: allocation.id, version: allocation.version },
          data: {
            consumedQuantity: { increment: 1 },
            version: { increment: 1 },
            status: 'ACTIVE',
          },
        });
        if (occResult.count === 0) {
          throw new ConflictException('Concurrent seat consumption detected. Please retry.');
        }
      }

      let activation = null;
      if (isActivationBound) {
        activation = await tx.activation.findUnique({ where: { id: enrollmentToken.activationId! } });
        if (!activation) {
          throw new NotFoundException('Activation not found for this enrollment token');
        }
        if (!['PENDING', 'DEACTIVATED'].includes(activation.status)) {
          throw new BadRequestException(`Cannot register against an activation in ${activation.status} status`);
        }
        if (activation.companyId !== enrollmentToken.companyId) {
          // Defense-in-depth — must always be true by construction, but never trusted implicitly.
          throw new BadRequestException('Activation/company mismatch on enrollment token');
        }
      }

      const created = await tx.installation.create({
        data: {
          companyId: enrollmentToken.companyId,
          allocationId: allocation.id,
          enrollmentTokenId: enrollmentToken.id,
          // Immutable provenance — see Installation.activationId's schema comment.
          activationId: activation?.id,
          deviceId: dto.deviceId.trim(),
          employeeName,
          employeeEmail,
          hostname: dto.hostname,
          os: dto.os,
          osVersion: dto.osVersion,
          architecture: dto.architecture,
          applicationVersion: dto.applicationVersion,
          agentVersion: dto.agentVersion,
          credentialHash: hashSecret(installationSecret),
          credentialRotatedAt: new Date(),
          // A plain/legacy token's registration is self-service and
          // unverified — it lands PENDING until a Company Admin approves it
          // (POST /customer/installations/:id/approve), even though the seat
          // is already reserved. An activation-bound token was already
          // approved via the LicenseRequest it came from, so it goes
          // straight to ACTIVE as before.
          status: isActivationBound ? 'ACTIVE' : 'PENDING',
          lastHeartbeatAt: new Date(),
        },
      });

      await tx.enrollmentToken.update({
        where: { id: enrollmentToken.id },
        data: { activationsUsed: { increment: 1 } },
      });

      if (activation) {
        await this.activationsService.linkInstallation(tx, activation.id, created.id);
      }

      return created;
    });

    await this.audit.logEvent({
      companyId: installation.companyId,
      actorId: installation.id,
      actorType: 'AGENT',
      action: 'AGENT_REGISTER',
      targetType: 'Installation',
      targetId: installation.id,
      result: 'SUCCESS',
      reason: isActivationBound
        ? `Activated via activation-bound enrollment token ${enrollmentToken.id} (activation ${enrollmentToken.activationId})`
        : `Registered via enrollment token ${enrollmentToken.id} — pending admin approval`,
    });

    return {
      installationId: installation.id,
      // Shown exactly once — the agent must persist this locally (e.g. alongside
      // its other %APPDATA% state); it cannot be recovered from the server again.
      credential: `${installation.id}.${installationSecret}`,
      companyId: installation.companyId,
      status: installation.status,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      gracePeriodDays: GRACE_PERIOD_DAYS,
    };
  }

  async heartbeat(installation: Installation, dto: HeartbeatDto) {
    if (installation.status === 'REVOKED') {
      throw new ForbiddenException('Installation has been revoked');
    }

    const updated = await this.prisma.installation.update({
      where: { id: installation.id },
      data: {
        lastHeartbeatAt: new Date(),
        status: installation.status === 'INACTIVE' ? 'ACTIVE' : installation.status,
        agentVersion: dto.agentVersion ?? installation.agentVersion,
        applicationVersion: dto.applicationVersion ?? installation.applicationVersion,
      },
    });

    await this.audit.logEvent({
      companyId: updated.companyId,
      actorId: updated.id,
      actorType: 'AGENT',
      action: 'AGENT_HEARTBEAT',
      targetType: 'Installation',
      targetId: updated.id,
      result: 'SUCCESS',
    });

    return this.buildPolicy(updated, await this.loadActivation(updated), await this.loadEntitlementEndDate(updated));
  }

  async getPolicy(installation: Installation) {
    return this.buildPolicy(
      installation,
      await this.loadActivation(installation),
      await this.loadEntitlementEndDate(installation),
    );
  }

  /** Loads the linked Activation for policy combination, if this installation has one. Legacy (non-activation) installations return null, unaffected. */
  private async loadActivation(installation: Installation) {
    if (!installation.activationId) return null;
    return this.prisma.activation.findUnique({ where: { id: installation.activationId } });
  }

  /**
   * The allocation itself never expires, but the commercial entitlement it
   * draws from does — this is what lets an already-registered plain/legacy
   * installation (no Activation, so activationExpired never applies to it)
   * still get cut off once that contract's end date passes, on its very
   * next heartbeat, without needing an admin to manually revoke it.
   */
  private async loadEntitlementEndDate(installation: Installation): Promise<Date | null> {
    const allocation = await this.prisma.licenseAllocation.findUnique({ where: { id: installation.allocationId } });
    if (!allocation) return null;
    const entitlement = await this.prisma.entitlement.findUnique({ where: { id: allocation.entitlementId } });
    return entitlement?.endDate ?? null;
  }

  /**
   * Self-release — the agent gives up its own seat (e.g. on uninstall).
   * Distinct from an admin-initiated revoke (InstallationsService.setStatus),
   * but converges on the same terminal state and seat-release bookkeeping.
   */
  async release(installation: Installation) {
    if (installation.status === 'REVOKED') {
      return { released: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.installation.update({
        where: { id: installation.id },
        data: { status: 'REVOKED', releasedAt: new Date() },
      });

      if (installation.activationId) {
        // The license right persists — only this machine's link to it is
        // cleared. The seat stays reserved to the Activation until it is
        // explicitly revoked (see ActivationsService.setStatus), so it must
        // NOT be freed here — freeing it here as well as on explicit revoke
        // would double-release it.
        await this.activationsService.deactivateForInstallationRelease(tx, installation.activationId);
      } else {
        await tx.licenseAllocation.update({
          where: { id: installation.allocationId },
          data: { consumedQuantity: { decrement: 1 } },
        });
      }
    });

    await this.audit.logEvent({
      companyId: installation.companyId,
      actorId: installation.id,
      actorType: 'AGENT',
      action: 'AGENT_RELEASE',
      targetType: 'Installation',
      targetId: installation.id,
      result: 'SUCCESS',
      reason: 'Self-released by agent',
    });

    return { released: true };
  }

  /**
   * Combines Installation state with its linked Activation's state (if any)
   * — the backend remains the sole authority on whether access is allowed.
   * An installation with no linked Activation (the legacy enrollment-token
   * path) always gets `activation: null` here, so every combined check below
   * short-circuits to exactly the installation-only behavior that existed
   * before this feature — purely additive.
   */
  private buildPolicy(
    installation: Installation,
    activation: { status: string; expiresAt: Date | null } | null,
    entitlementEndDate: Date | null,
  ) {
    const activationExpired =
      activation?.status === 'ACTIVE' && !!activation.expiresAt && activation.expiresAt.getTime() < Date.now();
    const entitlementExpired = !!entitlementEndDate && entitlementEndDate.getTime() < Date.now();

    return {
      installationId: installation.id,
      status: installation.status, // ACTIVE | SUSPENDED | INACTIVE | REVOKED
      suspended: installation.status === 'SUSPENDED' || activation?.status === 'SUSPENDED',
      revoked:
        installation.status === 'REVOKED' ||
        activation?.status === 'REVOKED' ||
        activationExpired ||
        entitlementExpired,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      gracePeriodDays: GRACE_PERIOD_DAYS,
      serverTime: new Date().toISOString(),
    };
  }
}

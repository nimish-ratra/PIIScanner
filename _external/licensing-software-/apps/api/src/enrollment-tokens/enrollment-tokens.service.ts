import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { LicenseAllocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { generateSecret, hashSecret } from '../agent/crypto.util.js';
import { DEFAULT_ENROLLMENT_TOKEN_MAX_ACTIVATIONS, DEFAULT_ENROLLMENT_TOKEN_TTL_DAYS } from '../agent/agent.constants.js';
import type { BulkCreateEnrollmentTokenDto, CreateEnrollmentTokenDto } from './enrollment-tokens.dto.js';

// Arbitrary but generous ceiling on a single bulk-generate call — protects
// against a fat-fingered quantity generating an unusable number of rows/CSV
// lines, not a real business constraint.
const MAX_BULK_QUANTITY = 500;

@Injectable()
export class EnrollmentTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, dto: CreateEnrollmentTokenDto, actorId: string) {
    if (!dto.allocationId?.trim()) {
      throw new BadRequestException('allocationId is required');
    }
    if (dto.maxActivations !== undefined && dto.maxActivations <= 0) {
      throw new BadRequestException('maxActivations must be positive');
    }
    if (dto.expiresInDays !== undefined && dto.expiresInDays <= 0) {
      throw new BadRequestException('expiresInDays must be positive');
    }

    const allocation = await this.prisma.licenseAllocation.findUnique({ where: { id: dto.allocationId } });
    if (!allocation || allocation.companyId !== companyId) {
      // 404, not 403 — avoids leaking the existence of another company's allocation (IDOR protection)
      throw new NotFoundException('License allocation not found');
    }

    const requested = dto.maxActivations ?? DEFAULT_ENROLLMENT_TOKEN_MAX_ACTIVATIONS;
    await this.assertIssuable(allocation, requested);

    const plaintext = generateSecret();
    const expiresAt = new Date(
      Date.now() + (dto.expiresInDays ?? DEFAULT_ENROLLMENT_TOKEN_TTL_DAYS) * 24 * 60 * 60 * 1000,
    );

    const token = await this.prisma.enrollmentToken.create({
      data: {
        companyId,
        allocationId: dto.allocationId,
        label: dto.label,
        tokenHash: hashSecret(plaintext),
        maxActivations: dto.maxActivations ?? DEFAULT_ENROLLMENT_TOKEN_MAX_ACTIVATIONS,
        createdBy: actorId,
        expiresAt,
      },
    });

    await this.audit.logEvent({
      companyId,
      actorId,
      actorType: 'USER',
      action: 'CREATE_ENROLLMENT_TOKEN',
      targetType: 'EnrollmentToken',
      targetId: token.id,
      result: 'SUCCESS',
    });

    // The plaintext token is returned exactly once here and is never persisted or retrievable again.
    return { ...this.omitHash(token), token: plaintext };
  }

  /**
   * Mints `quantity` independent single-use enrollment tokens against one
   * allocation in a single call — for handing a batch of individual codes to
   * IT (e.g. a spreadsheet mail-merge) rather than one shared secret typed
   * into every device. Distinct from create() above, which can also produce
   * a *shared* token (maxActivations > 1) for the "any device, same code"
   * unattended-push model — both flows remain available side by side.
   */
  async createBulk(companyId: string, dto: BulkCreateEnrollmentTokenDto, actorId: string) {
    if (!dto.allocationId?.trim()) {
      throw new BadRequestException('allocationId is required');
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    if (dto.quantity > MAX_BULK_QUANTITY) {
      throw new BadRequestException(`quantity cannot exceed ${MAX_BULK_QUANTITY} per batch`);
    }
    if (dto.expiresInDays !== undefined && dto.expiresInDays <= 0) {
      throw new BadRequestException('expiresInDays must be positive');
    }

    const allocation = await this.prisma.licenseAllocation.findUnique({ where: { id: dto.allocationId } });
    if (!allocation || allocation.companyId !== companyId) {
      throw new NotFoundException('License allocation not found');
    }

    await this.assertIssuable(allocation, dto.quantity);

    const expiresAt = new Date(
      Date.now() + (dto.expiresInDays ?? DEFAULT_ENROLLMENT_TOKEN_TTL_DAYS) * 24 * 60 * 60 * 1000,
    );

    const plaintexts: string[] = [];
    const created = await this.prisma.$transaction(
      Array.from({ length: dto.quantity }, (_, i) => {
        const plaintext = generateSecret();
        plaintexts.push(plaintext);
        return this.prisma.enrollmentToken.create({
          data: {
            companyId,
            allocationId: dto.allocationId,
            label: dto.label ? `${dto.label} #${i + 1}` : undefined,
            tokenHash: hashSecret(plaintext),
            maxActivations: 1,
            createdBy: actorId,
            expiresAt,
          },
        });
      }),
    );

    await this.audit.logEvent({
      companyId,
      actorId,
      actorType: 'USER',
      action: 'CREATE_ENROLLMENT_TOKEN_BULK',
      targetType: 'LicenseAllocation',
      targetId: dto.allocationId,
      result: 'SUCCESS',
      reason: `Bulk generated ${dto.quantity} enrollment tokens`,
    });

    // Each plaintext is returned exactly once here, same one-time discipline as create().
    return created.map((token, i) => ({ ...this.omitHash(token), token: plaintexts[i] }));
  }

  async findAll(companyId: string) {
    const tokens = await this.prisma.enrollmentToken.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((t) => this.omitHash(t));
  }

  async revoke(id: string, companyId: string, actorId: string) {
    const token = await this.prisma.enrollmentToken.findUnique({ where: { id } });
    if (!token || token.companyId !== companyId) {
      throw new NotFoundException('Enrollment token not found');
    }

    const updated = await this.prisma.enrollmentToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await this.audit.logEvent({
      companyId,
      actorId,
      actorType: 'USER',
      action: 'REVOKE_ENROLLMENT_TOKEN',
      targetType: 'EnrollmentToken',
      targetId: id,
      result: 'SUCCESS',
    });

    return this.omitHash(updated);
  }

  /**
   * Enforces that issuing `requestedActivations` more redemptions against
   * `allocation` won't out-run its remaining seat capacity. Tokens are just
   * vouchers — nothing previously stopped minting far more of them than an
   * allocation could ever satisfy (e.g. 200 single-use tokens against a
   * 100-seat allocation), which is harmless to *security* (redemption is
   * still capped by AgentService.register()'s own OCC check) but wastes
   * codes that can never all be redeemed and hides that fact from whoever's
   * distributing them.
   *
   * Only plain (activationId: null) tokens are counted here — an
   * activation-bound token's seat was already reserved in
   * allocation.consumedQuantity at Activation-creation time (see
   * AgentService.register()'s isActivationBound branch), so counting it
   * again here would double-charge the same seat.
   */
  private async assertIssuable(allocation: LicenseAllocation, requestedActivations: number): Promise<void> {
    const available = allocation.quantity - allocation.consumedQuantity;

    const liveTokens = await this.prisma.enrollmentToken.findMany({
      where: {
        allocationId: allocation.id,
        activationId: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { maxActivations: true, activationsUsed: true },
    });
    const outstanding = liveTokens.reduce(
      (sum, t) => sum + Math.max(0, t.maxActivations - t.activationsUsed),
      0,
    );

    if (outstanding + requestedActivations > available) {
      const issuable = Math.max(0, available - outstanding);
      throw new BadRequestException(
        `Cannot issue ${requestedActivations} activation(s): this allocation has ${available} seat(s) available and ${outstanding} are already reserved by unredeemed, unexpired enrollment tokens. At most ${issuable} more can be issued right now — revoke unused tokens or allocate more seats first.`,
      );
    }
  }

  private omitHash<T extends { tokenHash: string }>(token: T): Omit<T, 'tokenHash'> {
    const { tokenHash: _tokenHash, ...rest } = token;
    return rest;
  }
}

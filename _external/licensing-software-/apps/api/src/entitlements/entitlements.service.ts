import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  CreateEntitlementDto,
  ExtendEntitlementDto,
  UpdateEntitlementQuantityDto,
} from './entitlements.dto.js';

// Manual (SUSPENDED <-> ACTIVE, or either -> REVOKED) transitions a vendor
// operator can make. EXPIRED is not in this map — it is not a manual vendor
// action today (no expiry-sweep job exists in this codebase yet), and
// REVOKED is intentionally terminal — commercial history is not rewritten.
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
};

const AUDIT_ACTION_FOR_STATUS: Record<string, string> = {
  SUSPENDED: 'SUSPEND_ENTITLEMENT',
  REVOKED: 'REVOKE_ENTITLEMENT',
  ACTIVE: 'REACTIVATE_ENTITLEMENT',
};

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(enterpriseIds: string[]) {
    const where = enterpriseIds.includes('*') ? {} : { enterpriseId: { in: enterpriseIds } };
    return this.prisma.entitlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true } },
        edition: { select: { id: true, name: true } },
        // Enterprise.name is already an existing relation on Entitlement — this
        // is not a new capability, just enough of it to avoid showing the
        // vendor portal a raw enterpriseId where a customer name belongs.
        enterprise: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: string, enterpriseIds: string[]) {
    const entitlement = await this.prisma.entitlement.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true } },
        edition: { select: { id: true, name: true } },
        enterprise: { select: { id: true, name: true } },
        allocations: {
          include: {
            company: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!entitlement) {
      throw new NotFoundException('Entitlement not found');
    }

    if (!enterpriseIds.includes('*') && !enterpriseIds.includes(entitlement.enterpriseId)) {
      throw new NotFoundException('Entitlement not found');
    }

    return entitlement;
  }

  /**
   * Vendor entitlement issuance. Creates the commercial grant record only —
   * never individual per-seat licenses (those are LicenseAllocation rows,
   * created later by a Customer Admin via the existing allocate flow).
   */
  async create(dto: CreateEntitlementDto, actorId: string) {
    if (!dto.enterpriseId?.trim()) {
      throw new BadRequestException('enterpriseId is required');
    }
    if (!dto.productId?.trim()) {
      throw new BadRequestException('productId is required');
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid dates');
    }
    if (startDate > endDate) {
      throw new BadRequestException('startDate must not be after endDate');
    }

    const enterprise = await this.prisma.enterprise.findUnique({ where: { id: dto.enterpriseId } });
    if (!enterprise) {
      throw new BadRequestException('Customer not found');
    }
    if (enterprise.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot issue an entitlement to an inactive customer');
    }

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) {
      throw new BadRequestException('Product not found');
    }
    if (product.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot issue an entitlement for an inactive product');
    }

    if (dto.editionId) {
      const edition = await this.prisma.edition.findUnique({ where: { id: dto.editionId } });
      if (!edition) {
        throw new BadRequestException('Edition not found');
      }
      if (edition.productId !== dto.productId) {
        throw new BadRequestException('Edition does not belong to the selected product');
      }
      if (edition.status !== 'ACTIVE') {
        throw new BadRequestException('Cannot issue an entitlement for an inactive edition');
      }
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existingCount = await tx.entitlement.count({ where: { enterpriseId: dto.enterpriseId } });
          const reference = buildEntitlementReference(enterprise.name, enterprise.id, existingCount + 1 + attempt);

          const entitlement = await tx.entitlement.create({
            data: {
              enterpriseId: dto.enterpriseId,
              productId: dto.productId,
              editionId: dto.editionId || null,
              reference,
              quantity: dto.quantity,
              startDate,
              endDate,
              status: 'ACTIVE',
            },
            include: {
              product: { select: { id: true, name: true } },
              edition: { select: { id: true, name: true } },
              enterprise: { select: { id: true, name: true } },
            },
          });

          await this.audit.logEvent({
            enterpriseId: dto.enterpriseId,
            actorId,
            actorType: 'USER',
            action: 'CREATE_ENTITLEMENT',
            targetType: 'Entitlement',
            targetId: entitlement.id,
            result: 'SUCCESS',
            reason: `${product.name} x${dto.quantity} for ${enterprise.name}`,
          });

          return entitlement;
        });
      } catch (err: any) {
        // Unique constraint on `reference` — vanishingly rare (two issuances
        // for the same customer racing at the exact same count), retry with
        // the next candidate reference rather than failing the request.
        if (err?.code === 'P2002' && attempt < MAX_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }
    }
    // Unreachable — the loop above either returns or throws.
    throw new ConflictException('Could not generate a unique entitlement reference');
  }

  /**
   * Suspend / reactivate / revoke. OCC-guarded the same way LicensesService's
   * allocation flow is — a concurrent modification is rejected, never
   * silently overwritten.
   */
  async setStatus(id: string, newStatus: string, actorId: string) {
    const entitlement = await this.prisma.entitlement.findUnique({ where: { id } });
    if (!entitlement) {
      throw new NotFoundException('Entitlement not found');
    }

    const allowed = VALID_STATUS_TRANSITIONS[entitlement.status];
    if (!allowed?.includes(newStatus)) {
      throw new BadRequestException(`Invalid state transition from ${entitlement.status} to ${newStatus}`);
    }

    const updateResult = await this.prisma.entitlement.updateMany({
      where: { id, version: entitlement.version },
      data: { status: newStatus, version: { increment: 1 } },
    });

    if (updateResult.count === 0) {
      throw new ConflictException('Concurrent modification detected. Entitlement state changed — please retry.');
    }

    await this.audit.logEvent({
      enterpriseId: entitlement.enterpriseId,
      actorId,
      actorType: 'USER',
      action: AUDIT_ACTION_FOR_STATUS[newStatus] ?? 'UPDATE_ENTITLEMENT_STATUS',
      targetType: 'Entitlement',
      targetId: id,
      result: 'SUCCESS',
      reason: `Status changed from ${entitlement.status} to ${newStatus}`,
    });

    return this.prisma.entitlement.findUnique({ where: { id } });
  }

  /**
   * Extends the term. Only forward — shortening the term is not offered here
   * (that would rewrite commercial history rather than record a new
   * decision); use suspend/revoke instead to end an entitlement early.
   */
  async extend(id: string, dto: ExtendEntitlementDto, actorId: string) {
    const entitlement = await this.prisma.entitlement.findUnique({ where: { id } });
    if (!entitlement) {
      throw new NotFoundException('Entitlement not found');
    }
    if (entitlement.status === 'REVOKED') {
      throw new BadRequestException('Cannot extend a revoked entitlement');
    }

    const newEndDate = new Date(dto.endDate);
    if (Number.isNaN(newEndDate.getTime())) {
      throw new BadRequestException('endDate must be a valid date');
    }
    if (newEndDate <= entitlement.endDate) {
      throw new BadRequestException('New end date must be after the current end date');
    }

    const updateResult = await this.prisma.entitlement.updateMany({
      where: { id, version: entitlement.version },
      data: { endDate: newEndDate, version: { increment: 1 } },
    });

    if (updateResult.count === 0) {
      throw new ConflictException('Concurrent modification detected. Entitlement state changed — please retry.');
    }

    await this.audit.logEvent({
      enterpriseId: entitlement.enterpriseId,
      actorId,
      actorType: 'USER',
      action: 'EXTEND_ENTITLEMENT',
      targetType: 'Entitlement',
      targetId: id,
      result: 'SUCCESS',
      reason: `End date extended from ${entitlement.endDate.toISOString()} to ${newEndDate.toISOString()}`,
    });

    return this.prisma.entitlement.findUnique({ where: { id } });
  }

  /**
   * Adjusts the commercial quantity. Never allowed below allocatedQuantity —
   * that cache is a real invariant enforced elsewhere (LicensesService.allocate),
   * and this must not be the mutation that breaks it.
   */
  async updateQuantity(id: string, dto: UpdateEntitlementQuantityDto, actorId: string) {
    const entitlement = await this.prisma.entitlement.findUnique({ where: { id } });
    if (!entitlement) {
      throw new NotFoundException('Entitlement not found');
    }
    if (entitlement.status === 'REVOKED') {
      throw new BadRequestException('Cannot change the quantity of a revoked entitlement');
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    if (dto.quantity < entitlement.allocatedQuantity) {
      throw new BadRequestException(
        `quantity cannot be reduced below the already-allocated amount (${entitlement.allocatedQuantity})`,
      );
    }

    const updateResult = await this.prisma.entitlement.updateMany({
      where: { id, version: entitlement.version },
      data: { quantity: dto.quantity, version: { increment: 1 } },
    });

    if (updateResult.count === 0) {
      throw new ConflictException('Concurrent modification detected. Entitlement state changed — please retry.');
    }

    await this.audit.logEvent({
      enterpriseId: entitlement.enterpriseId,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_ENTITLEMENT_QUANTITY',
      targetType: 'Entitlement',
      targetId: id,
      result: 'SUCCESS',
      reason: `Quantity changed from ${entitlement.quantity} to ${dto.quantity}`,
    });

    return this.prisma.entitlement.findUnique({ where: { id } });
  }
}

/**
 * e.g. "ENT-ACME-CORPORATION-3F2A9C-2026-001"
 *
 * Includes a short fragment of the enterprise's own id, not just its name —
 * two different customers can legitimately have the same (or, once
 * truncated, the same-looking) name, and without something per-enterprise
 * unique in the prefix their sequence-1 references would collide on the
 * first entitlement each ever gets.
 */
function buildEntitlementReference(enterpriseName: string, enterpriseId: string, sequence: number): string {
  const slug = enterpriseName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);
  const idFragment = enterpriseId.replace(/-/g, '').slice(0, 6).toUpperCase();
  const year = new Date().getFullYear();
  const seq = String(sequence).padStart(3, '0');
  return `ENT-${slug}-${idFragment}-${year}-${seq}`;
}

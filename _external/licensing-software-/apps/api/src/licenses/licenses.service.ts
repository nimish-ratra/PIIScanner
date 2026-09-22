import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class LicensesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async findAll(allowedCompanyIds: string[]) {
    const where = allowedCompanyIds.includes('*') ? {} : { companyId: { in: allowedCompanyIds } };
    return this.prisma.licenseAllocation.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        entitlement: { select: { id: true, productId: true } }
      }
    });
  }

  async findOne(id: string, allowedCompanyIds: string[]) {
    const allocation = await this.prisma.licenseAllocation.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        entitlement: true
      }
    });

    if (!allocation) {
      throw new NotFoundException('License allocation not found');
    }

    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(allocation.companyId)) {
      throw new NotFoundException('License allocation not found'); // Prevent IDOR leak
    }

    return allocation;
  }

  /**
   * @param existingTx When provided, participates in the caller's own
   *   transaction instead of opening a new one — used by
   *   LicenseRequestsService.approve() so "allocate + create Activation +
   *   mark request APPROVED" is one atomic unit. Standalone callers (e.g. the
   *   direct vendor/customer allocate endpoint) omit it and get the original
   *   self-contained-transaction behavior, unchanged.
   */
  async allocate(
    entitlementId: string,
    companyId: string,
    quantity: number,
    actorId: string,
    existingTx?: Prisma.TransactionClient,
  ) {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const run = async (tx: Prisma.TransactionClient) => {
      // 1. Read Entitlement
      const entitlement = await tx.entitlement.findUnique({
        where: { id: entitlementId },
        include: { enterprise: true }
      });

      if (!entitlement) {
        throw new NotFoundException('Entitlement not found');
      }
      
      if (entitlement.status !== 'ACTIVE') {
        throw new BadRequestException('Cannot allocate from inactive entitlement');
      }
      if (entitlement.endDate.getTime() < Date.now()) {
        throw new BadRequestException('Cannot allocate from an entitlement whose end date has passed');
      }

      // Verify company belongs to the enterprise of this entitlement
      const company = await tx.company.findUnique({ where: { id: companyId }});
      if (!company || company.enterpriseId !== entitlement.enterpriseId) {
        throw new BadRequestException('Company does not belong to this enterprise');
      }

      // 2. Calculate available capacity
      const available = entitlement.quantity - entitlement.allocatedQuantity;
      if (quantity > available) {
        throw new BadRequestException(`Insufficient entitlement quantity. Requested: ${quantity}, Available: ${available}`);
      }

      // 3. Optimistic Concurrency Control
      const updateResult = await tx.entitlement.updateMany({
        where: {
          id: entitlementId,
          version: entitlement.version, // Ensure no one else mutated it since we read it
        },
        data: {
          allocatedQuantity: { increment: quantity },
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent allocation detected. Entitlement state changed.');
      }

      // 4. Create License Allocation
      const allocation = await tx.licenseAllocation.create({
        data: {
          companyId,
          entitlementId,
          quantity,
          status: 'ALLOCATED',
        }
      });

      await this.audit.logEvent({
        enterpriseId: entitlement.enterpriseId,
        companyId,
        actorId,
        actorType: 'USER',
        action: 'ALLOCATE_LICENSE',
        targetType: 'LicenseAllocation',
        targetId: allocation.id,
        result: 'SUCCESS',
        reason: `Allocated ${quantity} seats`
      });

      return allocation;
    };

    return existingTx ? run(existingTx) : this.prisma.$transaction(run);
  }

  async setStatus(id: string, allowedCompanyIds: string[], newStatus: string, actorId: string) {
    // Only certain transitions are legal
    const validTransitions: Record<string, string[]> = {
      'CREATED': ['ALLOCATED'],
      'ALLOCATED': ['ACTIVE', 'SUSPENDED', 'REVOKED'],
      'ACTIVE': ['SUSPENDED', 'REVOKED', 'EXPIRED'],
      'SUSPENDED': ['ACTIVE', 'REVOKED'],
    };

    const allocation = await this.findOne(id, allowedCompanyIds); // Reuses IDOR check

    if (!validTransitions[allocation.status]?.includes(newStatus)) {
      throw new BadRequestException(`Invalid state transition from ${allocation.status} to ${newStatus}`);
    }

    const updated = await this.prisma.licenseAllocation.update({
      where: { id },
      data: { status: newStatus }
    });

    await this.audit.logEvent({
      companyId: allocation.companyId,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_LICENSE_STATUS',
      targetType: 'LicenseAllocation',
      targetId: id,
      result: 'SUCCESS',
      reason: `Status changed to ${newStatus}`
    });

    return updated;
  }
}

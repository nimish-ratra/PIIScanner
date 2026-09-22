import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LicensesService } from '../licenses/licenses.service.js';
import { ActivationsService } from '../activations/activations.service.js';

/** The standard include shape used on every LicenseRequest query. */
const REQUEST_INCLUDE = {
  company:     { select: { id: true, name: true } },
  entitlement: {
    select: {
      id:       true,
      status:   true,
      quantity: true,
      allocatedQuantity: true,
      product:  { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class LicenseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly licensesService: LicensesService,
    private readonly activationsService: ActivationsService,
  ) {}

  /**
   * List all requests visible to the principal.
   *
   * Isolation rules:
   *   - EnterpriseAdmin (allowedCompanyIds = ['*']): scoped to their OWN enterprise
   *     via `enterpriseId`. Without this, a wildcard admin could see every enterprise's requests.
   *   - CompanyAdmin / regular user: scoped to the company IDs in `allowedCompanyIds`.
   */
  async findAll(allowedCompanyIds: string[], enterpriseId?: string) {
    let where: any;

    if (allowedCompanyIds.includes('*')) {
      // Enterprise-wide admin: must still be scoped to their enterprise
      where = enterpriseId ? { enterpriseId } : {};
    } else {
      where = { companyId: { in: allowedCompanyIds } };
    }

    return this.prisma.licenseRequest.findMany({
      where,
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fetch a single request.
   * Enforces enterprise-scoped isolation — a wildcard admin from Enterprise A
   * must not be able to read Enterprise B's requests.
   */
  async findOne(id: string, allowedCompanyIds: string[], enterpriseId?: string) {
    const req = await this.prisma.licenseRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });

    if (!req) throw new NotFoundException('License request not found');

    // Company-scoped: must be in the allowed list
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(req.companyId)) {
      throw new NotFoundException('License request not found');
    }

    // Enterprise-scoped: wildcard admins are still bounded to their enterprise
    if (allowedCompanyIds.includes('*') && enterpriseId && req.enterpriseId !== enterpriseId) {
      throw new NotFoundException('License request not found');
    }

    return req;
  }

  async create(
    companyId: string,
    entitlementId: string,
    quantity: number,
    reason: string,
    actorId: string,
    targetUserId?: string,
  ) {
    if (!quantity || quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive number');
    }
    // A request naming a specific employee recipient must be for exactly one
    // seat — there is no ambiguity to resolve about which seat of a
    // multi-seat request would belong to them. A request with no
    // targetUserId is ordinary capacity provisioning and may have any
    // quantity, unchanged from prior behavior.
    if (targetUserId && quantity !== 1) {
      throw new BadRequestException('A request with a targetUserId must have quantity 1');
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    // Verify the entitlement belongs to the same enterprise as the company
    const entitlement = await this.prisma.entitlement.findUnique({ where: { id: entitlementId } });
    if (!entitlement || entitlement.enterpriseId !== company.enterpriseId) {
      throw new NotFoundException('Entitlement not found');
    }

    if (targetUserId) {
      const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser || targetUser.companyId !== companyId) {
        throw new BadRequestException('targetUserId does not belong to the requesting company');
      }
    }

    const req = await this.prisma.licenseRequest.create({
      data: {
        enterpriseId:  company.enterpriseId,
        companyId,
        entitlementId,
        requestedBy:   actorId,
        targetUserId,
        quantity,
        reason,
        status: 'PENDING',
      },
      include: REQUEST_INCLUDE,
    });

    await this.audit.logEvent({
      enterpriseId: company.enterpriseId,
      companyId,
      actorId,
      actorType:  'USER',
      action:     'CREATE_LICENSE_REQUEST',
      targetType: 'LicenseRequest',
      targetId:   req.id,
      result:     'SUCCESS',
    });

    return req;
  }

  async approve(id: string, allowedCompanyIds: string[], enterpriseId: string | undefined, actorId: string) {
    const req = await this.findOne(id, allowedCompanyIds, enterpriseId);

    // A request can only ever be approved once — re-approving an already
    // APPROVED/REJECTED/CANCELLED request is rejected with 400, matching
    // existing behavior exactly (unchanged by this feature). Combined with
    // wrapping this whole method in one transaction below, this makes a
    // duplicate Activation structurally unreachable: the only path that
    // creates one requires the request to still be PENDING, and that
    // transition happens atomically with the Activation creation itself.
    // ActivationsService.createFromApprovedRequest()'s own requestId lookup
    // is kept as defense-in-depth on top of that.
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve request in ${req.status} status`);
    }

    // Guard: entitlement must belong to the same enterprise as the session principal.
    // Prevents a wildcard principal from approving cross-enterprise requests.
    if (enterpriseId && req.enterpriseId !== enterpriseId) {
      throw new NotFoundException('License request not found');
    }
    if (req.targetUserId && req.quantity !== 1) {
      throw new BadRequestException('A request with a targetUserId must have quantity 1');
    }

    // Multi-tenant rule: a pure capacity request (no targetUserId) draws
    // from the shared enterprise-level entitlement pool, so approving it
    // affects how much is left for *other* companies under the same
    // enterprise — only a principal with enterprise-wide scope may approve
    // it, never that same company's own admin, even though they hold
    // license_request.approve for their own company. A named-employee
    // request (targetUserId set) is a company-internal decision that
    // doesn't touch other companies' capacity, so it's unaffected — that
    // company's own admin can still approve it exactly as before.
    if (!req.targetUserId && !allowedCompanyIds.includes('*')) {
      throw new ForbiddenException(
        'Capacity requests can only be approved by an enterprise-level admin, not the requesting company’s own admin',
      );
    }

    // One transaction for "flip PENDING->APPROVED + allocate + (optionally)
    // create Activation" — previously allocate()'s own transaction and the
    // request-status update were two separate calls, leaving a window where
    // a crash between them could strand a request PENDING despite a real
    // allocation already existing. That gap matters more now that Activation
    // creation sits in the same critical section.
    //
    // The PENDING->APPROVED flip happens FIRST, via a conditional update
    // guarded on status still being PENDING — not the plain findOne() read
    // above, which is only a pre-check for a fast 400 and is NOT itself
    // concurrency-safe. Without this conditional guard, two concurrent
    // approve() calls for the SAME request could both pass the pre-check
    // (neither transaction has committed yet) and both proceed to allocate a
    // seat and create a duplicate Activation. Only the transaction that wins
    // this conditional update proceeds to allocate/activate; the loser gets
    // a clear Conflict rather than silently duplicating anything.
    const { updated, activation, enrollmentToken } = await this.prisma.$transaction(async (tx) => {
      const flipResult = await tx.licenseRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
      if (flipResult.count === 0) {
        throw new ConflictException('This request was already approved or reviewed by another request.');
      }

      const allocation = await this.licensesService.allocate(
        req.entitlementId,
        req.companyId,
        req.quantity,
        actorId,
        tx,
      );

      let activation: any = null;
      let enrollmentToken: any = null;
      if (req.targetUserId) {
        const result = await this.activationsService.createFromApprovedRequest(tx, req, allocation, actorId);
        activation = result.activation;
        enrollmentToken = result.enrollmentToken;
      }

      const updated = await tx.licenseRequest.findUnique({
        where: { id },
        include: REQUEST_INCLUDE,
      });

      return { updated, activation, enrollmentToken };
    });

    await this.audit.logEvent({
      enterpriseId: req.enterpriseId,
      companyId:    req.companyId,
      actorId,
      actorType:    'USER',
      action:       'APPROVE_LICENSE_REQUEST',
      targetType:   'LicenseRequest',
      targetId:     id,
      result:       'SUCCESS',
    });

    return { ...updated, activation, enrollmentToken };
  }

  async reject(
    id: string,
    allowedCompanyIds: string[],
    enterpriseId: string | undefined,
    reason: string,
    actorId: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    const req = await this.findOne(id, allowedCompanyIds, enterpriseId);

    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Cannot reject request in ${req.status} status`);
    }

    const updated = await this.prisma.licenseRequest.update({
      where: { id },
      data:  {
        status:       'REJECTED',
        reviewedBy:   actorId,
        reviewedAt:   new Date(),
        reviewReason: reason.trim(),
      },
      include: REQUEST_INCLUDE,
    });

    await this.audit.logEvent({
      enterpriseId: req.enterpriseId,
      companyId:    req.companyId,
      actorId,
      actorType:    'USER',
      action:       'REJECT_LICENSE_REQUEST',
      targetType:   'LicenseRequest',
      targetId:     id,
      result:       'SUCCESS',
      reason:       reason.trim(),
    });

    return updated;
  }
}

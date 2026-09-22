import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { generateSecret } from '../agent/crypto.util.js';
import type { CreateCustomerDto, CreateCompanyDto } from './customers.dto.js';

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vendor-side view of a "customer" — the Enterprise record. Deliberately
 * separate from CompaniesController (customer/companies), which is a
 * different resource scoped to CUSTOMER principals — a VendorUser must never
 * call that controller (see PermissionsGuard's principal-type isolation).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwordService: PasswordService,
  ) {}

  async findAll() {
    return this.prisma.enterprise.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { companies: true, entitlements: true } },
      },
    });
  }

  async findOne(id: string) {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id },
      include: {
        companies: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        entitlements: {
          orderBy: { createdAt: 'desc' },
          include: {
            product: { select: { id: true, name: true } },
            edition: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!enterprise) {
      throw new NotFoundException('Customer not found');
    }
    return enterprise;
  }

  /**
   * Creates a real, immediately-usable customer: an Enterprise, a default
   * Company under it, an EnterpriseAdmin Role/RoleAssignment, and a User with
   * a freshly generated Argon2id-hashed password. The plaintext password is
   * returned exactly once here, mirroring EnrollmentTokensService's pattern —
   * it is never persisted and can never be retrieved again.
   *
   * There is no password-reset/change flow yet (see the Customer Portal auth
   * work) — if this credential is lost, a new one can't currently be issued
   * to the same user without a direct database update.
   */
  async create(dto: CreateCustomerDto, actorId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!dto.adminName?.trim()) {
      throw new BadRequestException('adminName is required');
    }
    const adminEmail = dto.adminEmail?.trim().toLowerCase();
    if (!adminEmail || !EMAIL_PATTERN.test(adminEmail)) {
      throw new BadRequestException('A valid adminEmail is required');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: adminEmail } });
    if (existingUser) {
      throw new ConflictException(`A user with email "${adminEmail}" already exists`);
    }

    const temporaryPassword = generateSecret();
    const passwordHash = await this.passwordService.hash(temporaryPassword);

    const { enterprise, user } = await this.prisma.$transaction(async (tx) => {
      const enterprise = await tx.enterprise.create({ data: { name: dto.name.trim() } });

      const company = await tx.company.create({
        data: { name: dto.name.trim(), enterpriseId: enterprise.id },
      });

      const role = await tx.role.create({
        data: { companyId: company.id, name: 'EnterpriseAdmin', permissions: ['*'] },
      });

      const user = await tx.user.create({
        data: {
          email: adminEmail,
          name: dto.adminName.trim(),
          companyId: company.id,
          passwordHash,
          // The password returned below is system-generated and shown only
          // once — force a real one to be set before anything else is usable.
          mustChangePassword: true,
        },
      });

      // companyId: null = enterprise-wide scope, matching the seeded EnterpriseAdmin pattern.
      await tx.roleAssignment.create({
        data: { userId: user.id, roleId: role.id, companyId: null },
      });

      return { enterprise, user };
    });

    await this.audit.logEvent({
      enterpriseId: enterprise.id,
      actorId,
      actorType: 'USER',
      action: 'CREATE_CUSTOMER',
      targetType: 'Enterprise',
      targetId: enterprise.id,
      result: 'SUCCESS',
      reason: `Initial admin: ${adminEmail}`,
    });

    return {
      ...enterprise,
      initialAdmin: {
        userId: user.id,
        email: user.email,
        // Shown exactly once — the vendor must hand this to the customer now;
        // it cannot be recovered from the server again.
        temporaryPassword,
      },
    };
  }

  /**
   * Adds a new Company (subsidiary/business unit) under an existing
   * customer's Enterprise. This is a vendor-only action, gated the same way
   * customer creation is — company/subsidiary structure is provisioned by
   * the vendor as part of the commercial relationship, not self-served by
   * the customer. Any existing EnterpriseAdmin (companyId: null
   * RoleAssignment) automatically gains visibility into the new company on
   * their next session refresh — IdentityService.buildPrincipal recomputes
   * allowedCompanyIds from the enterprise's companies fresh every time.
   */
  async addCompany(enterpriseId: string, dto: CreateCompanyDto, actorId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    const enterprise = await this.prisma.enterprise.findUnique({ where: { id: enterpriseId } });
    if (!enterprise) {
      throw new NotFoundException('Customer not found');
    }

    const company = await this.prisma.company.create({
      data: { name: dto.name.trim(), enterpriseId },
    });

    await this.audit.logEvent({
      enterpriseId,
      actorId,
      actorType: 'USER',
      action: 'CREATE_COMPANY',
      targetType: 'Company',
      targetId: company.id,
      result: 'SUCCESS',
      reason: `Company "${company.name}" added to enterprise`,
    });

    return company;
  }

  async setStatus(id: string, status: string, actorId: string) {
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const existing = await this.prisma.enterprise.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Customer not found');
    }

    const updated = await this.prisma.enterprise.update({
      where: { id },
      data: { status },
    });

    await this.audit.logEvent({
      enterpriseId: id,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_CUSTOMER_STATUS',
      targetType: 'Enterprise',
      targetId: id,
      result: 'SUCCESS',
      reason: `Status changed to ${status}`,
    });

    return updated;
  }
}

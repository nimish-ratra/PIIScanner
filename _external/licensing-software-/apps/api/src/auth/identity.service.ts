/**
 * IdentityService
 *
 * Resolves a fully-loaded application principal (roles, permissions,
 * allowedCompanyIds) for a local User by id. Used by AuthGuard after a
 * session cookie is unsealed, regardless of how that session was
 * established (password login today; the E2E test path builds its own
 * principal shape directly and does not go through this service).
 *
 * Security invariants:
 *   - A disabled local User is DENIED even with a valid session.
 *   - Roles and permissions are loaded fresh from the DB on every call
 *     (never trusted from the session cookie's own contents).
 */

import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ResolvedPrincipal {
  id: string;
  email: string;
  principalType: 'CUSTOMER' | 'VENDOR';
  roles: string[];
  permissions: Set<string>;
  // '*' means "every tenant in the system" and is reserved for VENDOR
  // principals only — see buildPrincipal's doc comment for why a CUSTOMER
  // principal must never receive that literal value here, even for an
  // enterprise-wide (companyId: null) role assignment.
  allowedCompanyIds: string[];
  // True for a CUSTOMER principal with an enterprise-wide (companyId: null)
  // role assignment — the frontend's "is this an Enterprise Admin" signal,
  // now that allowedCompanyIds itself is always a concrete, real list.
  isEnterpriseWide?: boolean;
  // Vendor principals are global (not tied to a Company/Enterprise) — absent for VENDOR.
  enterpriseId?: string;
  companyId?: string;
  // True when this CUSTOMER principal is still on a system-generated
  // temporary password (e.g. one issued when a vendor created this
  // customer) — the frontend forces a password change before anything
  // else. Absent for VENDOR.
  mustChangePassword?: boolean;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a fully-loaded principal from a local user ID.
   * Called by AuthGuard on every authenticated request after unsealing the session.
   */
  async resolvePrincipalById(userId: string): Promise<ResolvedPrincipal> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: true,
        roleAssignments: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Local user not found');
    }

    if (!user.isActive) {
      this.logger.warn(`Access denied: user ${userId} is disabled`);
      throw new ForbiddenException('Account is disabled');
    }

    return await this.buildPrincipal(user);
  }

  /**
   * Resolve a fully-loaded VENDOR principal from a VendorUser id.
   * Roles come from the VendorUser row itself (no Role/RoleAssignment table
   * for vendors — there's exactly one real role today). Permissions are
   * derived from roles the same way the E2E test path derives them
   * (AuthGuard.deriveE2ePermissions) rather than a separate lookup, since
   * that's the full extent of vendor RBAC that exists.
   */
  async resolveVendorPrincipalById(userId: string): Promise<ResolvedPrincipal> {
    const vendorUser = await this.prisma.vendorUser.findUnique({ where: { id: userId } });

    if (!vendorUser) {
      throw new UnauthorizedException('Vendor user not found');
    }

    if (!vendorUser.isActive) {
      this.logger.warn(`Access denied: vendor user ${userId} is disabled`);
      throw new ForbiddenException('Account is disabled');
    }

    const roles = vendorUser.roles.length > 0 ? vendorUser.roles : ['TrustfabricAdmin'];

    return {
      id: vendorUser.id,
      email: vendorUser.email,
      principalType: 'VENDOR',
      roles,
      // TrustfabricAdmin is the only vendor role today and holds full access.
      permissions: new Set(roles.includes('TrustfabricAdmin') ? ['*'] : []),
      allowedCompanyIds: ['*'],
    };
  }

  /**
   * SECURITY: a `companyId: null` RoleAssignment means "every company in
   * MY enterprise" — it must never be resolved to the literal '*' sentinel,
   * which numerous services (CompaniesService, EntitlementsController,
   * AuditService, LicensesService, LicenseRequestsService, TenantGuard, ...)
   * treat as "skip company scoping entirely". Doing that for a CUSTOMER
   * principal previously let ANY Enterprise Admin see every OTHER
   * customer's companies, entitlements, licenses, and audit logs —
   * a real cross-tenant data leak, found via manual testing of a freshly
   * created customer login. Resolving enterprise-wide scope to the
   * concrete list of that enterprise's own company ids fixes every one of
   * those call sites at once, since none of them will ever see the
   * ambiguous wildcard for a customer again. '*' remains reserved for
   * VENDOR principals (see resolveVendorPrincipalById), whose global access
   * is intentional.
   */
  private async buildPrincipal(user: any): Promise<ResolvedPrincipal> {
    // Aggregate all permissions from all role assignments
    const permissions = new Set<string>();
    const roles: string[] = [];
    const explicitCompanyIds: string[] = [];
    let isEnterpriseWide = false;

    for (const ra of user.roleAssignments) {
      if (!roles.includes(ra.role.name)) {
        roles.push(ra.role.name);
      }

      for (const perm of ra.role.permissions) {
        permissions.add(perm);
      }

      if (ra.companyId === null) {
        isEnterpriseWide = true;
      } else if (!explicitCompanyIds.includes(ra.companyId)) {
        explicitCompanyIds.push(ra.companyId);
      }
    }

    let allowedCompanyIds: string[];
    if (isEnterpriseWide) {
      const siblingCompanies = await this.prisma.company.findMany({
        where: { enterpriseId: user.company.enterpriseId },
        select: { id: true },
      });
      allowedCompanyIds = siblingCompanies.map((c) => c.id);
    } else {
      allowedCompanyIds = explicitCompanyIds;
    }

    // Defense-in-depth: this should be structurally impossible given the code
    // above (allowedCompanyIds is always either real Company ids from the DB
    // or explicit RoleAssignment company ids, never the literal sentinel) —
    // but numerous call sites across the codebase still branch on
    // `allowedCompanyIds.includes('*')` to decide whether to skip company
    // scoping entirely (see the security comment above this method), so if
    // this invariant is ever broken by a future change here, it must fail
    // loudly at the source rather than silently leaking every enterprise's
    // data through those call sites again.
    if (allowedCompanyIds.includes('*')) {
      throw new Error(
        `SECURITY INVARIANT VIOLATION: buildPrincipal() computed allowedCompanyIds=['*'] for CUSTOMER user ${user.id} — '*' is reserved for VENDOR principals only.`,
      );
    }

    return {
      id: user.id,
      email: user.email,
      principalType: 'CUSTOMER',
      roles,
      permissions,
      allowedCompanyIds,
      isEnterpriseWide,
      enterpriseId: user.company.enterpriseId,
      companyId: user.companyId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}

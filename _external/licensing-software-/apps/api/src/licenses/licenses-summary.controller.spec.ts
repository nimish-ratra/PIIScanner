/**
 * LicensesSummaryController — cross-tenant isolation regression tests.
 *
 * This controller previously used an empty {} Prisma filter for
 * enterprise-wide principals, on the mistaken assumption that
 * "enterprise-wide" meant the same thing as VENDOR's true global '*' access.
 * That summed license allocations and active installations across every
 * enterprise in the system, not just the caller's own — found via manual
 * testing where one customer's portal displayed another customer's
 * allocated-seat totals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LicensesSummaryController } from './licenses-summary.controller.js';

function makePrisma(overrides: Partial<any> = {}): any {
  return {
    user: { findUnique: vi.fn() },
    entitlement: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0, allocatedQuantity: 0 } }) },
    licenseAllocation: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    installation: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    company: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('LicensesSummaryController', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let controller: LicensesSummaryController;

  beforeEach(() => {
    prisma = makePrisma();
    controller = new LicensesSummaryController(prisma);
  });

  it('An enterprise-wide principal only sees allocations scoped to their own companies (no cross-tenant leak)', async () => {
    // Enterprise "rock" has one company and zero allocations of its own.
    // Another enterprise ("acme") has a 50-seat allocation sitting in the DB.
    // The aggregate call must be scoped to rock's own company, so it must
    // never see acme's 50.
    const req = {
      user: {
        id: 'user-rock',
        isEnterpriseWide: true,
        allowedCompanyIds: ['company-rock'],
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-rock', company: { enterpriseId: 'ent-rock' } });

    await controller.getSummary(req);

    expect(prisma.licenseAllocation.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: { in: ['company-rock'] } } }),
    );
  });

  it('The allocation/installation aggregate filters are never an empty {} filter for a CUSTOMER principal', async () => {
    const req = {
      user: {
        id: 'user-1',
        isEnterpriseWide: true,
        allowedCompanyIds: ['company-a', 'company-b'],
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', company: { enterpriseId: 'ent-1' } });

    await controller.getSummary(req);

    const allocCall = prisma.licenseAllocation.aggregate.mock.calls[0][0];
    const instCall = prisma.installation.count.mock.calls[0][0];
    expect(allocCall.where).not.toEqual({});
    expect(instCall.where).not.toEqual({ status: 'ACTIVE' });
    expect(allocCall.where.companyId.in).toEqual(['company-a', 'company-b']);
    expect(instCall.where.companyId.in).toEqual(['company-a', 'company-b']);
  });

  it('totalEntitled is computed for an enterprise-wide principal (isEnterpriseWide, not allowedCompanyIds contents, gates it)', async () => {
    const req = {
      user: {
        id: 'user-1',
        isEnterpriseWide: true,
        allowedCompanyIds: ['company-a'],
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', company: { enterpriseId: 'ent-1' } });
    prisma.entitlement.aggregate.mockResolvedValue({ _sum: { quantity: 100, allocatedQuantity: 50 } });

    const result = await controller.getSummary(req);

    expect(prisma.entitlement.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enterpriseId: 'ent-1', status: 'ACTIVE' } }),
    );
    expect(result.totalEntitled).toBe(100);
  });

  it('A non-enterprise-wide (company-scoped) principal never triggers the entitlement lookup', async () => {
    const req = {
      user: {
        id: 'user-2',
        isEnterpriseWide: false,
        allowedCompanyIds: ['company-a'],
      },
    };

    const result = await controller.getSummary(req);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.entitlement.aggregate).not.toHaveBeenCalled();
    expect(result.totalEntitled).toBe(0);
    expect(prisma.licenseAllocation.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: { in: ['company-a'] } } }),
    );
  });

  it('companyUtilization groupBy calls are also scoped to allowedCompanyIds, never global', async () => {
    const req = {
      user: {
        id: 'user-1',
        isEnterpriseWide: true,
        allowedCompanyIds: ['company-a', 'company-b'],
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', company: { enterpriseId: 'ent-1' } });

    await controller.getSummary(req);

    expect(prisma.licenseAllocation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: { in: ['company-a', 'company-b'] } } }),
    );
    expect(prisma.installation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE', companyId: { in: ['company-a', 'company-b'] } } }),
    );
  });
});

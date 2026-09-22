import { Controller, Get, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';

@Controller('customer/licenses/summary')
export class LicensesSummaryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('license.read')
  async getSummary(@Request() req: any) {
    const { allowedCompanyIds } = req.user;
    // A CUSTOMER's allowedCompanyIds is always a concrete list of their own
    // enterprise's company ids now (never the literal '*' — see
    // IdentityService.buildPrincipal), so enterprise-wide scope must be read
    // from isEnterpriseWide, not inferred from allowedCompanyIds.
    const isEnterpriseScope = req.user.isEnterpriseWide ?? false;

    // To properly calculate total entitled, we need the enterpriseId for the current user's scope.
    // If not enterprise scope, they only see allocations.
    
    let totalEntitled = 0;
    let totalAllocated = 0;
    let activeInstallations = 0;
    let userRecord: any = null;

    if (isEnterpriseScope) {
      userRecord = await this.prisma.user.findUnique({
        where: { id: req.user.id },
        include: { company: true }
      });
      
      if (userRecord) {
        const entAggr = await this.prisma.entitlement.aggregate({
          where: { enterpriseId: userRecord.company.enterpriseId, status: 'ACTIVE' },
          _sum: { quantity: true, allocatedQuantity: true }
        });
        totalEntitled = entAggr._sum.quantity || 0;
      }
    }

    // NEVER use an empty {} filter here — allowedCompanyIds is always a real,
    // concrete list scoped to this principal's own enterprise (even when
    // enterprise-wide), so it must always be applied. An empty filter for the
    // enterprise-wide case previously summed allocations/installations across
    // EVERY enterprise in the system — a cross-tenant leak.
    const allocWhere = { companyId: { in: allowedCompanyIds } };
    const allocAggr = await this.prisma.licenseAllocation.aggregate({
      where: allocWhere,
      _sum: { quantity: true }
    });
    totalAllocated = allocAggr._sum.quantity || 0;

    const instWhere = { status: 'ACTIVE', companyId: { in: allowedCompanyIds } };
    const activeInstallationsCount = await this.prisma.installation.count({
      where: instWhere
    });

    const companyUtilization = [];
    if (isEnterpriseScope) {
      const companies = await this.prisma.company.findMany({
        where: { enterpriseId: userRecord?.company?.enterpriseId }
      });
      
      const allocations = await this.prisma.licenseAllocation.groupBy({
        by: ['companyId'],
        where: { companyId: { in: allowedCompanyIds } },
        _sum: { quantity: true },
      });

      const installations = await this.prisma.installation.groupBy({
        by: ['companyId'],
        where: { status: 'ACTIVE', companyId: { in: allowedCompanyIds } },
        _count: { id: true },
      });

      for (const comp of companies) {
        const allocated = allocations.find(a => a.companyId === comp.id)?._sum?.quantity || 0;
        const active = installations.find(i => i.companyId === comp.id)?._count?.id || 0;
        companyUtilization.push({
          companyId: comp.id,
          companyName: comp.name,
          allocated,
          active,
        });
      }
    }

    return {
      totalEntitled,
      totalAllocated,
      activeInstallations: activeInstallationsCount,
      companyUtilization
    };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(allowedCompanyIds: string[]) {
    const where = allowedCompanyIds.includes('*') 
      ? {} 
      : { id: { in: allowedCompanyIds } };

    return this.prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        enterpriseId: true,
        allowedEmailDomains: true,
        telemetryEnabled: true,
        syncFullPaths: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string, allowedCompanyIds: string[]) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(id)) {
      throw new NotFoundException('Company not found');
    }

    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        enterpriseId: true,
        allowedEmailDomains: true,
        telemetryEnabled: true,
        syncFullPaths: true,
        createdAt: true,
        updatedAt: true,
        enterprise: {
          select: {
            name: true,
          }
        }
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  /**
   * Configures which employee-email domains this company accepts when
   * self-declared at agent registration time (see AgentService.register()).
   * An empty array means "no enforcement configured" — that's a deliberate,
   * valid state, not an error, so a company can be onboarded before anyone
   * gets around to setting this.
   */
  async setAllowedEmailDomains(id: string, allowedEmailDomains: unknown, allowedCompanyIds: string[], actorId: string) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(id)) {
      // 404, not 403 — same IDOR-avoidance convention used elsewhere in this codebase.
      throw new NotFoundException('Company not found');
    }
    if (!Array.isArray(allowedEmailDomains) || allowedEmailDomains.some((d) => typeof d !== 'string')) {
      throw new BadRequestException('allowedEmailDomains must be an array of strings');
    }

    const normalized = Array.from(
      new Set(
        allowedEmailDomains
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d.length > 0),
      ),
    );

    const company = await this.prisma.company.update({
      where: { id },
      data: { allowedEmailDomains: normalized },
      select: { id: true, name: true, allowedEmailDomains: true },
    });

    await this.audit.logEvent({
      companyId: id,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_COMPANY_EMAIL_DOMAINS',
      targetType: 'Company',
      targetId: id,
      result: 'SUCCESS',
      reason: `Set allowed email domains to [${normalized.join(', ')}]`,
    });

    return company;
  }

  /**
   * Updates company-level fleet telemetry settings (telemetryEnabled, syncFullPaths).
   */
  async updateTelemetrySettings(
    id: string,
    dto: { telemetryEnabled?: boolean; syncFullPaths?: boolean },
    allowedCompanyIds: string[],
    actorId: string,
  ) {
    if (!allowedCompanyIds.includes('*') && !allowedCompanyIds.includes(id)) {
      throw new NotFoundException('Company not found');
    }

    const data: { telemetryEnabled?: boolean; syncFullPaths?: boolean } = {};
    if (typeof dto.telemetryEnabled === 'boolean') {
      data.telemetryEnabled = dto.telemetryEnabled;
    }
    if (typeof dto.syncFullPaths === 'boolean') {
      data.syncFullPaths = dto.syncFullPaths;
    }

    const company = await this.prisma.company.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        allowedEmailDomains: true,
        telemetryEnabled: true,
        syncFullPaths: true,
      },
    });

    await this.audit.logEvent({
      companyId: id,
      actorId,
      actorType: 'USER',
      action: 'UPDATE_COMPANY_TELEMETRY_SETTINGS',
      targetType: 'Company',
      targetId: id,
      result: 'SUCCESS',
      reason: `Updated telemetry settings: telemetryEnabled=${company.telemetryEnabled}, syncFullPaths=${company.syncFullPaths}`,
    });

    return company;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface CreateAuditEventDto {
  enterpriseId?: string;
  companyId?: string;
  actorId: string;
  actorType: 'USER' | 'SYSTEM' | 'AGENT';
  action: string;
  targetType: string;
  targetId?: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILURE';
  reason?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async logEvent(dto: CreateAuditEventDto): Promise<void> {
    try {
      // Phase 2: Synchronous write to PostgreSQL.
      // Future: Push to Redis/BullMQ queue for asynchronous processing.
      await this.prisma.auditEvent.create({
        data: dto,
      });
      this.logger.log(`Audit Event: ${dto.action} on ${dto.targetType} [${dto.result}]`);
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Failed to persist audit event: ${e.message}`, e.stack);
    }
  }

  async findAll(allowedCompanyIds: string[], filters: { 
    companyId?: string, actorId?: string, action?: string, targetType?: string, result?: string, limit?: number, offset?: number 
  } = {}) {
    const where: any = {};
    
    // Authorization scope
    if (!allowedCompanyIds.includes('*')) {
      where.companyId = { in: allowedCompanyIds };
    }

    if (filters.companyId && (allowedCompanyIds.includes('*') || allowedCompanyIds.includes(filters.companyId))) {
      where.companyId = filters.companyId;
    }
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.result) where.result = filters.result;

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
        include: {
          company: { select: { name: true } }
        }
      }),
      this.prisma.auditEvent.count({ where })
    ]);

    return {
      data: events,
      meta: {
        total,
        limit: filters.limit || 50,
        offset: filters.offset || 0
      }
    };
  }
}

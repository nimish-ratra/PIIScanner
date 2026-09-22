import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateFeatureDto, UpdateFeatureDto } from './features.dto.js';

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(editionId: string, dto: CreateFeatureDto, actorId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!dto.key?.trim()) {
      throw new BadRequestException('key is required');
    }

    const edition = await this.prisma.edition.findUnique({ where: { id: editionId } });
    if (!edition) {
      throw new NotFoundException('Edition not found');
    }

    const key = dto.key.trim();
    const existing = await this.prisma.feature.findFirst({ where: { editionId, key } });
    if (existing) {
      throw new ConflictException(`A feature with key "${key}" already exists in this edition`);
    }

    const feature = await this.prisma.feature.create({
      data: {
        editionId,
        name: dto.name.trim(),
        key,
        description: dto.description?.trim() || null,
      },
    });

    await this.audit.logEvent({
      actorId,
      actorType: 'USER',
      action: 'CREATE_FEATURE',
      targetType: 'Feature',
      targetId: feature.id,
      result: 'SUCCESS',
      reason: `Edition: ${edition.name}`,
    });

    return feature;
  }

  async update(id: string, dto: UpdateFeatureDto, actorId: string) {
    const existing = await this.prisma.feature.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Feature not found');
    }

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('name cannot be empty');
    }
    if (dto.key !== undefined) {
      if (!dto.key.trim()) {
        throw new BadRequestException('key cannot be empty');
      }
      const duplicate = await this.prisma.feature.findFirst({
        where: { editionId: existing.editionId, key: dto.key.trim(), id: { not: id } },
      });
      if (duplicate) {
        throw new ConflictException(`A feature with key "${dto.key.trim()}" already exists in this edition`);
      }
    }
    if (dto.status !== undefined && !VALID_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const updated = await this.prisma.feature.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.key !== undefined ? { key: dto.key.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    await this.audit.logEvent({
      actorId,
      actorType: 'USER',
      action: 'UPDATE_FEATURE',
      targetType: 'Feature',
      targetId: id,
      result: 'SUCCESS',
      reason: dto.status !== undefined ? `Status changed to ${dto.status}` : undefined,
    });

    return updated;
  }
}

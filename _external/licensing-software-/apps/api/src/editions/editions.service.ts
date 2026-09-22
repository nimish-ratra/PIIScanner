import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateEditionDto, UpdateEditionDto } from './editions.dto.js';

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

@Injectable()
export class EditionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAllForProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.prisma.edition.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
      include: { features: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async create(productId: string, dto: CreateEditionDto, actorId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const edition = await this.prisma.edition.create({
      data: {
        productId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
      },
    });

    await this.audit.logEvent({
      actorId,
      actorType: 'USER',
      action: 'CREATE_EDITION',
      targetType: 'Edition',
      targetId: edition.id,
      result: 'SUCCESS',
      reason: `Product: ${product.name}`,
    });

    return edition;
  }

  async update(id: string, dto: UpdateEditionDto, actorId: string) {
    const existing = await this.prisma.edition.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Edition not found');
    }

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('name cannot be empty');
    }
    if (dto.status !== undefined && !VALID_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const updated = await this.prisma.edition.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    await this.audit.logEvent({
      actorId,
      actorType: 'USER',
      action: 'UPDATE_EDITION',
      targetType: 'Edition',
      targetId: id,
      result: 'SUCCESS',
      reason: dto.status !== undefined ? `Status changed to ${dto.status}` : undefined,
    });

    return updated;
  }
}

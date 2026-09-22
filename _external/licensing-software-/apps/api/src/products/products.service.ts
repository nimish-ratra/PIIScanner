import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateProductDto, UpdateProductDto } from './products.dto.js';

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    return this.prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { editions: true, entitlements: true } },
      },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        editions: {
          orderBy: { createdAt: 'asc' },
          include: {
            features: { orderBy: { createdAt: 'asc' } },
            _count: { select: { entitlements: true } },
          },
        },
        _count: { select: { entitlements: true } },
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async create(dto: CreateProductDto, actorId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    const product = await this.prisma.product.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
      },
    });

    await this.audit.logEvent({
      actorId,
      actorType: 'USER',
      action: 'CREATE_PRODUCT',
      targetType: 'Product',
      targetId: product.id,
      result: 'SUCCESS',
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('name cannot be empty');
    }
    if (dto.status !== undefined && !VALID_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const updated = await this.prisma.product.update({
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
      action: 'UPDATE_PRODUCT',
      targetType: 'Product',
      targetId: id,
      result: 'SUCCESS',
      reason: dto.status !== undefined ? `Status changed to ${dto.status}` : undefined,
    });

    return updated;
  }
}

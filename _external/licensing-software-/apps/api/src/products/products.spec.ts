import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service.js';

function makePrisma(): any {
  return {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

describe('ProductsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: ProductsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new ProductsService(prisma, audit);
  });

  it('create() rejects a missing name', async () => {
    await expect(service.create({ name: '  ' } as any, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('create() trims name/description and persists via Prisma', async () => {
    prisma.product.create.mockResolvedValue({ id: 'p1', name: 'Trustfabric Pro', description: 'x', status: 'ACTIVE' });
    const result = await service.create({ name: '  Trustfabric Pro  ', description: '  x  ' }, 'vendor-1');
    expect(prisma.product.create).toHaveBeenCalledWith({ data: { name: 'Trustfabric Pro', description: 'x' } });
    expect(result.id).toBe('p1');
  });

  it('create() records a CREATE_PRODUCT audit event', async () => {
    prisma.product.create.mockResolvedValue({ id: 'p1', name: 'Trustfabric Pro' });
    await service.create({ name: 'Trustfabric Pro' }, 'vendor-1');
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_PRODUCT', actorId: 'vendor-1', targetId: 'p1', result: 'SUCCESS' }),
    );
  });

  it('update() 404s for an unknown product', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { name: 'x' }, 'vendor-1')).rejects.toThrow(NotFoundException);
  });

  it('update() rejects an invalid status value', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trustfabric Pro' });
    await expect(service.update('p1', { status: 'DELETED' }, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('update() disables a product and records UPDATE_PRODUCT', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trustfabric Pro' });
    prisma.product.update.mockResolvedValue({ id: 'p1', status: 'INACTIVE' });
    const result = await service.update('p1', { status: 'INACTIVE' }, 'vendor-1');
    expect(result.status).toBe('INACTIVE');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_PRODUCT' }));
  });
});

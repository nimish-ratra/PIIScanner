import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EditionsService } from './editions.service.js';

function makePrisma(): any {
  return {
    product: { findUnique: vi.fn() },
    edition: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

describe('EditionsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: EditionsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new EditionsService(prisma, audit);
  });

  it('create() 404s when the parent product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.create('missing-product', { name: 'Enterprise' }, 'vendor-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('create() rejects a missing name', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trustfabric Pro' });
    await expect(service.create('p1', { name: '' } as any, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('create() persists the edition under the given product and audits it', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Trustfabric Pro' });
    prisma.edition.create.mockResolvedValue({ id: 'e1', productId: 'p1', name: 'Enterprise Edition' });

    const result = await service.create('p1', { name: 'Enterprise Edition' }, 'vendor-1');

    expect(prisma.edition.create).toHaveBeenCalledWith({
      data: { productId: 'p1', name: 'Enterprise Edition', description: null },
    });
    expect(result.id).toBe('e1');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_EDITION', targetId: 'e1' }));
  });

  it('update() rejects an invalid status', async () => {
    prisma.edition.findUnique.mockResolvedValue({ id: 'e1' });
    await expect(service.update('e1', { status: 'GONE' }, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('update() 404s for an unknown edition', async () => {
    prisma.edition.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { status: 'INACTIVE' }, 'vendor-1')).rejects.toThrow(NotFoundException);
  });
});

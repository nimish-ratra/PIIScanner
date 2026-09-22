import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service.js';

function makePrisma(): any {
  const prisma: any = {
    enterprise: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    edition: { findUnique: vi.fn() },
    entitlement: {
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

const ACTIVE_ENTERPRISE = { id: 'ent-1', name: 'Acme Corporation', status: 'ACTIVE' };
const ACTIVE_PRODUCT = { id: 'prod-1', name: 'Trustfabric Pro', status: 'ACTIVE' };
const ACTIVE_EDITION = { id: 'ed-1', productId: 'prod-1', name: 'Enterprise', status: 'ACTIVE' };

const VALID_CREATE_DTO = {
  enterpriseId: 'ent-1',
  productId: 'prod-1',
  quantity: 500,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
};

describe('EntitlementsService.create (issuance)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: EntitlementsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new EntitlementsService(prisma, audit);
    prisma.enterprise.findUnique.mockResolvedValue(ACTIVE_ENTERPRISE);
    prisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
    prisma.edition.findUnique.mockResolvedValue(ACTIVE_EDITION);
  });

  it('rejects a non-positive quantity', async () => {
    await expect(service.create({ ...VALID_CREATE_DTO, quantity: 0 }, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid dates', async () => {
    await expect(
      service.create({ ...VALID_CREATE_DTO, startDate: 'not-a-date' }, 'vendor-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects startDate after endDate', async () => {
    await expect(
      service.create({ ...VALID_CREATE_DTO, startDate: '2026-12-31', endDate: '2026-01-01' }, 'vendor-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown customer', async () => {
    prisma.enterprise.findUnique.mockResolvedValue(null);
    await expect(service.create(VALID_CREATE_DTO, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects issuance to an inactive customer', async () => {
    prisma.enterprise.findUnique.mockResolvedValue({ ...ACTIVE_ENTERPRISE, status: 'INACTIVE' });
    await expect(service.create(VALID_CREATE_DTO, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown product', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.create(VALID_CREATE_DTO, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects an inactive product', async () => {
    prisma.product.findUnique.mockResolvedValue({ ...ACTIVE_PRODUCT, status: 'INACTIVE' });
    await expect(service.create(VALID_CREATE_DTO, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects an edition that does not belong to the given product', async () => {
    prisma.edition.findUnique.mockResolvedValue({ ...ACTIVE_EDITION, productId: 'some-other-product' });
    await expect(service.create({ ...VALID_CREATE_DTO, editionId: 'ed-1' }, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an unknown edition', async () => {
    prisma.edition.findUnique.mockResolvedValue(null);
    await expect(service.create({ ...VALID_CREATE_DTO, editionId: 'missing' }, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('creates the entitlement with a generated human-readable reference', async () => {
    prisma.entitlement.count.mockResolvedValue(0);
    prisma.entitlement.create.mockResolvedValue({ id: 'ent-x', reference: 'ENT-ACME-CORPORATION-ENT1-2026-001' });

    const result = await service.create(VALID_CREATE_DTO, 'vendor-1');

    expect(prisma.entitlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reference: expect.stringMatching(/^ENT-ACME-CORPORATION-[A-Z0-9]+-\d{4}-001$/) }),
      }),
    );
    expect(result.reference).toBe('ENT-ACME-CORPORATION-ENT1-2026-001');
  });

  it('never creates individual per-seat licenses — only the one Entitlement row', async () => {
    prisma.entitlement.create.mockResolvedValue({ id: 'ent-x' });
    await service.create({ ...VALID_CREATE_DTO, quantity: 500 }, 'vendor-1');
    expect(prisma.entitlement.create).toHaveBeenCalledTimes(1);
  });

  it('records a CREATE_ENTITLEMENT audit event', async () => {
    prisma.entitlement.create.mockResolvedValue({ id: 'ent-x' });
    await service.create(VALID_CREATE_DTO, 'vendor-1');
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_ENTITLEMENT', enterpriseId: 'ent-1', targetId: 'ent-x' }),
    );
  });

  it('retries with the next sequence number on a reference collision (P2002)', async () => {
    prisma.entitlement.create
      .mockRejectedValueOnce(Object.assign(new Error('unique constraint'), { code: 'P2002' }))
      .mockResolvedValueOnce({ id: 'ent-x', reference: 'ENT-ACME-CORPORATION-2026-002' });

    const result = await service.create(VALID_CREATE_DTO, 'vendor-1');
    expect(result.reference).toBe('ENT-ACME-CORPORATION-2026-002');
    expect(prisma.entitlement.create).toHaveBeenCalledTimes(2);
  });
});

describe('EntitlementsService lifecycle', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: EntitlementsService;

  const ACTIVE_ENTITLEMENT = {
    id: 'ent-x',
    enterpriseId: 'ent-1',
    status: 'ACTIVE',
    version: 3,
    quantity: 500,
    allocatedQuantity: 100,
    endDate: new Date('2026-12-31'),
  };

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new EntitlementsService(prisma, audit);
    prisma.entitlement.findUnique.mockResolvedValue(ACTIVE_ENTITLEMENT);
  });

  describe('setStatus', () => {
    it('rejects an invalid transition (e.g. ACTIVE -> ACTIVE)', async () => {
      await expect(service.setStatus('ent-x', 'ACTIVE', 'vendor-1')).rejects.toThrow(BadRequestException);
    });

    it('suspends with OCC and audits SUSPEND_ENTITLEMENT', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 1 });
      prisma.entitlement.findUnique
        .mockResolvedValueOnce(ACTIVE_ENTITLEMENT) // read before update
        .mockResolvedValueOnce({ ...ACTIVE_ENTITLEMENT, status: 'SUSPENDED' }); // re-read after update

      const result = await service.setStatus('ent-x', 'SUSPENDED', 'vendor-1');

      expect(prisma.entitlement.updateMany).toHaveBeenCalledWith({
        where: { id: 'ent-x', version: 3 },
        data: { status: 'SUSPENDED', version: { increment: 1 } },
      });
      expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUSPEND_ENTITLEMENT' }));
      expect(result?.status).toBe('SUSPENDED');
    });

    it('throws ConflictException when the version has moved (concurrent edit)', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.setStatus('ent-x', 'SUSPENDED', 'vendor-1')).rejects.toThrow(ConflictException);
    });

    it('404s for an unknown entitlement', async () => {
      prisma.entitlement.findUnique.mockResolvedValue(null);
      await expect(service.setStatus('missing', 'SUSPENDED', 'vendor-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('extend', () => {
    it('rejects a new end date that is not after the current one', async () => {
      await expect(service.extend('ent-x', { endDate: '2026-06-01' }, 'vendor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects extending a revoked entitlement', async () => {
      prisma.entitlement.findUnique.mockResolvedValue({ ...ACTIVE_ENTITLEMENT, status: 'REVOKED' });
      await expect(service.extend('ent-x', { endDate: '2027-06-01' }, 'vendor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('extends with OCC and audits EXTEND_ENTITLEMENT', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 1 });
      await service.extend('ent-x', { endDate: '2027-06-01' }, 'vendor-1');
      expect(prisma.entitlement.updateMany).toHaveBeenCalledWith({
        where: { id: 'ent-x', version: 3 },
        data: { endDate: new Date('2027-06-01'), version: { increment: 1 } },
      });
      expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTEND_ENTITLEMENT' }));
    });

    it('throws ConflictException on concurrent modification', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.extend('ent-x', { endDate: '2027-06-01' }, 'vendor-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateQuantity', () => {
    it('rejects a non-positive quantity', async () => {
      await expect(service.updateQuantity('ent-x', { quantity: 0 }, 'vendor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects reducing quantity below the already-allocated amount', async () => {
      await expect(service.updateQuantity('ent-x', { quantity: 50 }, 'vendor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects changing quantity on a revoked entitlement', async () => {
      prisma.entitlement.findUnique.mockResolvedValue({ ...ACTIVE_ENTITLEMENT, status: 'REVOKED' });
      await expect(service.updateQuantity('ent-x', { quantity: 600 }, 'vendor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('increases quantity with OCC and audits UPDATE_ENTITLEMENT_QUANTITY', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 1 });
      await service.updateQuantity('ent-x', { quantity: 750 }, 'vendor-1');
      expect(prisma.entitlement.updateMany).toHaveBeenCalledWith({
        where: { id: 'ent-x', version: 3 },
        data: { quantity: 750, version: { increment: 1 } },
      });
      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE_ENTITLEMENT_QUANTITY' }),
      );
    });

    it('allows setting quantity exactly equal to allocatedQuantity', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.updateQuantity('ent-x', { quantity: 100 }, 'vendor-1')).resolves.toBeDefined();
    });

    it('throws ConflictException on concurrent modification', async () => {
      prisma.entitlement.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.updateQuantity('ent-x', { quantity: 600 }, 'vendor-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});

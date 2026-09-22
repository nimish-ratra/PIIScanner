import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FeaturesService } from './features.service.js';

function makePrisma(): any {
  return {
    edition: { findUnique: vi.fn() },
    feature: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

describe('FeaturesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: FeaturesService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new FeaturesService(prisma, audit);
  });

  it('create() 404s when the parent edition does not exist', async () => {
    prisma.edition.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing-edition', { name: 'SSO', key: 'sso' }, 'vendor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('create() rejects a missing key', async () => {
    prisma.edition.findUnique.mockResolvedValue({ id: 'e1', name: 'Enterprise' });
    await expect(service.create('e1', { name: 'SSO', key: '' } as any, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create() rejects a duplicate key within the same edition', async () => {
    prisma.edition.findUnique.mockResolvedValue({ id: 'e1', name: 'Enterprise' });
    prisma.feature.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.create('e1', { name: 'SSO', key: 'sso' }, 'vendor-1')).rejects.toThrow(ConflictException);
  });

  it('create() allows the same key across two different editions', async () => {
    prisma.edition.findUnique.mockResolvedValue({ id: 'e2', name: 'Basic' });
    prisma.feature.findFirst.mockResolvedValue(null); // scoped to e2, not e1's existing "sso"
    prisma.feature.create.mockResolvedValue({ id: 'f2', editionId: 'e2', key: 'sso' });

    const result = await service.create('e2', { name: 'SSO', key: 'sso' }, 'vendor-1');
    expect(result.editionId).toBe('e2');
  });

  it('create() persists and audits CREATE_FEATURE', async () => {
    prisma.edition.findUnique.mockResolvedValue({ id: 'e1', name: 'Enterprise' });
    prisma.feature.findFirst.mockResolvedValue(null);
    prisma.feature.create.mockResolvedValue({ id: 'f1', editionId: 'e1', key: 'sso' });

    await service.create('e1', { name: 'SSO', key: 'sso' }, 'vendor-1');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_FEATURE', targetId: 'f1' }));
  });

  it('update() rejects renaming the key to one already used in the same edition', async () => {
    prisma.feature.findUnique.mockResolvedValue({ id: 'f1', editionId: 'e1', key: 'sso' });
    prisma.feature.findFirst.mockResolvedValue({ id: 'f2' }); // another feature already has this key
    await expect(service.update('f1', { key: 'advanced_reporting' }, 'vendor-1')).rejects.toThrow(ConflictException);
  });
});

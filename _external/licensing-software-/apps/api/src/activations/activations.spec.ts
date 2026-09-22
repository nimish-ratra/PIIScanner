import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ActivationsService } from './activations.service.js';

function makePrisma(): any {
  const prisma: any = {
    activation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    entitlement: { findUnique: vi.fn() },
    licenseAllocation: { updateMany: vi.fn(), update: vi.fn() },
    enrollmentToken: { create: vi.fn() },
    company: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

const REQUEST = {
  id: 'req-1',
  companyId: 'comp-1',
  entitlementId: 'ent-1',
  requestedBy: 'user-admin', // filer — must NOT become Activation.userId
  targetUserId: 'user-employee',
  quantity: 1,
  status: 'PENDING',
};

const ALLOCATION = {
  id: 'alloc-1',
  companyId: 'comp-1',
  entitlementId: 'ent-1',
  quantity: 10,
  consumedQuantity: 3,
  version: 1,
  status: 'ALLOCATED',
};

describe('ActivationsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: ActivationsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new ActivationsService(prisma, audit);

    prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', companyId: 'comp-1' });
    prisma.entitlement.findUnique.mockResolvedValue({ id: 'ent-1', productId: 'prod-1', editionId: null });
    prisma.licenseAllocation.updateMany.mockResolvedValue({ count: 1 });
    prisma.activation.findUnique.mockResolvedValue(null);
    prisma.activation.create.mockResolvedValue({
      id: 'act-1',
      requestId: 'req-1',
      allocationId: 'alloc-1',
      userId: 'user-employee',
      companyId: 'comp-1',
      status: 'PENDING',
    });
    prisma.enrollmentToken.create.mockResolvedValue({
      id: 'token-1',
      companyId: 'comp-1',
      allocationId: 'alloc-1',
      activationId: 'act-1',
      tokenHash: 'hashed',
      maxActivations: 1,
      activationsUsed: 0,
    });
  });

  describe('createFromApprovedRequest', () => {
    it('creates an Activation whose userId comes from targetUserId, NOT requestedBy', async () => {
      const { activation } = await service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin');

      expect(prisma.activation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-employee', requestId: 'req-1' }),
        }),
      );
      expect(activation.userId).toBe('user-employee');
      expect(activation.userId).not.toBe(REQUEST.requestedBy);
    });

    it('consumes exactly one seat from the allocation via OCC', async () => {
      await service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin');

      expect(prisma.licenseAllocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'alloc-1', version: 1 },
        data: { consumedQuantity: { increment: 1 }, version: { increment: 1 } },
      });
    });

    it('mints a bound EnrollmentToken with activationId set and maxActivations 1', async () => {
      await service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin');

      expect(prisma.enrollmentToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activationId: 'act-1', maxActivations: 1, allocationId: 'alloc-1' }),
        }),
      );
    });

    it('rejects a request with no targetUserId', async () => {
      await expect(
        service.createFromApprovedRequest(prisma, { ...REQUEST, targetUserId: null } as any, ALLOCATION as any, 'user-admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a request with quantity !== 1', async () => {
      await expect(
        service.createFromApprovedRequest(prisma, { ...REQUEST, quantity: 5 } as any, ALLOCATION as any, 'user-admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a targetUserId belonging to another company', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', companyId: 'comp-OTHER' });
      await expect(
        service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('is idempotent — a retried call for the same request returns the existing Activation, no duplicate, no double seat consumption', async () => {
      const existing = { id: 'act-existing', requestId: 'req-1', status: 'PENDING' };
      prisma.activation.findUnique.mockResolvedValue(existing);

      const { activation, enrollmentToken } = await service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin');

      expect(activation).toEqual(existing);
      expect(enrollmentToken).toBeNull();
      expect(prisma.activation.create).not.toHaveBeenCalled();
      expect(prisma.licenseAllocation.updateMany).not.toHaveBeenCalled();
    });

    it('throws ConflictException on OCC failure (concurrent approval racing the last seat)', async () => {
      prisma.licenseAllocation.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin'),
      ).rejects.toThrow(ConflictException);
    });

    it('audits CREATE_ACTIVATION', async () => {
      await service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin');
      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_ACTIVATION', targetType: 'Activation', result: 'SUCCESS' }),
      );
    });

    it('attributes CREATE_ACTIVATION to SYSTEM, never to the approving Customer Admin — issuing the Activation is a Trustfabric backend decision, not something the customer manually performed', async () => {
      await service.createFromApprovedRequest(prisma, REQUEST as any, ALLOCATION as any, 'user-admin');
      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_ACTIVATION', actorType: 'SYSTEM', actorId: 'SYSTEM' }),
      );
      // The approving admin is still traceable, just in `reason`, not as the actor.
      const call = audit.logEvent.mock.calls.find((c: any[]) => c[0].action === 'CREATE_ACTIVATION');
      expect(call![0].reason).toContain('user-admin');
    });
  });

  describe('linkInstallation', () => {
    it('links from PENDING and sets status ACTIVE', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'PENDING', companyId: 'comp-1', activatedAt: null });
      prisma.activation.update.mockResolvedValue({ id: 'act-1', status: 'ACTIVE', installationId: 'inst-1' });

      const result = await service.linkInstallation(prisma, 'act-1', 'inst-1');

      expect(prisma.activation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'act-1' }, data: expect.objectContaining({ installationId: 'inst-1', status: 'ACTIVE' }) }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('links from DEACTIVATED (device replacement)', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'DEACTIVATED', companyId: 'comp-1', activatedAt: new Date() });
      prisma.activation.update.mockResolvedValue({ id: 'act-1', status: 'ACTIVE' });

      await expect(service.linkInstallation(prisma, 'act-1', 'inst-2')).resolves.toBeDefined();
    });

    it('rejects linking to a REVOKED activation', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'REVOKED', companyId: 'comp-1' });
      await expect(service.linkInstallation(prisma, 'act-1', 'inst-1')).rejects.toThrow(BadRequestException);
    });

    it('404s for a nonexistent activation', async () => {
      prisma.activation.findUnique.mockResolvedValue(null);
      await expect(service.linkInstallation(prisma, 'ghost', 'inst-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateForInstallationRelease', () => {
    it('moves ACTIVE to DEACTIVATED, clears installationId, does NOT touch consumedQuantity', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'ACTIVE', companyId: 'comp-1', allocationId: 'alloc-1' });

      await service.deactivateForInstallationRelease(prisma, 'act-1');

      expect(prisma.activation.update).toHaveBeenCalledWith({
        where: { id: 'act-1' },
        data: { installationId: null, status: 'DEACTIVATED' },
      });
      expect(prisma.licenseAllocation.update).not.toHaveBeenCalled();
    });

    it('is a no-op for an already-terminal activation (REVOKED/EXPIRED)', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'REVOKED', companyId: 'comp-1' });
      await service.deactivateForInstallationRelease(prisma, 'act-1');
      expect(prisma.activation.update).not.toHaveBeenCalled();
    });
  });

  describe('setStatus (suspend/reactivate/revoke)', () => {
    function withActivation(status: string, extra: any = {}) {
      prisma.activation.findUnique.mockResolvedValue({
        id: 'act-1',
        status,
        companyId: 'comp-1',
        allocationId: 'alloc-1',
        ...extra,
      });
      prisma.activation.update.mockResolvedValue({ id: 'act-1', status });
    }

    it('ACTIVE -> SUSPENDED is valid', async () => {
      withActivation('ACTIVE');
      await expect(service.setStatus('act-1', ['*'], 'SUSPENDED', 'admin-1')).resolves.toBeDefined();
    });

    it('SUSPENDED -> ACTIVE is valid', async () => {
      withActivation('SUSPENDED');
      await expect(service.setStatus('act-1', ['*'], 'ACTIVE', 'admin-1')).resolves.toBeDefined();
    });

    it('REVOKED -> ACTIVE is rejected (no silent reactivation from a terminal state)', async () => {
      withActivation('REVOKED');
      await expect(service.setStatus('act-1', ['*'], 'ACTIVE', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('EXPIRED -> ACTIVE is rejected', async () => {
      withActivation('EXPIRED');
      await expect(service.setStatus('act-1', ['*'], 'ACTIVE', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('revoking from ACTIVE frees the seat exactly once', async () => {
      withActivation('ACTIVE');
      await service.setStatus('act-1', ['*'], 'REVOKED', 'admin-1');
      expect(prisma.licenseAllocation.update).toHaveBeenCalledWith({
        where: { id: 'alloc-1' },
        data: { consumedQuantity: { decrement: 1 } },
      });
    });

    it('tenant-scoping: cross-company access 404s', async () => {
      withActivation('ACTIVE');
      await expect(service.setStatus('act-1', ['comp-OTHER'], 'SUSPENDED', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('mintReplacementEnrollmentToken', () => {
    it('only works from DEACTIVATED', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'ACTIVE', companyId: 'comp-1', allocationId: 'alloc-1' });
      await expect(service.mintReplacementEnrollmentToken('act-1', ['*'], 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('mints a fresh bound token from DEACTIVATED', async () => {
      prisma.activation.findUnique.mockResolvedValue({ id: 'act-1', status: 'DEACTIVATED', companyId: 'comp-1', allocationId: 'alloc-1' });
      const { enrollmentToken } = await service.mintReplacementEnrollmentToken('act-1', ['*'], 'admin-1');
      expect(enrollmentToken.token).toEqual(expect.any(String));
      expect(prisma.enrollmentToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ activationId: 'act-1', maxActivations: 1 }) }),
      );
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service.js';

function makePrisma(): any {
  const prisma: any = {
    enterprise: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    company: { create: vi.fn() },
    role: { create: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    roleAssignment: { create: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

function makePasswordService(): any {
  return { hash: vi.fn().mockResolvedValue('$argon2id$fake-hash') };
}

const VALID_CREATE_DTO = { name: 'Initech LLC', adminName: 'Jordan Smith', adminEmail: 'jordan@initech.com' };

describe('CustomersService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let passwordService: ReturnType<typeof makePasswordService>;
  let service: CustomersService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    passwordService = makePasswordService();
    service = new CustomersService(prisma, audit, passwordService);

    prisma.enterprise.create.mockResolvedValue({ id: 'ent-1', name: 'Initech LLC', status: 'ACTIVE' });
    prisma.company.create.mockResolvedValue({ id: 'comp-1', name: 'Initech LLC', enterpriseId: 'ent-1' });
    prisma.role.create.mockResolvedValue({ id: 'role-1', companyId: 'comp-1', name: 'EnterpriseAdmin', permissions: ['*'] });
    prisma.user.create.mockResolvedValue({ id: 'user-1', email: 'jordan@initech.com' });
  });

  it('create() rejects a missing name', async () => {
    await expect(service.create({ ...VALID_CREATE_DTO, name: '' }, 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('create() rejects a missing admin name', async () => {
    await expect(service.create({ ...VALID_CREATE_DTO, adminName: '' }, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create() rejects a missing or invalid admin email', async () => {
    await expect(service.create({ ...VALID_CREATE_DTO, adminEmail: '' }, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create({ ...VALID_CREATE_DTO, adminEmail: 'not-an-email' }, 'vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create() rejects an admin email that is already in use', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    await expect(service.create(VALID_CREATE_DTO, 'vendor-1')).rejects.toThrow(ConflictException);
  });

  it('create() persists Enterprise + Company + Role + User + RoleAssignment', async () => {
    const result = await service.create(VALID_CREATE_DTO, 'vendor-1');

    expect(prisma.enterprise.create).toHaveBeenCalledWith({ data: { name: 'Initech LLC' } });
    expect(prisma.company.create).toHaveBeenCalledWith({
      data: { name: 'Initech LLC', enterpriseId: 'ent-1' },
    });
    expect(prisma.role.create).toHaveBeenCalledWith({
      data: { companyId: 'comp-1', name: 'EnterpriseAdmin', permissions: ['*'] },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'jordan@initech.com',
        name: 'Jordan Smith',
        companyId: 'comp-1',
        passwordHash: '$argon2id$fake-hash',
      }),
    });
    // Enterprise-wide scope, matching the seeded EnterpriseAdmin pattern.
    expect(prisma.roleAssignment.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', roleId: 'role-1', companyId: null },
    });
    expect(result.id).toBe('ent-1');
  });

  it('create() hashes the password with Argon2id (PasswordService), never stores plaintext', async () => {
    await service.create(VALID_CREATE_DTO, 'vendor-1');
    expect(passwordService.hash).toHaveBeenCalled();
    const passedHash = prisma.user.create.mock.calls[0][0].data.passwordHash;
    expect(passedHash).toBe('$argon2id$fake-hash');
  });

  it('create() returns the plaintext temporary password exactly once', async () => {
    const result = await service.create(VALID_CREATE_DTO, 'vendor-1');
    expect(result.initialAdmin.email).toBe('jordan@initech.com');
    expect(result.initialAdmin.temporaryPassword).toEqual(expect.any(String));
    expect(result.initialAdmin.temporaryPassword.length).toBeGreaterThan(10);
  });

  it('create() audits CREATE_CUSTOMER with the enterprise id', async () => {
    await service.create(VALID_CREATE_DTO, 'vendor-1');
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_CUSTOMER', enterpriseId: 'ent-1', result: 'SUCCESS' }),
    );
  });

  it('create() audit event never contains the password', async () => {
    const result = await service.create(VALID_CREATE_DTO, 'vendor-1');
    const auditCall = JSON.stringify(audit.logEvent.mock.calls[0][0]);
    expect(auditCall).not.toContain(result.initialAdmin.temporaryPassword);
  });

  it('setStatus() rejects an invalid status value', async () => {
    await expect(service.setStatus('ent-1', 'DELETED', 'vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('setStatus() 404s for an unknown customer', async () => {
    prisma.enterprise.findUnique.mockResolvedValue(null);
    await expect(service.setStatus('missing', 'INACTIVE', 'vendor-1')).rejects.toThrow(NotFoundException);
  });

  it('setStatus() disables a customer and audits UPDATE_CUSTOMER_STATUS', async () => {
    prisma.enterprise.findUnique.mockResolvedValue({ id: 'ent-1', status: 'ACTIVE' });
    prisma.enterprise.update.mockResolvedValue({ id: 'ent-1', status: 'INACTIVE' });

    const result = await service.setStatus('ent-1', 'INACTIVE', 'vendor-1');
    expect(result.status).toBe('INACTIVE');
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_CUSTOMER_STATUS', enterpriseId: 'ent-1' }),
    );
  });

  describe('addCompany', () => {
    it('rejects a missing name', async () => {
      await expect(service.addCompany('ent-1', { name: '' }, 'vendor-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a whitespace-only name', async () => {
      await expect(service.addCompany('ent-1', { name: '   ' }, 'vendor-1')).rejects.toThrow(BadRequestException);
    });

    it('404s for an unknown customer', async () => {
      prisma.enterprise.findUnique.mockResolvedValue(null);
      await expect(service.addCompany('missing', { name: 'Acme UK' }, 'vendor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates a Company scoped to the given enterprise', async () => {
      prisma.enterprise.findUnique.mockResolvedValue({ id: 'ent-1', name: 'Acme' });
      prisma.company.create.mockResolvedValue({ id: 'comp-2', name: 'Acme UK', enterpriseId: 'ent-1' });

      const result = await service.addCompany('ent-1', { name: '  Acme UK  ' }, 'vendor-1');

      expect(prisma.company.create).toHaveBeenCalledWith({
        data: { name: 'Acme UK', enterpriseId: 'ent-1' },
      });
      expect(result.id).toBe('comp-2');
    });

    it('audits CREATE_COMPANY with the enterprise id', async () => {
      prisma.enterprise.findUnique.mockResolvedValue({ id: 'ent-1', name: 'Acme' });
      prisma.company.create.mockResolvedValue({ id: 'comp-2', name: 'Acme UK', enterpriseId: 'ent-1' });

      await service.addCompany('ent-1', { name: 'Acme UK' }, 'vendor-1');

      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_COMPANY', enterpriseId: 'ent-1', result: 'SUCCESS' }),
      );
    });
  });
});

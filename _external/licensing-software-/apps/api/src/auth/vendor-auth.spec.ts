/**
 * vendor-auth.spec.ts — Vendor password login unit tests (mocked Prisma/audit).
 *
 * Mirrors customer-auth.spec.ts's scenarios against VendorAuthService/VendorUser:
 * valid login, wrong password, unknown email, inactive user, no
 * user-enumeration, rate limiting, and that passwordHash never leaves the
 * service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common';
import { VendorAuthService } from './vendor-auth.service.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';

function makePrisma(overrides: Partial<any> = {}): any {
  return {
    vendorUser: { findUnique: vi.fn() },
    ...overrides,
  };
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

describe('VendorAuthService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let passwordService: PasswordService;
  let rateLimiter: LoginRateLimiterService;
  let service: VendorAuthService;

  const ACTIVE_VENDOR_USER = {
    id: 'vendor-1',
    passwordHash: 'stored-hash',
    isActive: true,
  };

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    passwordService = new PasswordService();
    rateLimiter = new LoginRateLimiterService();
    service = new VendorAuthService(prisma, passwordService, rateLimiter, audit);
  });

  it('1. Valid login succeeds and returns the userId', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    const result = await service.login({ email: 'Admin@Trustfabric.Test', password: 'correct' }, '127.0.0.1');
    expect(result.userId).toBe('vendor-1');
  });

  it('1b. Email lookup is case-insensitive (normalized to lowercase)', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    await service.login({ email: 'ADMIN@TRUSTFABRIC.TEST', password: 'correct' }, '127.0.0.1');
    expect(prisma.vendorUser.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'admin@trustfabric.test' } }),
    );
  });

  it('1c. Valid login records a VENDOR_LOGIN_SUCCESS audit event with the real user id', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    await service.login({ email: 'admin@trustfabric.test', password: 'correct' }, '127.0.0.1');
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VENDOR_LOGIN_SUCCESS', actorId: 'vendor-1', result: 'SUCCESS' }),
    );
  });

  it('2. Wrong password is rejected with the generic message', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

    await expect(
      service.login({ email: 'admin@trustfabric.test', password: 'wrong' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('3. Unknown email is rejected with the SAME message/type as a wrong password (no enumeration)', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(null);

    let unknownEmailError: unknown;
    try {
      await service.login({ email: 'nobody@trustfabric.test', password: 'whatever' }, '127.0.0.1');
    } catch (e) {
      unknownEmailError = e;
    }

    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);
    let wrongPasswordError: unknown;
    try {
      await service.login({ email: 'admin@trustfabric.test', password: 'wrong' }, '127.0.0.2');
    } catch (e) {
      wrongPasswordError = e;
    }

    expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
    expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
    expect((unknownEmailError as UnauthorizedException).message).toBe(
      (wrongPasswordError as UnauthorizedException).message,
    );
  });

  it('3b. Unknown email still invokes password verification (constant-time — no early return)', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(null);
    const verifySpy = vi.spyOn(passwordService, 'verify');

    await expect(
      service.login({ email: 'nobody@trustfabric.test', password: 'whatever' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(verifySpy).toHaveBeenCalled();
  });

  it('4. Inactive vendor user is rejected even with the correct password', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue({ ...ACTIVE_VENDOR_USER, isActive: false });
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    await expect(
      service.login({ email: 'admin@trustfabric.test', password: 'correct' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('4b. A vendor user with no passwordHash set is rejected (never provisioned a credential)', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue({ ...ACTIVE_VENDOR_USER, passwordHash: null });

    await expect(
      service.login({ email: 'admin@trustfabric.test', password: 'anything' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('Missing email/password → 400 (distinct from the generic auth-failure message)', async () => {
    await expect(service.login({ email: '', password: '' } as any, '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('5. Client-supplied roles/permissions/principalType on the login body are ignored', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    const maliciousDto: any = {
      email: 'admin@trustfabric.test',
      password: 'correct',
      roles: ['SuperAdmin'],
      permissions: ['*'],
      principalType: 'CUSTOMER',
    };

    const result = await service.login(maliciousDto, '127.0.0.1');
    expect(result).toEqual({ userId: 'vendor-1' });
  });

  it('6. passwordHash is never present on the returned value', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    const result = await service.login({ email: 'admin@trustfabric.test', password: 'correct' }, '127.0.0.1');
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('stored-hash');
  });

  it('7. Repeated failures from the same IP+email are rate-limited', async () => {
    prisma.vendorUser.findUnique.mockResolvedValue(ACTIVE_VENDOR_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ email: 'admin@trustfabric.test', password: 'wrong' }, '10.1.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    }

    prisma.vendorUser.findUnique.mockClear();
    await expect(
      service.login({ email: 'admin@trustfabric.test', password: 'wrong' }, '10.1.0.1'),
    ).rejects.toThrow(HttpException);
    expect(prisma.vendorUser.findUnique).not.toHaveBeenCalled();
  });
});

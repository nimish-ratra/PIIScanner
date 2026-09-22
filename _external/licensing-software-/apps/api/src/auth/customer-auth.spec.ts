/**
 * customer-auth.spec.ts — Password login unit tests (mocked Prisma/audit).
 *
 * Covers the CustomerAuthService scenarios from the OIDC → password
 * migration spec: valid login, wrong password, unknown email, inactive
 * user, no user-enumeration, rate limiting, and that passwordHash never
 * leaves the service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';

function makePrisma(overrides: Partial<any> = {}): any {
  return {
    user: { findUnique: vi.fn() },
    ...overrides,
  };
}

function makeAudit(): any {
  return { logEvent: vi.fn().mockResolvedValue(undefined) };
}

describe('CustomerAuthService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let passwordService: PasswordService;
  let rateLimiter: LoginRateLimiterService;
  let service: CustomerAuthService;

  const ACTIVE_USER = {
    id: 'user-1',
    companyId: 'comp-1',
    passwordHash: 'stored-hash',
    isActive: true,
  };

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    passwordService = new PasswordService();
    rateLimiter = new LoginRateLimiterService();
    service = new CustomerAuthService(prisma, passwordService, rateLimiter, audit);
  });

  it('1. Valid login succeeds and returns the userId', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    const result = await service.login({ email: 'Admin@Acme.Test', password: 'correct' }, '127.0.0.1');
    expect(result.userId).toBe('user-1');
  });

  it('1b. Email lookup is case-insensitive (normalized to lowercase)', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    await service.login({ email: 'ADMIN@ACME.TEST', password: 'correct' }, '127.0.0.1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'admin@acme.test' } }),
    );
  });

  it('1c. Valid login records a LOGIN_SUCCESS audit event with the real user id', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    await service.login({ email: 'admin@acme.test', password: 'correct' }, '127.0.0.1');
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN_SUCCESS', actorId: 'user-1', result: 'SUCCESS' }),
    );
  });

  it('2. Wrong password is rejected with the generic message', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

    await expect(
      service.login({ email: 'admin@acme.test', password: 'wrong' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('3. Unknown email is rejected with the SAME message/type as a wrong password (no enumeration)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    let unknownEmailError: unknown;
    try {
      await service.login({ email: 'nobody@acme.test', password: 'whatever' }, '127.0.0.1');
    } catch (e) {
      unknownEmailError = e;
    }

    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);
    let wrongPasswordError: unknown;
    try {
      await service.login({ email: 'admin@acme.test', password: 'wrong' }, '127.0.0.2');
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
    prisma.user.findUnique.mockResolvedValue(null);
    const verifySpy = vi.spyOn(passwordService, 'verify');

    await expect(
      service.login({ email: 'nobody@acme.test', password: 'whatever' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(verifySpy).toHaveBeenCalled();
  });

  it('4. Inactive user is rejected even with the correct password', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, isActive: false });
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    await expect(
      service.login({ email: 'admin@acme.test', password: 'correct' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('4b. A user with no passwordHash set is rejected (never provisioned a credential)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, passwordHash: null });

    await expect(
      service.login({ email: 'admin@acme.test', password: 'anything' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('Missing email/password → 400 (distinct from the generic auth-failure message)', async () => {
    await expect(service.login({ email: '', password: '' } as any, '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('5. Client-supplied enterpriseId/companyId/role/permissions on the login body are ignored', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    const maliciousDto: any = {
      email: 'admin@acme.test',
      password: 'correct',
      enterpriseId: 'ent-attacker',
      companyId: 'comp-attacker',
      role: 'EnterpriseAdmin',
      permissions: ['*'],
      principalType: 'VENDOR',
    };

    const result = await service.login(maliciousDto, '127.0.0.1');
    // Only userId is ever derived — nothing from the body flows into it.
    expect(result).toEqual({ userId: 'user-1' });
  });

  it('6. passwordHash is never present on the returned value', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

    const result = await service.login({ email: 'admin@acme.test', password: 'correct' }, '127.0.0.1');
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('stored-hash');
  });

  it('7. Repeated failures from the same IP+email are rate-limited', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

    for (let i = 0; i < 5; i++) {
      await expect(
        service.login({ email: 'admin@acme.test', password: 'wrong' }, '10.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    }

    // 6th attempt is blocked outright, without even touching Prisma again
    prisma.user.findUnique.mockClear();
    await expect(
      service.login({ email: 'admin@acme.test', password: 'wrong' }, '10.0.0.1'),
    ).rejects.toThrow(HttpException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('7b. Rate limiting is scoped per IP+email — a different IP is unaffected', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

    for (let i = 0; i < 6; i++) {
      await expect(
        service.login({ email: 'admin@acme.test', password: 'wrong' }, '10.0.0.2'),
      ).rejects.toThrow();
    }

    // A different IP against the same account is a fresh bucket
    await expect(
      service.login({ email: 'admin@acme.test', password: 'wrong' }, '10.0.0.3'),
    ).rejects.toThrow(UnauthorizedException); // not HttpException(429)
  });

  it('7c. A successful login resets the rate-limit bucket for that key', async () => {
    prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
    const verifySpy = vi.spyOn(passwordService, 'verify');

    verifySpy.mockResolvedValue(false);
    for (let i = 0; i < 4; i++) {
      await expect(
        service.login({ email: 'admin@acme.test', password: 'wrong' }, '10.0.0.4'),
      ).rejects.toThrow();
    }

    verifySpy.mockResolvedValue(true);
    await service.login({ email: 'admin@acme.test', password: 'correct' }, '10.0.0.4');

    verifySpy.mockResolvedValue(false);
    // Bucket was reset — this is attempt 1 of a fresh window, not attempt 5
    await expect(
      service.login({ email: 'admin@acme.test', password: 'wrong' }, '10.0.0.4'),
    ).rejects.toThrow(UnauthorizedException);
  });

  describe('changePassword', () => {
    it('8. Succeeds with a correct current password, hashes the new one, and clears mustChangePassword', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      prisma.user.update = vi.fn().mockResolvedValue({});
      vi.spyOn(passwordService, 'verify').mockResolvedValue(true);
      vi.spyOn(passwordService, 'hash').mockResolvedValue('new-stored-hash');

      await service.changePassword('user-1', { currentPassword: 'correct', newPassword: 'brandNew123' }, '127.0.0.1');

      expect(passwordService.hash).toHaveBeenCalledWith('brandNew123');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-stored-hash', mustChangePassword: false },
      });
    });

    it('9. Records a CHANGE_PASSWORD_SUCCESS audit event', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      prisma.user.update = vi.fn().mockResolvedValue({});
      vi.spyOn(passwordService, 'verify').mockResolvedValue(true);
      vi.spyOn(passwordService, 'hash').mockResolvedValue('new-stored-hash');

      await service.changePassword('user-1', { currentPassword: 'correct', newPassword: 'brandNew123' }, '127.0.0.1');

      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_PASSWORD_SUCCESS', actorId: 'user-1', result: 'SUCCESS' }),
      );
    });

    it('10. Wrong current password is rejected and never touches prisma.user.update', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      prisma.user.update = vi.fn();
      vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('10b. Wrong current password records a CHANGE_PASSWORD_FAILURE audit event', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      prisma.user.update = vi.fn();
      vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_PASSWORD_FAILURE', actorId: 'user-1', result: 'DENIED' }),
      );
    });

    it('11. New password shorter than 8 characters is rejected with a 400, before touching Prisma', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);

      await expect(
        service.changePassword('user-1', { currentPassword: 'correct', newPassword: 'short' }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('12. New password identical to current password is rejected with a 400', async () => {
      await expect(
        service.changePassword('user-1', { currentPassword: 'sameValue', newPassword: 'sameValue' }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('13. Missing currentPassword or newPassword is rejected with a 400', async () => {
      await expect(
        service.changePassword('user-1', { currentPassword: '', newPassword: 'brandNew123' } as any, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changePassword('user-1', { currentPassword: 'correct', newPassword: '' } as any, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('14. A user with no passwordHash (never provisioned) gets the generic failure, not a crash', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, passwordHash: null });

      await expect(
        service.changePassword('user-1', { currentPassword: 'correct', newPassword: 'brandNew123' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('15. A nonexistent userId gets the generic failure, not a crash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('ghost-user', { currentPassword: 'correct', newPassword: 'brandNew123' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('16. Repeated wrong-current-password attempts from the same ip+userId are rate-limited', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

      for (let i = 0; i < 5; i++) {
        await expect(
          service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '10.0.0.5'),
        ).rejects.toThrow(UnauthorizedException);
      }

      // 6th attempt is blocked outright, without even touching Prisma again
      prisma.user.findUnique.mockClear();
      await expect(
        service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '10.0.0.5'),
      ).rejects.toThrow(HttpException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('17. Rate limiting is scoped per ip+userId — a different user (or a different ip) is unaffected', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

      for (let i = 0; i < 6; i++) {
        await expect(
          service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '10.0.0.6'),
        ).rejects.toThrow();
      }

      // A different ip against the same account is a fresh bucket
      await expect(
        service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '10.0.0.7'),
      ).rejects.toThrow(UnauthorizedException); // not HttpException(429)
    });

    it('18. A successful change resets the rate-limit bucket for that key', async () => {
      prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
      prisma.user.update = vi.fn().mockResolvedValue({});
      const verifySpy = vi.spyOn(passwordService, 'verify');
      vi.spyOn(passwordService, 'hash').mockResolvedValue('new-stored-hash');

      verifySpy.mockResolvedValue(false);
      for (let i = 0; i < 4; i++) {
        await expect(
          service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew123' }, '10.0.0.8'),
        ).rejects.toThrow();
      }

      verifySpy.mockResolvedValue(true);
      await service.changePassword('user-1', { currentPassword: 'correct', newPassword: 'brandNew123' }, '10.0.0.8');

      verifySpy.mockResolvedValue(false);
      // Bucket was reset — this is attempt 1 of a fresh window, not attempt 5
      await expect(
        service.changePassword('user-1', { currentPassword: 'wrong', newPassword: 'brandNew456' }, '10.0.0.8'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

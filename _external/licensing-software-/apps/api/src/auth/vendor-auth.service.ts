/**
 * VendorAuthService
 *
 * Password-based login for Trustfabric Admin (the vendor control plane).
 * Mirrors CustomerAuthService's security invariants exactly, against
 * VendorUser instead of User:
 *   - A single generic "Invalid email or password" error covers every
 *     failure reason (unknown email, wrong password, inactive account) —
 *     never reveal which one it was.
 *   - passwordHash is selected explicitly and never leaves this service.
 *   - Roles/permissions are never accepted from the request — IdentityService
 *     resolves them fresh (there is exactly one vendor role today).
 */

import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { LoginDto } from './login.dto.js';

const GENERIC_FAILURE_MESSAGE = 'Invalid email or password';

@Injectable()
export class VendorAuthService {
  private readonly logger = new Logger(VendorAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly rateLimiter: LoginRateLimiterService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the authenticated vendor user's id on success. Throws on any failure. */
  async login(dto: LoginDto, ip: string): Promise<{ userId: string }> {
    const email = dto?.email?.trim().toLowerCase();
    const password = dto?.password;

    if (!email || !password) {
      throw new BadRequestException('email and password are required');
    }

    // Shares the bucket keyspace with CustomerAuthService (same singleton,
    // keyed by ip+email) — fine, since emails don't collide across tables.
    const rateLimitKey = LoginRateLimiterService.keyFor(ip, email);
    if (this.rateLimiter.isBlocked(rateLimitKey)) {
      throw new HttpException('Too many login attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const vendorUser = await this.prisma.vendorUser.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isActive: true },
    });

    // Always run a verify call even when the user doesn't exist, so response
    // timing doesn't leak account existence.
    const hashToCompare = vendorUser?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await this.passwordService.verify(hashToCompare, password);

    if (!vendorUser || !vendorUser.passwordHash || !passwordMatches || !vendorUser.isActive) {
      this.rateLimiter.recordFailure(rateLimitKey);
      await this.audit.logEvent({
        actorId: email,
        actorType: 'USER',
        action: 'VENDOR_LOGIN_FAILURE',
        targetType: 'VendorUser',
        targetId: vendorUser?.id,
        result: 'DENIED',
      });
      throw new UnauthorizedException(GENERIC_FAILURE_MESSAGE);
    }

    this.rateLimiter.reset(rateLimitKey);
    await this.audit.logEvent({
      actorId: vendorUser.id,
      actorType: 'USER',
      action: 'VENDOR_LOGIN_SUCCESS',
      targetType: 'VendorUser',
      targetId: vendorUser.id,
      result: 'SUCCESS',
    });

    return { userId: vendorUser.id };
  }
}

/**
 * A pre-computed argon2id hash of a value nobody will ever type, used so
 * `verify()` always does real work even when no vendor user/passwordHash
 * exists — otherwise a missing-user response would return measurably faster
 * than a wrong-password response, leaking account existence via timing.
 * (Same constant value as CustomerAuthService's — it's just a fixed dummy
 * hash, not tied to any real credential.)
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$DZwJTD4q5wO52MjhHcu+Xg$hAinvKRxKWtFXMtVZqZN9Ed3XSCJ1Dk+zgBZT+KNQWQ';

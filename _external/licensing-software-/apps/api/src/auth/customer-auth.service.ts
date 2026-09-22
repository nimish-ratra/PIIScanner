/**
 * CustomerAuthService
 *
 * Password-based login for the Customer Portal. This is the ONLY login path
 * for Customer/Company Admins — OIDC/SSO was removed. Vendor and Agent
 * authentication are entirely separate systems and are untouched by this.
 *
 * Security invariants:
 *   - A single generic "Invalid email or password" error covers every
 *     failure reason (unknown email, wrong password, inactive account) —
 *     never reveal which one it was.
 *   - passwordHash is selected explicitly and never leaves this service.
 *   - enterpriseId/companyId/role/permissions/principalType are never
 *     accepted from the request — IdentityService resolves them fresh from
 *     the database, exactly as the (former) OIDC path already did.
 */

import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { LoginDto } from './login.dto.js';
import type { ChangePasswordDto } from './change-password.dto.js';

const GENERIC_FAILURE_MESSAGE = 'Invalid email or password';
const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly rateLimiter: LoginRateLimiterService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the authenticated user's id on success. Throws on any failure. */
  async login(dto: LoginDto, ip: string): Promise<{ userId: string }> {
    const email = dto?.email?.trim().toLowerCase();
    const password = dto?.password;

    if (!email || !password) {
      throw new BadRequestException('email and password are required');
    }

    const rateLimitKey = LoginRateLimiterService.keyFor(ip, email);
    if (this.rateLimiter.isBlocked(rateLimitKey)) {
      throw new HttpException('Too many login attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, companyId: true, passwordHash: true, isActive: true },
    });

    // Always run a verify call even when the user doesn't exist or has no
    // password set, so response timing doesn't leak account existence.
    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await this.passwordService.verify(hashToCompare, password);

    if (!user || !user.passwordHash || !passwordMatches || !user.isActive) {
      this.rateLimiter.recordFailure(rateLimitKey);
      await this.audit.logEvent({
        companyId: user?.companyId,
        actorId: email,
        actorType: 'USER',
        action: 'LOGIN_FAILURE',
        targetType: 'User',
        targetId: user?.id,
        result: 'DENIED',
      });
      throw new UnauthorizedException(GENERIC_FAILURE_MESSAGE);
    }

    this.rateLimiter.reset(rateLimitKey);
    await this.audit.logEvent({
      companyId: user.companyId,
      actorId: user.id,
      actorType: 'USER',
      action: 'LOGIN_SUCCESS',
      targetType: 'User',
      targetId: user.id,
      result: 'SUCCESS',
    });

    return { userId: user.id };
  }

  /**
   * Changes a user's own password — used both for the forced first-login
   * reset (the user still knows their current password: the temporary one
   * they just logged in with) and for a voluntary change later. Requiring
   * the current password either way means this can't be used to take over
   * an account just from an authenticated session (e.g. a stolen cookie) —
   * and this is itself rate-limited by ip+userId (same LoginRateLimiterService
   * used by login()) so a hijacked session can't be used to brute-force the
   * real current password via unlimited guesses.
   */
  async changePassword(userId: string, dto: ChangePasswordDto, ip: string): Promise<void> {
    const currentPassword = dto?.currentPassword;
    const newPassword = dto?.newPassword;

    if (!currentPassword || !newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException('newPassword must be different from currentPassword');
    }

    const rateLimitKey = LoginRateLimiterService.keyFor(ip, userId);
    if (this.rateLimiter.isBlocked(rateLimitKey)) {
      throw new HttpException('Too many attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, passwordHash: true, isActive: true },
    });

    if (!user || !user.passwordHash) {
      // Shouldn't happen for an already-authenticated request, but never
      // reveal anything more specific than a generic failure.
      throw new UnauthorizedException(GENERIC_FAILURE_MESSAGE);
    }

    const currentMatches = await this.passwordService.verify(user.passwordHash, currentPassword);
    if (!currentMatches) {
      this.rateLimiter.recordFailure(rateLimitKey);
      await this.audit.logEvent({
        companyId: user.companyId,
        actorId: user.id,
        actorType: 'USER',
        action: 'CHANGE_PASSWORD_FAILURE',
        targetType: 'User',
        targetId: user.id,
        result: 'DENIED',
        reason: 'Current password did not match',
      });
      throw new UnauthorizedException('Current password is incorrect');
    }

    this.rateLimiter.reset(rateLimitKey);
    const newPasswordHash = await this.passwordService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });

    await this.audit.logEvent({
      companyId: user.companyId,
      actorId: user.id,
      actorType: 'USER',
      action: 'CHANGE_PASSWORD_SUCCESS',
      targetType: 'User',
      targetId: user.id,
      result: 'SUCCESS',
    });
  }
}

/**
 * A pre-computed argon2id hash of a value nobody will ever type, used so
 * `verify()` always does real work even when no user/passwordHash exists —
 * otherwise a missing-user response would return measurably faster than a
 * wrong-password response, leaking account existence via timing.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$DZwJTD4q5wO52MjhHcu+Xg$hAinvKRxKWtFXMtVZqZN9Ed3XSCJ1Dk+zgBZT+KNQWQ';

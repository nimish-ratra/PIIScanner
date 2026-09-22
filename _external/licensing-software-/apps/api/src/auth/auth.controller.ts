/**
 * AuthController
 *
 * Customer authentication endpoints.
 *
 * POST /customer/auth/login   → Verify email+password, establish a session
 * POST /customer/auth/logout  → Destroy session, clear the session cookie
 * GET  /customer/auth/me      → Return currently authenticated principal
 *
 * OIDC/SSO was removed from the Customer Portal — see docs/security-model.md.
 * This is now the only Customer Admin login path. Vendor and Agent
 * authentication are separate systems, untouched by this change.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './public.decorator.js';
import { SessionService } from './session.service.js';
import { CustomerAuthService } from './customer-auth.service.js';
import type { LoginDto } from './login.dto.js';
import type { ChangePasswordDto } from './change-password.dto.js';

@Controller('customer/auth')
export class AuthController {
  constructor(
    private readonly customerAuthService: CustomerAuthService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * POST /customer/auth/login
   *
   * Body: { email, password }. On success, seals a brand-new session cookie
   * (SessionService.createSession always mints a fresh sealed token — there
   * is no pre-auth session to fixate, so this inherently satisfies "rotate
   * the session on login"). Returns only a minimal ack; the frontend follows
   * up with GET /auth/me for the actual profile, per the documented flow.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const { userId } = await this.customerAuthService.login(dto, ip);

    await this.sessionService.createSession(res, {
      userId,
      provider: 'password',
    });

    return { status: 'OK' };
  }

  /**
   * POST /customer/auth/logout
   *
   * Destroys the local session and clears the cookie.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    this.sessionService.destroySession(res);
    return { status: 'OK' };
  }

  /**
   * GET /customer/auth/me
   *
   * Returns the currently authenticated principal's public profile.
   * Protected by AuthGuard — request.user is already fully resolved from
   * the database (never from the session cookie's own contents).
   */
  @Get('me')
  getMe(@Req() req: Request) {
    const user = (req as any).user;
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }

    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      allowedCompanyIds: user.allowedCompanyIds,
      isEnterpriseWide: user.isEnterpriseWide ?? false,
      enterpriseId: user.enterpriseId,
      companyId: user.companyId,
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }

  /**
   * POST /customer/auth/change-password
   *
   * Body: { currentPassword, newPassword }. Requires an authenticated
   * session (protected by AuthGuard/PermissionsGuard like every other route
   * here) — used both for the forced first-login reset after a vendor
   * issues a temporary password, and for a voluntary change any time after.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    const user = (req as any).user;
    if (!user) {
      throw new UnauthorizedException('Not logged in');
    }
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    await this.customerAuthService.changePassword(user.id, dto, ip);
    return { status: 'OK' };
  }
}

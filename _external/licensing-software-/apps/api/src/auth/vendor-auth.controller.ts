/**
 * VendorAuthController
 *
 * Trustfabric Admin (vendor) authentication endpoints.
 *
 * POST /vendor/auth/login   → Verify email+password, establish a vendor session
 * POST /vendor/auth/logout  → Destroy the vendor session, clear its cookie
 * GET  /vendor/auth/me      → Return the currently authenticated vendor principal
 *
 * Deliberately separate from AuthController (customer) rather than a shared
 * controller with a branch: the two use different backing tables
 * (VendorUser vs User), different session cookies (see SessionService), and
 * principal-type isolation is a security boundary elsewhere in this codebase
 * (PermissionsGuard) that this mirrors rather than complicates.
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
import { VendorAuthService } from './vendor-auth.service.js';
import type { LoginDto } from './login.dto.js';

@Controller('vendor/auth')
export class VendorAuthController {
  constructor(
    private readonly vendorAuthService: VendorAuthService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * POST /vendor/auth/login
   *
   * Body: { email, password }. On success, seals a brand-new session cookie
   * under the vendor-specific cookie name (SessionService.createSession
   * always mints a fresh sealed token, satisfying "rotate the session on
   * login"). Returns only a minimal ack; the frontend follows up with
   * GET /auth/me for the actual profile.
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
    const { userId } = await this.vendorAuthService.login(dto, ip);

    await this.sessionService.createSession(
      res,
      { userId, provider: 'vendor-password' },
      this.sessionService.vendorCookieName,
    );

    return { status: 'OK' };
  }

  /**
   * POST /vendor/auth/logout
   *
   * Destroys the vendor session and clears its cookie.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    this.sessionService.destroySession(res, this.sessionService.vendorCookieName);
    return { status: 'OK' };
  }

  /**
   * GET /vendor/auth/me
   *
   * Returns the currently authenticated vendor principal's public profile.
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
    };
  }
}

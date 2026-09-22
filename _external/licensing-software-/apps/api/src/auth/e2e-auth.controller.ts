/**
 * E2eAuthController
 *
 * Provides a deterministic test identity endpoint for automated E2E tests.
 * This controller is ONLY available when AUTH_MODE=e2e.
 * The route returns 404 if AUTH_MODE != 'e2e'.
 *
 * CRITICAL: E2E mode is blocked in production at API startup (main.ts).
 * This controller is a secondary defense — the startup check is the primary one.
 */

import { Controller, Post, Body, Res, UnauthorizedException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './public.decorator.js';

@Controller('customer/auth')
export class E2eAuthController {
  private readonly logger = new Logger(E2eAuthController.name);

  @Public()
  @Post('e2e/session')
  createE2eSession(@Body('testIdentity') testIdentity: string, @Res({ passthrough: true }) res: Response) {
    const isDevOrTest = process.env.NODE_ENV !== 'production';
    if (!isDevOrTest && process.env.AUTH_MODE !== 'e2e') {
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    let user;
    switch (testIdentity) {
      case 'company-admin-acme-india':
        user = {
          id: 'user-acme-in-admin',
          email: 'india-admin@acme.test',
          principalType: 'CUSTOMER',
          roles: ['CompanyAdmin'],
          enterpriseId: 'ent-acme',
          allowedCompanyIds: ['comp-acme-in'],
        };
        break;
      case 'enterprise-admin-acme':
        user = {
          id: 'user-acme-admin',
          email: 'admin@acme.test',
          principalType: 'CUSTOMER',
          roles: ['EnterpriseAdmin'],
          enterpriseId: 'ent-acme',
          allowedCompanyIds: ['*'],
        };
        break;
      case 'company-admin-globex':
        user = {
          id: 'user-globex-admin',
          email: 'admin@globex.test',
          principalType: 'CUSTOMER',
          roles: ['CompanyAdmin'],
          enterpriseId: 'ent-globex',
          allowedCompanyIds: ['comp-globex-in'],
        };
        break;
      case 'employee-acme':
        user = {
          id: 'user-acme-employee',
          email: 'employee@acme.test',
          principalType: 'CUSTOMER',
          roles: ['User'],
          enterpriseId: 'ent-acme',
          allowedCompanyIds: ['comp-acme-in'],
        };
        break;
      case 'vendor-admin':
        user = {
          id: 'user-vendor-admin',
          email: 'admin@trustfabric.test',
          principalType: 'VENDOR',
          roles: ['TrustfabricAdmin'],
          allowedCompanyIds: ['*'],
        };
        break;
      default:
        throw new UnauthorizedException('Invalid test identity');
    }

    const sessionData = JSON.stringify(user);
    const token = Buffer.from(sessionData).toString('base64');

    res.cookie('E2E_SESSION', token, {
      httpOnly: true,
      secure: false, // local test environment only
      sameSite: 'lax',
      maxAge: 3_600_000, // 1 hour
    });

    this.logger.debug(`E2E session created for testIdentity=${testIdentity}`);
    return { status: 'OK' };
  }
}

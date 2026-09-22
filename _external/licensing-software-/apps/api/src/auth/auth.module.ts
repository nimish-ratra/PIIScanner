import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { TenantGuard } from './tenant.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { AuthController } from './auth.controller.js';
import { E2eAuthController } from './e2e-auth.controller.js';
import { VendorAuthController } from './vendor-auth.controller.js';
import { SessionService } from './session.service.js';
import { IdentityService } from './identity.service.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { VendorAuthService } from './vendor-auth.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, E2eAuthController, VendorAuthController],
  providers: [
    SessionService,
    IdentityService,
    PasswordService,
    LoginRateLimiterService,
    CustomerAuthService,
    VendorAuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  exports: [SessionService, IdentityService, PasswordService],
})
export class AuthModule {}

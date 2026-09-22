import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { InstallationsModule } from './installations/installations.module.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import { LicensesModule } from './licenses/licenses.module.js';
import { LicenseRequestsModule } from './license-requests/license-requests.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { AgentModule } from './agent/agent.module.js';
import { EnrollmentTokensModule } from './enrollment-tokens/enrollment-tokens.module.js';
import { ProductsModule } from './products/products.module.js';
import { EditionsModule } from './editions/editions.module.js';
import { FeaturesModule } from './features/features.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { ActivationsModule } from './activations/activations.module.js';
import { AgentTelemetryModule } from './agent-telemetry/agent-telemetry.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    PrismaModule,
    AuditModule,
    InstallationsModule,
    EntitlementsModule,
    LicensesModule,
    LicenseRequestsModule,
    CompaniesModule,
    AgentModule,
    EnrollmentTokensModule,
    ProductsModule,
    EditionsModule,
    FeaturesModule,
    CustomersModule,
    ActivationsModule,
    AgentTelemetryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}


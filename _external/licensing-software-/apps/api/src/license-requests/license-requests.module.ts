import { Module } from '@nestjs/common';
import { LicenseRequestsService } from './license-requests.service.js';
import { LicenseRequestsController } from './license-requests.controller.js';
import { LicensesModule } from '../licenses/licenses.module.js';
import { ActivationsModule } from '../activations/activations.module.js';

@Module({
  imports: [LicensesModule, ActivationsModule],
  controllers: [LicenseRequestsController],
  providers: [LicenseRequestsService]
})
export class LicenseRequestsModule {}

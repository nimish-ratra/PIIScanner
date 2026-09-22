import { Module } from '@nestjs/common';
import { InstallationsService } from './installations.service.js';
import { InstallationsController, VendorInstallationsController } from './installations.controller.js';
import { ActivationsModule } from '../activations/activations.module.js';

@Module({
  imports: [ActivationsModule],
  controllers: [InstallationsController, VendorInstallationsController],
  providers: [InstallationsService],
})
export class InstallationsModule {}

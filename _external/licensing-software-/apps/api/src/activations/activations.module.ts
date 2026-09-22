import { Module } from '@nestjs/common';
import { ActivationsService } from './activations.service.js';
import { ActivationsController } from './activations.controller.js';
import { VendorActivationsController } from './vendor-activations.controller.js';

@Module({
  controllers: [ActivationsController, VendorActivationsController],
  providers: [ActivationsService],
  exports: [ActivationsService],
})
export class ActivationsModule {}

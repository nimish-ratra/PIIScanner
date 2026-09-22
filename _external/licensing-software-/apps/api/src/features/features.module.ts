import { Module } from '@nestjs/common';
import { FeaturesService } from './features.service.js';
import { FeaturesController, EditionFeaturesController } from './features.controller.js';

@Module({
  controllers: [EditionFeaturesController, FeaturesController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}

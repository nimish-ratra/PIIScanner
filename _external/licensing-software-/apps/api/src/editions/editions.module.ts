import { Module } from '@nestjs/common';
import { EditionsService } from './editions.service.js';
import { EditionsController, ProductEditionsController } from './editions.controller.js';

@Module({
  controllers: [ProductEditionsController, EditionsController],
  providers: [EditionsService],
  exports: [EditionsService],
})
export class EditionsModule {}

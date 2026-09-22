import { Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service.js';
import { EntitlementsController, CustomerEntitlementsController } from './entitlements.controller.js';

@Module({
  controllers: [EntitlementsController, CustomerEntitlementsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService]
})
export class EntitlementsModule {}

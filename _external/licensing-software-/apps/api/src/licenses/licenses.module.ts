import { Module } from '@nestjs/common';
import { LicensesService } from './licenses.service.js';
import { LicensesController } from './licenses.controller.js';
import { LicensesSummaryController } from './licenses-summary.controller.js';

@Module({
  controllers: [LicensesSummaryController, LicensesController],
  providers: [LicensesService],
  exports: [LicensesService]
})
export class LicensesModule {}

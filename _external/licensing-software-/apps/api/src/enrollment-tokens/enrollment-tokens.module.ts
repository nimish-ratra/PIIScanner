import { Module } from '@nestjs/common';
import { EnrollmentTokensController } from './enrollment-tokens.controller.js';
import { EnrollmentTokensService } from './enrollment-tokens.service.js';

@Module({
  controllers: [EnrollmentTokensController],
  providers: [EnrollmentTokensService],
})
export class EnrollmentTokensModule {}

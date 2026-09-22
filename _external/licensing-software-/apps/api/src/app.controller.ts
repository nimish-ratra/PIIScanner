import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';
import { PrismaService } from './prisma/prisma.service.js';
import type { Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  getHealth(): { status: string; timestamp: Date } {
    return { status: 'OK', timestamp: new Date() };
  }

  @Public()
  @Get('ready')
  async getReady(@Res() res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return res.status(HttpStatus.OK).json({ status: 'READY' });
    } catch (error) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'NOT_READY' });
    }
  }
}

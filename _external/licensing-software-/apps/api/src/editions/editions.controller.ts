import { Body, Controller, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { EditionsService } from './editions.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { CreateEditionDto, UpdateEditionDto } from './editions.dto.js';

@Controller('vendor/products/:productId/editions')
export class ProductEditionsController {
  constructor(private readonly editionsService: EditionsService) {}

  @Get()
  @RequirePermissions('vendor.product.read')
  async findAll(@Param('productId') productId: string) {
    return this.editionsService.findAllForProduct(productId);
  }

  @Post()
  @RequirePermissions('vendor.product.manage')
  async create(@Param('productId') productId: string, @Body() dto: CreateEditionDto, @Request() req: any) {
    return this.editionsService.create(productId, dto, req.user.id);
  }
}

@Controller('vendor/editions')
export class EditionsController {
  constructor(private readonly editionsService: EditionsService) {}

  @Patch(':id')
  @RequirePermissions('vendor.product.manage')
  async update(@Param('id') id: string, @Body() dto: UpdateEditionDto, @Request() req: any) {
    return this.editionsService.update(id, dto, req.user.id);
  }
}

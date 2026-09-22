import { Body, Controller, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { CreateProductDto, UpdateProductDto } from './products.dto.js';

/**
 * Vendor product catalog — the commercial hierarchy Product -> Edition ->
 * Feature. Customer-facing services never see this controller; entitlements
 * only reference a Product/Edition id.
 */
@Controller('vendor/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('vendor.product.read')
  async findAll() {
    return this.productsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('vendor.product.read')
  async findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @RequirePermissions('vendor.product.manage')
  async create(@Body() dto: CreateProductDto, @Request() req: any) {
    return this.productsService.create(dto, req.user.id);
  }

  @Patch(':id')
  @RequirePermissions('vendor.product.manage')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Request() req: any) {
    return this.productsService.update(id, dto, req.user.id);
  }
}

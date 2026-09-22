import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type {
  CreateEntitlementDto,
  ExtendEntitlementDto,
  UpdateEntitlementQuantityDto,
  UpdateEntitlementStatusDto,
} from './entitlements.dto.js';

@Controller('vendor/entitlements')
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  @RequirePermissions('entitlement.read')
  async findAll(@Request() req: any) {
    const enterpriseIds = req.user.allowedCompanyIds.includes('*') ? ['*'] : [req.user.enterpriseId || 'unknown'];
    return this.entitlementsService.findAll(enterpriseIds);
  }

  @Get(':id')
  @RequirePermissions('entitlement.read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const enterpriseIds = req.user.allowedCompanyIds.includes('*') ? ['*'] : [req.user.enterpriseId || 'unknown'];
    return this.entitlementsService.findOne(id, enterpriseIds);
  }

  /**
   * Entitlement issuance and lifecycle are vendor-exclusive commercial
   * operations (see docs on principal responsibilities) — these routes are
   * intentionally absent from CustomerEntitlementsController below.
   */
  @Post()
  @RequirePermissions('vendor.entitlement.create')
  async create(@Body() dto: CreateEntitlementDto, @Request() req: any) {
    return this.entitlementsService.create(dto, req.user.id);
  }

  @Post(':id/status')
  @RequirePermissions('vendor.entitlement.manage')
  async setStatus(@Param('id') id: string, @Body() dto: UpdateEntitlementStatusDto, @Request() req: any) {
    return this.entitlementsService.setStatus(id, dto.status, req.user.id);
  }

  @Post(':id/extend')
  @RequirePermissions('vendor.entitlement.manage')
  async extend(@Param('id') id: string, @Body() dto: ExtendEntitlementDto, @Request() req: any) {
    return this.entitlementsService.extend(id, dto, req.user.id);
  }

  @Post(':id/quantity')
  @RequirePermissions('vendor.entitlement.manage')
  async updateQuantity(@Param('id') id: string, @Body() dto: UpdateEntitlementQuantityDto, @Request() req: any) {
    return this.entitlementsService.updateQuantity(id, dto, req.user.id);
  }
}

@Controller('customer/entitlements')
export class CustomerEntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  @RequirePermissions('entitlement.read')
  async findAll(@Request() req: any) {
    const enterpriseIds = req.user.allowedCompanyIds.includes('*') ? ['*'] : [req.user.enterpriseId || 'unknown']; 
    return this.entitlementsService.findAll(enterpriseIds);
  }

  @Get(':id')
  @RequirePermissions('entitlement.read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const enterpriseIds = req.user.allowedCompanyIds.includes('*') ? ['*'] : [req.user.enterpriseId || 'unknown'];
    return this.entitlementsService.findOne(id, enterpriseIds);
  }
}

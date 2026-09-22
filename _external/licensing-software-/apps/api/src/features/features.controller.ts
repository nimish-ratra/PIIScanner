import { Body, Controller, Param, Patch, Post, Request } from '@nestjs/common';
import { FeaturesService } from './features.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { CreateFeatureDto, UpdateFeatureDto } from './features.dto.js';

@Controller('vendor/editions/:editionId/features')
export class EditionFeaturesController {
  constructor(private readonly featuresService: FeaturesService) {}

  @Post()
  @RequirePermissions('vendor.product.manage')
  async create(@Param('editionId') editionId: string, @Body() dto: CreateFeatureDto, @Request() req: any) {
    return this.featuresService.create(editionId, dto, req.user.id);
  }
}

@Controller('vendor/features')
export class FeaturesController {
  constructor(private readonly featuresService: FeaturesService) {}

  @Patch(':id')
  @RequirePermissions('vendor.product.manage')
  async update(@Param('id') id: string, @Body() dto: UpdateFeatureDto, @Request() req: any) {
    return this.featuresService.update(id, dto, req.user.id);
  }
}

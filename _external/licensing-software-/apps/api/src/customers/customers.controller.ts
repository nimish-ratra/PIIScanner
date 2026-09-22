import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { CreateCustomerDto, UpdateCustomerStatusDto, CreateCompanyDto } from './customers.dto.js';

@Controller('vendor/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('vendor.customer.read')
  async findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  @RequirePermissions('vendor.customer.read')
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  @RequirePermissions('vendor.customer.manage')
  async create(@Body() dto: CreateCustomerDto, @Request() req: any) {
    return this.customersService.create(dto, req.user.id);
  }

  @Post(':id/status')
  @RequirePermissions('vendor.customer.manage')
  async setStatus(@Param('id') id: string, @Body() dto: UpdateCustomerStatusDto, @Request() req: any) {
    return this.customersService.setStatus(id, dto.status, req.user.id);
  }

  @Post(':id/companies')
  @RequirePermissions('vendor.customer.manage')
  async addCompany(@Param('id') id: string, @Body() dto: CreateCompanyDto, @Request() req: any) {
    return this.customersService.addCompany(id, dto, req.user.id);
  }
}

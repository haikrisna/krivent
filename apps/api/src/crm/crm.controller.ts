import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Inject,
  HttpCode,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { CrmBody, CrmQueries } from './crm.swagger.js';
import { CrmService } from './crm.service.js';
import * as schemas from './crm.schemas.js';
const present = <T extends object>(row: T) =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !['dedupKey', 'normalizedEmail'].includes(key),
    ),
  );
import type {
  Actor,
  Query as ListQuery,
  LeadInput,
  CustomerInput,
  ActivityInput,
  FollowInput,
} from './crm.schemas.js';

@ApiTags('leads')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF')
@Controller('leads')
export class LeadsController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}
  @Get()
  @ApiOperation({ summary: 'List leads within current ownership scope' })
  @CrmQueries('leads')
  @ApiResponse({
    status: 200,
    description: '{ data: [], meta: { page, pageSize, total, totalPages } }',
  })
  async list(
    @CurrentUser() actor: Actor,
    @Query({ schema: schemas.listQuery }) query: ListQuery,
  ) {
    const result = await this.crm.list(actor, 'leads', query);
    return {
      ...result,
      data: result.data.map((row) => present(row as object)),
    };
  }
  @Post()
  @ApiOperation({ summary: 'Create leads' })
  @CrmBody(schemas.leadCreate, {
    companyName: 'PT Mitra Elektronik',
    contactName: 'Budi',
    source: 'REFERRAL',
  })
  async create(
    @CurrentUser() actor: Actor,
    @Body({ schema: schemas.leadCreate }) body: LeadInput,
  ) {
    return { data: present(await this.crm.createLead(actor, body)) };
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Get active leads; Admin may explicitly request status=all',
  })
  async detail(
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
    @Query({ schema: schemas.listQuery }) query: ListQuery,
  ) {
    return { data: present(await this.crm.detail(actor, 'leads', id, query)) };
  }
  @Patch(':id')
  @CrmBody(schemas.leadUpdate, { contactName: 'Siti' })
  async update(
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
    @Body({ schema: schemas.leadUpdate }) body: Partial<LeadInput>,
  ) {
    return { data: present(await this.crm.updateLead(actor, id, body)) };
  }
  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @Body({ schema: schemas.emptyBody }) _body: Record<string, never>,
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
  ) {
    return { data: present(await this.crm.archive(actor, 'leads', id)) };
  }
  @Post(':id/stage')
  @HttpCode(200)
  @CrmBody(schemas.stageBody, { stage: 'CONTACTED' })
  async stage(
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
    @Body({ schema: schemas.stageBody })
    body: { stage: string; reason?: string },
  ) {
    return {
      data: present(
        await this.crm.transition(actor, id, body.stage, body.reason),
      ),
    };
  }
  @Post(':id/convert')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Atomically convert WON lead; repeat returns the same Customer',
  })
  async convert(
    @Body({ schema: schemas.emptyBody }) _body: Record<string, never>,
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
  ) {
    return { data: present(await this.crm.convert(actor, id)) };
  }
}

@ApiTags('customers')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF')
@Controller('customers')
export class CustomersController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}
  @Get()
  @ApiOperation({ summary: 'List customers within current ownership scope' })
  @CrmQueries('customers')
  @ApiResponse({
    status: 200,
    description: '{ data: [], meta: { page, pageSize, total, totalPages } }',
  })
  async list(
    @CurrentUser() actor: Actor,
    @Query({ schema: schemas.listQuery }) query: ListQuery,
  ) {
    const result = await this.crm.list(actor, 'customers', query);
    return {
      ...result,
      data: result.data.map((row) => present(row as object)),
    };
  }
  @Post()
  @ApiOperation({ summary: 'Create customers' })
  @CrmBody(schemas.customerCreate, {
    name: 'PT Mitra Elektronik',
    contactName: 'Budi',
  })
  async create(
    @CurrentUser() actor: Actor,
    @Body({ schema: schemas.customerCreate }) body: CustomerInput,
  ) {
    return { data: present(await this.crm.createCustomer(actor, body)) };
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Get active customers; Admin may explicitly request status=all',
  })
  async detail(
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
    @Query({ schema: schemas.listQuery }) query: ListQuery,
  ) {
    return {
      data: present(await this.crm.detail(actor, 'customers', id, query)),
    };
  }
  @Patch(':id')
  @CrmBody(schemas.customerUpdate, { contactName: 'Siti' })
  async update(
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
    @Body({ schema: schemas.customerUpdate }) body: Partial<CustomerInput>,
  ) {
    return { data: present(await this.crm.updateCustomer(actor, id, body)) };
  }
  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @Body({ schema: schemas.emptyBody }) _body: Record<string, never>,
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
  ) {
    return { data: present(await this.crm.archive(actor, 'customers', id)) };
  }
}

@ApiTags('activities')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF')
@Controller('activities')
export class ActivitiesController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}
  @Get()
  @ApiOperation({ summary: 'List activities within current ownership scope' })
  @CrmQueries('activities')
  @ApiResponse({
    status: 200,
    description: '{ data: [], meta: { page, pageSize, total, totalPages } }',
  })
  async list(
    @CurrentUser() actor: Actor,
    @Query({ schema: schemas.listQuery }) query: ListQuery,
  ) {
    const result = await this.crm.list(actor, 'activities', query);
    return {
      ...result,
      data: result.data.map((row) => present(row as object)),
    };
  }
  @Post()
  @ApiOperation({ summary: 'Create activities' })
  @CrmBody(schemas.activityCreate, {
    leadId: '00000000-0000-4000-8000-000000000001',
    type: 'CALL',
    note: 'Diskusi kebutuhan laptop',
    occurredAt: '2026-11-10T08:00:00Z',
  })
  async create(
    @CurrentUser() actor: Actor,
    @Body({ schema: schemas.activityCreate }) body: ActivityInput,
  ) {
    return { data: present(await this.crm.activity(actor, body)) };
  }
}

@ApiTags('follow-ups')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF')
@Controller('follow-ups')
export class FollowUpsController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}
  @Get()
  @ApiOperation({ summary: 'List follow-ups within current ownership scope' })
  @CrmQueries('follow-ups')
  @ApiResponse({
    status: 200,
    description: '{ data: [], meta: { page, pageSize, total, totalPages } }',
  })
  async list(
    @CurrentUser() actor: Actor,
    @Query({ schema: schemas.listQuery }) query: ListQuery,
  ) {
    const result = await this.crm.list(actor, 'follow-ups', query);
    return {
      ...result,
      data: result.data.map((row) => present(row as object)),
    };
  }
  @Post()
  @ApiOperation({ summary: 'Create follow-ups' })
  @CrmBody(schemas.followCreate, {
    leadId: '00000000-0000-4000-8000-000000000001',
    note: 'Kirim proposal',
    dueAt: '2026-11-12T08:00:00Z',
  })
  async create(
    @CurrentUser() actor: Actor,
    @Body({ schema: schemas.followCreate }) body: FollowInput,
  ) {
    return { data: present(await this.crm.follow(actor, body)) };
  }
  @Patch(':id/status')
  @CrmBody(schemas.followStatus, { status: 'COMPLETED' })
  async status(
    @CurrentUser() actor: Actor,
    @Param('id', { schema: schemas.id }) id: string,
    @Body({ schema: schemas.followStatus })
    body: { status: 'COMPLETED' | 'CANCELLED' },
  ) {
    return {
      data: present(await this.crm.followState(actor, id, body.status)),
    };
  }
}

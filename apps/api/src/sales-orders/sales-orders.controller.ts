import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import type { Actor } from '../crm/crm.schemas.js';
import { CrmBody } from '../crm/crm.swagger.js';
import * as s from './sales-orders.schemas.js';
import { SalesOrdersService } from './sales-orders.service.js';
import { OrderDocs, OrderQueries } from './sales-orders.swagger.js';
@ApiTags('sales-orders')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    @Inject(SalesOrdersService) private readonly orders: SalesOrdersService,
  ) {}
  @Get()
  @OrderQueries()
  @OrderDocs(200, true)
  list(
    @CurrentUser() a: Actor,
    @Query({ schema: s.listQuery }) q: s.ListQuery,
  ) {
    return this.orders.list(a, q);
  }
  @Get(':id')
  @OrderDocs(200)
  async detail(
    @CurrentUser() a: Actor,
    @Param('id', { schema: s.id }) id: string,
  ) {
    return { data: await this.orders.detail(a, id) };
  }
  @Post()
  @Roles('ADMIN', 'SALES_STAFF')
  @OrderDocs(201)
  @ApiOperation({
    summary:
      'Create draft with immutable database price snapshots; no stock reservation',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @CrmBody(s.createOrder, {
    customerId: '00000000-0000-4000-8000-000000000001',
    items: [{ productId: '00000000-0000-4000-8000-000000000002', quantity: 2 }],
  })
  async create(
    @CurrentUser() a: Actor,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: s.createOrder }) body: s.CreateOrder,
  ) {
    return { data: await this.orders.create(a, key, body) };
  }
  @Patch(':id')
  @Roles('ADMIN', 'SALES_STAFF')
  @OrderDocs(200)
  @CrmBody(s.updateOrder, { notes: 'Customer purchase reference PO-01' })
  async update(
    @CurrentUser() a: Actor,
    @Param('id', { schema: s.id }) id: string,
    @Body({ schema: s.updateOrder }) body: { notes: string | null },
  ) {
    return { data: await this.orders.update(a, id, body.notes) };
  }
  @Post(':id/confirm')
  @HttpCode(200)
  @Roles('ADMIN', 'SALES_STAFF')
  @OrderDocs(200)
  @CrmBody(s.empty, {})
  async confirm(
    @CurrentUser() a: Actor,
    @Param('id', { schema: s.id }) id: string,
    @Body({ schema: s.empty }) _body: object,
  ) {
    return { data: await this.orders.transition(a, id, 'confirm') };
  }
  @Post(':id/fulfill')
  @HttpCode(200)
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @OrderDocs(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @CrmBody(s.empty, {})
  @ApiOperation({
    summary:
      'Atomically deduct stock and fulfill confirmed order; same key safely replays',
  })
  async fulfill(
    @CurrentUser() a: Actor,
    @Param('id', { schema: s.id }) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: s.empty }) _body: object,
  ) {
    return { data: await this.orders.fulfill(a, id, key) };
  }
  @Post(':id/complete')
  @HttpCode(200)
  @Roles('ADMIN', 'SALES_STAFF')
  @OrderDocs(200)
  @CrmBody(s.empty, {})
  async complete(
    @CurrentUser() a: Actor,
    @Param('id', { schema: s.id }) id: string,
    @Body({ schema: s.empty }) _body: object,
  ) {
    return { data: await this.orders.transition(a, id, 'complete') };
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('ADMIN', 'SALES_STAFF')
  @OrderDocs(200)
  @CrmBody(s.cancelOrder, { reason: 'Customer cancelled before fulfillment' })
  async cancel(
    @CurrentUser() a: Actor,
    @Param('id', { schema: s.id }) id: string,
    @Body({ schema: s.cancelOrder }) body: { reason: string },
  ) {
    return { data: await this.orders.transition(a, id, 'cancel', body.reason) };
  }
}

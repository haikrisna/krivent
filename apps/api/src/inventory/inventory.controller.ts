import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { InventoryService } from './inventory.service.js';
import * as schemas from './inventory.schemas.js';
import type { AuthenticatedUser } from '../users/user.select.js';
import {
  InventoryBody,
  InventoryErrors,
  InventoryQueries,
  InventoryResponse,
} from './inventory.swagger.js';
@ApiTags('inventory')
@ApiBearerAuth('access-token')
@InventoryErrors()
@Roles('ADMIN', 'WAREHOUSE_STAFF', 'SALES_STAFF')
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}
  @Post('receipts')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({
    summary: 'Receive goods atomically; retries replay the original movement',
  })
  @InventoryBody(schemas.receiptSchema, {
    productId: '00000000-0000-4000-8000-000000000001',
    quantity: 24,
    reason: 'Terima router PO-2026-001',
  })
  @InventoryResponse(201)
  async receipt(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: schemas.receiptSchema }) input: schemas.Receipt,
  ) {
    return {
      data: await this.inventory.change(actor.id, key, 'receipt', input),
    };
  }
  @Post('adjustments')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({
    summary:
      'Reconcile physical count using expectedVersion; stale counts return 409',
    description:
      'countedQuantity is the desired absolute balance, including zero. Unchanged counts return 409 without a movement.',
  })
  @InventoryBody(schemas.adjustmentSchema, {
    productId: '00000000-0000-4000-8000-000000000001',
    countedQuantity: 22,
    expectedVersion: 1,
    reason: 'Stock opname: dua unit rusak dipisahkan',
  })
  @InventoryResponse(201)
  async adjustment(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: schemas.adjustmentSchema }) input: schemas.Adjustment,
  ) {
    return {
      data: await this.inventory.change(actor.id, key, 'adjustment', input),
    };
  }
  @Get('balances')
  @ApiOperation({
    summary:
      'Stock availability; lowStock=true means stockQuantity <= product threshold',
    description:
      'Active products by default. Includes no cost or selling prices.',
  })
  @InventoryQueries(schemas.balanceQuery)
  @InventoryResponse(200, true, true)
  balances(
    @Query({ schema: schemas.balanceQuery }) query: schemas.BalanceQuery,
  ) {
    return this.inventory.balances(query);
  }
  @Get('movements')
  @ApiOperation({
    summary: 'Immutable stock ledger, including archived products',
    description:
      'Search reason/SKU/name; inclusive ISO timestamp range. Legacy snapshots can be null.',
  })
  @InventoryQueries(schemas.movementQuery)
  @InventoryResponse(200, true)
  movements(
    @Query({ schema: schemas.movementQuery }) query: schemas.MovementQuery,
  ) {
    return this.inventory.movements(query);
  }
  @Get('movements/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @InventoryResponse(200)
  async movement(@Param('id', { schema: schemas.id }) id: string) {
    return { data: await this.inventory.movement(id) };
  }
}

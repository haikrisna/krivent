import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import type { Actor } from '../crm/crm.schemas.js';
import { ReportingService } from './reporting.service.js';
import * as schemas from './reporting.schemas.js';
import type {
  Range,
  Page,
  TopQuery,
  PerformanceQuery,
  InventoryQuery,
  AuditQuery,
} from './reporting.schemas.js';
import { ReportOperation } from './reporting.swagger.js';
@ApiTags('reports')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF')
@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(ReportingService) private readonly reports: ReportingService,
  ) {}
  @Get('sales')
  @ReportOperation(
    'Realized sales by UTC day',
    schemas.salesQuery,
    'FULFILLED and COMPLETED counted once at fulfilledAt. Date descending.',
  )
  sales(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.salesQuery }) q: Page,
  ) {
    return this.reports.sales(a, q);
  }
  @Get('top-products')
  @ReportOperation(
    'Best-selling products',
    schemas.topQuery,
    'Realized orders only. Snapshot quantity × unitPrice. rankBy descending numerically, productId ascending for ties. Quantity is an integer string.',
  )
  top(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.topQuery }) q: TopQuery,
  ) {
    return this.reports.topProducts(a, q);
  }
  @Get('sales-performance')
  @ReportOperation(
    'Sales performance by order creator',
    schemas.performanceQuery,
    'Existing createdById attribution; no separate assigned staff field. Sales Staff see only own attribution within current customer ownership. Realized value descending, staffId ascending for ties.',
  )
  performance(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.performanceQuery }) q: PerformanceQuery,
  ) {
    return this.reports.performance(a, q);
  }
  @Get('lead-conversion')
  @ReportOperation(
    'Lead creation cohort conversion',
    schemas.conversionQuery,
    'Leads created in range, including archived. Conversion requires linked customer visible in current scope. Rate = converted / leads × 100, zero for empty cohort. Stage enum ascending. Measured as of now.',
  )
  conversion(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.conversionQuery }) q: Page,
  ) {
    return this.reports.conversion(a, q);
  }
  @Get('inventory')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ReportOperation(
    'Inventory balances and movements',
    schemas.inventoryQuery,
    'Balances: current active products, SKU then ID ascending. Low stock means quantity <= threshold. Movements: historical ledger including archived products, createdAt descending then ID ascending. Summary is current active balances; movement totals apply date/type/product filters.',
  )
  inventory(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.inventoryQuery }) q: InventoryQuery,
  ) {
    return this.reports.inventory(a, q);
  }
}
@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF')
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(ReportingService) private readonly reports: ReportingService,
  ) {}
  @Get('summary')
  @ReportOperation(
    'Role-scoped dashboard',
    schemas.summaryQuery,
    'Admin: all metrics. Sales: current customer/lead ownership, no inventory. Warehouse: inventory only. Order status counts/orderedValue use createdAt; realizedSales uses fulfilledAt. Active leads exclude WON/LOST; pipeline includes all active stages. Recent events are latest 10 as of now. Empty grouped datasets return [].',
  )
  summary(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.summaryQuery }) q: Range,
  ) {
    return this.reports.summary(a, q);
  }
}
@ApiTags('audit-logs')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(
    @Inject(ReportingService) private readonly reports: ReportingService,
  ) {}
  @Get()
  @ReportOperation(
    'Append-only business audit',
    schemas.auditQuery,
    'Admin only. createdAt descending then ID ascending. No update/delete endpoints. Events start at Phase 7 deployment; no historical backfill.',
  )
  list(
    @CurrentUser() a: Actor,
    @Query({ schema: schemas.auditQuery }) q: AuditQuery,
  ) {
    return this.reports.auditLogs(a, q);
  }
}

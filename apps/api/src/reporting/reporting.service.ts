import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from '../crm/crm.schemas.js';
import type {
  Range,
  Page,
  TopQuery,
  PerformanceQuery,
  InventoryQuery,
  AuditQuery,
} from './reporting.schemas.js';
type Tx = Prisma.TransactionClient;
// SQL identifiers and sort clauses are compile-time constants, never query string input.
const dateFilter = (column: Prisma.Sql, q: Range) => Prisma.sql`
  ${q.from ? Prisma.sql`AND ${column} >= ${new Date(q.from)}` : Prisma.empty}
  ${q.to ? Prisma.sql`AND ${column} < ${new Date(q.to)}` : Prisma.empty}`;
const realized = Prisma.sql`s.status IN ('FULFILLED','COMPLETED') AND s.fulfilled_at IS NOT NULL`;
@Injectable()
export class ReportingService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private allow(a: Actor, roles: string[]) {
    if (!roles.includes(a.role)) throw new ForbiddenException();
  }
  private salesScope(a: Actor) {
    this.allow(a, ['ADMIN', 'SALES_STAFF']);
    return a.role === 'ADMIN'
      ? Prisma.empty
      : Prisma.sql`AND EXISTS (SELECT 1 FROM customers c WHERE c.id=s.customer_id AND c.owner_id=${a.id}::uuid)`;
  }
  private crmScope(a: Actor) {
    this.allow(a, ['ADMIN', 'SALES_STAFF']);
    return a.role === 'ADMIN'
      ? Prisma.empty
      : Prisma.sql`AND l.owner_id=${a.id}::uuid`;
  }
  private snapshot<T>(fn: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(fn, {
      isolationLevel: 'RepeatableRead',
      timeout: 10000,
    });
  }
  private async page(tx: Tx, query: Prisma.Sql, order: Prisma.Sql, q: Page) {
    const [result] = await tx.$queryRaw<
      Array<{ data: Prisma.JsonValue[]; total: number }>
    >`
      WITH result AS (${query}), page AS (
        SELECT result.*, ROW_NUMBER() OVER (ORDER BY ${order}) AS _position FROM result ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
      ) SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) - '_position' ORDER BY p._position) FROM page p), '[]'::jsonb) AS data,
        (SELECT COUNT(*)::int FROM result) AS total`;
    return {
      data: result.data,
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / q.pageSize),
      },
    };
  }
  sales(a: Actor, q: Page) {
    const scope = this.salesScope(a);
    return this.snapshot((tx) =>
      this.page(
        tx,
        Prisma.sql`
      SELECT to_char(s.fulfilled_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,
        COUNT(*)::int AS "orderCount", SUM(s.total_amount)::text AS "realizedSales"
      FROM sales s WHERE ${realized} ${scope} ${dateFilter(Prisma.sql`s.fulfilled_at`, q)}
      GROUP BY 1`,
        Prisma.sql`date DESC`,
        q,
      ),
    );
  }
  topProducts(a: Actor, q: TopQuery) {
    const scope = this.salesScope(a);
    return this.snapshot((tx) =>
      this.page(
        tx,
        Prisma.sql`
      SELECT p.id AS "productId", p.sku, p.name, SUM(i.quantity)::text AS quantity,
        SUM(i.quantity::numeric * i.unit_price)::text AS value
      FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id
      WHERE ${realized} ${scope} ${dateFilter(Prisma.sql`s.fulfilled_at`, q)}
      GROUP BY p.id`,
        q.rankBy === 'quantity'
          ? Prisma.sql`quantity::numeric DESC, "productId" ASC`
          : Prisma.sql`value::numeric DESC, "productId" ASC`,
        q,
      ),
    );
  }
  performance(a: Actor, q: PerformanceQuery) {
    const scope = this.salesScope(a);
    if (a.role === 'SALES_STAFF' && q.staffId && q.staffId !== a.id)
      throw new ForbiddenException();
    // There is no assigned Sales Staff field on Sale: createdById is the existing attribution.
    return this.snapshot((tx) =>
      this.page(
        tx,
        Prisma.sql`
      SELECT u.id AS "staffId", u.name, COUNT(*)::int AS "orderCount", SUM(s.total_amount)::text AS "realizedSales"
      FROM sales s JOIN users u ON u.id=s.created_by_id
      WHERE ${realized} ${scope} ${dateFilter(Prisma.sql`s.fulfilled_at`, q)}
        ${a.role === 'SALES_STAFF' ? Prisma.sql`AND s.created_by_id=${a.id}::uuid` : Prisma.empty}
        ${q.staffId ? Prisma.sql`AND s.created_by_id=${q.staffId}::uuid` : Prisma.empty}
      GROUP BY u.id`,
        Prisma.sql`"realizedSales"::numeric DESC, "staffId" ASC`,
        q,
      ),
    );
  }
  conversion(a: Actor, q: Page) {
    const scope = this.crmScope(a);
    return this.snapshot(async (tx) => {
      const base = Prisma.sql`FROM leads l WHERE TRUE ${scope} ${dateFilter(Prisma.sql`l.created_at`, q)}`;
      // Cohort conversion as of now; historical ownership and stage snapshots do not exist.
      const [summary] = await tx.$queryRaw<Prisma.JsonObject[]>`
        SELECT COUNT(*)::int AS "leadCount", COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM customers c WHERE c.lead_id=l.id
          ${a.role === 'SALES_STAFF' ? Prisma.sql`AND c.owner_id=${a.id}::uuid` : Prisma.empty}
        ))::int AS "convertedCount" ${base}`;
      const leads = Number(summary.leadCount),
        converted = Number(summary.convertedCount);
      const result = await this.page(
        tx,
        Prisma.sql`
        SELECT l.stage, COUNT(*)::int AS count ${base} GROUP BY l.stage`,
        Prisma.sql`stage ASC`,
        q,
      );
      return {
        ...result,
        summary: {
          ...summary,
          conversionRate: leads
            ? new Prisma.Decimal(converted).div(leads).mul(100).toFixed(2)
            : '0.00',
        },
      };
    });
  }
  inventory(a: Actor, q: InventoryQuery) {
    this.allow(a, ['ADMIN', 'WAREHOUSE_STAFF']);
    return this.snapshot(async (tx) => {
      const productFilter = q.productId
        ? Prisma.sql`AND p.id=${q.productId}::uuid`
        : Prisma.empty;
      const [summary] = await tx.$queryRaw<Prisma.JsonObject[]>`
        SELECT COUNT(*)::int AS "activeProducts", COUNT(*) FILTER (WHERE p.stock_quantity<=p.low_stock_threshold)::int AS "lowStockProducts",
          COALESCE(SUM(p.stock_quantity),0)::text AS "stockQuantity"
        FROM products p WHERE p.is_active ${productFilter}`;
      if (q.view === 'balances') {
        const result = await this.page(
          tx,
          Prisma.sql`
          SELECT p.id AS "productId", p.sku, p.name, p.stock_quantity AS "stockQuantity", p.low_stock_threshold AS "lowStockThreshold"
          FROM products p WHERE p.is_active ${productFilter}
          ${q.lowStock ? (q.lowStock === 'true' ? Prisma.sql`AND p.stock_quantity<=p.low_stock_threshold` : Prisma.sql`AND p.stock_quantity>p.low_stock_threshold`) : Prisma.empty}`,
          Prisma.sql`sku ASC, "productId" ASC`,
          q,
        );
        return { ...result, summary };
      }
      const filter = Prisma.sql`FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE TRUE ${productFilter}
        ${q.type ? Prisma.sql`AND m.type=${q.type}::"StockMovementType"` : Prisma.empty}
        ${dateFilter(Prisma.sql`m.created_at`, q)}`;
      const movements = await tx.$queryRaw<
        Prisma.JsonObject[]
      >`SELECT m.type, COUNT(*)::int AS count,
        SUM(m.quantity)::text AS "netQuantity" ${filter} GROUP BY m.type ORDER BY m.type`;
      const result = await this.page(
        tx,
        Prisma.sql`SELECT m.id, m.product_id AS "productId", m.type, m.quantity,
        m.before_balance AS "beforeBalance", m.after_balance AS "afterBalance", m.created_at AS "createdAt" ${filter}`,
        Prisma.sql`"createdAt" DESC, id ASC`,
        q,
      );
      return { ...result, summary, movements };
    });
  }
  auditLogs(a: Actor, q: AuditQuery) {
    this.allow(a, ['ADMIN']);
    return this.snapshot((tx) =>
      this.page(
        tx,
        Prisma.sql`
      SELECT id, actor_id AS "actorId", action, resource_type AS "resourceType", resource_id AS "resourceId",
        created_at AS "createdAt", metadata, request_id AS "requestId" FROM audit_logs a WHERE TRUE
        ${dateFilter(Prisma.sql`a.created_at`, q)}
        ${q.actorId ? Prisma.sql`AND a.actor_id=${q.actorId}::uuid` : Prisma.empty}
        ${q.action ? Prisma.sql`AND a.action=${q.action}` : Prisma.empty}
        ${q.resourceType ? Prisma.sql`AND a.resource_type=${q.resourceType}` : Prisma.empty}
        ${q.resourceId ? Prisma.sql`AND a.resource_id=${q.resourceId}::uuid` : Prisma.empty}`,
        Prisma.sql`"createdAt" DESC, id ASC`,
        q,
      ),
    );
  }
  summary(a: Actor, q: Range) {
    this.allow(a, ['ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF']);
    return this.snapshot(async (tx) => {
      const result: Record<string, unknown> = {};
      if (a.role !== 'WAREHOUSE_STAFF') {
        const scope = this.salesScope(a),
          crm = this.crmScope(a);
        result.activeCustomers = await tx.customer.count({
          where: {
            isActive: true,
            ...(a.role === 'SALES_STAFF' ? { ownerId: a.id } : {}),
          },
        });
        result.pipeline =
          await tx.$queryRaw`SELECT l.stage, COUNT(*)::int AS count FROM leads l WHERE l.is_active ${crm} GROUP BY l.stage ORDER BY l.stage`;
        result.activeLeads = await tx.lead.count({
          where: {
            isActive: true,
            stage: { notIn: ['WON', 'LOST'] },
            ...(a.role === 'SALES_STAFF' ? { ownerId: a.id } : {}),
          },
        });
        result.ordersByStatus =
          await tx.$queryRaw`SELECT s.status, COUNT(*)::int AS "orderCount", SUM(s.total_amount)::text AS "orderedValue"
          FROM sales s WHERE TRUE ${scope} ${dateFilter(Prisma.sql`s.created_at`, q)} GROUP BY s.status ORDER BY s.status`;
        const [sales] = await tx.$queryRaw<
          Prisma.JsonObject[]
        >`SELECT COUNT(*)::int AS "orderCount", COALESCE(SUM(s.total_amount),0)::text AS total
          FROM sales s WHERE ${realized} ${scope} ${dateFilter(Prisma.sql`s.fulfilled_at`, q)}`;
        result.realizedSales = {
          ...sales,
          total: new Prisma.Decimal(sales.total as string).toFixed(2),
        };
        // Project structured activity fields only; authorization uses current target ownership.
        result.recentActivity = await tx.crmActivity.findMany({
          where:
            a.role === 'ADMIN'
              ? {}
              : {
                  OR: [
                    { lead: { ownerId: a.id } },
                    { customer: { ownerId: a.id } },
                  ],
                },
          select: {
            id: true,
            leadId: true,
            customerId: true,
            type: true,
            occurredAt: true,
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
          take: 10,
        });
      }
      if (a.role !== 'SALES_STAFF') {
        result.lowStockProducts = await tx.product.count({
          where: {
            isActive: true,
            stockQuantity: { lte: tx.product.fields.lowStockThreshold },
          },
        });
        result.recentInventoryEvents = await tx.stockMovement.findMany({
          select: {
            id: true,
            productId: true,
            type: true,
            quantity: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 10,
        });
      }
      return { data: result };
    });
  }
}

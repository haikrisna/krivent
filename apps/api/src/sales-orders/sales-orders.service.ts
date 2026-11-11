import { audit } from '../audit/audit.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { keySchema } from '../inventory/inventory.schemas.js';
import type { Actor } from '../crm/crm.schemas.js';
import type { CreateOrder, ListQuery } from './sales-orders.schemas.js';
type Tx = Prisma.TransactionClient;
const operational = {
  id: true,
  invoiceNumber: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  confirmedAt: true,
  fulfilledAt: true,
  completedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      product: { select: { sku: true, name: true } },
    },
  },
} satisfies Prisma.SaleSelect;
const full = {
  ...operational,
  customerId: true,
  createdById: true,
  totalAmount: true,
  notes: true,
  cancelledAt: true,
  cancellationReason: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { sku: true, name: true } },
    },
  },
} satisfies Prisma.SaleSelect;
@Injectable()
export class SalesOrdersService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}
  private scope(a: Actor): Prisma.SaleWhereInput {
    if (a.role === 'ADMIN') return {};
    if (a.role === 'SALES_STAFF') return { customer: { ownerId: a.id } };
    if (a.role === 'WAREHOUSE_STAFF')
      return { status: { in: ['CONFIRMED', 'FULFILLED', 'COMPLETED'] } };
    throw new ForbiddenException();
  }
  private manage(a: Actor) {
    if (!['ADMIN', 'SALES_STAFF'].includes(a.role))
      throw new ForbiddenException();
  }
  private async read(tx: Tx, a: Actor, id: string) {
    const row = await tx.sale.findFirst({
      where: { id, ...this.scope(a) },
      select: a.role === 'WAREHOUSE_STAFF' ? operational : full,
    });
    if (!row)
      throw new NotFoundException('Order unavailable within current scope');
    return row;
  }
  detail(a: Actor, id: string) {
    return this.read(this.db, a, id);
  }
  list(a: Actor, q: ListQuery) {
    const where: Prisma.SaleWhereInput = {
      AND: [
        this.scope(a),
        {
          status: q.status,
          customerId: q.customerId,
          invoiceNumber: q.search
            ? { contains: q.search, mode: 'insensitive' }
            : undefined,
          createdAt: {
            gte: q.from ? new Date(q.from) : undefined,
            lte: q.to ? new Date(q.to) : undefined,
          },
        },
      ],
    };
    return this.db.$transaction(
      async (tx) => {
        const data = await tx.sale.findMany({
          where,
          select: a.role === 'WAREHOUSE_STAFF' ? operational : full,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          orderBy: [{ [q.sortBy]: q.direction }, { id: 'asc' }],
        });
        const total = await tx.sale.count({ where });
        return {
          data,
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total,
            totalPages: Math.ceil(total / q.pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private atomic<T>(fn: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(fn, {
      isolationLevel: 'ReadCommitted',
      timeout: 10000,
    });
  }
  private async customer(tx: Tx, a: Actor, id: string, active: boolean) {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
    const c = await tx.customer.findFirst({
      where: { id, ...(a.role === 'SALES_STAFF' ? { ownerId: a.id } : {}) },
    });
    if (!c)
      throw new NotFoundException('Customer unavailable within current scope');
    if (active && !c.isActive)
      throw new ConflictException('Customer is archived');
  }
  private async lock(tx: Tx, a: Actor, id: string) {
    await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.sale.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Order not found');
    if (row.customerId) await this.customer(tx, a, row.customerId, false);
    await this.read(tx, a, id);
    return row;
  }
  private async idem(
    tx: Tx,
    a: Actor,
    operation: string,
    key: string | undefined,
    payload: unknown,
  ) {
    if (!keySchema.safeParse(key).success)
      throw new BadRequestException('Valid Idempotency-Key required');
    const requestHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'order:' + a.id + ':' + operation + ':' + key!},0))::text`;
    const previous = await tx.orderReceipt.findUnique({
      where: { actorId_operation_key: { actorId: a.id, operation, key: key! } },
    });
    if (previous) {
      await this.read(tx, a, previous.orderId);
      if (previous.requestHash !== requestHash)
        throw new ConflictException(
          'Idempotency key was used for a different request',
        );
    }
    return { previous, requestHash };
  }
  private replay(a: Actor, response: Prisma.JsonValue) {
    if (a.role !== 'WAREHOUSE_STAFF') return response;
    const source = response as Record<string, Prisma.JsonValue>;
    const result: Record<string, Prisma.JsonValue> = {};
    for (const field of Object.keys(operational)) {
      if (field !== 'items' && source[field] !== undefined)
        result[field] = source[field];
    }
    result.items = (
      source.items as Array<Record<string, Prisma.JsonValue>>
    ).map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      product: item.product,
    }));
    return result;
  }
  private async receipt(
    tx: Tx,
    a: Actor,
    operation: string,
    key: string,
    requestHash: string,
    id: string,
  ) {
    // Store only the actor's response projection. Read authorization is checked again on replay.
    const response = JSON.parse(
      JSON.stringify(await this.read(tx, a, id)),
    ) as Prisma.InputJsonValue;
    await tx.orderReceipt.create({
      data: {
        actorId: a.id,
        operation,
        key,
        requestHash,
        orderId: id,
        response,
      },
    });
    return response;
  }
  create(a: Actor, key: string | undefined, input: CreateOrder) {
    this.manage(a);
    const items = [...input.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );
    return this.atomic(async (tx) => {
      const { previous, requestHash } = await this.idem(tx, a, 'create', key, {
        customerId: input.customerId,
        notes: input.notes,
        items,
      });
      if (previous) return this.replay(a, previous.response);
      await this.customer(tx, a, input.customerId, true);
      let total = new Prisma.Decimal(0);
      const snapshots = [];
      for (const item of items) {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${item.productId}::uuid FOR UPDATE`;
        const p = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (!p) throw new NotFoundException('Product not found');
        if (!p.isActive) throw new ConflictException('Product is archived');
        total = total.add(p.sellingPrice.mul(item.quantity));
        snapshots.push({ ...item, unitPrice: p.sellingPrice });
      }
      if (total.gt('9999999999999999.99'))
        throw new ConflictException('Order total exceeds supported range');
      const order = await tx.sale.create({
        data: {
          invoiceNumber: 'SO-' + randomUUID(),
          customerId: input.customerId,
          createdById: a.id,
          totalAmount: total,
          notes: input.notes,
          items: { create: snapshots },
        },
      });
      return this.receipt(tx, a, 'create', key!, requestHash, order.id);
    });
  }
  update(a: Actor, id: string, notes: string | null) {
    this.manage(a);
    return this.atomic(async (tx) => {
      const row = await this.lock(tx, a, id);
      if (row.status !== 'DRAFT')
        throw new ConflictException('Only DRAFT orders can be edited');
      await tx.sale.update({ where: { id }, data: { notes } });
      return this.read(tx, a, id);
    });
  }
  transition(
    a: Actor,
    id: string,
    action: 'confirm' | 'complete' | 'cancel',
    reason?: string,
  ) {
    this.manage(a);
    return this.atomic(async (tx) => {
      const row = await this.lock(tx, a, id);
      const valid =
        action === 'confirm'
          ? row.status === 'DRAFT'
          : action === 'complete'
            ? row.status === 'FULFILLED'
            : ['DRAFT', 'CONFIRMED'].includes(row.status);
      if (!valid) throw new ConflictException('Invalid order state transition');
      if (action === 'confirm') {
        if (!row.customerId)
          throw new ConflictException('Order requires a customer');
        await this.customer(tx, a, row.customerId, true);
        const items = await tx.saleItem.findMany({
          where: { saleId: id },
          orderBy: { productId: 'asc' },
        });
        if (!items.length) throw new ConflictException('Order requires items');
        for (const i of items) {
          await tx.$queryRaw`SELECT id FROM products WHERE id = ${i.productId}::uuid FOR UPDATE`;
          const p = await tx.product.findUniqueOrThrow({
            where: { id: i.productId },
          });
          if (!p.isActive) throw new ConflictException('Product is archived');
        }
      }
      const now = new Date();
      await tx.sale.update({
        where: { id },
        data:
          action === 'confirm'
            ? { status: 'CONFIRMED', confirmedAt: now }
            : action === 'complete'
              ? { status: 'COMPLETED', completedAt: now }
              : {
                  status: 'CANCELLED',
                  cancelledAt: now,
                  cancellationReason: reason,
                },
      });
      await audit(tx, a.id, 'ORDER_' + action.toUpperCase(), 'SALE', id, {
        status:
          action === 'confirm'
            ? 'CONFIRMED'
            : action === 'complete'
              ? 'COMPLETED'
              : 'CANCELLED',
      });
      return this.read(tx, a, id);
    });
  }
  fulfill(a: Actor, id: string, key: string | undefined) {
    if (!['ADMIN', 'WAREHOUSE_STAFF'].includes(a.role))
      throw new ForbiddenException();
    return this.atomic(async (tx) => {
      const { previous, requestHash } = await this.idem(tx, a, 'fulfill', key, {
        id,
      });
      if (previous) return this.replay(a, previous.response);
      const row = await this.lock(tx, a, id);
      if (row.status !== 'CONFIRMED')
        throw new ConflictException('Only CONFIRMED orders can be fulfilled');
      if (!row.customerId)
        throw new ConflictException('Order requires a customer');
      await this.customer(tx, a, row.customerId, true);
      const items = await tx.saleItem.findMany({
        where: { saleId: id },
        orderBy: { productId: 'asc' },
      });
      if (!items.length) throw new ConflictException('Order requires items');
      for (const item of items) await this.inventory.deduct(tx, a.id, item);
      await tx.sale.update({
        where: { id },
        data: { status: 'FULFILLED', fulfilledAt: new Date() },
      });
      await audit(tx, a.id, 'ORDER_FULFILLED', 'SALE', id, {
        status: 'FULFILLED',
      });
      return this.receipt(tx, a, 'fulfill', key!, requestHash, id);
    });
  }
}

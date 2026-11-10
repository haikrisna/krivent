import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  keySchema,
  receiptSchema,
  adjustmentSchema,
  type Receipt,
  type Adjustment,
  type BalanceQuery,
  type MovementQuery,
} from './inventory.schemas.js';
const movementSelect = {
  id: true,
  productId: true,
  createdById: true,
  type: true,
  quantity: true,
  notes: true,
  beforeBalance: true,
  afterBalance: true,
  stockVersion: true,
  createdAt: true,
} satisfies Prisma.StockMovementSelect;
const balanceSelect = {
  id: true,
  sku: true,
  name: true,
  isActive: true,
  stockQuantity: true,
  stockVersion: true,
  lowStockThreshold: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;
@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async change(
    actorId: string,
    key: string | undefined,
    kind: 'receipt' | 'adjustment',
    input: Receipt | Adjustment,
    transaction?: Prisma.TransactionClient,
  ) {
    if (!keySchema.safeParse(key).success)
      throw new BadRequestException(
        'Idempotency-Key must contain 8–128 letters, digits, dot, colon, underscore or hyphen',
      );
    const parsed = (
      kind === 'receipt' ? receiptSchema : adjustmentSchema
    ).safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid stock change');
    input = parsed.data;
    const canonical = Object.fromEntries(
      Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
    );
    const hash = createHash('sha256')
      .update(JSON.stringify({ kind, input: canonical }))
      .digest('hex');
    // The transaction is also the deduplication boundary. No external cache or expiring lock.
    const run = async (tx: Prisma.TransactionClient) => {
      // Serialize the actor/key before locking the product, including reuse against a different product.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actorId + ':' + key!}, 0))::text`;
      const previous = await tx.stockMovement.findUnique({
        where: {
          createdById_idempotencyKey: {
            createdById: actorId,
            idempotencyKey: key!,
          },
        },
      });
      if (previous) {
        if (previous.requestHash !== hash)
          throw new ConflictException(
            'Idempotency key was used for a different request',
          );
        return tx.stockMovement.findUniqueOrThrow({
          where: { id: previous.id },
          select: movementSelect,
        });
      }
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM products WHERE id = ${input.productId}::uuid FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Product not found');
      const product = await tx.product.findUniqueOrThrow({
        where: { id: input.productId },
      });
      if (!product.isActive) throw new ConflictException('Product is archived');
      let after: number;
      if (kind === 'receipt')
        after = product.stockQuantity + (input as Receipt).quantity;
      else {
        const adjustment = input as Adjustment;
        if (product.stockVersion !== adjustment.expectedVersion)
          throw new ConflictException(
            'Stale stock version; read the balance and reconcile the count',
          );
        after = adjustment.countedQuantity;
      }
      if (
        after < 0 ||
        after > 2147483647 ||
        product.stockVersion === 2147483647
      )
        throw new ConflictException(
          'Stock balance or version exceeds supported range',
        );
      const delta = after - product.stockQuantity;
      if (delta === 0)
        throw new ConflictException(
          'Count equals current stock; no movement required',
        );
      await tx.product.update({
        where: { id: product.id },
        data: { stockQuantity: after, stockVersion: { increment: 1 } },
      });
      return tx.stockMovement.create({
        data: {
          productId: product.id,
          createdById: actorId,
          type: kind === 'receipt' ? 'PURCHASE' : 'ADJUSTMENT',
          quantity: delta,
          notes: input.reason,
          beforeBalance: product.stockQuantity,
          afterBalance: after,
          stockVersion: product.stockVersion + 1,
          idempotencyKey: key!,
          requestHash: hash,
        },
        select: movementSelect,
      });
    };
    // Internal callers can compose inventory writes with another domain transaction.
    // Callers supplying a transaction must use ReadCommitted and the same lock order.
    return transaction
      ? run(transaction)
      : this.prisma.$transaction(run, {
          isolationLevel: 'ReadCommitted',
          timeout: 10000,
        });
  }
  async movement(id: string) {
    const row = await this.prisma.stockMovement.findUnique({
      where: { id },
      select: movementSelect,
    });
    if (!row) throw new NotFoundException('Stock movement not found');
    return row;
  }
  balances(q: BalanceQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status === 'active' }),
      ...(q.productId ? { id: q.productId } : {}),
      ...(q.lowStock
        ? {
            stockQuantity:
              q.lowStock === 'true'
                ? { lte: this.prisma.product.fields.lowStockThreshold }
                : { gt: this.prisma.product.fields.lowStockThreshold },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { sku: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const data = await tx.product.findMany({
          where,
          select: balanceSelect,
          orderBy: [{ [q.sortBy]: q.direction }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        const total = await tx.product.count({ where });
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
  movements(q: MovementQuery) {
    const where: Prisma.StockMovementWhereInput = {
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.actorId ? { createdById: q.actorId } : {}),
      ...(q.type ? { type: q.type } : {}),
      createdAt: {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      },
      ...(q.search
        ? {
            OR: [
              { notes: { contains: q.search, mode: 'insensitive' } },
              { product: { sku: { contains: q.search, mode: 'insensitive' } } },
              {
                product: { name: { contains: q.search, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const data = await tx.stockMovement.findMany({
          where,
          select: movementSelect,
          orderBy: [{ [q.sortBy]: q.direction }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        const total = await tx.stockMovement.count({ where });
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
}

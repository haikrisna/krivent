import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../src/configure-app.js';
import { environmentSchema } from '../src/config/environment.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { HealthModule } from '../src/health/health.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('PostgreSQL integration (migrated local database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const rollback = new Error('rollback test fixtures');

  async function transaction(
    run: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    try {
      await prisma.$transaction(async (tx) => {
        await run(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validationSchema: environmentSchema,
        }),
        HealthModule,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns HTTP 200 after querying the actual PostgreSQL database', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(response.body.details.database.status).toBe('up');
  });

  it('has all seven domain tables', async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    expect(rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining([
        'users',
        'categories',
        'products',
        'customers',
        'sales',
        'sale_items',
        'stock_movements',
      ]),
    );
  });

  it('round-trips decimal money without floating-point loss', async () => {
    await transaction(async (tx) => {
      const category = await tx.category.create({
        data: { name: randomUUID() },
      });
      const product = await tx.product.create({
        data: {
          categoryId: category.id,
          sku: randomUUID(),
          name: 'Test product',
          costPrice: '1234567890123456.78',
          sellingPrice: '1234567890123456.99',
        },
      });
      expect(product.costPrice.toFixed(2)).toBe('1234567890123456.78');
      expect(product.sellingPrice.toFixed(2)).toBe('1234567890123456.99');
    });
  });

  it('rejects duplicate SKUs', async () => {
    await expect(
      transaction(async (tx) => {
        const category = await tx.category.create({
          data: { name: randomUUID() },
        });
        const data = {
          categoryId: category.id,
          sku: randomUUID(),
          name: 'Test',
          costPrice: '1',
          sellingPrice: '2',
        };
        await tx.product.create({ data });
        await tx.product.create({ data });
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it.each([
    { costPrice: '-1', sellingPrice: '2', stockQuantity: 0 },
    { costPrice: '1', sellingPrice: '-2', stockQuantity: 0 },
    { costPrice: '1', sellingPrice: '2', stockQuantity: -1 },
  ])(
    'enforces database checks for invalid product values %#',
    async (values) => {
      await expect(
        transaction(async (tx) => {
          const category = await tx.category.create({
            data: { name: randomUUID() },
          });
          await tx.product.create({
            data: {
              categoryId: category.id,
              sku: randomUUID(),
              name: 'Invalid product',
              ...values,
            },
          });
        }),
      ).rejects.toThrow(/constraint/i);
    },
  );

  it('prevents deleting a category referenced by a product', async () => {
    await expect(
      transaction(async (tx) => {
        const category = await tx.category.create({
          data: { name: randomUUID() },
        });
        await tx.product.create({
          data: {
            categoryId: category.id,
            sku: randomUUID(),
            name: 'Test',
            costPrice: '1',
            sellingPrice: '2',
          },
        });
        await tx.category.delete({ where: { id: category.id } });
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });

  it('rejects a stock movement referencing a sale item for a different product', async () => {
    await expect(
      transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            name: 'Test',
            passwordHash: 'test-only-placeholder',
          },
        });
        const category = await tx.category.create({
          data: { name: randomUUID() },
        });
        const product = await tx.product.create({
          data: {
            categoryId: category.id,
            sku: randomUUID(),
            name: 'Test',
            costPrice: '1',
            sellingPrice: '2',
          },
        });
        const other = await tx.product.create({
          data: {
            categoryId: category.id,
            sku: randomUUID(),
            name: 'Other',
            costPrice: '1',
            sellingPrice: '2',
          },
        });
        const sale = await tx.sale.create({
          data: { invoiceNumber: randomUUID(), createdById: user.id },
        });
        const item = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: product.id,
            quantity: 1,
            unitPrice: '2',
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: other.id,
            createdById: user.id,
            saleItemId: item.id,
            type: 'SALE',
            quantity: -1,
          },
        });
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});

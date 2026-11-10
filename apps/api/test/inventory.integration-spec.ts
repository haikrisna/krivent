import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { InventoryModule } from '../src/inventory/inventory.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PasswordService } from '../src/security/password.service.js';
import { environmentSchema } from '../src/config/environment.js';
import { configureApp } from '../src/configure-app.js';
import { isolatedDatabase } from './support/isolated-database.js';

describe('Phase 5 inventory HTTP with PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (who = 'sales') =>
    request
      .agent(app.getHttpServer())
      .set('Authorization', `Bearer ${tokens[who]}`);
  let categoryId: string;
  const product = async (stock = 0) => {
    const p = await db.product.create({
      data: {
        categoryId,
        sku: randomUUID(),
        name: 'Router AX3000',
        costPrice: '100',
        sellingPrice: '150',
        lowStockThreshold: 5,
      },
    });
    if (stock) await receipt(p.id, stock).expect(201);
    return db.product.findUniqueOrThrow({ where: { id: p.id } });
  };
  const receipt = (
    productId: string,
    quantity: number,
    key = randomUUID(),
    who = 'warehouse',
  ) =>
    as(who)
      .post('/api/v1/inventory/receipts')
      .set('Idempotency-Key', key)
      .send({ productId, quantity, reason: 'Terima router PO-2026-001' });
  const adjust = (
    productId: string,
    countedQuantity: number,
    expectedVersion: number,
    key = randomUUID(),
  ) =>
    as('warehouse')
      .post('/api/v1/inventory/adjustments')
      .set('Idempotency-Key', key)
      .send({
        productId,
        countedQuantity,
        expectedVersion,
        reason: 'Stock opname barang rusak',
      });
  beforeAll(async () => {
    database = await isolatedDatabase();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validationSchema: environmentSchema,
          load: [() => ({ DATABASE_URL: database.databaseUrl })],
        }),
        AuthModule,
        InventoryModule,
        CatalogModule,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    categoryId = (await db.category.create({ data: { name: 'Electronics' } }))
      .id;
    const password = `Test-${randomUUID()}`;
    const hash = await app.get(PasswordService).hash(password);
    for (const [key, role] of [
      ['admin', 'ADMIN'],
      ['sales', 'SALES_STAFF'],
      ['other', 'SALES_STAFF'],
      ['warehouse', 'WAREHOUSE_STAFF'],
    ] as const) {
      const user = await db.user.create({
        data: {
          name: key,
          email: `${key}@example.test`,
          passwordHash: hash,
          role,
        },
      });
      ids[key] = user.id;
      app
        .get<ThrottlerStorageService>(getStorageToken())
        .onApplicationShutdown();
      tokens[key] = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: user.email, password })
          .expect(200)
      ).body.data.accessToken;
    }
  });
  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });
  it('receives stock and records exact before/after balances, actor, reason, timestamp and version', async () => {
    const p = await product();
    const response = await receipt(p.id, 24).expect(201);
    expect(response.body.data).toMatchObject({
      productId: p.id,
      createdById: ids.warehouse,
      quantity: 24,
      beforeBalance: 0,
      afterBalance: 24,
      stockVersion: 1,
      type: 'PURCHASE',
      notes: 'Terima router PO-2026-001',
    });
    expect(Date.parse(response.body.data.createdAt)).not.toBeNaN();
    expect(response.body.data).not.toHaveProperty('requestHash');
    expect(response.body.data).not.toHaveProperty('idempotencyKey');
    expect(
      await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ stockQuantity: 24, stockVersion: 1 });
  });
  it('adjusts to physical count, supports zero and upward corrections, rejects unchanged counts', async () => {
    const p = await product(10);
    expect((await adjust(p.id, 7, 1).expect(201)).body.data).toMatchObject({
      quantity: -3,
      beforeBalance: 10,
      afterBalance: 7,
      type: 'ADJUSTMENT',
    });
    await adjust(p.id, 7, 2).expect(409);
    await adjust(p.id, 0, 2).expect(201);
    await adjust(p.id, 9, 3).expect(201);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      4,
    );
  });
  it('serializes concurrent deductions based on the same count version', async () => {
    const p = await product(10);
    const results = await Promise.all([adjust(p.id, 2, 1), adjust(p.id, 3, 1)]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const stored = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect([2, 3]).toContain(stored.stockQuantity);
    expect(stored.stockVersion).toBe(2);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      2,
    );
  });
  it('serializes concurrent receipts without lost increments', async () => {
    const p = await product();
    await Promise.all(
      Array.from({ length: 8 }, () => receipt(p.id, 3).expect(201)),
    );
    expect(
      await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ stockQuantity: 24, stockVersion: 8 });
    const ledger = await db.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: { stockVersion: 'asc' },
    });
    ledger.forEach((m, i) =>
      expect([m.beforeBalance, m.afterBalance]).toEqual([i * 3, (i + 1) * 3]),
    );
  });
  it('rejects stale counts after a receipt and ABA balance changes', async () => {
    const p = await product(10);
    await receipt(p.id, 2).expect(201);
    await adjust(p.id, 10, 2).expect(201);
    await adjust(p.id, 1, 1).expect(409);
  });
  it('replays double submissions including concurrent retries and retains result after later changes/archive', async () => {
    const p = await product();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      receipt(p.id, 10, key).expect(201),
      receipt(p.id, 10, key).expect(201),
    ]);
    expect(a.body).toEqual(b.body);
    await receipt(p.id, 4).expect(201);
    await db.product.update({ where: { id: p.id }, data: { isActive: false } });
    expect((await receipt(p.id, 10, key).expect(201)).body).toEqual(a.body);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      2,
    );
    await receipt(p.id, 11, key).expect(409);
    const other = await product();
    await receipt(other.id, 10, key).expect(409);
  });
  it('replays an adjustment before evaluating its now-stale version', async () => {
    const p = await product(10);
    const key = randomUUID();
    const a = await adjust(p.id, 5, 1, key).expect(201);
    expect((await adjust(p.id, 5, 1, key).expect(201)).body).toEqual(a.body);
    await receipt(p.id, 1, key).expect(409);
  });
  it('scopes keys to actors and rejects mismatching concurrent payloads', async () => {
    const p = await product();
    const key = randomUUID();
    await receipt(p.id, 1, key, 'admin').expect(201);
    await receipt(p.id, 1, key, 'warehouse').expect(201);
    const another = randomUUID();
    const r = await Promise.all([
      receipt(p.id, 2, another),
      receipt(p.id, 3, another),
    ]);
    expect(r.map((x) => x.status).sort((a, b) => a - b)).toEqual([201, 409]);
  });
  it('rolls back stock and version when ledger insertion fails, and leaves key reusable', async () => {
    const p = await product();
    const key = randomUUID();
    await expect(
      app.get(InventoryService).change(randomUUID(), key, 'receipt', {
        productId: p.id,
        quantity: 4,
        reason: 'Invalid actor FK',
      }),
    ).rejects.toThrow();
    expect(
      await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ stockQuantity: 0, stockVersion: 0 });
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      0,
    );
    await receipt(p.id, 4, key).expect(201);
  });
  it('rolls back an inventory write when the enclosing business transaction fails', async () => {
    const p = await product();
    const key = randomUUID();
    await expect(
      db.$transaction(
        async (tx) => {
          await app
            .get(InventoryService)
            .change(
              ids.admin,
              key,
              'receipt',
              {
                productId: p.id,
                quantity: 4,
                reason: 'Outer transaction rollback',
              },
              tx,
            );
          throw new Error('Simulated later business failure');
        },
        { isolationLevel: 'ReadCommitted' },
      ),
    ).rejects.toThrow('Simulated later business failure');
    expect(
      await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ stockQuantity: 0, stockVersion: 0 });
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      0,
    );
    await receipt(p.id, 4, key, 'admin').expect(201);
  });
  it('rejects raw stock changes without an exact matching ledger at commit', async () => {
    const p = await product();
    await expect(
      db.product.update({
        where: { id: p.id },
        data: { stockQuantity: 3, stockVersion: 1 },
      }),
    ).rejects.toThrow(/matching ledger/);
    await expect(
      db.product.update({ where: { id: p.id }, data: { stockQuantity: 3 } }),
    ).rejects.toThrow(/new version/);
    expect(
      await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    ).toMatchObject({ stockQuantity: 0, stockVersion: 0 });
  });
  it('serializes product archive against receipt and preserves valid history', async () => {
    const p = await product();
    const [r, a] = await Promise.all([
      receipt(p.id, 3),
      as('admin').post(`/api/v1/products/${p.id}/archive`),
    ]);
    expect([201, 409]).toContain(r.status);
    expect(a.status).toBe(200);
    const stored = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.isActive).toBe(false);
    expect(stored.stockQuantity).toBe(r.status === 201 ? 3 : 0);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      r.status === 201 ? 1 : 0,
    );
  });
  it('enforces nonnegative stock and coherent movement snapshots in PostgreSQL', async () => {
    const p = await product();
    await expect(
      db.product.update({ where: { id: p.id }, data: { stockQuantity: -1 } }),
    ).rejects.toThrow();
    await expect(
      db.stockMovement.create({
        data: {
          productId: p.id,
          createdById: ids.admin,
          type: 'ADJUSTMENT',
          quantity: -1,
          beforeBalance: 0,
          afterBalance: -1,
          stockVersion: 1,
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          notes: 'Invalid negative stock',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.product.update({
        where: { id: p.id },
        data: { lowStockThreshold: -1 },
      }),
    ).rejects.toThrow();
  });
  it('guards integer overflow without changing balance or creating a ledger entry', async () => {
    const p = await product();
    await receipt(p.id, 2147483647).expect(201);
    await receipt(p.id, 1).expect(409);
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
      1,
    );
  });
  it('rejects nonexistent and archived products, and failed requests do not consume keys', async () => {
    await receipt(randomUUID(), 1).expect(404);
    const p = await product();
    const key = randomUUID();
    await adjust(p.id, 2, 10, key).expect(409);
    await adjust(p.id, 2, 0, key).expect(201);
    await db.product.update({ where: { id: p.id }, data: { isActive: false } });
    await receipt(p.id, 1).expect(409);
    await adjust(p.id, 0, 1).expect(409);
  });
  it.each([0, -1, 1.2, '2', 2147483648, null])(
    'rejects invalid receipt quantity %s',
    async (quantity) => {
      const p = await product();
      await as('warehouse')
        .post('/api/v1/inventory/receipts')
        .set('Idempotency-Key', randomUUID())
        .send({ productId: p.id, quantity, reason: 'Goods receipt' })
        .expect(400);
      expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(
        0,
      );
    },
  );
  it.each([
    { countedQuantity: -1 },
    { countedQuantity: 0.5 },
    { countedQuantity: '1' },
    { expectedVersion: -1 },
    { expectedVersion: 0.2 },
    { reason: '' },
    { reason: '  ' },
    { reason: 'a'.repeat(2001) },
    { actorId: randomUUID() },
    { quantity: -100 },
  ])('rejects invalid adjustment %#', async (extra) => {
    const p = await product(2);
    await as('warehouse')
      .post('/api/v1/inventory/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({
        productId: p.id,
        countedQuantity: 0,
        expectedVersion: 1,
        reason: 'Stock count',
        ...extra,
      })
      .expect(400);
  });
  it('requires a valid key, reason, expectedVersion and UUID', async () => {
    const p = await product();
    await as('warehouse')
      .post('/api/v1/inventory/receipts')
      .send({ productId: p.id, quantity: 1, reason: 'Goods receipt' })
      .expect(400);
    await receipt(p.id, 1, 'bad key!').expect(400);
    await receipt('bad', 1).expect(400);
    await as('warehouse')
      .post('/api/v1/inventory/receipts')
      .set('Idempotency-Key', randomUUID())
      .send({ productId: p.id, quantity: 1 })
      .expect(400);
    await as('warehouse')
      .post('/api/v1/inventory/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ productId: p.id, countedQuantity: 1, reason: 'Stock count' })
      .expect(400);
  });
  it.each(['admin', 'warehouse', 'sales'])(
    'allows %s inventory reads and enforces write permissions',
    async (who) => {
      const p = await product();
      await as(who).get('/api/v1/inventory/balances').expect(200);
      await as(who).get('/api/v1/inventory/movements').expect(200);
      await receipt(p.id, 2, randomUUID(), who).expect(
        who === 'sales' ? 403 : 201,
      );
      await as(who)
        .post('/api/v1/inventory/adjustments')
        .set('Idempotency-Key', randomUUID())
        .send({
          productId: p.id,
          countedQuantity: 1,
          expectedVersion: 1,
          reason: 'Stock count',
        })
        .expect(who === 'sales' ? 403 : 201);
    },
  );
  it('returns 401 for all anonymous inventory operations', async () => {
    for (const route of ['balances', 'movements', `movements/${randomUUID()}`])
      await request(app.getHttpServer())
        .get(`/api/v1/inventory/${route}`)
        .expect(401);
    for (const route of ['receipts', 'adjustments'])
      await request(app.getHttpServer())
        .post(`/api/v1/inventory/${route}`)
        .send({})
        .expect(401);
  });
  it('keeps movement history immutable through APIs and database writes', async () => {
    const p = await product();
    const m = (await receipt(p.id, 2).expect(201)).body.data;
    for (const who of ['admin', 'warehouse', 'sales'])
      expect(
        (await as(who).get(`/api/v1/inventory/movements/${m.id}`).expect(200))
          .body.data,
      ).toEqual(m);
    await as('admin')
      .patch(`/api/v1/inventory/movements/${m.id}`)
      .send({ quantity: 999 })
      .expect(404);
    await as('admin').delete(`/api/v1/inventory/movements/${m.id}`).expect(404);
    await expect(
      db.stockMovement.update({
        where: { id: m.id },
        data: { notes: 'Tamper' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.stockMovement.delete({ where: { id: m.id } }),
    ).rejects.toThrow(/immutable/);
    await as().get(`/api/v1/inventory/movements/${randomUUID()}`).expect(404);
    await as().get('/api/v1/inventory/movements/invalid').expect(400);
  });
  it('filters history by product, actor, date, type and search with pagination and ordering', async () => {
    const p = await product();
    for (const quantity of [2, 4, 6]) await receipt(p.id, quantity).expect(201);
    const response = await as()
      .get('/api/v1/inventory/movements')
      .query({
        productId: p.id,
        actorId: ids.warehouse,
        type: 'PURCHASE',
        search: 'po-2026',
        from: '2020-01-01T00:00:00Z',
        to: '2099-01-01T00:00:00Z',
        sortBy: 'quantity',
        direction: 'desc',
        pageSize: 1,
        page: 2,
      })
      .expect(200);
    expect(response.body.meta).toEqual({
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
    });
    expect(response.body.data[0].quantity).toBe(4);
    expect(
      (
        await as()
          .get('/api/v1/inventory/movements')
          .query({ productId: p.id, actorId: ids.admin })
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    expect(
      (
        await as()
          .get('/api/v1/inventory/movements')
          .query({ productId: p.id, to: '2020-01-01T00:00:00Z' })
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    expect(
      (
        await as()
          .get('/api/v1/inventory/movements')
          .query({ productId: p.id, page: 999 })
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });
  it('reports low stock using product threshold and supports balance filters without exposing prices', async () => {
    const p = await product(5);
    const q = {
      productId: p.id,
      lowStock: 'true',
      search: p.sku,
      sortBy: 'stockQuantity',
      direction: 'asc',
      pageSize: 1,
    };
    const r = await as().get('/api/v1/inventory/balances').query(q).expect(200);
    expect(r.body.meta.total).toBe(1);
    expect(r.body.data[0]).toMatchObject({
      stockQuantity: 5,
      lowStockThreshold: 5,
      stockVersion: 1,
    });
    expect(r.body.data[0]).not.toHaveProperty('costPrice');
    await receipt(p.id, 1).expect(201);
    expect(
      (await as().get('/api/v1/inventory/balances').query(q).expect(200)).body
        .meta.total,
    ).toBe(0);
    await as('admin')
      .patch(`/api/v1/products/${p.id}`)
      .send({ lowStockThreshold: 10 })
      .expect(200);
    await as('warehouse')
      .patch(`/api/v1/products/${p.id}`)
      .send({ stockQuantity: 100 })
      .expect(400);
    await as('warehouse')
      .patch(`/api/v1/products/${p.id}`)
      .send({ stockVersion: 100 })
      .expect(400);
    await as('admin').post(`/api/v1/products/${p.id}/archive`).expect(200);
    expect(
      (
        await as()
          .get('/api/v1/inventory/balances')
          .query({ productId: p.id })
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    expect(
      (
        await as()
          .get('/api/v1/inventory/balances')
          .query({ productId: p.id, status: 'all' })
          .expect(200)
      ).body.meta.total,
    ).toBe(1);
    expect(
      (
        await as()
          .get('/api/v1/inventory/movements')
          .query({ productId: p.id })
          .expect(200)
      ).body.meta.total,
    ).toBe(2);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { sortBy: 'passwordHash' },
    { actorId: 'invalid' },
    { from: 'yesterday' },
    { from: '2030-01-01T00:00:00Z', to: '2020-01-01T00:00:00Z' },
    { extra: 'x' },
  ])('rejects invalid history query %#', async (query) => {
    await as().get('/api/v1/inventory/movements').query(query).expect(400);
  });
  it('publishes Swagger bodies, filters, responses and mandatory idempotency header', async () => {
    const doc = (await as().get('/api/docs-json').expect(200)).body;
    const receipt = doc.paths['/api/v1/inventory/receipts'].post;
    expect(
      receipt.parameters.find(
        (p: { name: string }) => p.name === 'Idempotency-Key',
      ).required,
    ).toBe(true);
    expect(
      receipt.responses['201'].content['application/json'].schema.properties
        .data.properties.beforeBalance,
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/inventory/movements'].get.parameters.map(
        (p: { name: string }) => p.name,
      ),
    ).toContain('actorId');
    expect(
      doc.paths['/api/v1/inventory/adjustments'].post.requestBody.content[
        'application/json'
      ].schema.required,
    ).toContain('expectedVersion');
  });
});

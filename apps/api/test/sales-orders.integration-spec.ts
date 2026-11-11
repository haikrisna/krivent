import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { SalesOrdersModule } from '../src/sales-orders/sales-orders.module.js';
import { InventoryModule } from '../src/inventory/inventory.module.js';
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PasswordService } from '../src/security/password.service.js';
import { environmentSchema } from '../src/config/environment.js';
import { configureApp } from '../src/configure-app.js';
import { isolatedDatabase } from './support/isolated-database.js';

describe('Phase 6 sales orders HTTP with PostgreSQL', () => {
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
        SalesOrdersModule,
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
  const customer = () =>
    db.customer.create({
      data: {
        code: randomUUID().slice(0, 30),
        name: 'Order customer',
        ownerId: ids.sales,
      },
    });
  const order = async (
    productId: string,
    quantity = 2,
    who = 'sales',
    key = randomUUID(),
  ) => {
    const c = await customer();
    return as(who)
      .post('/api/v1/sales-orders')
      .set('Idempotency-Key', key)
      .send({ customerId: c.id, items: [{ productId, quantity }] })
      .expect(201);
  };
  const transition = (
    id: string,
    action: string,
    who = 'sales',
    key = randomUUID(),
  ) =>
    as(who)
      .post(`/api/v1/sales-orders/${id}/${action}`)
      .set('Idempotency-Key', key)
      .send({});
  it('snapshots price, calculates total, and completes the lifecycle', async () => {
    const p = await product(10);
    const o = (await order(p.id)).body.data;
    expect(o.totalAmount).toBe('300');
    expect(o.items[0].unitPrice).toBe('150');
    await db.product.update({
      where: { id: p.id },
      data: { sellingPrice: '999' },
    });
    await transition(o.id, 'confirm').expect(200);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: p.id } }))
        .stockQuantity,
    ).toBe(10);
    await transition(o.id, 'fulfill', 'warehouse').expect(200);
    await transition(o.id, 'complete').expect(200);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: p.id } }))
        .stockQuantity,
    ).toBe(8);
    const ledger = await db.stockMovement.findFirstOrThrow({
      where: { saleItemId: o.items[0].id },
    });
    expect(ledger).toMatchObject({
      type: 'SALE',
      quantity: -2,
      beforeBalance: 10,
      afterBalance: 8,
      stockVersion: 2,
    });
    expect(
      (await as().get(`/api/v1/sales-orders/${o.id}`).expect(200)).body.data
        .totalAmount,
    ).toBe('300');
    await transition(o.id, 'cancel').send({ reason: 'Too late' }).expect(409);
  });
  it('prevents concurrent double fulfillment and replays the original response', async () => {
    const p = await product(10);
    const o = (await order(p.id)).body.data;
    await transition(o.id, 'confirm').expect(200);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      transition(o.id, 'fulfill', 'warehouse', key),
      transition(o.id, 'fulfill', 'warehouse', key),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    await transition(o.id, 'fulfill', 'admin').expect(409);
    expect(
      await db.stockMovement.count({ where: { saleItemId: o.items[0].id } }),
    ).toBe(1);
    await transition(o.id, 'complete').expect(200);
    expect(
      (await transition(o.id, 'fulfill', 'warehouse', key).expect(200)).body,
    ).toEqual(a.body);
  });
  it('prevents overselling two orders racing for one balance', async () => {
    const p = await product(3);
    const a = (await order(p.id)).body.data;
    const b = (await order(p.id)).body.data;
    await transition(a.id, 'confirm').expect(200);
    await transition(b.id, 'confirm').expect(200);
    const r = await Promise.all([
      transition(a.id, 'fulfill', 'warehouse'),
      transition(b.id, 'fulfill', 'warehouse'),
    ]);
    expect(r.map((x) => x.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: p.id } }))
        .stockQuantity,
    ).toBe(1);
  });
  it('rolls back earlier item deduction when later item lacks stock and allows retry', async () => {
    const products = [await product(5), await product(5)].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    await adjust(products[1].id, 0, 1).expect(201);
    const c = await customer();
    const o = (
      await as()
        .post('/api/v1/sales-orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId: c.id,
          items: products.map((p) => ({ productId: p.id, quantity: 2 })),
        })
        .expect(201)
    ).body.data;
    await transition(o.id, 'confirm').expect(200);
    const key = randomUUID();
    await transition(o.id, 'fulfill', 'warehouse', key).expect(409);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: products[0].id } }))
        .stockQuantity,
    ).toBe(5);
    expect(
      await db.stockMovement.count({
        where: { saleItemId: { in: o.items.map((i: { id: string }) => i.id) } },
      }),
    ).toBe(0);
    expect(
      (await db.sale.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe('CONFIRMED');
    await receipt(products[1].id, 3).expect(201);
    await transition(o.id, 'fulfill', 'warehouse', key).expect(200);
  });
  it('enforces ownership, role permissions and warehouse projection', async () => {
    const p = await product(5);
    const o = (await order(p.id)).body.data;
    await as('other').get(`/api/v1/sales-orders/${o.id}`).expect(404);
    expect(
      (await as('other').get('/api/v1/sales-orders').expect(200)).body.meta
        .total,
    ).toBe(0);
    await as('warehouse').get(`/api/v1/sales-orders/${o.id}`).expect(404);
    await transition(o.id, 'fulfill').expect(403);
    await transition(o.id, 'confirm', 'warehouse').expect(403);
    await transition(o.id, 'confirm').expect(200);
    const r = (
      await as('warehouse').get(`/api/v1/sales-orders/${o.id}`).expect(200)
    ).body.data;
    for (const field of ['totalAmount', 'customerId', 'notes', 'createdById'])
      expect(r).not.toHaveProperty(field);
    expect(r.items[0]).not.toHaveProperty('unitPrice');
    await request(app.getHttpServer()).get('/api/v1/sales-orders').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/sales-orders')
      .send({})
      .expect(401);
  });
  it('supports create idempotency, conflict detection and ownership recheck', async () => {
    const p = await product();
    const c = await customer();
    const key = randomUUID();
    const body = {
      customerId: c.id,
      items: [{ productId: p.id, quantity: 1 }],
    };
    const create = () =>
      as().post('/api/v1/sales-orders').set('Idempotency-Key', key).send(body);
    const [a, b] = await Promise.all([create(), create()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    await as()
      .post('/api/v1/sales-orders')
      .set('Idempotency-Key', key)
      .send({ ...body, notes: 'different' })
      .expect(409);
    await db.customer.update({
      where: { id: c.id },
      data: { ownerId: ids.other },
    });
    await create().expect(404);
  });
  it('rejects archived customer/product on creation and later processing', async () => {
    const p = await product(5);
    const c = await customer();
    await db.customer.update({
      where: { id: c.id },
      data: { isActive: false },
    });
    await as()
      .post('/api/v1/sales-orders')
      .set('Idempotency-Key', randomUUID())
      .send({ customerId: c.id, items: [{ productId: p.id, quantity: 1 }] })
      .expect(409);
    const o = (await order(p.id)).body.data;
    await db.product.update({ where: { id: p.id }, data: { isActive: false } });
    const activeCustomer = await customer();
    await as()
      .post('/api/v1/sales-orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        customerId: activeCustomer.id,
        items: [{ productId: p.id, quantity: 1 }],
      })
      .expect(409);
    await transition(o.id, 'confirm').expect(409);
  });
  it('restricts draft changes and cancellation without stock effects', async () => {
    const p = await product(4);
    const o = (await order(p.id)).body.data;
    await transition(o.id, 'complete').expect(409);
    await transition(o.id, 'fulfill', 'admin').expect(409);
    await as()
      .patch(`/api/v1/sales-orders/${o.id}`)
      .send({ notes: 'Revised note' })
      .expect(200);
    await transition(o.id, 'confirm').expect(200);
    await as()
      .patch(`/api/v1/sales-orders/${o.id}`)
      .send({ notes: 'Forbidden edit' })
      .expect(409);
    await as()
      .post(`/api/v1/sales-orders/${o.id}/cancel`)
      .send({ reason: 'Customer cancellation' })
      .expect(200);
    await transition(o.id, 'fulfill', 'admin').expect(409);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: p.id } }))
        .stockQuantity,
    ).toBe(4);
  });
  it('filters and paginates reporting data and documents routes', async () => {
    const p = await product();
    const o = (await order(p.id)).body.data;
    const r = await as()
      .get('/api/v1/sales-orders')
      .query({
        customerId: o.customerId,
        status: 'DRAFT',
        pageSize: 1,
        from: '2020-01-01T00:00:00Z',
        to: '2099-01-01T00:00:00Z',
      })
      .expect(200);
    expect(r.body.meta.total).toBe(1);
    expect(r.body.data[0].id).toBe(o.id);
    const doc = (await as().get('/api/docs-json').expect(200)).body;
    expect(
      doc.paths['/api/v1/sales-orders/{id}/fulfill'].post.responses['200'],
    ).toBeDefined();
  });
  it('serializes same-order fulfillment with distinct keys', async () => {
    const p = await product(6);
    const o = (await order(p.id)).body.data;
    await transition(o.id, 'confirm').expect(200);
    const r = await Promise.all([
      transition(o.id, 'fulfill', 'admin'),
      transition(o.id, 'fulfill', 'warehouse'),
    ]);
    expect(r.map((x) => x.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: p.id } }))
        .stockQuantity,
    ).toBe(4);
  });
  it('blocks archived customers at fulfillment without consuming the key', async () => {
    const p = await product(5);
    const o = (await order(p.id)).body.data;
    await transition(o.id, 'confirm').expect(200);
    await db.customer.update({
      where: { id: o.customerId },
      data: { isActive: false },
    });
    const key = randomUUID();
    await transition(o.id, 'fulfill', 'warehouse', key).expect(409);
    await db.customer.update({
      where: { id: o.customerId },
      data: { isActive: true },
    });
    await transition(o.id, 'fulfill', 'warehouse', key).expect(200);
  });
  it('cancels drafts and denies further transitions', async () => {
    const p = await product();
    const o = (await order(p.id)).body.data;
    await as()
      .post(`/api/v1/sales-orders/${o.id}/cancel`)
      .send({ reason: 'Wrong item selected' })
      .expect(200);
    await transition(o.id, 'confirm').expect(409);
  });
  it('validates create bodies, keys, and customer ownership at HTTP boundary', async () => {
    const p = await product();
    const c = await customer();
    const body = {
      customerId: c.id,
      items: [{ productId: p.id, quantity: 1 }],
    };
    await as().post('/api/v1/sales-orders').send(body).expect(400);
    await as('other')
      .post('/api/v1/sales-orders')
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(404);
    await as('warehouse')
      .post('/api/v1/sales-orders')
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(403);
    for (const extra of [
      { items: [] },
      { totalAmount: 1 },
      { items: [{ productId: p.id, quantity: 0 }] },
    ])
      await as()
        .post('/api/v1/sales-orders')
        .set('Idempotency-Key', randomUUID())
        .send({ ...body, ...extra })
        .expect(400);
  });
  it('reprojects fulfillment replay after actor role changes', async () => {
    const p = await product(4);
    const o = (await order(p.id)).body.data;
    await transition(o.id, 'confirm').expect(200);
    const key = randomUUID();
    await transition(o.id, 'fulfill', 'admin', key).expect(200);
    await db.user.update({
      where: { id: ids.admin },
      data: { role: 'WAREHOUSE_STAFF' },
    });
    try {
      const r = await transition(o.id, 'fulfill', 'admin', key).expect(200);
      expect(r.body.data).not.toHaveProperty('totalAmount');
      expect(r.body.data.items[0]).not.toHaveProperty('unitPrice');
    } finally {
      await db.user.update({
        where: { id: ids.admin },
        data: { role: 'ADMIN' },
      });
    }
  });
});

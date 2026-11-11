import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { ReportingModule } from '../src/reporting/reporting.module.js';
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { CrmModule } from '../src/crm/crm.module.js';
import { UsersModule } from '../src/users/users.module.js';
import { InventoryModule } from '../src/inventory/inventory.module.js';
import { SalesOrdersModule } from '../src/sales-orders/sales-orders.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PasswordService } from '../src/security/password.service.js';
import { environmentSchema } from '../src/config/environment.js';
import { configureApp } from '../src/configure-app.js';
import { audit } from '../src/audit/audit.js';
import { isolatedDatabase } from './support/isolated-database.js';

describe('Phase 7 reports and audit with PostgreSQL', () => {
  let app: INestApplication, db: PrismaService;
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  const tokens: Record<string, string> = {},
    ids: Record<string, string> = {};
  const as = (who = 'admin') =>
    request
      .agent(app.getHttpServer())
      .set('Authorization', `Bearer ${tokens[who]}`);
  let categoryId: string,
    productId: string,
    secondProductId: string,
    customerId: string,
    foreignCustomerId: string;
  const from = '2026-10-01T00:00:00Z',
    to = '2026-11-01T00:00:00Z';
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
        ReportingModule,
        CatalogModule,
        CrmModule,
        UsersModule,
        InventoryModule,
        SalesOrdersModule,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    const password = `Test-${randomUUID()}`,
      hash = await app.get(PasswordService).hash(password);
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
    categoryId = (await db.category.create({ data: { name: 'Reports' } })).id;
    for (const key of ['sales', 'other']) {
      const c = await db.customer.create({
        data: { name: key, code: key, ownerId: ids[key] },
      });
      if (key === 'sales') customerId = c.id;
      else foreignCustomerId = c.id;
    }
    const p = await db.product.create({
      data: {
        categoryId,
        sku: 'A',
        name: 'A',
        costPrice: '0.01',
        sellingPrice: '0.10',
        lowStockThreshold: 5,
      },
    });
    productId = p.id;
    secondProductId = (
      await db.product.create({
        data: {
          categoryId,
          sku: 'B',
          name: 'B',
          costPrice: '0.02',
          sellingPrice: '0.20',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });
  const seedSale = (
    status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'FULFILLED' | 'COMPLETED',
    amount: string,
    fulfilledAt = '2026-10-10T00:00:00Z',
    foreign = false,
    quantity = 1,
    p = productId,
  ) =>
    db.sale.create({
      data: {
        invoiceNumber: randomUUID(),
        createdById: foreign ? ids.other : ids.sales,
        customerId: foreign ? foreignCustomerId : customerId,
        status,
        totalAmount: amount,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        fulfilledAt: ['FULFILLED', 'COMPLETED'].includes(status)
          ? new Date(fulfilledAt)
          : null,
        items: {
          create: {
            productId: p,
            quantity,
            unitPrice: new Prisma.Decimal(amount).div(quantity).toFixed(2),
          },
        },
      },
    });
  const report = (path: string, who = 'admin', query: object = { from, to }) =>
    as(who)
      .get('/api/v1/' + path)
      .query(query);
  it('returns correct empty reports and zero conversion before any events', async () => {
    const s = (await report('dashboard/summary').expect(200)).body.data;
    expect(s.realizedSales).toEqual({ orderCount: 0, total: '0.00' });
    expect(s.ordersByStatus).toEqual([]);
    for (const path of [
      'reports/sales',
      'reports/top-products',
      'reports/sales-performance',
      'reports/lead-conversion',
      'audit-logs',
    ]) {
      const r = (await report(path).expect(200)).body;
      expect(r.data).toEqual([]);
      expect(r.meta.total).toBe(0);
      if (path.endsWith('lead-conversion'))
        expect(r.summary.conversionRate).toBe('0.00');
    }
  });
  it('excludes drafts, confirmed and cancelled; counts completed once with decimal precision', async () => {
    for (const status of ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const)
      await seedSale(status, '999.99');
    await seedSale('FULFILLED', '0.10');
    await seedSale('COMPLETED', '0.20');
    await seedSale('FULFILLED', '50.00', undefined, true);
    const s = (await report('dashboard/summary', 'sales').expect(200)).body
      .data;
    expect(s.realizedSales).toEqual({ orderCount: 2, total: '0.30' });
    expect(
      s.ordersByStatus.reduce(
        (n: number, r: { orderCount: number }) => n + r.orderCount,
        0,
      ),
    ).toBe(5);
    expect(s).not.toHaveProperty('lowStockProducts');
    const sales = (await report('reports/sales', 'sales').expect(200)).body;
    expect(sales.data).toEqual([
      { date: '2026-10-10', orderCount: 2, realizedSales: '0.30' },
    ]);
    expect(
      (await report('dashboard/summary').expect(200)).body.data.realizedSales
        .total,
    ).toBe('50.30');
  });
  it('uses UTC fulfillment boundaries, exclusive upper bound, and equivalent offsets', async () => {
    await seedSale('FULFILLED', '1.00', '2026-10-01T00:00:00Z');
    await seedSale('COMPLETED', '2.00', '2026-11-01T00:00:00Z');
    await seedSale('FULFILLED', '4.00', '2026-09-30T23:59:59.999Z');
    const a = (await report('reports/sales', 'sales').expect(200)).body;
    const b = (
      await report('reports/sales', 'sales', {
        from: '2026-10-01T07:00:00+07:00',
        to: '2026-11-01T07:00:00+07:00',
      }).expect(200)
    ).body;
    expect(a).toEqual(b);
    expect(a.data.map((r: { date: string }) => r.date)).toEqual([
      '2026-10-10',
      '2026-10-01',
    ]);
    expect(
      (await report('dashboard/summary', 'sales').expect(200)).body.data
        .realizedSales.total,
    ).toBe('1.30');
  });
  it('ranks products by snapshot quantity and value, with stable pagination and archived products', async () => {
    await seedSale(
      'FULFILLED',
      '0.60',
      '2026-10-10T00:00:00Z',
      false,
      3,
      secondProductId,
    );
    const value = (
      await report('reports/top-products', 'sales', {
        from,
        to,
        rankBy: 'value',
        pageSize: 1,
      }).expect(200)
    ).body;
    expect(value.data[0].productId).toBe(productId);
    expect(value.data[0].value).toBe('1.30');
    expect(value.meta.total).toBe(2);
    const quantity = (
      await report('reports/top-products', 'sales', {
        from,
        to,
        rankBy: 'quantity',
      }).expect(200)
    ).body;
    const expected = [productId, secondProductId].sort();
    expect(
      quantity.data.map((r: { productId: string }) => r.productId),
    ).toEqual(expected);
    expect(
      (
        await report('reports/top-products', 'sales', {
          from,
          to,
          page: 99,
        }).expect(200)
      ).body,
    ).toMatchObject({ data: [], meta: { total: 2 } });
    await db.product.update({
      where: { id: secondProductId },
      data: { sellingPrice: '999.99', isActive: false },
    });
    expect(
      (
        await report('reports/top-products', 'sales', {
          from,
          to,
          rankBy: 'value',
        }).expect(200)
      ).body.data.find(
        (r: { productId: string }) => r.productId === secondProductId,
      ).value,
    ).toBe('0.60');
  });
  it('attributes performance to creator and limits staff filter', async () => {
    const r = (await report('reports/sales-performance', 'sales').expect(200))
      .body;
    expect(r.data).toEqual([
      {
        staffId: ids.sales,
        name: 'sales',
        orderCount: 4,
        realizedSales: '1.90',
      },
    ]);
    await report('reports/sales-performance', 'sales', {
      from,
      to,
      staffId: ids.other,
    }).expect(403);
    expect(
      (
        await report('reports/sales-performance', 'admin', {
          from,
          to,
          staffId: ids.other,
        }).expect(200)
      ).body.data[0].realizedSales,
    ).toBe('50.00');
  });
  it('reports lead cohort conversion from linked customers, including archived leads', async () => {
    const leads = [];
    for (const [n, owner] of [
      [0, 'sales'],
      [1, 'sales'],
      [2, 'other'],
    ] as const) {
      leads.push(
        await db.lead.create({
          data: {
            companyName: 'Company' + n,
            contactName: 'Contact',
            source: 'TEST',
            ownerId: ids[owner],
            stage: n === 1 ? 'NEW' : 'WON',
            isActive: n !== 0,
            createdAt: new Date(from),
          },
        }),
      );
    }
    await db.customer.create({
      data: {
        name: 'Converted',
        code: randomUUID().slice(0, 30),
        ownerId: ids.sales,
        leadId: leads[0].id,
      },
    });
    const r = (await report('reports/lead-conversion', 'sales').expect(200))
      .body;
    expect(r.summary).toEqual({
      leadCount: 2,
      convertedCount: 1,
      conversionRate: '50.00',
    });
    expect(
      (await report('reports/lead-conversion').expect(200)).body.summary
        .conversionRate,
    ).toBe('33.33');
    const d = (await report('dashboard/summary', 'sales').expect(200)).body
      .data;
    expect(d.activeLeads).toBe(1);
    expect(d.activeCustomers).toBe(2);
  });
  it('scopes all sales aggregates by current customer ownership after reassignment', async () => {
    await db.customer.update({
      where: { id: customerId },
      data: { ownerId: ids.other },
    });
    for (const path of [
      'reports/sales',
      'reports/top-products',
      'reports/sales-performance',
    ])
      expect((await report(path, 'sales').expect(200)).body.data).toEqual([]);
    expect(
      (await report('dashboard/summary', 'sales').expect(200)).body.data
        .realizedSales.total,
    ).toBe('0.00');
    await db.customer.update({
      where: { id: customerId },
      data: { ownerId: ids.sales },
    });
  });
  it.each([
    'dashboard/summary',
    'reports/sales',
    'reports/top-products',
    'reports/sales-performance',
    'reports/lead-conversion',
    'reports/inventory',
    'audit-logs',
  ])('rejects anonymous %s', async (path) => {
    await request(app.getHttpServer())
      .get('/api/v1/' + path)
      .expect(401);
  });
  it.each([
    'reports/sales',
    'reports/top-products',
    'reports/sales-performance',
    'reports/lead-conversion',
    'audit-logs',
  ])('denies warehouse %s', async (path) => {
    await report(path, 'warehouse').expect(403);
  });
  it('denies inventory and audit to sales and projects warehouse dashboard', async () => {
    await report('reports/inventory', 'sales', {}).expect(403);
    await report('audit-logs', 'sales').expect(403);
    const d = (await report('dashboard/summary', 'warehouse').expect(200)).body
      .data;
    expect(Object.keys(d).sort()).toEqual([
      'lowStockProducts',
      'recentInventoryEvents',
    ]);
  });
  it.each([
    { from: '2026-02-30T00:00:00Z' },
    { from: '2026-11-01' },
    { from: to, to: from },
    { pageSize: 101 },
    { ownerId: 'injection' },
  ])('validates report queries over HTTP %#', async (q) => {
    await report('reports/sales', 'admin', q).expect(400);
  });
  it('audits price/status/role changes with correlation IDs and excludes sensitive body values', async () => {
    const r = await as()
      .patch(`/api/v1/products/${productId}`)
      .send({ sellingPrice: '0.11', description: 'secret free text' })
      .expect(200);
    const events = await db.auditLog.findMany({
      where: { resourceId: productId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: ids.admin,
      action: 'PRODUCT_PRICE_CHANGED',
      requestId: r.headers['x-request-id'],
      metadata: { costPrice: '0.01', sellingPrice: '0.11' },
    });
    const u = await db.user.create({
      data: {
        name: 'Target',
        email: randomUUID() + '@example.test',
        passwordHash: 'secret',
      },
    });
    await as()
      .patch(`/api/v1/users/${u.id}/role`)
      .send({ role: 'WAREHOUSE_STAFF' })
      .expect(200);
    await as()
      .patch(`/api/v1/users/${u.id}/status`)
      .send({ isActive: false })
      .expect(200);
    expect(
      (await db.auditLog.findMany({ where: { resourceId: u.id } }))
        .map((e) => e.action)
        .sort(),
    ).toEqual(['USER_ROLE_CHANGED', 'USER_STATUS_CHANGED']);
    const logs = (
      await report('audit-logs', 'admin', {
        resourceId: productId,
        pageSize: 1,
      }).expect(200)
    ).body;
    expect(logs.meta.total).toBe(1);
    expect(JSON.stringify(logs)).not.toMatch(
      /secret|passwordHash|authorization|description/,
    );
  });
  it('audits receipts and physical counts once under idempotent replay and reports inventory', async () => {
    const key = randomUUID();
    const receive = () =>
      as('warehouse')
        .post('/api/v1/inventory/receipts')
        .set('Idempotency-Key', key)
        .send({ productId, quantity: 10, reason: 'Incoming stock' });
    const r = (await receive().expect(201)).body.data;
    await receive().expect(201);
    expect(await db.auditLog.count({ where: { resourceId: r.id } })).toBe(1);
    const a = (
      await as('warehouse')
        .post('/api/v1/inventory/adjustments')
        .set('Idempotency-Key', randomUUID())
        .send({
          productId,
          countedQuantity: 4,
          expectedVersion: 1,
          reason: 'Physical stock count',
        })
        .expect(201)
    ).body.data;
    expect(
      await db.auditLog.count({
        where: { resourceId: a.id, action: 'INVENTORY_ADJUSTED' },
      }),
    ).toBe(1);
    const balances = (
      await report('reports/inventory', 'warehouse', {
        lowStock: 'true',
      }).expect(200)
    ).body;
    expect(balances.summary).toEqual({
      activeProducts: 1,
      lowStockProducts: 1,
      stockQuantity: '4',
    });
    expect(balances.data).toHaveLength(1);
    const m = (
      await report('reports/inventory', 'warehouse', {
        view: 'movements',
        productId,
        type: 'ADJUSTMENT',
      }).expect(200)
    ).body;
    expect(m.movements).toEqual([
      { type: 'ADJUSTMENT', count: 1, netQuantity: '-6' },
    ]);
    expect(m.meta.total).toBe(1);
  });
  it('audits CRM stage changes and conversion once', async () => {
    const lead = (
      await as('sales')
        .post('/api/v1/leads')
        .send({
          companyName: 'Unique audit lead',
          contactName: 'Contact',
          source: 'AUDIT',
        })
        .expect(201)
    ).body.data;
    for (const stage of ['CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON'])
      await as('sales')
        .post(`/api/v1/leads/${lead.id}/stage`)
        .send({ stage })
        .expect(200);
    for (let i = 0; i < 2; i++)
      await as('sales')
        .post(`/api/v1/leads/${lead.id}/convert`)
        .send({})
        .expect(200);
    expect(
      await db.auditLog.count({
        where: { resourceId: lead.id, action: 'LEAD_STAGE_CHANGED' },
      }),
    ).toBe(4);
    expect(
      await db.auditLog.count({
        where: { resourceId: lead.id, action: 'LEAD_CONVERTED' },
      }),
    ).toBe(1);
    const other = (await report('dashboard/summary', 'other', {}).expect(200))
      .body.data;
    expect(
      other.recentActivity.some(
        (r: { leadId: string }) => r.leadId === lead.id,
      ),
    ).toBe(false);
  });
  it('audits lifecycle atomically and does not duplicate fulfillment replay', async () => {
    const order = (
      await as('sales')
        .post('/api/v1/sales-orders')
        .set('Idempotency-Key', randomUUID())
        .send({ customerId, items: [{ productId, quantity: 1 }] })
        .expect(201)
    ).body.data;
    await as('sales')
      .post(`/api/v1/sales-orders/${order.id}/confirm`)
      .send({})
      .expect(200);
    const key = randomUUID();
    for (let i = 0; i < 2; i++)
      await as('warehouse')
        .post(`/api/v1/sales-orders/${order.id}/fulfill`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(200);
    await as('sales')
      .post(`/api/v1/sales-orders/${order.id}/complete`)
      .send({})
      .expect(200);
    expect(
      (await db.auditLog.findMany({ where: { resourceId: order.id } }))
        .map((r) => r.action)
        .sort(),
    ).toEqual(['ORDER_COMPLETE', 'ORDER_CONFIRM', 'ORDER_FULFILLED']);
  });
  it('does not record success on failed multi-item fulfillment or failed transitions', async () => {
    const empty = await db.product.create({
      data: {
        categoryId,
        sku: randomUUID(),
        name: 'Empty',
        costPrice: '1',
        sellingPrice: '1',
      },
    });
    const order = (
      await as('sales')
        .post('/api/v1/sales-orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          customerId,
          items: [
            { productId, quantity: 1 },
            { productId: empty.id, quantity: 1 },
          ],
        })
        .expect(201)
    ).body.data;
    await as('sales')
      .post(`/api/v1/sales-orders/${order.id}/confirm`)
      .send({})
      .expect(200);
    const before = await db.auditLog.count();
    await as('warehouse')
      .post(`/api/v1/sales-orders/${order.id}/fulfill`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    await as('sales')
      .post(`/api/v1/sales-orders/${order.id}/complete`)
      .send({})
      .expect(409);
    expect(await db.auditLog.count()).toBe(before);
    expect(
      await db.stockMovement.count({
        where: { saleItem: { saleId: order.id } },
      }),
    ).toBe(0);
  });
  it('rolls back an audit inserted before a later business failure', async () => {
    const resourceId = randomUUID(),
      failure = new Error('later failure');
    await expect(
      db.$transaction(async (tx) => {
        await audit(tx, ids.admin, 'PRODUCT_ARCHIVED', 'PRODUCT', resourceId, {
          isActive: false,
        });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.auditLog.count({ where: { resourceId } })).toBe(0);
  });
  it.each(['update', 'delete', 'truncate'] as const)(
    'rejects direct database audit %s',
    async (kind) => {
      const event = await db.auditLog.findFirstOrThrow();
      if (kind === 'update')
        await expect(
          db.auditLog.update({
            where: { id: event.id },
            data: { action: 'FORGED' },
          }),
        ).rejects.toThrow(/append-only/);
      if (kind === 'delete')
        await expect(
          db.auditLog.delete({ where: { id: event.id } }),
        ).rejects.toThrow(/append-only/);
      if (kind === 'truncate')
        await expect(db.$executeRaw`TRUNCATE audit_logs`).rejects.toThrow(
          /append-only/,
        );
      expect(
        await db.auditLog.findUnique({ where: { id: event.id } }),
      ).not.toBeNull();
    },
  );
  it('audits product archival and order cancellation, and ignores repeated archival', async () => {
    const p = await db.product.create({
      data: {
        categoryId,
        sku: randomUUID(),
        name: 'Archive audit',
        costPrice: '1',
        sellingPrice: '1',
      },
    });
    for (let i = 0; i < 2; i++)
      await as().post(`/api/v1/products/${p.id}/archive`).send({}).expect(200);
    expect(
      await db.auditLog.count({
        where: { resourceId: p.id, action: 'PRODUCT_ARCHIVED' },
      }),
    ).toBe(1);
    const o = (
      await as('sales')
        .post('/api/v1/sales-orders')
        .set('Idempotency-Key', randomUUID())
        .send({ customerId, items: [{ productId, quantity: 1 }] })
        .expect(201)
    ).body.data;
    await as('sales')
      .post(`/api/v1/sales-orders/${o.id}/cancel`)
      .send({ reason: 'Customer cancellation secret text' })
      .expect(200);
    const event = await db.auditLog.findFirstOrThrow({
      where: { resourceId: o.id },
    });
    expect(event.action).toBe('ORDER_CANCEL');
    expect(event.metadata).toEqual({ status: 'CANCELLED' });
  });
  it('rolls back business changes when the audit writer fails', async () => {
    const before = await db.product.findUniqueOrThrow({
      where: { id: productId },
    });
    await expect(
      db.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: productId },
          data: { sellingPrice: '888' },
        });
        await audit(
          tx,
          'invalid-actor-id',
          'PRODUCT_PRICE_CHANGED',
          'PRODUCT',
          productId,
          { sellingPrice: '888.00' },
        );
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.product.findUniqueOrThrow({ where: { id: productId } })
      ).sellingPrice.eq(before.sellingPrice),
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: {
          resourceId: productId,
          metadata: { path: ['sellingPrice'], equals: '888.00' },
        },
      }),
    ).toBe(0);
  });
  it('retains precision above JavaScript safe integer and sorts money numerically', async () => {
    const period = { from: '2040-01-01T00:00:00Z', to: '2040-02-01T00:00:00Z' };
    await seedSale('FULFILLED', '9007199254740993.01', '2040-01-02T00:00:00Z');
    await seedSale('COMPLETED', '0.09', '2040-01-02T00:00:00Z');
    expect(
      (await report('reports/sales', 'sales', period).expect(200)).body.data[0]
        .realizedSales,
    ).toBe('9007199254740993.10');
    expect(
      (await report('dashboard/summary', 'sales', period).expect(200)).body.data
        .realizedSales.total,
    ).toBe('9007199254740993.10');
  });
  it('exposes no mutation routes for audit and documents all report query parameters', async () => {
    const doc = (await as().get('/api/docs-json').expect(200)).body;
    for (const path of [
      'dashboard/summary',
      'reports/sales',
      'reports/top-products',
      'reports/sales-performance',
      'reports/lead-conversion',
      'reports/inventory',
      'audit-logs',
    ])
      expect(doc.paths['/api/v1/' + path].get).toBeDefined();
    expect(
      doc.paths['/api/v1/reports/top-products'].get.parameters.map(
        (p: { name: string }) => p.name,
      ),
    ).toContain('rankBy');
    expect(Object.keys(doc.paths['/api/v1/audit-logs'])).toEqual(['get']);
    await as()
      .patch('/api/v1/audit-logs/' + randomUUID())
      .send({})
      .expect(404);
    await as()
      .delete('/api/v1/audit-logs/' + randomUUID())
      .expect(404);
  });
});
import { Prisma } from '../src/generated/prisma/client.js';

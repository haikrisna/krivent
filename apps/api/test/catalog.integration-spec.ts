import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { PasswordService } from '../src/security/password.service.js';
import { isolatedDatabase } from './support/isolated-database.js';
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { configureApp } from '../src/configure-app.js';
import { environmentSchema } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Catalog HTTP with PostgreSQL persistence', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let categoryId: string;
  let token: string;
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  const categoryIds: string[] = [];
  const sku = () => `TEST-${randomUUID()}`.toUpperCase();
  const input = () => ({
    categoryId,
    sku: sku(),
    name: 'Business laptop',
    costPrice: '1000000.01',
    sellingPrice: '1250000.99',
  });
  const http = () =>
    request.agent(app.getHttpServer()).set('Authorization', `Bearer ${token}`);
  const create = async (data = input()) => {
    const response = await http()
      .post('/api/v1/products')
      .send(data)
      .expect(201);
    return response.body.data;
  };
  const expectError = (
    body: { statusCode: number; message: unknown },
    status: number,
  ) => {
    expect(body.statusCode).toBe(status);
    expect(body.message).toBeDefined();
    expect(JSON.stringify(body)).not.toMatch(
      /password_hash|connectionString|Invalid `prisma/,
    );
  };

  beforeAll(async () => {
    database = await isolatedDatabase();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validationSchema: environmentSchema,
          load: [
            () => ({ NODE_ENV: 'test', DATABASE_URL: database.databaseUrl }),
          ],
        }),
        AuthModule,
        CatalogModule,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    const password = `Test-${randomUUID()}`;
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@example.test`,
        name: 'Catalog test Admin',
        role: 'ADMIN',
        passwordHash: await app.get(PasswordService).hash(password),
      },
    });
    token = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password })
        .expect(200)
    ).body.data.accessToken;
  });
  beforeEach(async () => {
    const response = await http()
      .post('/api/v1/categories')
      .send({ name: `Test-${randomUUID()}` })
      .expect(201);
    categoryId = response.body.data.id;
    categoryIds.push(categoryId);
  });
  afterAll(async () => {
    try {
      if (prisma && categoryIds.length) {
        // Only fixture records created by this suite; never truncate/reset application data.
        await prisma.product.deleteMany({
          where: { categoryId: { in: categoryIds } },
        });
        await prisma.category.deleteMany({
          where: { id: { in: categoryIds } },
        });
      }
    } finally {
      if (app) await app.close();
      if (database) await database.cleanup();
    }
  });

  it('creates a normalized product with zero stock and persists exact decimal values across connections', async () => {
    const body = {
      ...input(),
      sku: sku().toLowerCase(),
      costPrice: '1234567890123456.78',
      sellingPrice: '1234567890123456.99',
    };
    const product = await create(body);
    expect(product).toMatchObject({
      sku: body.sku.toUpperCase(),
      costPrice: body.costPrice,
      sellingPrice: body.sellingPrice,
      stockQuantity: 0,
      isActive: true,
    });
    const independent = new PrismaService(config);
    try {
      const stored = await independent.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(stored.sellingPrice.toFixed(2)).toBe(body.sellingPrice);
      expect(stored.categoryId).toBe(categoryId);
    } finally {
      await independent.$disconnect();
    }
    const detail = await http()
      .get(`/api/v1/products/${product.id}`)
      .expect(200);
    expect(detail.body.data).toEqual(product);
  });

  it('returns 409 for duplicate normalized SKU, including concurrent requests', async () => {
    const body = input();
    const responses = await Promise.all([
      http().post('/api/v1/products').send(body),
      http()
        .post('/api/v1/products')
        .send({ ...body, sku: body.sku.toLowerCase() }),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expectError(responses.find((r) => r.status === 409)!.body, 409);
  });

  it.each([
    { costPrice: '-1' },
    { sellingPrice: 12.5 },
    { sellingPrice: '1.001' },
    { sellingPrice: '10000000000000000.00' },
    { sellingPrice: '1e3' },
    { sellingPrice: '1\n' },
    { sellingPrice: '01.00' },
    { costPrice: null },
    { name: '  ' },
    { sku: '' },
    { categoryId: 'bad' },
    { name: 'a'.repeat(201) },
    { stockQuantity: 10 },
    { isActive: false },
    { permissions: ['ADMIN'] },
  ])('rejects invalid or unowned fields %#', async (change) => {
    const response = await http()
      .post('/api/v1/products')
      .send({ ...input(), ...change })
      .expect(400);
    expectError(response.body, 400);
    expect(await prisma.product.count({ where: { categoryId } })).toBe(0);
  });

  it('rejects missing required fields and nonexistent category with 400 and 404', async () => {
    expectError(
      (await http().post('/api/v1/products').send({}).expect(400)).body,
      400,
    );
    expectError(
      (
        await http()
          .post('/api/v1/products')
          .send({ ...input(), categoryId: randomUUID() })
          .expect(404)
      ).body,
      404,
    );
    expectError(
      (await http().get(`/api/v1/products/${randomUUID()}`).expect(404)).body,
      404,
    );
    expectError(
      (await http().get('/api/v1/products/not-a-uuid').expect(400)).body,
      400,
    );
  });

  it('updates prices and category while preserving stock; validates partial updates', async () => {
    const product = await create();
    const response = await http()
      .patch(`/api/v1/products/${product.id}`)
      .send({ name: 'Updated', sellingPrice: '0.10' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      name: 'Updated',
      sellingPrice: '0.10',
      costPrice: '1000000.01',
      stockQuantity: 0,
    });
    for (const body of [
      {},
      { stockQuantity: 1 },
      { sellingPrice: '-1' },
      { isActive: true },
    ]) {
      expectError(
        (
          await http()
            .patch(`/api/v1/products/${product.id}`)
            .send(body)
            .expect(400)
        ).body,
        400,
      );
    }
    await http()
      .patch(`/api/v1/products/${product.id}`)
      .send({ categoryId: randomUUID() })
      .expect(404);
    const second = await create();
    await http()
      .patch(`/api/v1/products/${product.id}`)
      .send({ sku: second.sku })
      .expect(409);
    const otherCategory = await prisma.category.create({
      data: { name: `Test-${randomUUID()}` },
    });
    categoryIds.push(otherCategory.id);
    await http()
      .patch(`/api/v1/products/${product.id}`)
      .send({ categoryId: otherCategory.id })
      .expect(200);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
        .categoryId,
    ).toBe(otherCategory.id);
  });

  it('filters and paginates on the server with stable sorting and matching totals', async () => {
    for (const [name, sellingPrice] of [
      ['Alpha', '1.00'],
      ['Beta', '2.00'],
      ['Gamma', '3.00'],
    ])
      await create({ ...input(), name, sellingPrice });
    const query = {
      categoryId,
      minPrice: '1.50',
      maxPrice: '3.00',
      sortBy: 'sellingPrice',
      direction: 'desc',
      pageSize: 1,
      page: 2,
    };
    const response = await http()
      .get('/api/v1/products')
      .query(query)
      .expect(200);
    expect(response.body.meta).toEqual({
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(response.body.data[0].name).toBe('Beta');
    const search = await http()
      .get('/api/v1/products')
      .query({ categoryId, search: 'aLpHa' })
      .expect(200);
    expect(search.body.meta.total).toBe(1);
    expect(
      (
        await http()
          .get('/api/v1/products')
          .query({ categoryId, page: 10 })
          .expect(200)
      ).body.data,
    ).toEqual([]);
    for (const query of [
      { page: 0 },
      { pageSize: 101 },
      { sortBy: 'passwordHash' },
      { minPrice: '3', maxPrice: '2' },
      { status: 'false' },
      { extra: 'x' },
    ]) {
      expectError(
        (await http().get('/api/v1/products').query(query).expect(400)).body,
        400,
      );
    }
  });

  it('archives safely, keeps details and unique SKU, and excludes archived products by default', async () => {
    const body = input();
    const product = await create(body);
    await http().post(`/api/v1/categories/${categoryId}/archive`).expect(409);
    for (let i = 0; i < 2; i++) {
      const response = await http()
        .post(`/api/v1/products/${product.id}/archive`)
        .expect(200);
      expect(response.body.data.isActive).toBe(false);
    }
    await http()
      .patch(`/api/v1/products/${product.id}`)
      .send({ name: 'Changed' })
      .expect(409);
    await http().post('/api/v1/products').send(body).expect(409);
    expect(
      (await http().get('/api/v1/products').query({ categoryId }).expect(200))
        .body.meta.total,
    ).toBe(0);
    for (const status of ['archived', 'all'])
      expect(
        (
          await http()
            .get('/api/v1/products')
            .query({ categoryId, status })
            .expect(200)
        ).body.meta.total,
      ).toBe(1);
    expect(
      (await http().get(`/api/v1/products/${product.id}`).expect(200)).body.data
        .isActive,
    ).toBe(false);
    await http().post(`/api/v1/categories/${categoryId}/archive`).expect(200);
    await http().post('/api/v1/products').send(input()).expect(409);
    await http()
      .patch(`/api/v1/categories/${categoryId}`)
      .send({ name: 'Changed' })
      .expect(409);
    await http().delete(`/api/v1/products/${product.id}`).expect(404);
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
  });

  it('manages category validation, uniqueness, listing, details, and updates', async () => {
    const original = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
    });
    await http()
      .post('/api/v1/categories')
      .send({ name: original.name })
      .expect(409);
    await http()
      .post('/api/v1/categories')
      .send({ name: ' ', stockQuantity: 5 })
      .expect(400);
    await http().patch(`/api/v1/categories/${categoryId}`).send({}).expect(400);
    await http()
      .patch(`/api/v1/categories/${categoryId}`)
      .send({ description: 'Updated' })
      .expect(200);
    expect(
      (await http().get(`/api/v1/categories/${categoryId}`).expect(200)).body
        .data.description,
    ).toBe('Updated');
    const listed = await http()
      .get('/api/v1/categories')
      .query({
        search: original.name,
        pageSize: 1,
        sortBy: 'createdAt',
        direction: 'desc',
      })
      .expect(200);
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0].id).toBe(categoryId);
    await http().post(`/api/v1/categories/${categoryId}/archive`).expect(200);
    expect(
      (
        await http()
          .get('/api/v1/categories')
          .query({ search: original.name })
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    expect(
      (
        await http()
          .get('/api/v1/categories')
          .query({ search: original.name, status: 'archived' })
          .expect(200)
      ).body.meta.total,
    ).toBe(1);
  });

  it('serializes category archive against product creation', async () => {
    const [created, archived] = await Promise.all([
      http().post('/api/v1/products').send(input()),
      http().post(`/api/v1/categories/${categoryId}/archive`),
    ]);
    expect([created.status, archived.status]).toSatisfy(
      (statuses: number[]) =>
        (statuses[0] === 201 && statuses[1] === 409) ||
        (statuses[0] === 409 && statuses[1] === 200),
    );
    const category = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
    });
    if (!category.isActive)
      expect(
        await prisma.product.count({ where: { categoryId, isActive: true } }),
      ).toBe(0);
  });

  it('publishes request and response schemas in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/v1/products'].post;
    expect(
      operation.requestBody.content['application/json'].schema.properties
        .costPrice.type,
    ).toBe('string');
    expect(
      operation.responses['201'].content['application/json'].schema.properties
        .data.properties.stockQuantity.readOnly,
    ).toBe(true);
  });

  it('requires authentication and allows authenticated Admin catalog access outside development mode', async () => {
    await request(app.getHttpServer()).get('/api/v1/products').expect(401);
    config.set('NODE_ENV', 'production');
    try {
      await http().get('/api/v1/products').expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .send({ name: 'Forbidden' })
        .expect(401);
    } finally {
      config.set('NODE_ENV', 'test');
    }
  });
});

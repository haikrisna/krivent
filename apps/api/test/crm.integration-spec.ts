import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { CrmModule } from '../src/crm/crm.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PasswordService } from '../src/security/password.service.js';
import { environmentSchema } from '../src/config/environment.js';
import { configureApp } from '../src/configure-app.js';
import { isolatedDatabase } from './support/isolated-database.js';

describe('Phase 4 CRM HTTP with PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (who = 'sales') =>
    request
      .agent(app.getHttpServer())
      .set('Authorization', `Bearer ${tokens[who]}`);
  const create = async (extra = {}, who = 'sales') =>
    (
      await as(who)
        .post('/api/v1/leads')
        .send({
          companyName: `PT ${randomUUID()}`,
          contactName: 'Budi',
          source: 'REFERRAL',
          ...extra,
        })
        .expect(201)
    ).body.data;
  const won = async (id: string) => {
    for (const stage of ['CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON'])
      await as().post(`/api/v1/leads/${id}/stage`).send({ stage }).expect(200);
  };
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
        CrmModule,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
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
  it.each(['leads', 'customers', 'activities', 'follow-ups'])(
    'denies anonymous and warehouse access to %s',
    async (resource) => {
      await request(app.getHttpServer()).get(`/api/v1/${resource}`).expect(401);
      await as('warehouse').get(`/api/v1/${resource}`).expect(403);
      await as('warehouse').post(`/api/v1/${resource}`).send({}).expect(403);
    },
  );
  it('creates, normalizes, updates, searches, filters and paginates scoped leads', async () => {
    const lead = await create({
      companyName: 'PT Searchable',
      email: 'TEST@Example.test',
    });
    expect(lead.email).toBe('test@example.test');
    expect(lead.ownerId).toBe(ids.sales);
    await as()
      .patch(`/api/v1/leads/${lead.id}`)
      .send({ contactName: 'Siti' })
      .expect(200);
    const r = await as()
      .get('/api/v1/leads')
      .query({
        search: 'searchable',
        stage: 'NEW',
        ownerId: ids.sales,
        source: 'REFERRAL',
        sortBy: 'companyName',
        direction: 'asc',
        pageSize: 1,
      })
      .expect(200);
    expect(r.body.data[0].id).toBe(lead.id);
    expect(r.body.meta).toEqual({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    expect(
      (await as('other').get('/api/v1/leads').query({ search: 'searchable' }))
        .body.data,
    ).toEqual([]);
    await as('other').get(`/api/v1/leads/${lead.id}`).expect(404);
    await as('other')
      .patch(`/api/v1/leads/${lead.id}`)
      .send({ notes: 'unauthorized' })
      .expect(404);
    await as()
      .patch(`/api/v1/leads/${lead.id}`)
      .send({ ownerId: ids.other })
      .expect(403);
    await as().get('/api/v1/leads').query({ ownerId: ids.other }).expect(403);
  });
  it('validates DTOs, owner references and malformed/missing ids', async () => {
    for (const body of [
      { companyName: '' },
      { actorId: ids.admin },
      { stage: 'WON' },
      { email: 'invalid' },
    ])
      await as()
        .post('/api/v1/leads')
        .send({
          companyName: 'PT Invalid',
          contactName: 'Budi',
          source: 'WEB',
          ...body,
        })
        .expect(400);
    await as('admin')
      .post('/api/v1/leads')
      .send({
        companyName: 'PT Invalid Owner',
        contactName: 'Budi',
        source: 'WEB',
        ownerId: ids.warehouse,
      })
      .expect(400);
    await as().get('/api/v1/leads/invalid').expect(400);
    await as().get(`/api/v1/leads/${randomUUID()}`).expect(404);
    await as().get('/api/v1/leads').query({ pageSize: 101 }).expect(400);
    await as()
      .patch(`/api/v1/leads/${(await create()).id}`)
      .send({})
      .expect(400);
  });
  it('enforces ordered stages, loss reason, and terminal restrictions', async () => {
    const lead = await create();
    await as().post(`/api/v1/leads/${lead.id}/convert`).expect(409);
    await as()
      .post(`/api/v1/leads/${lead.id}/stage`)
      .send({ stage: 'QUALIFIED' })
      .expect(409);
    await as()
      .post(`/api/v1/leads/${lead.id}/stage`)
      .send({ stage: 'LOST' })
      .expect(400);
    await as()
      .post(`/api/v1/leads/${lead.id}/stage`)
      .send({ stage: 'LOST', reason: 'Budget not approved' })
      .expect(200);
    await as()
      .post(`/api/v1/leads/${lead.id}/stage`)
      .send({ stage: 'NEW' })
      .expect(409);
    await as()
      .patch(`/api/v1/leads/${lead.id}`)
      .send({ notes: 'changed' })
      .expect(409);
  });
  it('converts atomically and idempotently under concurrent requests without Sales Orders', async () => {
    const lead = await create();
    await won(lead.id);
    const results = await Promise.all([
      as().post(`/api/v1/leads/${lead.id}/convert`),
      as().post(`/api/v1/leads/${lead.id}/convert`),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const customer = results[0].body.data;
    expect(results[1].body.data.id).toBe(customer.id);
    expect(customer.leadId).toBe(lead.id);
    expect(customer).not.toHaveProperty('dedupKey');
    expect(await db.customer.count({ where: { leadId: lead.id } })).toBe(1);
    expect(await db.sale.count()).toBe(0);
    expect(
      (await as().post(`/api/v1/leads/${lead.id}/convert`).expect(200)).body
        .data.id,
    ).toBe(customer.id);
    await as('other').get(`/api/v1/customers/${customer.id}`).expect(404);
    await as('other').post(`/api/v1/leads/${lead.id}/convert`).expect(404);
  });
  it('deduplicates customer names/emails and serializes competing conversions', async () => {
    const companyName = `PT Shared ${randomUUID()}`;
    const a = await create({ companyName });
    const b = await create({ companyName: companyName.toUpperCase() });
    await won(a.id);
    await won(b.id);
    const results = await Promise.all([
      as().post(`/api/v1/leads/${a.id}/convert`),
      as().post(`/api/v1/leads/${b.id}/convert`),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await db.customer.count({ where: { leadId: { in: [a.id, b.id] } } }),
    ).toBe(1);
    const email = `${randomUUID()}@example.test`;
    await as()
      .post('/api/v1/customers')
      .send({ name: `PT ${randomUUID()}`, email })
      .expect(201);
    await as('other')
      .post('/api/v1/customers')
      .send({ name: 'PT Another', email: email.toUpperCase() })
      .expect(409);
  });
  it('preserves legacy customer data and lets Admin assign it safely', async () => {
    const legacy = await db.customer.create({
      data: {
        code: `OLD-${randomUUID().slice(0, 8)}`,
        name: 'PT Legacy',
        email: 'LEGACY@example.test',
      },
    });
    await as().get(`/api/v1/customers/${legacy.id}`).expect(404);
    expect(
      (await as('admin').get(`/api/v1/customers/${legacy.id}`).expect(200)).body
        .data.code,
    ).toBe(legacy.code);
    await as()
      .post('/api/v1/customers')
      .send({ name: 'pt legacy' })
      .expect(409);
    await as('admin')
      .patch(`/api/v1/customers/${legacy.id}`)
      .send({ ownerId: ids.sales })
      .expect(200);
    await as().get(`/api/v1/customers/${legacy.id}`).expect(200);
    await as()
      .patch(`/api/v1/customers/${legacy.id}`)
      .send({ phone: '+62215550100' })
      .expect(200);
  });
  it('keeps archived records out of ordinary queries and preserves history', async () => {
    const lead = await create();
    await as()
      .post('/api/v1/activities')
      .send({
        leadId: lead.id,
        type: 'CALL',
        note: 'Discussed',
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    await as().post(`/api/v1/leads/${lead.id}/archive`).expect(200);
    await as().get(`/api/v1/leads/${lead.id}`).expect(404);
    await as().get('/api/v1/leads').query({ status: 'all' }).expect(403);
    await as('admin')
      .get(`/api/v1/leads/${lead.id}`)
      .query({ status: 'all' })
      .expect(200);
    expect(
      (await as().get('/api/v1/activities').query({ leadId: lead.id })).body
        .data,
    ).toEqual([]);
    expect(
      (
        await as('admin')
          .get('/api/v1/activities')
          .query({ leadId: lead.id, status: 'all' })
      ).body.data,
    ).toHaveLength(1);
    await as()
      .post('/api/v1/activities')
      .send({
        leadId: lead.id,
        type: 'NOTE',
        note: 'No',
        occurredAt: new Date().toISOString(),
      })
      .expect(404);
    expect(await db.crmActivity.count({ where: { leadId: lead.id } })).toBe(1);
  });
  it('enforces interaction ownership, actor identity and exactly one existing target', async () => {
    const lead = await create();
    const input = {
      leadId: lead.id,
      type: 'EMAIL',
      note: 'Proposal',
      occurredAt: new Date().toISOString(),
    };
    const activity = (
      await as().post('/api/v1/activities').send(input).expect(201)
    ).body.data;
    expect(activity.actorId).toBe(ids.sales);
    await as('other').post('/api/v1/activities').send(input).expect(404);
    expect(
      (await as('other').get('/api/v1/activities').query({ leadId: lead.id }))
        .body.data,
    ).toEqual([]);
    for (const bad of [
      { ...input, actorId: ids.admin },
      { ...input, customerId: randomUUID() },
      { ...input, leadId: undefined },
    ])
      await as().post('/api/v1/activities').send(bad).expect(400);
    await as()
      .post('/api/v1/activities')
      .send({ ...input, leadId: randomUUID() })
      .expect(404);
  });
  it('filters follow-ups and enforces completion, cancellation and assignment policy', async () => {
    const lead = await create();
    const task = (
      await as()
        .post('/api/v1/follow-ups')
        .send({
          leadId: lead.id,
          note: 'Call back',
          dueAt: '2020-01-01T00:00:00Z',
        })
        .expect(201)
    ).body.data;
    const list = await as()
      .get('/api/v1/follow-ups')
      .query({
        timing: 'overdue',
        taskStatus: 'PENDING',
        assigneeId: ids.sales,
        leadId: lead.id,
        sortBy: 'dueAt',
      })
      .expect(200);
    expect(list.body.data[0].id).toBe(task.id);
    expect(
      (
        await as()
          .get('/api/v1/follow-ups')
          .query({ timing: 'upcoming', leadId: lead.id })
      ).body.data,
    ).toEqual([]);
    await as('other')
      .patch(`/api/v1/follow-ups/${task.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(404);
    await as()
      .patch(`/api/v1/follow-ups/${task.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    await as()
      .patch(`/api/v1/follow-ups/${task.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(409);
    const second = (
      await as()
        .post('/api/v1/follow-ups')
        .send({
          leadId: lead.id,
          note: 'Second',
          dueAt: new Date().toISOString(),
        })
        .expect(201)
    ).body.data;
    await as('admin')
      .patch(`/api/v1/leads/${lead.id}`)
      .send({ ownerId: ids.other })
      .expect(200);
    expect(
      (await db.followUp.findUniqueOrThrow({ where: { id: second.id } }))
        .assigneeId,
    ).toBe(ids.other);
    await as()
      .patch(`/api/v1/follow-ups/${second.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(404);
    await as('other')
      .patch(`/api/v1/follow-ups/${second.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(200);
  });
  it('supports customer activity/task/archive workflows with isolated reads', async () => {
    const customer = (
      await as()
        .post('/api/v1/customers')
        .send({ name: `PT ${randomUUID()}` })
        .expect(201)
    ).body.data;
    await as()
      .post('/api/v1/activities')
      .send({
        customerId: customer.id,
        type: 'MEETING',
        note: 'Kickoff',
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    await as()
      .post('/api/v1/follow-ups')
      .send({
        customerId: customer.id,
        note: 'Quote',
        dueAt: new Date().toISOString(),
        assigneeId: ids.other,
      })
      .expect(400);
    const task = (
      await as()
        .post('/api/v1/follow-ups')
        .send({
          customerId: customer.id,
          note: 'Quote',
          dueAt: new Date().toISOString(),
        })
        .expect(201)
    ).body.data;
    await as('admin')
      .patch(`/api/v1/follow-ups/${task.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    await as().post(`/api/v1/customers/${customer.id}/archive`).expect(200);
    await as().get(`/api/v1/customers/${customer.id}`).expect(404);
    expect(
      (await as('other').get('/api/v1/customers')).body.data.some(
        (r: { id: string }) => r.id === customer.id,
      ),
    ).toBe(false);
  });
  it('enforces database XOR and loss invariants outside the HTTP validator', async () => {
    await expect(
      db.crmActivity.create({
        data: {
          actorId: ids.sales,
          type: 'NOTE',
          note: 'Invalid target',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.lead.create({
        data: {
          companyName: 'Invalid',
          contactName: 'Invalid',
          source: 'WEB',
          ownerId: ids.sales,
          stage: 'LOST',
        },
      }),
    ).rejects.toThrow();
  });
  it('publishes validated CRM body schemas, query filters and Bearer security', async () => {
    const spec = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const lead = spec.paths['/api/v1/leads'];
    expect(lead.post.security).toEqual([{ 'access-token': [] }]);
    expect(
      lead.post.requestBody.content['application/json'].schema.required,
    ).toContain('companyName');
    expect(
      lead.post.requestBody.content['application/json'].schema
        .additionalProperties,
    ).toBe(false);
    expect(
      lead.get.parameters.some((p: { name: string }) => p.name === 'stage'),
    ).toBe(true);
    expect(
      spec.paths['/api/v1/follow-ups'].get.parameters.some(
        (p: { name: string }) => p.name === 'timing',
      ),
    ).toBe(true);
  });
  it('rejects irrelevant filters, contradictory task timing and action mass assignment', async () => {
    await as().get('/api/v1/customers').query({ stage: 'NEW' }).expect(400);
    await as()
      .get('/api/v1/follow-ups')
      .query({ timing: 'overdue', taskStatus: 'COMPLETED' })
      .expect(400);
    const lead = await create();
    await as()
      .post(`/api/v1/leads/${lead.id}/archive`)
      .send({ actorId: ids.admin })
      .expect(400);
  });
});

import 'dotenv/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtSigner } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { jwtOptions } from '../src/auth/jwt.options.js';
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { HealthModule } from '../src/health/health.module.js';
import { UsersModule } from '../src/users/users.module.js';
import { UsersService } from '../src/users/users.service.js';
import { PasswordService } from '../src/security/password.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { environmentSchema } from '../src/config/environment.js';
import { configureApp } from '../src/configure-app.js';
import type { UserRole } from '../src/generated/prisma/client.js';
import { isolatedDatabase } from './support/isolated-database.js';

@Controller('_auth-default')
class DefaultProtectionProbe {
  @Get() check() {
    return { protected: true };
  }
}

describe('Phase 3 identity and RBAC (isolated PostgreSQL schema)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let users: UsersService;
  let config: ConfigService;
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  let adminId: string;
  let adminToken: string;
  let initialHash: string;
  const password = `Test-only-${randomUUID()}`;
  const adminEmail = 'initial-admin@example.test';
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const http = () => request(app.getHttpServer());
  const as = (token: string) =>
    request.agent(app.getHttpServer()).set('Authorization', `Bearer ${token}`);
  const login = async (email = adminEmail, secret = password) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: secret })
        .expect(200)
    ).body.data as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: string;
    };
  const fixture = async (role: UserRole = 'SALES_STAFF', isActive = true) =>
    prisma.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        name: 'Test user',
        passwordHash: initialHash,
        role,
        isActive,
      },
    });
  const noSecrets = (body: unknown) =>
    expect(JSON.stringify(body)).not.toMatch(
      /passwordHash|password_hash|refreshTokens|authSessions|tokenHash|sessionId/,
    );

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
        UsersModule,
        CatalogModule,
        HealthModule,
      ],
      controllers: [DefaultProtectionProbe],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    users = app.get(UsersService);
    config = app.get(ConfigService);
    await users.bootstrap({
      email: adminEmail,
      name: 'Initial Admin',
      password,
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    adminId = admin.id;
    initialHash = admin.passwordHash;
  });
  beforeEach(async () => {
    app.get<ThrottlerStorageService>(getStorageToken()).onApplicationShutdown();
    adminToken = (await login()).accessToken;
  });
  afterEach(async () => {
    if (!prisma) return;
    // Every record here is in the randomly named schema created by this suite, never public.
    await prisma.refreshToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.user.update({
      where: { id: adminId },
      data: {
        email: adminEmail,
        name: 'Initial Admin',
        passwordHash: initialHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    await prisma.user.deleteMany({ where: { id: { not: adminId } } });
  });
  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.cleanup();
  });

  it('logs in with normalized email, returns short-lived tokens and safe user profiles', async () => {
    const result = await http()
      .post('/api/v1/auth/login')
      .send({ email: ` ${adminEmail.toUpperCase()} `, password })
      .expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data.expiresIn).toBe(900);
    expect(result.body.data.tokenType).toBe('Bearer');
    expect(initialHash.startsWith('$argon2id$')).toBe(true);
    expect(await passwords.verify(initialHash, password)).toBe(true);
    for (const path of ['/api/v1/auth/me', '/api/v1/users/me']) {
      const response = await as(result.body.data.accessToken)
        .get(path)
        .expect(200);
      expect(response.body.data).toMatchObject({
        id: adminId,
        role: 'ADMIN',
        isActive: true,
      });
      noSecrets(response.body);
    }
    const payload = JSON.parse(
      Buffer.from(
        result.body.data.accessToken.split('.')[1],
        'base64url',
      ).toString(),
    );
    expect(payload.iss).toBe(config.get('AUTH_JWT_ISSUER'));
    expect(payload.aud).toBe(config.get('AUTH_JWT_AUDIENCE'));
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload.role).toBeUndefined();
  });

  it('uses the same generic login error for bad passwords, unknown users and disabled users', async () => {
    const inactive = await fixture('SALES_STAFF', false);
    const responses = [];
    for (const credentials of [
      { email: adminEmail, password: 'wrong-password' },
      { email: 'unknown@example.test', password },
      { email: inactive.email, password },
    ])
      responses.push(
        await http().post('/api/v1/auth/login').send(credentials).expect(401),
      );
    for (const response of responses) {
      expect(response.body).toEqual({
        statusCode: 401,
        message: 'Invalid email or password',
      });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await prisma.authSession.count()).toBe(1); // Only beforeEach's Admin session.
  });

  it('protects new endpoints by default and keeps health explicitly public', async () => {
    await http().get('/api/v1/health').expect(200);
    await http().get('/api/v1/_auth-default').expect(401);
    await as(adminToken).get('/api/v1/_auth-default').expect(200);
    for (const path of [
      '/api/v1/products',
      '/api/v1/categories',
      '/api/v1/users',
      '/api/v1/users/me',
      '/api/v1/auth/me',
    ])
      await http().get(path).expect(401);
    await http().post('/api/v1/users').send({ role: 'ADMIN' }).expect(401);
    await http().post('/api/v1/auth/logout').expect(401);
  });

  it.each([
    'malformed',
    'signature',
    'expired',
    'issuer',
    'audience',
    'algorithm',
    'no-expiry',
    'future',
    'unknown-session',
  ] as const)('rejects invalid access tokens: %s', async (kind) => {
    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: adminId },
    });
    const options = jwtOptions(config);
    const claims = { sub: adminId, sid: session.id };
    let token: string;
    if (kind === 'malformed') token = 'not-a-jwt';
    else if (kind === 'expired')
      token = new JwtSigner({
        ...options,
        now: () => Date.now() - 3600000,
      }).sign(claims);
    else if (kind === 'issuer')
      token = new JwtSigner({
        ...options,
        issuer: 'https://other.example.test',
      }).sign(claims);
    else if (kind === 'audience')
      token = new JwtSigner({ ...options, audience: 'other-client' }).sign(
        claims,
      );
    else if (kind === 'future')
      token = new JwtSigner(options).sign({
        ...claims,
        nbf: Math.floor(Date.now() / 1000) + 3600,
      });
    else if (kind === 'unknown-session')
      token = new JwtSigner(options).sign({ ...claims, sid: randomUUID() });
    else if (kind === 'signature') {
      const parts = adminToken.split('.');
      parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
      token = parts.join('.');
    } else {
      const algorithm = kind === 'algorithm' ? 'HS384' : 'HS256';
      const header = Buffer.from(
        JSON.stringify({ alg: algorithm, typ: 'at+jwt' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          ...claims,
          iss: options.issuer,
          aud: options.audience,
          iat: Math.floor(Date.now() / 1000),
          ...(kind === 'no-expiry'
            ? {}
            : { exp: Math.floor(Date.now() / 1000) + 900 }),
        }),
      ).toString('base64url');
      token = `${header}.${payload}.${createHmac(
        algorithm === 'HS384' ? 'sha384' : 'sha256',
        Buffer.from(config.getOrThrow<string>('AUTH_JWT_SECRET'), 'hex'),
      )
        .update(`${header}.${payload}`)
        .digest('base64url')}`;
    }
    const response = await as(token).get('/api/v1/users/me').expect(401);
    expect(response.body.statusCode).toBe(401);
  });

  it('stores only refresh hashes and rotates tokens atomically', async () => {
    const first = await login();
    const saved = await prisma.refreshToken.findUniqueOrThrow({
      where: { hash: hash(first.refreshToken) },
    });
    expect(saved.hash === first.refreshToken).toBe(false);
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(rotated.body.data.refreshToken !== first.refreshToken).toBe(true);
    expect(rotated.headers['cache-control']).toBe('no-store');
    expect(
      (
        await prisma.refreshToken.findUniqueOrThrow({
          where: { hash: saved.hash },
        })
      ).usedAt,
    ).not.toBeNull();
    expect(
      await prisma.refreshToken.count({
        where: { sessionId: saved.sessionId },
      }),
    ).toBe(2);
    await as(rotated.body.data.accessToken).get('/api/v1/users/me').expect(200);
  });

  it('commits family revocation on refresh replay and rejects successor access/refresh tokens', async () => {
    const first = await login();
    const second = (
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200)
    ).body.data;
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    const token = await prisma.refreshToken.findUniqueOrThrow({
      where: { hash: hash(first.refreshToken) },
      include: { session: true },
    });
    expect(token.session.revokedAt).not.toBeNull();
    await as(second.accessToken).get('/api/v1/users/me').expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
  });

  it('allows only one concurrent refresh and revokes the winning family after the replay', async () => {
    const first = await login();
    const results = await Promise.all(
      [1, 2].map(() =>
        http()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: first.refreshToken }),
      ),
    );
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
    const winner = results.find((r) => r.status === 200)!.body.data;
    await as(winner.accessToken).get('/api/v1/users/me').expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: winner.refreshToken })
      .expect(401);
  });

  it('rejects unknown and expired refresh tokens', async () => {
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(43) })
      .expect(401);
    const first = await login();
    await prisma.refreshToken.update({
      where: { hash: hash(first.refreshToken) },
      data: {
        createdAt: new Date(Date.now() - 3600000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
  });

  it('enforces absolute session expiry for access and refresh tokens', async () => {
    const first = await login();
    const saved = await prisma.refreshToken.findUniqueOrThrow({
      where: { hash: hash(first.refreshToken) },
    });
    await prisma.authSession.update({
      where: { id: saved.sessionId },
      data: {
        createdAt: new Date(Date.now() - 3600000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await as(first.accessToken).get('/api/v1/users/me').expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
  });

  it('logout revokes only the current session immediately, including access tokens', async () => {
    const first = await login();
    const second = await login();
    const response = await as(first.accessToken)
      .post('/api/v1/auth/logout')
      .expect(204);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    await as(first.accessToken).get('/api/v1/users/me').expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await as(second.accessToken).get('/api/v1/users/me').expect(200);
  });

  it('keeps logout authoritative when it races a refresh', async () => {
    const first = await login();
    const [logout, refresh] = await Promise.all([
      as(first.accessToken).post('/api/v1/auth/logout'),
      http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken }),
    ]);
    expect(logout.status).toBe(204);
    expect([200, 401]).toContain(refresh.status);
    await as(first.accessToken).get('/api/v1/users/me').expect(401);
    if (refresh.status === 200)
      await as(refresh.body.data.accessToken)
        .get('/api/v1/users/me')
        .expect(401);
  });

  it.each(['ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF'] as const)(
    'enforces Catalog and Users permissions for %s',
    async (role) => {
      const user = await fixture(role);
      const access = (await login(user.email)).accessToken;
      const category = await prisma.category.create({
        data: { name: randomUUID() },
      });
      const product = await prisma.product.create({
        data: {
          categoryId: category.id,
          name: 'Test',
          sku: randomUUID(),
          costPrice: '1',
          sellingPrice: '2',
        },
      });
      await as(access).get('/api/v1/products').expect(200);
      await as(access).get(`/api/v1/products/${product.id}`).expect(200);
      await as(access).get('/api/v1/categories').expect(200);
      await as(access).get(`/api/v1/categories/${category.id}`).expect(200);
      await as(access).get('/api/v1/users/me').expect(200);
      await as(access)
        .get('/api/v1/users')
        .expect(role === 'ADMIN' ? 200 : 403);
      await as(access)
        .get(`/api/v1/users/${adminId}`)
        .expect(role === 'ADMIN' ? 200 : 403);
      await as(access)
        .post('/api/v1/categories')
        .send({ name: randomUUID() })
        .expect(role === 'SALES_STAFF' ? 403 : 201);
      await as(access)
        .post('/api/v1/products')
        .send({
          categoryId: category.id,
          sku: randomUUID(),
          name: 'New',
          costPrice: '1',
          sellingPrice: '2',
        })
        .expect(role === 'SALES_STAFF' ? 403 : 201);
      await as(access)
        .patch(`/api/v1/categories/${category.id}`)
        .send({ description: 'Updated' })
        .expect(role === 'SALES_STAFF' ? 403 : 200);
      await as(access)
        .patch(`/api/v1/products/${product.id}`)
        .send({ name: 'Updated' })
        .expect(role === 'SALES_STAFF' ? 403 : 200);
      await as(access)
        .post(`/api/v1/products/${product.id}/archive`)
        .expect(role === 'ADMIN' ? 200 : 403);
      // Empty category tests authorization independently from the active-products business rule.
      const empty = await prisma.category.create({
        data: { name: randomUUID() },
      });
      await as(access)
        .post(`/api/v1/categories/${empty.id}/archive`)
        .expect(role === 'ADMIN' ? 200 : 403);
    },
  );

  it('creates safe users, enforces normalized unique email, and supports listing/detail/update', async () => {
    const email = `${randomUUID()}@example.test`;
    const created = await as(adminToken)
      .post('/api/v1/users')
      .send({ email: ` ${email.toUpperCase()} `, name: 'New staff', password })
      .expect(201);
    expect(created.body.data).toMatchObject({
      email,
      role: 'SALES_STAFF',
      isActive: true,
    });
    noSecrets(created.body);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await passwords.verify(row.passwordHash, password)).toBe(true);
    await as(adminToken)
      .post('/api/v1/users')
      .send({ email, name: 'Duplicate', password })
      .expect(409);
    const second = await fixture();
    await as(adminToken)
      .patch(`/api/v1/users/${second.id}`)
      .send({ email: email.toUpperCase() })
      .expect(409);
    const updated = await as(adminToken)
      .patch(`/api/v1/users/${row.id}`)
      .send({ name: 'Updated', email: `updated-${email}` })
      .expect(200);
    expect(updated.body.data.name).toBe('Updated');
    const listed = await as(adminToken)
      .get('/api/v1/users')
      .query({
        search: `updated-${email}`,
        role: 'SALES_STAFF',
        status: 'active',
        pageSize: 1,
      })
      .expect(200);
    expect(listed.body.meta).toEqual({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    noSecrets(listed.body);
    noSecrets(
      (await as(adminToken).get(`/api/v1/users/${row.id}`).expect(200)).body,
    );
    await as(adminToken).get(`/api/v1/users/${randomUUID()}`).expect(404);
    await as(adminToken).get('/api/v1/users/not-a-uuid').expect(400);
  });

  it('normalizes legacy mixed-case email without rewriting the stored address', async () => {
    const user = await fixture();
    const legacy = `  ${user.email.toUpperCase()}  `;
    await prisma.user.update({
      where: { id: user.id },
      data: { email: legacy },
    });
    await login(user.email);
    await as(adminToken)
      .post('/api/v1/users')
      .send({ email: user.email, name: 'Duplicate legacy', password })
      .expect(409);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email,
    ).toBe(legacy);
  });

  it('blocks privilege escalation via bodies, headers and non-Admin endpoints', async () => {
    const sales = await fixture();
    const access = (await login(sales.email)).accessToken;
    const agent = as(access);
    await agent
      .patch(`/api/v1/users/${sales.id}/role`)
      .send({ role: 'ADMIN' })
      .expect(403);
    await agent
      .patch(`/api/v1/users/${adminId}/status`)
      .send({ isActive: false })
      .expect(403);
    await agent
      .patch(`/api/v1/users/${sales.id}`)
      .send({ name: 'Changed' })
      .expect(403);
    await agent
      .post('/api/v1/users')
      .send({
        email: `${randomUUID()}@example.test`,
        name: 'Escalate',
        password,
        role: 'ADMIN',
      })
      .expect(403);
    await agent
      .post('/api/v1/categories')
      .set('X-Role', 'ADMIN')
      .send({ name: randomUUID() })
      .expect(403);
    await as(adminToken)
      .patch(`/api/v1/users/${sales.id}`)
      .send({ role: 'ADMIN' })
      .expect(400);
    await as(adminToken)
      .patch(`/api/v1/users/${sales.id}`)
      .send({ isActive: false })
      .expect(400);
    await as(adminToken)
      .patch(`/api/v1/users/${sales.id}`)
      .send({ passwordHash: 'injected' })
      .expect(400);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: sales.id } })).role,
    ).toBe('SALES_STAFF');
  });

  it('uses current database permissions even if JWT contains an Admin role claim', async () => {
    const sales = await fixture();
    await login(sales.email);
    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: sales.id },
    });
    const forgedRoleClaim = new JwtSigner(jwtOptions(config)).sign({
      sub: sales.id,
      sid: session.id,
      role: 'ADMIN',
    });
    await as(forgedRoleClaim).get('/api/v1/users').expect(403);
  });

  it('revokes every account session when disabled and does not revive them on reactivation', async () => {
    const sales = await fixture();
    const first = await login(sales.email);
    const second = await login(sales.email);
    await as(adminToken)
      .patch(`/api/v1/users/${sales.id}/status`)
      .send({ isActive: false })
      .expect(200);
    for (const token of [first.accessToken, second.accessToken])
      await as(token).get('/api/v1/users/me').expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: sales.email, password })
      .expect(401);
    await as(adminToken)
      .patch(`/api/v1/users/${sales.id}/status`)
      .send({ isActive: true })
      .expect(200);
    await as(first.accessToken).get('/api/v1/users/me').expect(401);
    app.get<ThrottlerStorageService>(getStorageToken()).onApplicationShutdown();
    await login(sales.email);
  });

  it('revokes sessions on role/password changes and authenticates only the new password', async () => {
    const staff = await fixture('ADMIN');
    const first = await login(staff.email);
    await as(adminToken)
      .patch(`/api/v1/users/${staff.id}/role`)
      .send({ role: 'WAREHOUSE_STAFF' })
      .expect(200);
    await as(first.accessToken).get('/api/v1/users').expect(401);
    const second = await login(staff.email);
    await as(second.accessToken).get('/api/v1/users').expect(403);
    const newPassword = `New-${password}`;
    await as(adminToken)
      .patch(`/api/v1/users/${staff.id}`)
      .send({ password: newPassword })
      .expect(200);
    await as(second.accessToken).get('/api/v1/users/me').expect(401);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password })
      .expect(401);
    await login(staff.email, newPassword);
  });

  it('protects the last active Admin and prevents self-demotion/deactivation even with another Admin', async () => {
    for (const [path, body] of [
      ['role', { role: 'SALES_STAFF' }],
      ['status', { isActive: false }],
    ] as const)
      await as(adminToken)
        .patch(`/api/v1/users/${adminId}/${path}`)
        .send(body)
        .expect(409);
    await fixture('ADMIN');
    await as(adminToken)
      .patch(`/api/v1/users/${adminId}/role`)
      .send({ role: 'WAREHOUSE_STAFF' })
      .expect(409);
    await as(adminToken)
      .patch(`/api/v1/users/${adminId}/status`)
      .send({ isActive: false })
      .expect(409);
    expect(
      await prisma.user.count({ where: { role: 'ADMIN', isActive: true } }),
    ).toBe(2);
  });

  it('preserves an active Admin when two Admins try to disable each other concurrently', async () => {
    const other = await fixture('ADMIN');
    const otherToken = (await login(other.email)).accessToken;
    const results = await Promise.all([
      as(adminToken)
        .patch(`/api/v1/users/${other.id}/status`)
        .send({ isActive: false }),
      as(otherToken)
        .patch(`/api/v1/users/${adminId}/status`)
        .send({ isActive: false }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => [401, 403].includes(r.status))).toHaveLength(
      1,
    );
    expect(
      await prisma.user.count({ where: { role: 'ADMIN', isActive: true } }),
    ).toBe(1);
  });

  it('keeps bootstrap idempotent and never changes an existing Admin password/role/status', async () => {
    const result = await users.bootstrap({
      email: 'another@example.test',
      name: 'Other',
      password: `Different-${password}`,
    });
    expect(result.created).toBe(false);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: adminId },
    });
    expect(admin.passwordHash === initialHash).toBe(true);
    await prisma.user.update({
      where: { id: adminId },
      data: { isActive: false },
    });
    expect(
      (
        await users.bootstrap({
          email: adminEmail,
          name: 'Attempt recovery',
          password,
        })
      ).created,
    ).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: adminId } }))
        .isActive,
    ).toBe(false);
  });

  it.each([
    { email: 'invalid' },
    { password: 'short' },
    { name: ' ' },
    { email: 'é@example.test' },
    { role: 'SUPER_ADMIN' },
    { isActive: true },
    { permissions: ['ALL'] },
    { passwordHash: 'client-hash' },
  ])('rejects invalid User DTO input %#', async (change) => {
    await as(adminToken)
      .post('/api/v1/users')
      .send({
        email: `${randomUUID()}@example.test`,
        name: 'Invalid',
        password,
        ...change,
      })
      .expect(400);
  });

  it('validates auth/update/status/role/query DTOs without mass assignment', async () => {
    await http()
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password, role: 'ADMIN' })
      .expect(400);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'bad' })
      .expect(400);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(43), accessToken: 'extra' })
      .expect(400);
    const user = await fixture();
    await as(adminToken).patch(`/api/v1/users/${user.id}`).send({}).expect(400);
    await as(adminToken)
      .patch(`/api/v1/users/${user.id}/status`)
      .send({ isActive: 'false' })
      .expect(400);
    await as(adminToken)
      .patch(`/api/v1/users/${user.id}/role`)
      .send({ role: 'ADMIN', isActive: true })
      .expect(400);
    await as(adminToken)
      .get('/api/v1/users')
      .query({ pageSize: 101 })
      .expect(400);
    await as(adminToken)
      .get('/api/v1/users')
      .query({ sortBy: 'passwordHash' })
      .expect(400);
  });

  it('rate-limits login before Argon2 work and ignores spoofed forwarding identities', async () => {
    app.get<ThrottlerStorageService>(getStorageToken()).onApplicationShutdown();
    for (let i = 0; i < 5; i++)
      await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `192.0.2.${i}`)
        .send({ email: adminEmail, password: 'wrong' })
        .expect(401);
    const response = await http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ email: adminEmail, password: 'wrong' })
      .expect(429);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('documents Bearer auth, protected catalog/users, safe responses and public token endpoints', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const spec = response.body;
    expect(spec.components.securitySchemes['access-token'].scheme).toBe(
      'bearer',
    );
    expect(spec.paths['/api/v1/products'].post.security).toEqual([
      { 'access-token': [] },
    ]);
    expect(spec.paths['/api/v1/users'].post.security).toEqual([
      { 'access-token': [] },
    ]);
    expect(spec.paths['/api/v1/auth/login'].post.security).toBeUndefined();
    expect(spec.paths['/api/v1/health'].get.security).toBeUndefined();
    noSecrets(spec.paths['/api/v1/users/me'].get.responses['200']);
  });
});

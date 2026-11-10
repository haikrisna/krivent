import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { configureApp } from '../src/configure-app.js';
import { HealthModule } from '../src/health/health.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Test-only endpoint: exercise the global pipe without adding domain CRUD.
const inputSchema = z.strictObject({ quantity: z.number().int().positive() });
@Controller('_validation')
class ValidationProbeController {
  @Post()
  validate(@Body({ schema: inputSchema }) body: z.infer<typeof inputSchema>) {
    return body;
  }
}

describe('HTTP foundation (database double)', () => {
  let app: INestApplication;
  const query = vi.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ FRONTEND_ORIGIN: 'http://localhost:5173' })],
        }),
        HealthModule,
      ],
      controllers: [ValidationProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $runCommandRaw: () => {
          throw new Error('Use the mongodb provider');
        },
        $queryRawUnsafe: query,
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('checks the database over the prefixed health endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.details.database.status).toBe('up');
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the database query fails', async () => {
    query.mockRejectedValue(
      new Error('database connection refused: secret-password'),
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);
    expect(response.body.status).toBe('error');
    expect(response.body.details.database.status).toBe('down');
    expect(JSON.stringify(response.body)).not.toContain('secret-password');
  });

  it('serves Swagger UI and a document with the correct health path', async () => {
    await request(app.getHttpServer())
      .get('/api/docs/')
      .expect(200)
      .expect(/swagger-ui/);
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(response.body.paths['/api/v1/health'].get).toBeDefined();
  });

  it('does not expose an unprefixed health endpoint', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('permits the configured local frontend', async () => {
    await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173')
      .expect(204);
  });

  it('does not grant CORS access to another origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://untrusted.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).not.toBe(
      'https://untrusted.example',
    );
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('accepts a valid schema-bound request', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/_validation')
      .send({ quantity: 2 })
      .expect(201)
      .expect({ quantity: 2 });
  });

  it.each([{ quantity: -1 }, { quantity: '2' }, { quantity: 1, extra: true }])(
    'rejects invalid input and unknown properties %#',
    async (body) => {
      await request(app.getHttpServer())
        .post('/api/v1/_validation')
        .send(body)
        .expect(400);
    },
  );
});

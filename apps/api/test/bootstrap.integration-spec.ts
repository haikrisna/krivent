import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PasswordService } from '../src/security/password.service.js';
import { isolatedDatabase } from './support/isolated-database.js';

// Exercise the shipped command over stdin, never argv or a shell containing credentials.
function command(
  databaseUrl: string,
  input: unknown,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--env-file=.env', 'dist/admin-bootstrap.js'],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

describe('Initial Admin bootstrap command (isolated database schema)', () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  let prisma: PrismaService;
  const passwords = new PasswordService();
  const input = () => ({
    email: `${randomUUID()}@example.test`,
    name: 'Bootstrap test',
    password: `Test-only-${randomUUID()}`,
  });
  beforeAll(async () => {
    if (!existsSync('dist/admin-bootstrap.js'))
      throw new Error('Run npm run build before bootstrap integration tests');
    database = await isolatedDatabase();
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: database.databaseUrl }),
    );
    await passwords.onModuleInit();
  });
  afterEach(async () => {
    if (prisma) {
      await prisma.user.deleteMany();
      await prisma.adminBootstrap.deleteMany();
    }
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (database) await database.cleanup();
  });

  it('creates one Argon2id Admin and is idempotent without overwriting credentials', async () => {
    const data = input();
    const first = await command(database.databaseUrl, data);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe('Initial Admin created.\n');
    expect(
      first.stdout.includes(data.password) ||
        first.stderr.includes(data.password),
    ).toBe(false);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: data.email },
    });
    expect(admin.role).toBe('ADMIN');
    expect(await passwords.verify(admin.passwordHash, data.password)).toBe(
      true,
    );
    const second = await command(database.databaseUrl, {
      ...data,
      password: `Changed-${randomUUID()}`,
    });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('no account changed');
    expect(await prisma.user.count()).toBe(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }))
        .passwordHash === admin.passwordHash,
    ).toBe(true);
  });

  it('serializes simultaneous first bootstraps so only one Admin is created', async () => {
    const results = await Promise.all([
      command(database.databaseUrl, input()),
      command(database.databaseUrl, input()),
    ]);
    expect(results.map((r) => r.status)).toEqual([0, 0]);
    expect(
      results.filter((r) => r.stdout.includes('Initial Admin created')),
    ).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    expect(await prisma.adminBootstrap.count()).toBe(1);
  });

  it('does not promote an existing non-Admin on an email collision', async () => {
    const data = input();
    const user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: await passwords.hash(data.password),
      },
    });
    const result = await command(database.databaseUrl, data);
    expect(result.status).toBe(1);
    expect(result.stderr.includes(data.password)).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role,
    ).toBe('SALES_STAFF');
    expect(await prisma.adminBootstrap.count()).toBe(0);
  });

  it('never replaces an existing disabled Admin, even without a marker', async () => {
    const data = input();
    const user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: await passwords.hash(data.password),
        role: 'ADMIN',
        isActive: false,
      },
    });
    const result = await command(database.databaseUrl, input());
    expect(result.status).toBe(0);
    expect(await prisma.user.count()).toBe(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .isActive,
    ).toBe(false);
    expect(await prisma.adminBootstrap.count()).toBe(1);
  });

  it('rejects invalid input without creating users or printing the supplied password', async () => {
    const data = { ...input(), role: 'ADMIN' };
    const result = await command(database.databaseUrl, data);
    expect(result.status).toBe(1);
    expect(result.stderr.includes(data.password)).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });
});

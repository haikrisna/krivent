import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export async function isolatedDatabase() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing integration tests in production mode');
  const base = new ConfigService().getOrThrow<string>('DATABASE_URL');
  const schema = `krivent_test_${randomUUID().replaceAll('-', '')}`;
  const control = new PrismaService(new ConfigService({ DATABASE_URL: base }));
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  // schema contains only a fixed prefix and random hex, never user input.
  try {
    await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        timeout: 15000,
      },
    );
  } catch (error) {
    await control.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
    );
    throw error;
  } finally {
    await control.$disconnect();
  }
  return {
    databaseUrl: url.toString(),
    schema,
    async cleanup() {
      const client = new PrismaService(
        new ConfigService({ DATABASE_URL: base }),
      );
      try {
        await client.$executeRawUnsafe(
          `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
        );
      } finally {
        await client.$disconnect();
      }
    },
  };
}

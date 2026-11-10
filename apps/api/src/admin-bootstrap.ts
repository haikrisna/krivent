import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { environmentSchema } from './config/environment.js';
import { UsersModule } from './users/users.module.js';
import { UsersService } from './users/users.service.js';
import { bootstrapSchema } from './users/users.schemas.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: environmentSchema,
    }),
    UsersModule,
  ],
})
class BootstrapModule {}

async function bootstrap() {
  // Stdin keeps passwords out of argv/process listings; never echo input or validation errors.
  const input = bootstrapSchema.safeParse(
    JSON.parse(readFileSync(0, 'utf8')) as unknown,
  );
  if (!input.success) throw new Error('Invalid bootstrap input');
  const app = await NestFactory.createApplicationContext(BootstrapModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const result = await app.get(UsersService).bootstrap(input.data);
    process.stdout.write(
      result.created
        ? 'Initial Admin created.\n'
        : 'Admin bootstrap already completed; no account changed.\n',
    );
  } finally {
    await app.close();
  }
}
try {
  await bootstrap();
} catch {
  process.stderr.write(
    'Admin bootstrap failed. Check email/name/password policy, required environment, migration status, and email uniqueness. No credentials were printed.\n',
  );
  process.exitCode = 1;
}

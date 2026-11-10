import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule, ObserveInstrument, observeEnabled } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    observeEnabled ? { instrument: ObserveInstrument } : {},
  );
  configureApp(app);
  await app.listen(
    app.get(ConfigService).getOrThrow<number>('PORT'),
    '127.0.0.1',
  );
}
await bootstrap();

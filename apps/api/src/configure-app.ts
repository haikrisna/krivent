import { randomUUID } from 'node:crypto';
import { requestContext } from './audit/audit.js';
import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    requestContext.run({ requestId }, next);
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false,
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Krivent API')
      .setDescription(
        'Inventory & Sales Management — Phase 7 Dashboard analytics, reporting, append-only audit, sales orders, inventory, CRM and RBAC',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Short-lived access token from POST /api/v1/auth/login',
        },
        'access-token',
      )
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
}

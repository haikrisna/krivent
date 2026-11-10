import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
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
        'Inventory & Sales Management — Phase 2 catalog (local development only)',
      )
      .setVersion('1.0.0')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
}

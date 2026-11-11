import { ReportingModule } from './reporting/reporting.module.js';
import 'dotenv/config';
import { SalesOrdersModule } from './sales-orders/sales-orders.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { environmentSchema } from './config/environment.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { CrmModule } from './crm/crm.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { HealthModule } from './health/health.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule({
  skipInstrumentation: (instance) =>
    /^(AuthService|UsersService|PasswordService|JwtAuthProvider|PrismaService|CrmService|InventoryService|SalesOrdersService|ReportingService)$/.test(
      (instance as object)?.constructor?.name ?? '',
    ),
});
export const observeEnabled = Boolean(
  process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET,
);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    ...(observeEnabled
      ? [
          ObserveModule.forRoot({
            appKey: process.env.OBSERVE_APP_KEY!,
            appSecret: process.env.OBSERVE_APP_SECRET!,
            serviceId: 'api',
            http: { capture: false },
            redaction: {
              keys: [
                'password',
                'passwordHash',
                'refreshToken',
                'accessToken',
                'authorization',
                'cookie',
                'hash',
              ],
            },
          }),
        ]
      : []),
    AuthModule,
    UsersModule,
    HealthModule,
    CatalogModule,
    CrmModule,
    InventoryModule,
    SalesOrdersModule,
    ReportingModule,
  ],
})
export class AppModule {}

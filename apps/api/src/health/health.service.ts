import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(PrismaHealthIndicator)
    private readonly database: PrismaHealthIndicator,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  check() {
    return this.health.check([
      async () => {
        const result = await this.database.pingCheck('database', this.prisma, {
          timeout: 3000,
        });
        if (result.database.status === 'down') {
          return {
            database: {
              status: 'down' as const,
              message: 'Database unavailable',
            },
          };
        }
        return result;
      },
    ]);
  }
}

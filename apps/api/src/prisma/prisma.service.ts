import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(ConfigService) config: ConfigService) {
    const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
    const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
      throw new TypeError('Unsupported database schema name');
    super({
      adapter: new PrismaPg(
        {
          options: `-c search_path=${schema}`,
          connectionString: databaseUrl,
          connectionTimeoutMillis: 3000,
          query_timeout: 3000,
          statement_timeout: 3000,
          max: 10,
        },
        { schema },
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

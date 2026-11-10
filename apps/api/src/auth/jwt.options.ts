import type { ConfigService } from '@nestjs/config';
import type { JwtSignerOptions } from '@nestjs/authentication';

export function jwtOptions(config: ConfigService): JwtSignerOptions {
  return {
    key: Buffer.from(config.getOrThrow<string>('AUTH_JWT_SECRET'), 'hex'),
    alg: 'HS256',
    type: 'at+jwt',
    issuer: config.getOrThrow<string>('AUTH_JWT_ISSUER'),
    audience: config.getOrThrow<string>('AUTH_JWT_AUDIENCE'),
    ttl: config.getOrThrow<number>('AUTH_ACCESS_TTL_SECONDS') * 1000,
  };
}

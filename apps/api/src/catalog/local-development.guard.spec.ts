import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDevelopmentGuard } from './local-development.guard.js';

const context = (remoteAddress: string | undefined): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        socket: { remoteAddress },
        headers: { 'x-forwarded-for': '127.0.0.1' },
      }),
    }),
  }) as ExecutionContext;

describe('Temporary catalog access boundary', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'allows direct local development traffic from %s',
    (address) => {
      const guard = new LocalDevelopmentGuard(
        new ConfigService({ NODE_ENV: 'development' }),
      );
      expect(guard.canActivate(context(address))).toBe(true);
    },
  );
  it.each(['192.0.2.1', '::ffff:192.0.2.1', undefined])(
    'rejects nonlocal/unknown peers even with spoofed forwarded headers: %s',
    (address) => {
      const guard = new LocalDevelopmentGuard(
        new ConfigService({ NODE_ENV: 'development' }),
      );
      expect(() => guard.canActivate(context(address))).toThrow(
        ForbiddenException,
      );
    },
  );
  it.each(['production', 'test', undefined])(
    'fails closed outside explicit development mode: %s',
    (env) => {
      const guard = new LocalDevelopmentGuard({
        get: () => env,
      } as unknown as ConfigService);
      expect(() => guard.canActivate(context('127.0.0.1'))).toThrow(
        ForbiddenException,
      );
    },
  );
});

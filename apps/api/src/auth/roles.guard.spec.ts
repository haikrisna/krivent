import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../generated/prisma/client.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

@Roles('ADMIN')
class Probe {
  @Roles('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF')
  read() {}
  manage() {}
}
const context = (
  method: 'read' | 'manage',
  role?: UserRole,
): ExecutionContext =>
  ({
    getClass: () => Probe,
    getHandler: () => Probe.prototype[method],
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  }) as ExecutionContext;

describe('Role authorization boundary', () => {
  const guard = new RolesGuard(new Reflector());
  it.each(['ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF'] as const)(
    'allows %s to read when method overrides class role',
    (role) => {
      expect(guard.canActivate(context('read', role))).toBe(true);
    },
  );
  it('inherits class Admin restriction', () => {
    expect(guard.canActivate(context('manage', 'ADMIN'))).toBe(true);
  });
  it.each(['SALES_STAFF', 'WAREHOUSE_STAFF'] as const)(
    'returns 403 for authenticated %s without permission',
    (role) => {
      expect(() => guard.canActivate(context('manage', role))).toThrow(
        ForbiddenException,
      );
    },
  );
  it.each(['read', 'manage'] as const)(
    'returns 401 when identity is missing on %s',
    (method) => {
      expect(() => guard.canActivate(context(method))).toThrow(
        UnauthorizedException,
      );
    },
  );
});

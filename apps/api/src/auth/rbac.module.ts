import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
// Imported after AuthenticationModule so authentication runs before authorization.
@Module({ providers: [{ provide: APP_GUARD, useClass: RolesGuard }] })
export class RbacModule {}

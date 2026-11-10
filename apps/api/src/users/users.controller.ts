import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { idSchema } from '../catalog/catalog.schemas.js';
import { UsersService } from './users.service.js';
import { presentUser, type AuthenticatedUser } from './user.select.js';
import {
  userCreateSchema,
  userUpdateSchema,
  userQuerySchema,
  userStatusSchema,
  userRoleSchema,
  type UserCreate,
  type UserUpdate,
  type UserQuery,
} from './users.schemas.js';
import type { UserRole } from '../generated/prisma/client.js';
import { IdentityOperation } from './identity.swagger.js';

@ApiBearerAuth('access-token')
@ApiTags('users')
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('me')
  @Roles('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF')
  @IdentityOperation('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { data: presentUser(user) };
  }

  @Get()
  @IdentityOperation('list')
  list(@Query({ schema: userQuerySchema }) query: UserQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  @IdentityOperation('detail')
  async detail(@Param('id', { schema: idSchema }) id: string) {
    return { data: await this.users.get(id) };
  }

  @Post()
  @IdentityOperation('create')
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: userCreateSchema }) body: UserCreate,
  ) {
    return { data: await this.users.create(actor.id, body) };
  }

  @Patch(':id')
  @IdentityOperation('update')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: userUpdateSchema }) body: UserUpdate,
  ) {
    return { data: await this.users.update(actor.id, id, body) };
  }

  @Patch(':id/status')
  @IdentityOperation('status')
  async status(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: userStatusSchema }) body: { isActive: boolean },
  ) {
    return { data: await this.users.setStatus(actor.id, id, body.isActive) };
  }

  @Patch(':id/role')
  @IdentityOperation('role')
  async role(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: userRoleSchema }) body: { role: UserRole },
  ) {
    return { data: await this.users.setRole(actor.id, id, body.role) };
  }
}

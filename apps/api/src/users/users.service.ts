import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';
import { publicUserSelect } from './user.select.js';
import type { UserCreate, UserQuery, UserUpdate } from './users.schemas.js';

// All Admin-management/bootstrap writes use this transaction-scoped lock. It is shared by API instances.
const adminLock = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(71003001)::text`;

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
  list(q: UserQuery) {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status === 'all' ? {} : { isActive: q.status === 'active' }),
      ...(q.search
        ? {
            OR: [
              { email: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const data = await tx.user.findMany({
          where,
          select: publicUserSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        const total = await tx.user.count({ where });
        return {
          data,
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total,
            totalPages: Math.ceil(total / q.pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async manage<T>(
    actorId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await adminLock(tx);
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true, isActive: true },
      });
      if (!actor?.isActive || actor.role !== 'ADMIN')
        throw new ForbiddenException('Admin permission required');
      return run(tx);
    });
  }
  async create(actorId: string, input: UserCreate) {
    const { password, ...data } = input;
    const passwordHash = await this.passwords.hash(password);
    return this.manage(actorId, (tx) =>
      tx.user.create({
        data: { ...data, passwordHash },
        select: publicUserSelect,
      }),
    );
  }
  async update(actorId: string, id: string, input: UserUpdate) {
    const { password, ...data } = input;
    const passwordHash =
      password === undefined ? undefined : await this.passwords.hash(password);
    return this.manage(actorId, async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { ...data, ...(passwordHash ? { passwordHash } : {}) },
        select: publicUserSelect,
      });
      if (passwordHash || data.email !== undefined)
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      return user;
    });
  }
  setRole(actorId: string, id: string, role: UserRole) {
    return this.changeAccess(actorId, id, { role });
  }
  setStatus(actorId: string, id: string, isActive: boolean) {
    return this.changeAccess(actorId, id, { isActive });
  }
  private changeAccess(
    actorId: string,
    id: string,
    change: { role?: UserRole; isActive?: boolean },
  ) {
    return this.manage(actorId, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: publicUserSelect,
      });
      if (!target) throw new NotFoundException('User not found');
      const removesAdmin =
        target.role === 'ADMIN' &&
        target.isActive &&
        ((change.role !== undefined && change.role !== 'ADMIN') ||
          change.isActive === false);
      if (
        removesAdmin &&
        (await tx.user.count({ where: { role: 'ADMIN', isActive: true } })) <= 1
      )
        throw new ConflictException('Cannot remove the last active Admin');
      if (
        actorId === id &&
        (change.isActive === false ||
          (change.role !== undefined && change.role !== 'ADMIN'))
      )
        throw new ConflictException(
          'Admin cannot deactivate or demote their own account',
        );
      const changed =
        (change.role !== undefined && change.role !== target.role) ||
        (change.isActive !== undefined && change.isActive !== target.isActive);
      const user = await tx.user.update({
        where: { id },
        data: change,
        select: publicUserSelect,
      });
      if (changed)
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      return user;
    });
  }

  async bootstrap(input: { email: string; name: string; password: string }) {
    const passwordHash = await this.passwords.hash(input.password);
    return this.prisma.$transaction(async (tx) => {
      await adminLock(tx);
      if (
        await tx.adminBootstrap.findUnique({ where: { id: 'initial-admin' } })
      )
        return { created: false };
      // An existing Admin, even disabled, is never replaced/resurrected by this command.
      const exists = await tx.user.count({ where: { role: 'ADMIN' } });
      if (!exists)
        await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash,
            role: 'ADMIN',
          },
        });
      await tx.adminBootstrap.create({ data: { id: 'initial-admin' } });
      return { created: !exists };
    });
  }
}

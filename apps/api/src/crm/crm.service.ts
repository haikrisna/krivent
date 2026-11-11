import { audit } from '../audit/audit.js';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  allowedStage,
  type Actor,
  type Query,
  type LeadInput,
  type CustomerInput,
  type ActivityInput,
  type FollowInput,
} from './crm.schemas.js';
type Tx = Prisma.TransactionClient;
type Kind = 'leads' | 'customers' | 'activities' | 'follow-ups';
const normalize = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
@Injectable()
export class CrmService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private role(a: Actor) {
    if (!['ADMIN', 'SALES_STAFF'].includes(a.role))
      throw new ForbiddenException();
  }
  private scope(a: Actor) {
    this.role(a);
    return a.role === 'ADMIN' ? {} : { ownerId: a.id };
  }
  private async atomic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(e.code) &&
          attempt < 3
        )
          continue;
        throw e;
      }
    }
  }
  private async owner(tx: Tx, a: Actor, requested?: string) {
    this.role(a);
    if (a.role !== 'ADMIN' && requested && requested !== a.id)
      throw new ForbiddenException('Only Admin can reassign ownership');
    const ownerId = requested ?? a.id;
    if (
      !(await tx.user.findFirst({
        where: { id: ownerId, role: 'SALES_STAFF', isActive: true },
      }))
    )
      throw new BadRequestException(
        'Owner must be an active sales staff member',
      );
    return ownerId;
  }
  private async target(
    tx: Tx,
    a: Actor,
    kind: 'leads' | 'customers',
    id: string,
    archived = false,
  ) {
    const where = {
      id,
      ...this.scope(a),
      ...(archived ? {} : { isActive: true }),
    };
    const row =
      kind === 'leads'
        ? await tx.lead.findFirst({ where })
        : await tx.customer.findFirst({ where });
    if (!row) throw new NotFoundException('CRM record not found');
    return row;
  }
  async detail(a: Actor, kind: 'leads' | 'customers', id: string, q: Query) {
    if (q.status !== 'active' && a.role !== 'ADMIN')
      throw new ForbiddenException();
    return this.target(this.db, a, kind, id, q.status !== 'active');
  }
  private async duplicate(
    tx: Tx,
    name: string,
    email?: string | null,
    except?: string,
  ) {
    // Include legacy records without rewriting or imposing uniqueness on existing duplicates.
    const rows = await tx.customer.findMany({
      where: except ? { id: { not: except } } : {},
      select: { name: true, email: true },
    });
    if (
      rows.some(
        (r) =>
          normalize(r.name) === normalize(name) ||
          (email && r.email && normalize(r.email) === email),
      )
    )
      throw new ConflictException('Customer identity already registered');
  }
  createLead(a: Actor, body: LeadInput) {
    return this.atomic(async (tx) =>
      tx.lead.create({
        data: { ...body, ownerId: await this.owner(tx, a, body.ownerId) },
      }),
    );
  }
  updateLead(a: Actor, id: string, body: Partial<LeadInput>) {
    return this.atomic(async (tx) => {
      const lead = await this.target(tx, a, 'leads', id);
      if (await tx.customer.findUnique({ where: { leadId: id } }))
        throw new ConflictException('Converted lead is immutable');
      if (['WON', 'LOST'].includes((lead as { stage: string }).stage))
        throw new ConflictException('Terminal lead is immutable');
      if (body.ownerId && body.ownerId !== lead.ownerId) {
        await this.owner(tx, a, body.ownerId);
        // Pending work follows the newly assigned account owner.
        await tx.followUp.updateMany({
          where: { leadId: id, status: 'PENDING' },
          data: { assigneeId: body.ownerId },
        });
      }
      return tx.lead.update({ where: { id }, data: body });
    });
  }
  transition(a: Actor, id: string, stage: string, reason?: string) {
    return this.atomic(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, isActive: true, ...this.scope(a) },
      });
      if (!lead) throw new NotFoundException('CRM record not found');
      if (!allowedStage(lead.stage, stage))
        throw new ConflictException('Invalid lead stage transition');
      if (stage === 'LOST' && !reason)
        throw new BadRequestException('Lost reason required');
      await tx.crmActivity.create({
        data: {
          leadId: id,
          actorId: a.id,
          type: 'NOTE',
          note: `Stage ${lead.stage} -> ${stage}${reason ? ': ' + reason : ''}`,
          occurredAt: new Date(),
        },
      });
      await audit(tx, a.id, 'LEAD_STAGE_CHANGED', 'LEAD', id, { stage });
      return tx.lead.update({
        where: { id },
        data: {
          stage: stage as Prisma.LeadUpdateInput['stage'],
          lostReason: stage === 'LOST' ? reason : null,
        },
      });
    });
  }
  createCustomer(a: Actor, body: CustomerInput) {
    return this.atomic(async (tx) => {
      const ownerId = await this.owner(tx, a, body.ownerId);
      await this.duplicate(tx, body.name, body.email);
      return tx.customer.create({
        data: {
          ...body,
          ownerId,
          code: `C-${randomUUID().replaceAll('-', '').slice(0, 28)}`,
          dedupKey: normalize(body.name),
          normalizedEmail: body.email,
        },
      });
    });
  }
  updateCustomer(a: Actor, id: string, body: Partial<CustomerInput>) {
    return this.atomic(async (tx) => {
      const row = await tx.customer.findFirst({
        where: { id, isActive: true, ...this.scope(a) },
      });
      if (!row) throw new NotFoundException('CRM record not found');
      if (body.ownerId && body.ownerId !== row.ownerId) {
        await this.owner(tx, a, body.ownerId);
        await tx.followUp.updateMany({
          where: { customerId: id, status: 'PENDING' },
          data: { assigneeId: body.ownerId },
        });
      }
      await this.duplicate(
        tx,
        body.name ?? row.name,
        body.email === undefined ? row.email?.toLowerCase() : body.email,
        id,
      );
      return tx.customer.update({
        where: { id },
        data: {
          ...body,
          dedupKey: normalize(body.name ?? row.name),
          normalizedEmail:
            body.email === undefined ? row.email?.toLowerCase() : body.email,
        },
      });
    });
  }
  convert(a: Actor, id: string) {
    return this.atomic(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, isActive: true, ...this.scope(a) },
      });
      if (!lead) throw new NotFoundException('CRM record not found');
      const existing = await tx.customer.findUnique({ where: { leadId: id } });
      if (existing) {
        await this.target(tx, a, 'customers', existing.id, true);
        return existing;
      }
      if (lead.stage !== 'WON')
        throw new ConflictException('Only WON leads can be converted');
      await this.duplicate(tx, lead.companyName, lead.email);
      const customer = await tx.customer.create({
        data: {
          code: `C-${randomUUID().replaceAll('-', '').slice(0, 28)}`,
          name: lead.companyName,
          contactName: lead.contactName,
          email: lead.email,
          phone: lead.phone,
          ownerId: lead.ownerId,
          leadId: id,
          dedupKey: normalize(lead.companyName),
          normalizedEmail: lead.email,
        },
      });
      await tx.crmActivity.create({
        data: {
          leadId: id,
          actorId: a.id,
          type: 'NOTE',
          note: 'Lead converted to customer',
          occurredAt: new Date(),
        },
      });
      await audit(tx, a.id, 'LEAD_CONVERTED', 'LEAD', id, {
        customerId: customer.id,
      });
      return customer;
    });
  }
  archive(a: Actor, kind: 'leads' | 'customers', id: string) {
    return this.atomic(async (tx) => {
      await this.target(tx, a, kind, id, true);
      if (kind === 'leads')
        return tx.lead.update({ where: { id }, data: { isActive: false } });
      return tx.customer.update({ where: { id }, data: { isActive: false } });
    });
  }
  private async interactionTarget(
    tx: Tx,
    a: Actor,
    body: { leadId?: string; customerId?: string },
  ) {
    if (Boolean(body.leadId) === Boolean(body.customerId))
      throw new BadRequestException('Exactly one target required');
    return this.target(
      tx,
      a,
      body.leadId ? 'leads' : 'customers',
      (body.leadId ?? body.customerId)!,
    );
  }
  activity(a: Actor, body: ActivityInput) {
    return this.atomic(async (tx) => {
      await this.interactionTarget(tx, a, body);
      return tx.crmActivity.create({
        data: { ...body, actorId: a.id, occurredAt: new Date(body.occurredAt) },
      });
    });
  }
  follow(a: Actor, body: FollowInput) {
    return this.atomic(async (tx) => {
      const parent = await this.interactionTarget(tx, a, body);
      const assigneeId = body.assigneeId ?? parent.ownerId;
      if (!assigneeId || assigneeId !== parent.ownerId)
        throw new BadRequestException('Assignee must equal target owner');
      await this.owner(tx, a, assigneeId);
      return tx.followUp.create({
        data: { ...body, assigneeId, dueAt: new Date(body.dueAt) },
      });
    });
  }
  followState(a: Actor, id: string, status: 'COMPLETED' | 'CANCELLED') {
    return this.atomic(async (tx) => {
      this.role(a);
      const task = await tx.followUp.findFirst({
        where: { id, ...(a.role === 'ADMIN' ? {} : { assigneeId: a.id }) },
      });
      if (!task) throw new NotFoundException('CRM record not found');
      await this.interactionTarget(tx, a, {
        leadId: task.leadId ?? undefined,
        customerId: task.customerId ?? undefined,
      });
      if (task.status !== 'PENDING')
        throw new ConflictException('Follow-up is terminal');
      return tx.followUp.update({ where: { id }, data: { status } });
    });
  }
  async list(a: Actor, kind: Kind, q: Query) {
    this.role(a);
    if (q.status !== 'active' && a.role !== 'ADMIN')
      throw new ForbiddenException();
    if (
      a.role !== 'ADMIN' &&
      ((q.ownerId && q.ownerId !== a.id) ||
        (q.assigneeId && q.assigneeId !== a.id))
    )
      throw new ForbiddenException();
    const supported: Record<Kind, string[]> = {
      leads: ['search', 'stage', 'ownerId', 'source'],
      customers: ['search', 'ownerId'],
      activities: ['search', 'ownerId', 'leadId', 'customerId'],
      'follow-ups': [
        'ownerId',
        'leadId',
        'customerId',
        'assigneeId',
        'taskStatus',
        'timing',
      ],
    };
    for (const key of [
      'search',
      'stage',
      'ownerId',
      'source',
      'leadId',
      'customerId',
      'assigneeId',
      'taskStatus',
      'timing',
    ] as const) {
      if (q[key] !== undefined && !supported[kind].includes(key))
        throw new BadRequestException('Filter unsupported for resource');
    }
    if (q.timing && q.taskStatus && q.taskStatus !== 'PENDING')
      throw new BadRequestException('Timing requires PENDING status');
    const active =
      q.status === 'all' ? {} : { isActive: q.status === 'active' };
    const owner = {
      ...this.scope(a),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    };
    const parent = { ...owner, ...active };
    const targets = {
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
    };
    const visibility = {
      OR: [{ lead: { is: parent } }, { customer: { is: parent } }],
    };
    const page = { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
    const sorts: Record<Kind, string[]> = {
      leads: ['createdAt', 'updatedAt', 'companyName'],
      customers: ['createdAt', 'updatedAt', 'name'],
      activities: ['createdAt', 'occurredAt'],
      'follow-ups': ['createdAt', 'updatedAt', 'dueAt'],
    };
    if (!sorts[kind].includes(q.sortBy))
      throw new BadRequestException('Invalid sort for resource');
    const orderBy = [{ [q.sortBy]: q.direction }, { id: q.direction }];
    return this.db.$transaction(
      async (tx) => {
        let data: unknown[];
        let total: number;
        if (kind === 'leads') {
          const where: Prisma.LeadWhereInput = {
            ...parent,
            ...(q.stage ? { stage: q.stage } : {}),
            ...(q.source ? { source: q.source } : {}),
            ...(q.search
              ? {
                  OR: ['companyName', 'contactName', 'email', 'phone'].map(
                    (key) => ({
                      [key]: { contains: q.search, mode: 'insensitive' },
                    }),
                  ),
                }
              : {}),
          };
          data = await tx.lead.findMany({ where, ...page, orderBy });
          total = await tx.lead.count({ where });
        } else if (kind === 'customers') {
          const where: Prisma.CustomerWhereInput = {
            ...parent,
            ...(q.search
              ? {
                  OR: ['name', 'contactName', 'email', 'code'].map((key) => ({
                    [key]: { contains: q.search, mode: 'insensitive' },
                  })),
                }
              : {}),
          };
          data = await tx.customer.findMany({ where, ...page, orderBy });
          total = await tx.customer.count({ where });
        } else if (kind === 'activities') {
          const where: Prisma.CrmActivityWhereInput = {
            ...visibility,
            ...targets,
            ...(q.search
              ? { note: { contains: q.search, mode: 'insensitive' } }
              : {}),
          };
          data = await tx.crmActivity.findMany({ where, ...page, orderBy });
          total = await tx.crmActivity.count({ where });
        } else {
          const where: Prisma.FollowUpWhereInput = {
            ...visibility,
            ...targets,
            ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
            ...(q.taskStatus ? { status: q.taskStatus } : {}),
            ...(q.timing
              ? {
                  status: 'PENDING',
                  dueAt:
                    q.timing === 'overdue'
                      ? { lt: new Date() }
                      : { gte: new Date() },
                }
              : {}),
          };
          data = await tx.followUp.findMany({ where, ...page, orderBy });
          total = await tx.followUp.count({ where });
        }
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
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

import { z } from 'zod';
const text = (n: number) => z.string().trim().min(1).max(n);
export const id = z.uuid();
const email = z
  .string()
  .trim()
  .pipe(z.email().max(254))
  .transform((v) => v.toLowerCase())
  .nullable()
  .optional();
export const leadCreate = z.strictObject({
  companyName: text(120),
  contactName: text(120),
  email,
  phone: text(32).nullable().optional(),
  source: text(80),
  ownerId: id.optional(),
  notes: text(5000).nullable().optional(),
});
export const leadUpdate = leadCreate
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const customerCreate = z.strictObject({
  name: text(120),
  contactName: text(120).nullable().optional(),
  email,
  phone: text(32).nullable().optional(),
  address: text(2000).nullable().optional(),
  ownerId: id.optional(),
});
export const customerUpdate = customerCreate
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const stages = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'WON',
  'LOST',
] as const;
export const stageBody = z.strictObject({
  stage: z.enum(stages),
  reason: text(2000).optional(),
});
const target = { leadId: id.optional(), customerId: id.optional() };
const exactlyOne = (v: { leadId?: string; customerId?: string }) =>
  Boolean(v.leadId) !== Boolean(v.customerId);
export const activityCreate = z
  .strictObject({
    ...target,
    type: z.enum(['CALL', 'EMAIL', 'MEETING', 'NOTE', 'OTHER']),
    note: text(5000),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .refine(exactlyOne, 'Exactly one target required');
export const followCreate = z
  .strictObject({
    ...target,
    assigneeId: id.optional(),
    note: text(5000),
    dueAt: z.iso.datetime({ offset: true }),
  })
  .refine(exactlyOne, 'Exactly one target required');
export const followStatus = z.strictObject({
  status: z.enum(['COMPLETED', 'CANCELLED']),
});
export const listQuery = z.strictObject({
  search: text(200).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  stage: z.enum(stages).optional(),
  ownerId: id.optional(),
  source: text(80).optional(),
  leadId: id.optional(),
  customerId: id.optional(),
  assigneeId: id.optional(),
  taskStatus: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
  timing: z.enum(['overdue', 'upcoming']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum([
      'createdAt',
      'updatedAt',
      'companyName',
      'name',
      'dueAt',
      'occurredAt',
    ])
    .default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type Actor = { id: string; role: string };
export type Query = z.infer<typeof listQuery>;
export type LeadInput = z.infer<typeof leadCreate>;
export type CustomerInput = z.infer<typeof customerCreate>;
export type ActivityInput = z.infer<typeof activityCreate>;
export type FollowInput = z.infer<typeof followCreate>;
export function allowedStage(from: string, to: string) {
  return (
    (to === 'LOST' && !['WON', 'LOST'].includes(from)) ||
    (
      {
        NEW: 'CONTACTED',
        CONTACTED: 'QUALIFIED',
        QUALIFIED: 'PROPOSAL',
        PROPOSAL: 'WON',
      } as Record<string, string>
    )[from] === to
  );
}

export const emptyBody = z.strictObject({}).default({});

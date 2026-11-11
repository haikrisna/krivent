import { z } from 'zod';
export const id = z.uuid();
export const createOrder = z
  .strictObject({
    customerId: id,
    notes: z.string().trim().max(2000).optional(),
    items: z
      .array(
        z.strictObject({
          productId: id,
          quantity: z.number().int().min(1).max(2147483647),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    'Duplicate product',
  );
export const updateOrder = z.strictObject({
  notes: z.string().trim().max(2000).nullable(),
});
export const cancelOrder = z.strictObject({
  reason: z.string().trim().min(3).max(2000),
});
export const empty = z.strictObject({}).default({});
export const listQuery = z
  .strictObject({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z
      .enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'COMPLETED', 'CANCELLED'])
      .optional(),
    customerId: id.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    sortBy: z
      .enum(['createdAt', 'updatedAt', 'invoiceNumber'])
      .default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to),
    'Invalid date range',
  );
export type CreateOrder = z.infer<typeof createOrder>;
export type ListQuery = z.infer<typeof listQuery>;

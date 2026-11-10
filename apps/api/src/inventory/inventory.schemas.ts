import { z } from 'zod';
export const id = z.uuid();
const quantity = z.number().int().min(0).max(2147483647);
const reason = z.string().trim().min(3).max(2000);
export const keySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export const receiptSchema = z.strictObject({
  productId: id,
  quantity: quantity.min(1),
  reason,
});
export const adjustmentSchema = z.strictObject({
  productId: id,
  countedQuantity: quantity,
  expectedVersion: quantity,
  reason,
});
const base = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  direction: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().min(1).max(200).optional(),
  productId: id.optional(),
};
export const balanceQuery = z.strictObject({
  ...base,
  status: z.enum(['active', 'archived', 'all']).default('active'),
  lowStock: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['name', 'sku', 'stockQuantity', 'createdAt']).default('name'),
});
export const movementQuery = z
  .strictObject({
    ...base,
    actorId: id.optional(),
    type: z
      .enum(['OPENING', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'])
      .optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    sortBy: z
      .enum(['createdAt', 'quantity', 'stockVersion'])
      .default('createdAt'),
  })
  .refine(
    (q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to),
    'from must not exceed to',
  );
export type Receipt = z.infer<typeof receiptSchema>;
export type Adjustment = z.infer<typeof adjustmentSchema>;
export type BalanceQuery = z.infer<typeof balanceQuery>;
export type MovementQuery = z.infer<typeof movementQuery>;

import { z } from 'zod';
// Accept second precision as well as milliseconds; reject implicit local time and invalid calendar dates.
const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => !/\.\d{4,}/.test(v), 'At most milliseconds')
  .optional();
const dates = { from: instant, to: instant };
const paging = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const range = (q: { from?: string; to?: string }) =>
  !q.from || !q.to || new Date(q.from) < new Date(q.to);
export const summaryQuery = z
  .strictObject(dates)
  .refine(range, 'from must precede to');
export const salesQuery = z
  .strictObject({ ...dates, ...paging })
  .refine(range, 'from must precede to');
export const topQuery = z
  .strictObject({
    ...dates,
    ...paging,
    rankBy: z.enum(['quantity', 'value']).default('quantity'),
  })
  .refine(range, 'from must precede to');
export const performanceQuery = z
  .strictObject({ ...dates, ...paging, staffId: z.uuid().optional() })
  .refine(range, 'from must precede to');
export const conversionQuery = salesQuery;
export const inventoryQuery = z
  .strictObject({
    ...dates,
    ...paging,
    view: z.enum(['balances', 'movements']).default('balances'),
    productId: z.uuid().optional(),
    lowStock: z.enum(['true', 'false']).optional(),
    type: z
      .enum(['OPENING', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'])
      .optional(),
  })
  .refine(range, 'from must precede to')
  .refine(
    (q) =>
      q.view === 'movements'
        ? q.lowStock === undefined
        : !q.from && !q.to && !q.type,
    'Dates/type apply to movements; lowStock applies to balances',
  );
export const auditQuery = z
  .strictObject({
    ...dates,
    ...paging,
    actorId: z.uuid().optional(),
    action: z
      .string()
      .regex(/^[A-Z_]+$/)
      .max(80)
      .optional(),
    resourceType: z
      .enum(['USER', 'PRODUCT', 'LEAD', 'STOCK_MOVEMENT', 'SALE'])
      .optional(),
    resourceId: z.uuid().optional(),
  })
  .refine(range, 'from must precede to');
export type Range = z.infer<typeof summaryQuery>;
export type Page = z.infer<typeof salesQuery>;
export type TopQuery = z.infer<typeof topQuery>;
export type PerformanceQuery = z.infer<typeof performanceQuery>;
export type InventoryQuery = z.infer<typeof inventoryQuery>;
export type AuditQuery = z.infer<typeof auditQuery>;

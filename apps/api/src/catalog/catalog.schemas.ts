import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
// Decimal(18,2): at most 16 integral digits. Never coerce money to Number.
export const moneySchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/,
    'Use a nonnegative decimal string, max 16 integral and 2 fractional digits',
  )
  .refine(
    (v) => v.trim() === v,
    'Price must not contain surrounding whitespace',
  );
export const idSchema = z.uuid();
export const categoryCreateSchema = z.strictObject({
  name: text(120),
  description: text(2000).nullable().optional(),
});
export const categoryUpdateSchema = categoryCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const productCreateSchema = z.strictObject({
  categoryId: idSchema,
  sku: text(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .transform((v) => v.toUpperCase()),
  name: text(200),
  description: text(2000).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(2147483647).optional(),
  costPrice: moneySchema,
  sellingPrice: moneySchema,
});
export const productUpdateSchema = productCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
const baseQuery = {
  search: text(200).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  direction: z.enum(['asc', 'desc']).default('asc'),
};
export const categoryQuerySchema = z.strictObject({
  ...baseQuery,
  sortBy: z.enum(['name', 'createdAt']).default('name'),
});
export const productQuerySchema = z
  .strictObject({
    ...baseQuery,
    categoryId: idSchema.optional(),
    sortBy: z
      .enum(['name', 'sku', 'sellingPrice', 'createdAt'])
      .default('name'),
    minPrice: moneySchema.optional(),
    maxPrice: moneySchema.optional(),
  })
  .refine((v) => {
    if (v.minPrice === undefined || v.maxPrice === undefined) return true;
    const minor = (s: string) => {
      const [a, b = ''] = s.split('.');
      return BigInt(a) * 100n + BigInt(b.padEnd(2, '0'));
    };
    return minor(v.minPrice) <= minor(v.maxPrice);
  }, 'minPrice must not exceed maxPrice');
export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;
export type ProductCreate = z.infer<typeof productCreateSchema>;
export type ProductUpdate = z.infer<typeof productUpdateSchema>;
export type CategoryQuery = z.infer<typeof categoryQuerySchema>;
export type ProductQuery = z.infer<typeof productQuerySchema>;

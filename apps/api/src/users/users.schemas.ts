import { z } from 'zod';

// Deliberate business identity rule: ASCII email, trim + lowercase; no provider-specific dot/plus rewriting.
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[\x21-\x7e]+$/)
  .email()
  .transform((v) => v.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (v) => Buffer.byteLength(v, 'utf8') <= 256,
    'Password is too long in bytes',
  )
  .refine((v) => v.trim().length > 0, 'Password must not be blank');
export const roleSchema = z.enum(['ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF']);
export const userCreateSchema = z.strictObject({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: roleSchema.default('SALES_STAFF'),
});
export const userUpdateSchema = userCreateSchema
  .pick({ email: true, name: true, password: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const userStatusSchema = z.strictObject({ isActive: z.boolean() });
export const userRoleSchema = z.strictObject({ role: roleSchema });
export const userQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});
export const bootstrapSchema = userCreateSchema.omit({ role: true });
export type UserCreate = z.infer<typeof userCreateSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;
export type UserQuery = z.infer<typeof userQuerySchema>;

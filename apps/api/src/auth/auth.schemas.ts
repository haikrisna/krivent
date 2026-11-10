import { z } from 'zod';
import { emailSchema } from '../users/users.schemas.js';

export const loginSchema = z.strictObject({
  email: emailSchema,
  // Login accepts legacy short passwords too; only provisioning requires the current strength policy.
  password: z
    .string()
    .min(1)
    .max(128)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 256),
});
export const refreshSchema = z.strictObject({
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type LoginInput = z.infer<typeof loginSchema>;

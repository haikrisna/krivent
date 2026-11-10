import { z } from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          ['postgres:', 'postgresql:'].includes(url.protocol) &&
          Boolean(url.username && url.password && url.pathname.length > 1)
        );
      }, 'Must be a PostgreSQL URL with username, password, and database'),
    FRONTEND_ORIGIN: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname) &&
          url.origin === value
        );
      }, 'Must be an exact local HTTP origin, for example http://localhost:5173')
      .default('http://localhost:5173'),
    AUTH_JWT_SECRET: z
      .string()
      .regex(
        /^[a-fA-F0-9]{64}$/,
        'Generate a 32-byte secret with openssl rand -hex 32',
      )
      .refine(
        (v) => new Set(v.toLowerCase()).size >= 8,
        'Do not use a repeated-character placeholder secret',
      ),
    AUTH_JWT_ISSUER: z.string().url().default('http://localhost:4000'),
    AUTH_JWT_AUDIENCE: z.string().trim().min(1).max(120).default('krivent-api'),
    AUTH_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(900),
    AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_LOGIN_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
    OBSERVE_APP_KEY: z.string().optional(),
    OBSERVE_APP_SECRET: z.string().optional(),
  })
  .refine((env) => env.AUTH_REFRESH_TTL_DAYS <= env.AUTH_SESSION_TTL_DAYS, {
    message: 'Refresh lifetime cannot exceed session lifetime',
    path: ['AUTH_REFRESH_TTL_DAYS'],
  })
  .refine(
    (env) => Boolean(env.OBSERVE_APP_KEY) === Boolean(env.OBSERVE_APP_SECRET),
    {
      message: 'Configure both Observe keys or neither',
      path: ['OBSERVE_APP_KEY'],
    },
  );

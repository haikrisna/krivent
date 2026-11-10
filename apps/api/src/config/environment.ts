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
    OBSERVE_APP_KEY: z.string().optional(),
    OBSERVE_APP_SECRET: z.string().optional(),
  })
  .refine(
    (env) => Boolean(env.OBSERVE_APP_KEY) === Boolean(env.OBSERVE_APP_SECRET),
    {
      message: 'Configure both Observe keys or neither',
      path: ['OBSERVE_APP_KEY'],
    },
  );

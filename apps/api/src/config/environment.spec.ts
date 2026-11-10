import { environmentSchema } from './environment.js';

const valid = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/krivent',
};

describe('environment configuration', () => {
  it('defaults to port 4000 and the exact local frontend origin', () => {
    const env = environmentSchema.parse(valid);
    expect(env.PORT).toBe(4000);
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost:5173');
  });

  it.each([
    {},
    { ...valid, DATABASE_URL: 'mysql://user:secret@localhost/db' },
    { ...valid, DATABASE_URL: 'postgresql://localhost/db' },
    { ...valid, PORT: '0' },
    { ...valid, PORT: '65536' },
    { ...valid, FRONTEND_ORIGIN: '*' },
    { ...valid, FRONTEND_ORIGIN: 'https://example.com' },
    { ...valid, FRONTEND_ORIGIN: 'http://localhost:5173/path' },
    { ...valid, OBSERVE_APP_KEY: 'key' },
  ])('rejects invalid or incomplete settings %#', (env) => {
    expect(environmentSchema.safeParse(env).success).toBe(false);
  });
});

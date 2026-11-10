import { randomBytes } from 'node:crypto';
import { PasswordService } from './password.service.js';

describe('Argon2id credentials', () => {
  const service = new PasswordService();
  const password = randomBytes(24).toString('base64url');
  beforeAll(() => service.onModuleInit());
  it('uses Argon2id and an independent random salt for each hash', async () => {
    const first = await service.hash(password);
    const second = await service.hash(password);
    expect(first.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(first !== second).toBe(true);
    expect(await service.verify(first, password)).toBe(true);
  });
  it('rejects an incorrect password', async () => {
    expect(
      await service.verify(await service.hash(password), `${password}-wrong`),
    ).toBe(false);
  });
  it('rejects nonexistent/legacy malformed credentials with a dummy hash check', async () => {
    for (const hash of [undefined, 'legacy-placeholder', '$argon2id$malformed'])
      expect(await service.verify(hash, password)).toBe(false);
  });
  it('preserves spaces in passwords rather than silently trimming credentials', async () => {
    const hash = await service.hash(` ${password} `);
    expect(await service.verify(hash, ` ${password} `)).toBe(true);
    expect(await service.verify(hash, password)).toBe(false);
  });
});

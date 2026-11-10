import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  // OWASP Argon2id minimum: 19 MiB, 2 iterations, parallelism 1.
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  } as const;
  private dummyHash: string;
  async onModuleInit() {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64url'));
  }
  hash(password: string) {
    return argon2.hash(password, this.options);
  }
  async verify(hash: string | undefined, password: string): Promise<boolean> {
    // Unknown accounts and malformed legacy hashes still perform a real Argon2id check.
    const validFormat = hash?.startsWith('$argon2id$') ?? false;
    try {
      return (
        (await argon2.verify(validFormat ? hash! : this.dummyHash, password)) &&
        validFormat
      );
    } catch {
      await argon2.verify(this.dummyHash, password);
      return false;
    }
  }
}

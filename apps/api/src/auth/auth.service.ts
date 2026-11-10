import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtSigner } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';
import { jwtOptions } from './jwt.options.js';
import type { LoginInput } from './auth.schemas.js';

const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const DAY = 86400000;

@Injectable()
export class AuthService {
  private readonly signer: JwtSigner;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.signer = new JwtSigner(jwtOptions(config));
  }

  private pair(userId: string, sessionId: string, refreshToken: string) {
    return {
      accessToken: this.signer.sign({ sub: userId, sid: sessionId }),
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: this.config.getOrThrow<number>('AUTH_ACCESS_TTL_SECONDS'),
    };
  }
  private tokenExpiry(now: Date, sessionExpiry: Date) {
    return new Date(
      Math.min(
        now.getTime() +
          this.config.getOrThrow<number>('AUTH_REFRESH_TTL_DAYS') * DAY,
        sessionExpiry.getTime(),
      ),
    );
  }

  async login(input: LoginInput) {
    // Matches the expression unique index, including legacy whitespace/casing. No email rewriting in migration.
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE lower(btrim(email)) = ${input.email}
    `;
    const user = rows[0]
      ? await this.prisma.user.findUnique({ where: { id: rows[0].id } })
      : null;
    const valid = await this.passwords.verify(
      user?.passwordHash,
      input.password,
    );
    if (!user || !valid || !user.isActive)
      throw new UnauthorizedException('Invalid email or password');
    const raw = newToken();
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      // A password/status change racing verification must not mint a new valid session.
      if (!current?.isActive || current.passwordHash !== user.passwordHash)
        return null;
      const now = new Date();
      const created = await tx.authSession.create({
        data: {
          userId: user.id,
          createdAt: now,
          expiresAt: new Date(
            now.getTime() +
              this.config.getOrThrow<number>('AUTH_SESSION_TTL_DAYS') * DAY,
          ),
        },
      });
      await tx.refreshToken.create({
        data: {
          hash: digest(raw),
          sessionId: created.id,
          createdAt: now,
          expiresAt: this.tokenExpiry(now, created.expiresAt),
        },
      });
      return created;
    });
    if (!session) throw new UnauthorizedException('Invalid email or password');
    return this.pair(user.id, session.id, raw);
  }

  async refresh(raw: string) {
    const hash = digest(raw);
    const known = await this.prisma.refreshToken.findUnique({
      where: { hash },
      select: { sessionId: true, session: { select: { userId: true } } },
    });
    if (!known) throw new UnauthorizedException('Invalid refresh token');
    const next = newToken();
    const result = await this.prisma.$transaction(async (tx) => {
      // Same lock order as user-management: user first, then session. All refreshes of one family serialize.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${known.session.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${known.sessionId}::uuid FOR UPDATE`;
      const token = await tx.refreshToken.findUnique({
        where: { hash },
        include: {
          session: { include: { user: { select: { isActive: true } } } },
        },
      });
      const now = new Date();
      if (
        !token ||
        token.session.revokedAt ||
        !token.session.user.isActive ||
        token.session.expiresAt <= now
      )
        return null;
      if (token.usedAt) {
        await tx.authSession.update({
          where: { id: token.sessionId },
          data: { revokedAt: now },
        });
        // Return a sentinel: throwing here would roll back the security-critical revocation.
        return null;
      }
      if (token.expiresAt <= now) return null;
      const claimed = await tx.refreshToken.updateMany({
        where: { hash, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        await tx.authSession.update({
          where: { id: token.sessionId },
          data: { revokedAt: now },
        });
        return null;
      }
      await tx.refreshToken.create({
        data: {
          hash: digest(next),
          sessionId: token.sessionId,
          createdAt: now,
          expiresAt: this.tokenExpiry(now, token.session.expiresAt),
        },
      });
      return { userId: token.session.userId, sessionId: token.sessionId };
    });
    if (!result) throw new UnauthorizedException('Invalid refresh token');
    return this.pair(result.userId, result.sessionId, next);
  }

  async logout(userId: string, sessionId: string) {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  publicUserSelect,
  type AuthenticatedUser,
} from '../users/user.select.js';

@Injectable()
export class JwtAuthProvider extends JwtBearerProvider<AuthenticatedUser> {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthenticationRegistry) registry: AuthenticationRegistry,
  ) {
    super({ realm: 'krivent', algorithms: ['HS256'], type: 'at+jwt' });
    registry.registerProvider(this);
  }
  async validate(claims: JwtClaims): Promise<AuthenticatedUser | null> {
    if (
      !z.uuid().safeParse(claims.sub).success ||
      !z.uuid().safeParse(claims.sid).success
    )
      return null;
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sid as string,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      select: { id: true, user: { select: publicUserSelect } },
    });
    return session ? { ...session.user, sessionId: session.id } : null;
  }
}

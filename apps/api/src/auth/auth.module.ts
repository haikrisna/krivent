import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PasswordModule } from '../security/password.module.js';
import { jwtOptions } from './jwt.options.js';
import { JwtAuthProvider } from './jwt-auth.provider.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { RbacModule } from './rbac.module.js';

@Module({
  imports: [
    PrismaModule,
    PasswordModule,
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        accessToken: jwtOptions(config),
        // JWT verification/guard are first-party; refresh families use our atomic Prisma transaction below.
        refreshToken: false,
      }),
    }),
    RbacModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { ttl: 60000, limit: config.getOrThrow<number>('AUTH_LOGIN_LIMIT') },
        ],
        // Direct peer only; forwarding headers cannot manufacture new rate-limit identities.
        getTracker: (req) => req.socket.remoteAddress ?? 'unknown',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthProvider, AuthService],
})
export class AuthModule {}

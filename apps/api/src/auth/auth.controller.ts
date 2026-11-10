import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { loginSchema, refreshSchema, type LoginInput } from './auth.schemas.js';
import { presentUser, type AuthenticatedUser } from '../users/user.select.js';
import { IdentityOperation } from '../users/identity.swagger.js';

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  @IdentityOperation('login')
  async login(@Body({ schema: loginSchema }) body: LoginInput) {
    return { data: await this.auth.login(body) };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(200)
  @IdentityOperation('refresh')
  async refresh(
    @Body({ schema: refreshSchema }) body: { refreshToken: string },
  ) {
    return { data: await this.auth.refresh(body.refreshToken) };
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(204)
  @IdentityOperation('logout')
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(user.id, user.sessionId);
  }

  @ApiBearerAuth('access-token')
  @Get('me')
  @IdentityOperation('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { data: presentUser(user) };
  }
}

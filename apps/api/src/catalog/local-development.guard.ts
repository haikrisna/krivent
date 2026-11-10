import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class LocalDevelopmentGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const address = request.socket.remoteAddress;
    if (
      this.config.get<string>('NODE_ENV') !== 'development' ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')
    ) {
      throw new ForbiddenException(
        'Catalog is available only in local development until authentication is implemented',
      );
    }
    return true;
  }
}

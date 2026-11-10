import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

@Catch()
export class CatalogErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500;
    let message: string | object = 'Internal server error';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | object }).message ?? body);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const errors: Record<string, [number, string]> = {
        P2002: [409, 'SKU or category name already exists'],
        P2003: [409, 'Referenced record prevents this operation'],
        P2025: [404, 'Record not found'],
        P2034: [409, 'Concurrent change; retry the request'],
        P2024: [503, 'Database temporarily unavailable'],
        P1001: [503, 'Database temporarily unavailable'],
      };
      [status, message] = errors[error.code] ?? [500, 'Internal server error'];
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, message });
  }
}

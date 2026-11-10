import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { listQuery } from './crm.schemas.js';
export const CrmBody = (schema: z.ZodType, example: object) =>
  ApiBody({
    schema: {
      ...(z.toJSONSchema(schema, {
        io: 'input',
        target: 'openapi-3.0',
      }) as SchemaObject),
      example,
    },
  });
export function CrmQueries(
  kind: 'leads' | 'customers' | 'activities' | 'follow-ups',
) {
  const common = ['status', 'page', 'pageSize', 'sortBy', 'direction'];
  const fields = {
    leads: ['search', 'ownerId', 'source', 'stage'],
    customers: ['search', 'ownerId'],
    activities: ['search', 'ownerId', 'leadId', 'customerId'],
    'follow-ups': [
      'ownerId',
      'leadId',
      'customerId',
      'assigneeId',
      'taskStatus',
      'timing',
    ],
  }[kind];
  const json = z.toJSONSchema(listQuery, {
    io: 'input',
    target: 'openapi-3.0',
  });
  return applyDecorators(
    ...[...common, ...fields].map((name) =>
      ApiQuery({
        name,
        required: false,
        schema: json.properties![name] as SchemaObject,
      }),
    ),
    ...[400, 401, 403, 404, 409].map((status) =>
      ApiResponse({
        status,
        description:
          status === 404
            ? 'Record unavailable within current ownership scope'
            : 'See standard { statusCode, message } error contract',
      }),
    ),
  );
}

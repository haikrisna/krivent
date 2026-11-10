import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';

const role: SchemaObject = {
  type: 'string',
  enum: ['ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF'],
  example: 'SALES_STAFF',
};
const email: SchemaObject = {
  type: 'string',
  format: 'email',
  maxLength: 254,
  example: 'sales@example.test',
};
const name: SchemaObject = {
  type: 'string',
  minLength: 1,
  maxLength: 120,
  example: 'Sales Nusa',
};
const password: SchemaObject = {
  type: 'string',
  format: 'password',
  writeOnly: true,
  minLength: 12,
  maxLength: 128,
  description:
    '12–128 characters, max 256 UTF-8 bytes; never trim the password',
};
const id: SchemaObject = { type: 'string', format: 'uuid' };
const user: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'email',
    'name',
    'role',
    'isActive',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id,
    email,
    name,
    role,
    isActive: { type: 'boolean', example: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
const tokens: SchemaObject = {
  type: 'object',
  properties: {
    accessToken: {
      type: 'string',
      description: 'JWT access token; send in Authorization: Bearer header',
    },
    refreshToken: {
      type: 'string',
      minLength: 43,
      maxLength: 43,
      description:
        'Opaque single-use token; replace the previous token after every refresh',
    },
    tokenType: { type: 'string', example: 'Bearer' },
    expiresIn: {
      type: 'integer',
      example: 900,
      description: 'Access token lifetime, seconds',
    },
  },
};
type Operation =
  | 'login'
  | 'refresh'
  | 'logout'
  | 'me'
  | 'list'
  | 'detail'
  | 'create'
  | 'update'
  | 'status'
  | 'role';
export function IdentityOperation(action: Operation) {
  const decorators = [
    ApiOperation({
      summary: `${action} ${['login', 'refresh', 'logout'].includes(action) ? 'authentication' : 'user'}`,
      description:
        'Responses are non-cacheable. User management requires Admin. No public self-registration.',
    }),
  ];
  const status = action === 'create' ? 201 : action === 'logout' ? 204 : 200;
  const entity = ['login', 'refresh'].includes(action) ? tokens : user;
  decorators.push(
    ApiResponse({
      status,
      ...(status === 204
        ? { description: 'Current session revoked; no response body' }
        : {
            schema:
              action === 'list'
                ? {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: user },
                      meta: {
                        type: 'object',
                        properties: {
                          page: { type: 'integer', example: 1 },
                          pageSize: { type: 'integer', example: 20 },
                          total: { type: 'integer', example: 1 },
                          totalPages: { type: 'integer', example: 1 },
                        },
                      },
                    },
                  }
                : { type: 'object', properties: { data: entity } },
          }),
    }),
  );
  for (const [code, message] of [
    [400, 'Invalid input'],
    [401, 'Authentication failed or session expired/revoked'],
    [403, 'Insufficient permissions'],
    [404, 'User not found'],
    [409, 'Unique value or Admin safety rule conflict'],
    [429, 'Too many requests'],
    [500, 'Internal server error'],
    [503, 'Database temporarily unavailable'],
  ] as const)
    decorators.push(
      ApiResponse({
        status: code,
        description: message,
        schema: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer', example: code },
            message: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'object' } },
              ],
              example: message,
            },
          },
        },
      }),
    );
  const bodies: Partial<Record<Operation, SchemaObject>> = {
    login: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'password'],
      properties: { email, password: { ...password, minLength: 1 } },
    },
    refresh: {
      type: 'object',
      additionalProperties: false,
      required: ['refreshToken'],
      properties: {
        refreshToken: {
          type: 'string',
          pattern: '^[A-Za-z0-9_-]{43}$',
          writeOnly: true,
        },
      },
    },
    create: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'name', 'password'],
      properties: { email, name, password, role },
    },
    update: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: { email, name, password },
    },
    status: {
      type: 'object',
      additionalProperties: false,
      required: ['isActive'],
      properties: { isActive: { type: 'boolean' } },
    },
    role: {
      type: 'object',
      additionalProperties: false,
      required: ['role'],
      properties: { role },
    },
  };
  if (bodies[action]) decorators.push(ApiBody({ schema: bodies[action]! }));
  if (['detail', 'update', 'status', 'role'].includes(action))
    decorators.push(ApiParam({ name: 'id', schema: id }));
  if (action === 'list')
    for (const [name, schema] of Object.entries({
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      search: { type: 'string', maxLength: 120 },
      role,
      status: {
        type: 'string',
        enum: ['active', 'inactive', 'all'],
        default: 'all',
      },
    } satisfies Record<string, SchemaObject>))
      decorators.push(ApiQuery({ name, required: false, schema }));
  return applyDecorators(...decorators);
}

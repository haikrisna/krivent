import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';

const id = {
  type: 'string',
  format: 'uuid',
  example: 'a1b2c3d4-1111-4111-8111-123456789abc',
};
const price = {
  type: 'string',
  pattern: '^(0|[1-9][0-9]{0,15})(\\.[0-9]{1,2})?$',
  example: '1250000.00',
};
const categoryProperties = {
  name: { type: 'string', minLength: 1, maxLength: 120, example: 'Laptop' },
  description: {
    type: 'string',
    nullable: true,
    maxLength: 2000,
    example: 'Perangkat elektronik bisnis',
  },
};
const productProperties = {
  categoryId: id,
  sku: {
    type: 'string',
    maxLength: 64,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
    example: 'NB-LEN-001',
  },
  name: {
    type: 'string',
    minLength: 1,
    maxLength: 200,
    example: 'ThinkPad E14',
  },
  description: categoryProperties.description,
  lowStockThreshold: {
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
    example: 10,
  },
  costPrice: price,
  sellingPrice: { ...price, example: '1500000.00' },
};
export function CatalogOperation(
  kind: 'category' | 'product',
  action: 'create' | 'update' | 'detail' | 'list' | 'archive',
) {
  const properties =
    kind === 'category' ? categoryProperties : productProperties;
  const entity = {
    type: 'object',
    properties: {
      id,
      ...properties,
      isActive: { type: 'boolean', example: action !== 'archive' },
      ...(kind === 'product'
        ? { stockQuantity: { type: 'integer', readOnly: true, example: 0 } }
        : {}),
      createdAt: {
        type: 'string',
        format: 'date-time',
        example: '2026-11-10T04:00:00.000Z',
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
        example: '2026-11-10T04:00:00.000Z',
      },
    },
  };
  const decorators = [
    ApiOperation({
      summary: `${action} ${kind}`,
      description:
        'Bearer access token required. Admin/Warehouse may create/update; only Admin may archive. Archive is terminal and preserves references. Money is a decimal string in IDR.',
    }),
    ApiResponse({
      status: action === 'create' ? 201 : 200,
      schema:
        action === 'list'
          ? {
              type: 'object',
              properties: {
                data: { type: 'array', items: entity },
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
  ];
  for (const [status, message] of [
    [400, 'Invalid input'],
    [401, 'Authentication required'],
    [403, 'Insufficient permissions'],
    [404, 'Record not found'],
    [409, 'Duplicate or archived record'],
    [500, 'Internal server error'],
    [503, 'Database temporarily unavailable'],
  ] as const) {
    decorators.push(
      ApiResponse({
        status,
        description: message,
        schema: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer', example: status },
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
  }
  if (action === 'create' || action === 'update')
    decorators.push(
      ApiBody({
        schema: {
          type: 'object',
          additionalProperties: false,
          properties,
          ...(action === 'create'
            ? {
                required: Object.keys(properties).filter(
                  (k) => k !== 'description',
                ),
              }
            : { minProperties: 1 }),
        },
      }),
    );
  if (!['create', 'list'].includes(action))
    decorators.push(ApiParam({ name: 'id', schema: id }));
  if (action === 'list') {
    for (const [name, schema] of Object.entries({
      search: { type: 'string', maxLength: 200 },
      status: {
        type: 'string',
        enum: ['active', 'archived', 'all'],
        default: 'active',
      },
      page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      sortBy: {
        type: 'string',
        enum:
          kind === 'product'
            ? ['name', 'sku', 'sellingPrice', 'createdAt']
            : ['name', 'createdAt'],
        default: 'name',
      },
      direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      ...(kind === 'product'
        ? { categoryId: id, minPrice: price, maxPrice: price }
        : {}),
    }))
      decorators.push(ApiQuery({ name, required: false, schema }));
  }
  return applyDecorators(...decorators);
}

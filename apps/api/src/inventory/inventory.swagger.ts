import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
export const InventoryBody = (schema: z.ZodType, example: object) =>
  applyDecorators(
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        '8–128 letters/digits/._:-; actor-scoped, permanent. Reuse with different payload returns 409.',
      example: 'receipt-PO-2026-001',
    }),
    ApiBody({
      schema: {
        ...(z.toJSONSchema(schema, {
          io: 'input',
          target: 'openapi-3.0',
        }) as SchemaObject),
        example,
      },
    }),
  );
const movement: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    createdById: { type: 'string', format: 'uuid' },
    type: {
      type: 'string',
      enum: ['OPENING', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'],
      example: 'PURCHASE',
    },
    quantity: { type: 'integer', example: 24 },
    notes: {
      type: 'string',
      nullable: true,
      example: 'Terima 24 router, PO-2026-001',
    },
    beforeBalance: { type: 'integer', nullable: true, example: 0 },
    afterBalance: { type: 'integer', nullable: true, example: 24 },
    stockVersion: { type: 'integer', nullable: true, example: 1 },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
const balance: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    sku: { type: 'string', example: 'RTR-AX3000' },
    name: { type: 'string', example: 'Router AX3000' },
    isActive: { type: 'boolean' },
    stockQuantity: { type: 'integer', example: 24 },
    stockVersion: { type: 'integer', example: 1 },
    lowStockThreshold: { type: 'integer', example: 10 },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export const InventoryResponse = (
  status: number,
  list = false,
  balances = false,
) =>
  ApiResponse({
    status,
    description: list
      ? 'Snapshot list and total; deterministic secondary ordering by id'
      : 'Movement; replay returns the original movement with the same status',
    schema: {
      type: 'object',
      properties: {
        data: list
          ? { type: 'array', items: balances ? balance : movement }
          : movement,
        ...(list
          ? {
              meta: {
                type: 'object',
                properties: Object.fromEntries(
                  ['page', 'pageSize', 'total', 'totalPages'].map((k) => [
                    k,
                    { type: 'integer' },
                  ]),
                ),
              },
            }
          : {}),
      },
    },
  });
export const InventoryErrors = () =>
  applyDecorators(
    ...[
      [400, 'Invalid body, query, UUID or missing/invalid idempotency key'],
      [401, 'Authentication required'],
      [403, 'Role does not permit this operation'],
      [404, 'Product or movement not found'],
      [
        409,
        'Archived product, stale version, unchanged count, overflow or reused key',
      ],
      [500, 'Internal server error'],
    ].map(([status, description]) =>
      ApiResponse({
        status: Number(status),
        description: String(description),
        schema: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            message: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'object' } },
              ],
            },
          },
        },
      }),
    ),
  );
export const InventoryQueries = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0' });
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, value]) =>
      ApiQuery({ name, required: false, schema: value as SchemaObject }),
    ),
  );
};

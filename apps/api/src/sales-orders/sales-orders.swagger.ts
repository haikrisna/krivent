import { applyDecorators } from '@nestjs/common';
import { ApiQuery, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { listQuery } from './sales-orders.schemas.js';
export function OrderQueries() {
  const json = z.toJSONSchema(listQuery, {
    io: 'input',
    target: 'openapi-3.0',
  });
  return applyDecorators(
    ...Object.entries(json.properties!).map(([name, schema]) =>
      ApiQuery({ name, required: false, schema: schema as SchemaObject }),
    ),
  );
}
export function OrderDocs(status: number, list = false) {
  return applyDecorators(
    ApiResponse({
      status,
      description:
        'Warehouse receives operational projection only; prices serialize as Decimal strings.',
      schema: {
        type: 'object',
        properties: {
          data: list
            ? { type: 'array', items: { type: 'object' } }
            : { type: 'object' },
          ...(list ? { meta: { type: 'object' } } : {}),
        },
        example: list
          ? {
              data: [],
              meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
            }
          : {
              data: {
                id: '00000000-0000-4000-8000-000000000001',
                invoiceNumber: 'SO-uuid',
                status: 'DRAFT',
                totalAmount: '300.00',
                items: [
                  {
                    productId: '00000000-0000-4000-8000-000000000002',
                    quantity: 2,
                    unitPrice: '150.00',
                  },
                ],
              },
            },
      },
    }),
    ...[400, 401, 403, 404, 409].map((status) =>
      ApiResponse({
        status,
        description:
          'Standard {statusCode,message}: invalid input / unauthenticated / forbidden role / outside scope / invalid state, archived, insufficient stock or key conflict',
      }),
    ),
  );
}

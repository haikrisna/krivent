import { reportResponse } from './reporting.responses.js';
import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
export function ReportOperation(
  summary: string,
  schema: z.ZodType,
  description: string,
) {
  const json = z.toJSONSchema(schema, { io: 'input' }) as {
    properties?: Record<string, object>;
  };
  return applyDecorators(
    ApiOperation({
      summary,
      description:
        description +
        ' Date ranges are [from,to), ISO 8601 with explicit offset, at most milliseconds. UTC day buckets. Omitted bounds are unbounded. Money is an exact decimal string (IDR). Pagination: {data,meta:{page,pageSize,total,totalPages}}. Stable documented order.',
    }),
    ...Object.entries(json.properties ?? {}).map(([name, property]) =>
      ApiQuery({ name, required: false, schema: property }),
    ),
    ApiResponse({
      status: 200,
      description: 'Report result',
      schema: reportResponse(summary),
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid filters, date range or pagination',
    }),
    ApiResponse({ status: 401, description: 'Authentication required' }),
    ApiResponse({
      status: 403,
      description: 'Role or requested staff scope forbidden',
    }),
  );
}

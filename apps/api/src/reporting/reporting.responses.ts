// OpenAPI response contracts for SQL aggregates and bounded event projections.
const uuid = { type: 'string', format: 'uuid' };
const text = { type: 'string' };
const time = { type: 'string', format: 'date-time' };
const integer = { type: 'integer', minimum: 0 };
const money = {
  type: 'string',
  pattern: '^\\d+\\.\\d{2}$',
  example: '1500000.10',
  description: 'Exact IDR amount, two decimal places',
};
const quantity = {
  type: 'string',
  pattern: '^-?\\d+$',
  description: 'Exact integer aggregate serialized as string',
};
const object = (properties: Record<string, object>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
});
const array = (items: object) => ({ type: 'array', items });
const meta = object({
  page: integer,
  pageSize: integer,
  total: integer,
  totalPages: integer,
});
export function reportResponse(summary: string): object {
  if (summary === 'Role-scoped dashboard') {
    return {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          description:
            'Properties are included only for authorized domains. Admin receives all; Sales omit inventory; Warehouse receive only lowStockProducts and recentInventoryEvents.',
          properties: {
            activeCustomers: integer,
            activeLeads: integer,
            pipeline: array(object({ stage: text, count: integer })),
            ordersByStatus: array(
              object({
                status: text,
                orderCount: integer,
                orderedValue: money,
              }),
            ),
            realizedSales: object({ orderCount: integer, total: money }),
            lowStockProducts: integer,
            recentActivity: array(
              object({
                id: uuid,
                leadId: { ...uuid, nullable: true },
                customerId: { ...uuid, nullable: true },
                type: text,
                occurredAt: time,
              }),
            ),
            recentInventoryEvents: array(
              object({
                id: uuid,
                productId: uuid,
                type: text,
                quantity: { type: 'integer' },
                createdAt: time,
              }),
            ),
          },
        },
      },
    };
  }
  let row: object;
  let extras: Record<string, object> = {};
  switch (summary) {
    case 'Realized sales by UTC day':
      row = object({
        date: { type: 'string', format: 'date' },
        orderCount: integer,
        realizedSales: money,
      });
      break;
    case 'Best-selling products':
      row = object({
        productId: uuid,
        sku: text,
        name: text,
        quantity,
        value: money,
      });
      break;
    case 'Sales performance by order creator':
      row = object({
        staffId: uuid,
        name: text,
        orderCount: integer,
        realizedSales: money,
      });
      break;
    case 'Lead creation cohort conversion':
      row = object({ stage: text, count: integer });
      extras = {
        summary: object({
          leadCount: integer,
          convertedCount: integer,
          conversionRate: {
            ...money,
            description: 'Converted / cohort leads × 100, two decimal percent',
            example: '33.33',
          },
        }),
      };
      break;
    case 'Inventory balances and movements':
      row = {
        oneOf: [
          object({
            productId: uuid,
            sku: text,
            name: text,
            stockQuantity: integer,
            lowStockThreshold: integer,
          }),
          object({
            id: uuid,
            productId: uuid,
            type: text,
            quantity: { type: 'integer' },
            beforeBalance: { type: 'integer', nullable: true },
            afterBalance: { type: 'integer', nullable: true },
            createdAt: time,
          }),
        ],
      };
      extras = {
        summary: object({
          activeProducts: integer,
          lowStockProducts: integer,
          stockQuantity: quantity,
        }),
        movements: array(
          object({ type: text, count: integer, netQuantity: quantity }),
        ),
      };
      break;
    default:
      row = object({
        id: uuid,
        actorId: uuid,
        action: text,
        resourceType: text,
        resourceId: uuid,
        createdAt: time,
        requestId: { ...uuid, nullable: true },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description:
            'Allowlisted changed scalar fields only; no free text or request body',
        },
      });
  }
  return {
    type: 'object',
    required: [
      'data',
      'meta',
      ...(summary === 'Lead creation cohort conversion' ||
      summary === 'Inventory balances and movements'
        ? ['summary']
        : []),
    ],
    properties: { data: array(row), meta, ...extras },
  };
}

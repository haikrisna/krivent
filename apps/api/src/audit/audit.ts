import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../generated/prisma/client.js';
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
// Only these structured fields can reach storage. Free text and request bodies are excluded.
const safeFields = new Set([
  'role',
  'isActive',
  'costPrice',
  'sellingPrice',
  'stage',
  'status',
  'customerId',
  'productId',
  'quantity',
  'beforeBalance',
  'afterBalance',
]);
export function safeMetadata(
  input: Record<string, unknown>,
): Prisma.InputJsonObject {
  const output: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!safeFields.has(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      output[key] = value;
  }
  return output;
}
export function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  return tx.auditLog.create({
    data: {
      actorId,
      action,
      resourceType,
      resourceId,
      metadata: safeMetadata(metadata),
      requestId: requestContext.getStore()?.requestId,
    },
  });
}

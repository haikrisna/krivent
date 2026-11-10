import { randomUUID } from 'node:crypto';
import {
  adjustmentSchema,
  receiptSchema,
  movementQuery,
  keySchema,
} from './inventory.schemas.js';
describe('Inventory domain input contracts', () => {
  const productId = randomUUID();
  it('requires absolute count and version rather than arbitrary deductions', () => {
    expect(
      adjustmentSchema.parse({
        productId,
        countedQuantity: 0,
        expectedVersion: 3,
        reason: '  Stock opname  ',
      }),
    ).toEqual({
      productId,
      countedQuantity: 0,
      expectedVersion: 3,
      reason: 'Stock opname',
    });
    expect(
      adjustmentSchema.safeParse({ productId, quantity: -10, reason: 'Damage' })
        .success,
    ).toBe(false);
  });
  it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER, Infinity, NaN, '10'])(
    'rejects invalid receipt quantity %s',
    (quantity) => {
      expect(
        receiptSchema.safeParse({
          productId,
          quantity,
          reason: 'Goods received',
        }).success,
      ).toBe(false);
    },
  );
  it('accepts PostgreSQL integer limits and refuses mass assignment', () => {
    expect(
      receiptSchema.safeParse({
        productId,
        quantity: 2147483647,
        reason: 'Goods received',
      }).success,
    ).toBe(true);
    expect(
      receiptSchema.safeParse({
        productId,
        quantity: 1,
        reason: 'Goods received',
        createdById: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('requires timezone and ordered date bounds', () => {
    expect(
      movementQuery.safeParse({ from: '2026-01-01T00:00:00' }).success,
    ).toBe(false);
    expect(
      movementQuery.safeParse({
        from: '2026-01-02T00:00:00Z',
        to: '2026-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      movementQuery.parse({ from: '2026-01-01T07:00:00+07:00' }).pageSize,
    ).toBe(20);
  });
  it.each(['short', 'key with spaces', 'a'.repeat(129), '', 'key/with/slash'])(
    'rejects unsafe or unbounded key %s',
    (key) => {
      expect(keySchema.safeParse(key).success).toBe(false);
    },
  );
});

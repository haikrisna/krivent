import { randomUUID } from 'node:crypto';
import {
  createOrder,
  listQuery,
  updateOrder,
  cancelOrder,
} from './sales-orders.schemas.js';
describe('sales order validation', () => {
  const productId = randomUUID();
  const valid = {
    customerId: randomUUID(),
    items: [{ productId, quantity: 2 }],
  };
  it('accepts minimal order', () =>
    expect(createOrder.safeParse(valid).success).toBe(true));
  it.each([0, -1, 1.2, '2', 2147483648])('rejects quantity %s', (quantity) =>
    expect(
      createOrder.safeParse({ ...valid, items: [{ productId, quantity }] })
        .success,
    ).toBe(false),
  );
  it('rejects empty and duplicate lines', () => {
    expect(createOrder.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(
      createOrder.safeParse({
        ...valid,
        items: [...valid.items, ...valid.items],
      }).success,
    ).toBe(false);
  });
  it('rejects injected totals and price', () => {
    expect(createOrder.safeParse({ ...valid, totalAmount: 1 }).success).toBe(
      false,
    );
    expect(
      createOrder.safeParse({
        ...valid,
        items: [{ ...valid.items[0], unitPrice: 1 }],
      }).success,
    ).toBe(false);
  });
  it('restricts patch and requires cancellation reason', () => {
    expect(updateOrder.safeParse({ status: 'COMPLETED' }).success).toBe(false);
    expect(cancelOrder.safeParse({ reason: ' ' }).success).toBe(false);
  });
  it('validates dates and pagination', () => {
    expect(
      listQuery.safeParse({
        from: '2030-01-01T00:00:00Z',
        to: '2020-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(listQuery.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});

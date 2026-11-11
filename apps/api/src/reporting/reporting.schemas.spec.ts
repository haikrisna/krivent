import {
  summaryQuery,
  salesQuery,
  inventoryQuery,
  topQuery,
  auditQuery,
} from './reporting.schemas.js';
import { safeMetadata } from '../audit/audit.js';
describe('Phase 7 report input and audit redaction', () => {
  it.each([
    { from: '2026-11-01' },
    { from: '2026-11-01T00:00:00' },
    { from: '2026-02-30T00:00:00Z' },
    { from: '2026-11-01T00:00:00.1234Z' },
    { from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' },
    { from: '2026-11-01T00:00:00Z', to: '2026-11-01T07:00:00+07:00' },
    { ownerId: 'forged' },
  ])('rejects invalid or ambiguous date/scope input %#', (q) => {
    expect(summaryQuery.safeParse(q).success).toBe(false);
  });
  it('accepts equivalent offset instants and bounded pagination', () => {
    expect(
      salesQuery.parse({
        from: '2026-11-01T07:00:00+07:00',
        to: '2026-11-02T00:00:00.000Z',
        pageSize: '100',
      }).pageSize,
    ).toBe(100);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: '1.2' },
    { page: '' },
    { page: 100001 },
  ])('rejects pagination %#', (q) => {
    expect(salesQuery.safeParse(q).success).toBe(false);
  });
  it('rejects unsupported sort and contradictory inventory filters', () => {
    expect(topQuery.safeParse({ rankBy: 'sql' }).success).toBe(false);
    expect(
      inventoryQuery.safeParse({ from: '2026-11-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(
      inventoryQuery.safeParse({ view: 'movements', lowStock: 'true' }).success,
    ).toBe(false);
    expect(auditQuery.safeParse({ action: 'DROP TABLE' }).success).toBe(false);
  });
  it('stores only allowlisted scalars, never nested secrets, headers or free text', () => {
    expect(
      safeMetadata({
        role: 'ADMIN',
        isActive: false,
        status: { password: 'secret' },
        password: 'secret',
        passwordHash: 'hash',
        accessToken: 'token',
        refreshToken: 'token',
        authorization: 'Bearer secret',
        headers: { cookie: 'secret' },
        notes: 'secret',
        requestHash: 'secret',
        sellingPrice: '0.10',
        customerId: null,
      }),
    ).toEqual({
      role: 'ADMIN',
      isActive: false,
      sellingPrice: '0.10',
      customerId: null,
    });
  });
});

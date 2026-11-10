import {
  allowedStage,
  leadCreate,
  activityCreate,
  followCreate,
  listQuery,
} from './crm.schemas.js';
describe('CRM lifecycle and strict schemas', () => {
  const stages = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];
  it.each(stages.flatMap((from) => stages.map((to) => [from, to])))(
    '%s -> %s follows explicit graph',
    (from, to) => {
      const edges = [
        'NEW:CONTACTED',
        'CONTACTED:QUALIFIED',
        'QUALIFIED:PROPOSAL',
        'PROPOSAL:WON',
        'NEW:LOST',
        'CONTACTED:LOST',
        'QUALIFIED:LOST',
        'PROPOSAL:LOST',
      ];
      expect(allowedStage(from, to)).toBe(edges.includes(`${from}:${to}`));
    },
  );
  it('normalizes email and rejects actor injection', () => {
    const body = {
      companyName: ' PT Mitra ',
      contactName: ' Budi ',
      source: 'REFERRAL',
      email: 'Budi@Example.test',
    };
    expect(leadCreate.parse(body).email).toBe('budi@example.test');
    expect(leadCreate.safeParse({ ...body, actorId: 'spoof' }).success).toBe(
      false,
    );
  });
  it('requires exactly one parent for each interaction', () => {
    expect(
      activityCreate.safeParse({
        type: 'NOTE',
        note: 'test',
        occurredAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
    expect(
      followCreate.safeParse({
        leadId: '00000000-0000-4000-8000-000000000001',
        customerId: '00000000-0000-4000-8000-000000000002',
        note: 'test',
        dueAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { sortBy: 'passwordHash' },
    { status: 'false' },
  ])('rejects invalid query %j', (q) =>
    expect(listQuery.safeParse(q).success).toBe(false),
  );
});

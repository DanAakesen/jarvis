import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyViewIds, dailyModuleId, dailyContractVersion, dailyQuerySources, dailyQuerySchema, isDailyQuery } from './index.js';

test('Daily reserves four distinct stable view IDs without registering renderers', () => {
  assert.equal(dailyModuleId, 'daily');
  assert.equal(dailyContractVersion, 1);
  assert.deepEqual(dailyViewIds, {
    status: 'daily-status', recomp: 'daily-recomp', review: 'daily-review', ready: 'daily-ready',
  });
  assert.equal(new Set(Object.values(dailyViewIds)).size, 4);
  assert.ok(Object.isFrozen(dailyViewIds));
});

for (const source of [dailyQuerySources.favorites, dailyQuerySources.plans]) {
  test(`${source} accepts bounded collection pages with exact string IDs, not history cursors`, () => {
    assert.ok(dailyQuerySchema.properties.source.enum.includes(source));
    for (const query of [{ source }, { source, limit: 1 }, { source, limit: 100, cursor: { id: '001' } }]) {
      assert.equal(isDailyQuery(query), true);
    }
    for (const patch of [
      { owner: 'foreign' }, { startDate: '2026-10-01', endDate: '2026-10-16' },
      { limit: 0 }, { limit: 101 }, { limit: '5' }, { limit: undefined },
      { cursor: {} }, { cursor: null }, { cursor: { id: 1 } }, { cursor: { id: '' } },
      { cursor: { id: ' padded' } }, { cursor: { id: 'x'.repeat(257) } },
      { cursor: { id: '001', owner: 'foreign' } },
      { cursor: { id: '001', createdAt: '2026-10-15T00:00:00Z' } },
      { cursor: { date: '2026-10-15', key: '001' } },
    ]) assert.equal(isDailyQuery({ source, ...patch }), false, JSON.stringify(patch));
  });
}

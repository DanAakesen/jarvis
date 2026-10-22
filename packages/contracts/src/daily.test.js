import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyViewIds, dailyModuleId, dailyContractVersion, dailyQuerySources, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3, dailyQuerySourcesV4, dailyQuerySourcesV5, dailyQuerySourcesV5WithoutFeeds, dailyCapabilitiesVersion, dailyCapabilitiesAccept, dailyQuerySchema, isDailyQuery } from './index.js';

test('Daily reserves four distinct stable view IDs without registering renderers', () => {
  assert.equal(dailyModuleId, 'daily');
  assert.equal(dailyContractVersion, 1);
  assert.deepEqual(dailyViewIds, {
    status: 'daily-status', recomp: 'daily-recomp', review: 'daily-review', ready: 'daily-ready',
  });
  assert.equal(new Set(Object.values(dailyViewIds)).size, 4);
  assert.ok(Object.isFrozen(dailyViewIds));
});

test('capability v1-v4 source lists remain fixed while v5 adds owner training targets', () => {
  assert.equal(dailyCapabilitiesVersion, 5);
  assert.equal(dailyCapabilitiesAccept, 'application/json;version=5, application/json;version=4, application/json;version=3, application/json;version=2, application/json');
  assert.deepEqual(dailyQuerySourcesV1, [
    'daily.health.metrics', 'daily.health.sleep', 'daily.health.workouts', 'daily.health.workout',
    'daily.health.heart-rate', 'daily.nutrition.meals', 'daily.nutrition.favorites', 'daily.nutrition.plans', 'daily.sync',
  ]);
  assert.ok(Object.isFrozen(dailyQuerySourcesV1));
  assert.ok(!dailyQuerySourcesV1.includes(dailyQuerySources.briefs));
  assert.ok(!dailyQuerySourcesV1.includes(dailyQuerySources.brief));
  assert.deepEqual(dailyQuerySourcesV2, [
    ...dailyQuerySourcesV1, 'daily.briefs.history', 'daily.briefs.detail',
  ]);
  assert.deepEqual(dailyQuerySourcesV3, [
    ...dailyQuerySourcesV2, 'daily.health.metric-catalog', 'daily.nutrition.days',
  ]);
  assert.deepEqual(dailyQuerySourcesV4, [
    ...dailyQuerySourcesV3, 'daily.attention', 'daily.calendar',
  ]);
  assert.deepEqual(dailyQuerySourcesV5, [...dailyQuerySourcesV4, dailyQuerySources.trainingTargets]);
  assert.deepEqual(dailyQuerySourcesV5WithoutFeeds, [...dailyQuerySourcesV3, dailyQuerySources.trainingTargets]);
  assert.ok(Object.isFrozen(dailyQuerySourcesV2));
  assert.ok(Object.isFrozen(dailyQuerySourcesV3));
  assert.ok(Object.isFrozen(dailyQuerySourcesV4));
  assert.ok(Object.isFrozen(dailyQuerySourcesV5));
  assert.ok(Object.isFrozen(dailyQuerySourcesV5WithoutFeeds));
});

test('training target query accepts no caller selectors', () => {
  const query = { source: dailyQuerySources.trainingTargets };
  assert.equal(isDailyQuery(query), true);
  assert.ok(dailyQuerySchema.properties.source.enum.includes(dailyQuerySources.trainingTargets));
  for (const patch of [{ owner: 'foreign' }, { startDate: '2026-10-01' }, { cursor: {} }, { limit: 1 }]) {
    assert.equal(isDailyQuery({ ...query, ...patch }), false, JSON.stringify(patch));
  }
});

test('attention and calendar source queries accept only their bounded selectors', () => {
  const attention = { source: dailyQuerySources.attention };
  assert.equal(isDailyQuery(attention), true);
  for (const patch of [{ owner: 'foreign' }, { from: '2026-10-01T00:00:00Z' }, { cursor: {} }]) {
    assert.equal(isDailyQuery({ ...attention, ...patch }), false);
  }

  const calendar = {
    source: dailyQuerySources.calendar,
    from: '2026-10-01T00:00:00Z',
    to: '2026-12-02T00:00:00Z',
  };
  assert.equal(isDailyQuery(calendar), true);
  assert.equal(isDailyQuery({ ...calendar, to: '2026-10-01T00:00:00Z' }), false);
  assert.equal(isDailyQuery({ ...calendar, to: '2026-12-03T00:00:00Z' }), false);
  for (const patch of [
    { from: '2026-02-30T00:00:00Z' }, { from: '2026-10-01' }, { to: null },
    { cursor: {} }, { owner: 'foreign' }, { extra: true },
  ]) assert.equal(isDailyQuery({ ...calendar, ...patch }), false, JSON.stringify(patch));
  assert.ok(dailyQuerySchema.properties.source.enum.includes(dailyQuerySources.attention));
  assert.ok(dailyQuerySchema.properties.source.enum.includes(dailyQuerySources.calendar));
});

test('metric filters and metric catalogue queries validate their exact selector and key cursor', () => {
  const metrics = { source: dailyQuerySources.metrics, startDate: '2026-01-01', endDate: '2026-12-31' };
  const catalog = { source: dailyQuerySources.metricCatalog, startDate: '2026-01-01', endDate: '2026-12-31' };
  assert.equal(isDailyQuery({ ...metrics, metric: 'body_mass' }), true);
  assert.equal(isDailyQuery({ ...metrics, metric: 'x'.repeat(256), limit: 1, cursor: { date: '2026-06-01', key: 'body_mass' } }), true);
  for (const metric of ['', ' padded', 'padded ', 'x'.repeat(257), 'bad\nname', null]) {
    assert.equal(isDailyQuery({ ...metrics, metric }), false);
  }
  assert.equal(isDailyQuery({ ...metrics, limit: 501 }), false);
  assert.equal(isDailyQuery({ ...metrics, owner: 'foreign' }), false);
  assert.equal(isDailyQuery({ ...metrics, cursor: { date: '2026-06-01', key: 'body_mass', owner: 'foreign' } }), false);

  for (const limit of [1, 500]) assert.equal(isDailyQuery({ ...catalog, limit }), true);
  assert.equal(isDailyQuery({ ...catalog, cursor: { key: 'body_mass' } }), true);
  for (const query of [
    { ...catalog, startDate: '2026-02-30' }, { ...catalog, endDate: '2026-01-03', startDate: '2025-01-01' },
    { ...catalog, limit: 0 }, { ...catalog, limit: 501 }, { ...catalog, cursor: {} },
    { ...catalog, cursor: { key: '' } }, { ...catalog, cursor: { key: 'x'.repeat(257) } },
    { ...catalog, cursor: { key: 'body_mass', owner: 'foreign' } }, { ...catalog, unknown: true },
  ]) assert.equal(isDailyQuery(query), false, JSON.stringify(query));
  assert.equal(isDailyQuery({ ...catalog, startDate: '2025-01-01', endDate: '2026-01-02' }), true);
  assert.equal(isDailyQuery({ ...catalog, startDate: '2025-01-01', endDate: '2026-01-03' }), false);
});

test('per-day nutrition queries validate their date cursor and 400-row page bound', () => {
  const days = { source: dailyQuerySources.days, startDate: '2026-01-01', endDate: '2026-12-31' };
  for (const limit of [1, 400]) assert.equal(isDailyQuery({ ...days, limit }), true);
  assert.equal(isDailyQuery({ ...days, cursor: { date: '2026-06-01' } }), true);
  for (const query of [
    { ...days, startDate: '2026-02-30' }, { ...days, endDate: '2026-01-03', startDate: '2025-01-01' },
    { ...days, limit: 0 }, { ...days, limit: 401 }, { ...days, cursor: {} },
    { ...days, cursor: { date: '2027-01-01' } }, { ...days, cursor: { date: '2026-06-01', key: 'meal' } },
    { ...days, extra: true },
  ]) assert.equal(isDailyQuery(query), false, JSON.stringify(query));
  assert.equal(isDailyQuery({ ...days, startDate: '2025-01-01', endDate: '2026-01-02' }), true);
  assert.equal(isDailyQuery({ ...days, startDate: '2025-01-01', endDate: '2026-01-03' }), false);
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

test('retained brief selectors preserve exact legacy IDs and stored-text cursors without dates or write authority', () => {
  const history = dailyQuerySources.briefs;
  const detail = dailyQuerySources.brief;
  for (const query of [{ source: history }, { source: history, limit: 100, cursor: { startedAt: '', id: ' padded ' } },
    { source: detail, briefId: ' padded ' }]) assert.equal(isDailyQuery(query), true);
  for (const patch of [{ owner: 'foreign' }, { startDate: '2026-10-01' }, { limit: 101 },
    { cursor: { id: 'id' } }, { cursor: { startedAt: null, id: 'id' } }, { cursor: { startedAt: 'raw', id: '' } },
    { cursor: { startedAt: 'x'.repeat(65), id: 'id' } }, { cursor: { startedAt: 'raw', id: 'id', owner: 'foreign' } }]) {
    assert.equal(isDailyQuery({ source: history, ...patch }), false);
  }
  for (const briefId of [null, '', 0, undefined, 'x'.repeat(257)]) assert.equal(isDailyQuery({ source: detail, briefId }), false);
  for (const patch of [{ cursor: { id: 'id' } }, { owner: 'foreign' }, { operation: 'send' }]) {
    assert.equal(isDailyQuery({ source: detail, briefId: 'id', ...patch }), false);
  }
});

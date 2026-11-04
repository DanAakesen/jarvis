import assert from 'node:assert/strict';
import test from 'node:test';
import { healthViewIds, healthModuleId, healthContractVersion, healthQuerySources, healthQuerySourcesV1, healthQuerySourcesV2, healthQuerySourcesV3, healthQuerySourcesV5, healthQuerySourcesV6, healthQuerySourcesV6WithoutTrainingTargets, healthCapabilitiesVersion, healthCapabilitiesAccept, healthQuerySchema, isHealthQuery } from './index.js';

test('Health reserves four distinct stable view IDs without registering renderers', () => {
  assert.equal(healthModuleId, 'health');
  assert.equal(healthContractVersion, 1);
  assert.deepEqual(healthViewIds, {
    status: 'health-status', recomp: 'health-recomp', review: 'health-review', ready: 'health-ready',
  });
  assert.equal(new Set(Object.values(healthViewIds)).size, 4);
  assert.ok(Object.isFrozen(healthViewIds));
});

test('capability v1-v5 source lists remain fixed while v6 adds owner workout lifts', () => {
  assert.equal(healthCapabilitiesVersion, 6);
  assert.equal(healthCapabilitiesAccept, 'application/json;version=6, application/json;version=5, application/json;version=4, application/json;version=3, application/json;version=2, application/json');
  assert.deepEqual(healthQuerySourcesV1, [
    'daily.health.metrics', 'daily.health.sleep', 'daily.health.workouts', 'daily.health.workout',
    'daily.health.heart-rate', 'daily.nutrition.meals', 'daily.nutrition.favorites', 'daily.nutrition.plans', 'daily.sync',
  ]);
  assert.ok(Object.isFrozen(healthQuerySourcesV1));
  assert.ok(!healthQuerySourcesV1.includes(healthQuerySources.briefs));
  assert.ok(!healthQuerySourcesV1.includes(healthQuerySources.brief));
  assert.deepEqual(healthQuerySourcesV2, [
    ...healthQuerySourcesV1, 'daily.briefs.history', 'daily.briefs.detail',
  ]);
  assert.deepEqual(healthQuerySourcesV3, [
    ...healthQuerySourcesV2, 'daily.health.metric-catalog', 'daily.nutrition.days',
  ]);
  assert.deepEqual(healthQuerySourcesV5, [...healthQuerySourcesV3, healthQuerySources.trainingTargets]);
  assert.deepEqual(healthQuerySourcesV6, [...healthQuerySourcesV5, healthQuerySources.lifts]);
  assert.deepEqual(healthQuerySourcesV6WithoutTrainingTargets, [...healthQuerySourcesV3, healthQuerySources.lifts]);
  assert.ok(Object.isFrozen(healthQuerySourcesV2));
  assert.ok(Object.isFrozen(healthQuerySourcesV3));
  assert.ok(Object.isFrozen(healthQuerySourcesV5));
  assert.ok(Object.isFrozen(healthQuerySourcesV6));
  assert.ok(Object.isFrozen(healthQuerySourcesV6WithoutTrainingTargets));
});

test('lift history queries validate bounded pagination and the latest-per-exercise option', () => {
  const lifts = { source: healthQuerySources.lifts };
  assert.equal(isHealthQuery(lifts), true);
  assert.equal(isHealthQuery({ ...lifts, limit: 100, lastPerExercise: true }), true);
  assert.equal(isHealthQuery({ ...lifts, limit: 1, cursor: { performedAt: '2026-10-30T12:00:00Z', id: 'abcdef01-2345-4678-89ab-cdef01234567' } }), true);
  for (const patch of [
    { owner: 'foreign' }, { startDate: '2026-10-01' }, { limit: 101 }, { limit: 0 },
    { lastPerExercise: 'yes' }, { cursor: { performedAt: '2026-10-30', id: 'lift-1' } },
    { cursor: { performedAt: '2026-10-30T12:00:00Z', id: 'lift-1', owner: 'foreign' } },
  ]) assert.equal(isHealthQuery({ ...lifts, ...patch }), false, JSON.stringify(patch));
  assert.ok(healthQuerySchema.properties.source.enum.includes(healthQuerySources.lifts));
});

test('training target query accepts no caller selectors', () => {
  const query = { source: healthQuerySources.trainingTargets };
  assert.equal(isHealthQuery(query), true);
  assert.ok(healthQuerySchema.properties.source.enum.includes(healthQuerySources.trainingTargets));
  for (const patch of [{ owner: 'foreign' }, { startDate: '2026-10-01' }, { cursor: {} }, { limit: 1 }]) {
    assert.equal(isHealthQuery({ ...query, ...patch }), false, JSON.stringify(patch));
  }
});

test('the retired attention and calendar sources are no longer accepted', () => {
  assert.equal(isHealthQuery({ source: 'daily.attention' }), false);
  assert.equal(isHealthQuery({ source: 'daily.calendar', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }), false);
  assert.ok(!healthQuerySchema.properties.source.enum.includes('daily.attention'));
  assert.ok(!healthQuerySchema.properties.source.enum.includes('daily.calendar'));
});

test('metric filters and metric catalogue queries validate their exact selector and key cursor', () => {
  const metrics = { source: healthQuerySources.metrics, startDate: '2026-01-01', endDate: '2026-12-31' };
  const heartRate = { source: healthQuerySources.heartRate, workoutId: 'workout-1' };
  const catalog = { source: healthQuerySources.metricCatalog, startDate: '2026-01-01', endDate: '2026-12-31' };
  assert.equal(isHealthQuery({ ...metrics, metric: 'body_mass' }), true);
  assert.equal(isHealthQuery({ ...metrics, metric: 'x'.repeat(256), limit: 1, cursor: { date: '2026-06-01', key: 'body_mass' } }), true);
  assert.equal(isHealthQuery({ ...heartRate, metric: 'heart_rate', limit: 1, cursor: { minute: '2026-06-01T10:00:00Z', metric: 'heart_rate' } }), true);
  for (const metric of ['', ' padded', 'padded ', 'x'.repeat(257), 'bad\nname', null]) {
    assert.equal(isHealthQuery({ ...heartRate, metric }), false);
  }
  assert.equal(isHealthQuery({ ...heartRate, extra: true }), false);
  for (const metric of ['', ' padded', 'padded ', 'x'.repeat(257), 'bad\nname', null]) {
    assert.equal(isHealthQuery({ ...metrics, metric }), false);
  }
  assert.equal(isHealthQuery({ ...metrics, limit: 501 }), false);
  assert.equal(isHealthQuery({ ...metrics, owner: 'foreign' }), false);
  assert.equal(isHealthQuery({ ...metrics, cursor: { date: '2026-06-01', key: 'body_mass', owner: 'foreign' } }), false);

  for (const limit of [1, 500]) assert.equal(isHealthQuery({ ...catalog, limit }), true);
  assert.equal(isHealthQuery({ ...catalog, cursor: { key: 'body_mass' } }), true);
  for (const query of [
    { ...catalog, startDate: '2026-02-30' }, { ...catalog, endDate: '2026-01-03', startDate: '2025-01-01' },
    { ...catalog, limit: 0 }, { ...catalog, limit: 501 }, { ...catalog, cursor: {} },
    { ...catalog, cursor: { key: '' } }, { ...catalog, cursor: { key: 'x'.repeat(257) } },
    { ...catalog, cursor: { key: 'body_mass', owner: 'foreign' } }, { ...catalog, unknown: true },
  ]) assert.equal(isHealthQuery(query), false, JSON.stringify(query));
  assert.equal(isHealthQuery({ ...catalog, startDate: '2025-01-01', endDate: '2026-01-02' }), true);
  assert.equal(isHealthQuery({ ...catalog, startDate: '2025-01-01', endDate: '2026-01-03' }), false);
});

test('per-day nutrition queries validate their date cursor and 400-row page bound', () => {
  const days = { source: healthQuerySources.days, startDate: '2026-01-01', endDate: '2026-12-31' };
  for (const limit of [1, 400]) assert.equal(isHealthQuery({ ...days, limit }), true);
  assert.equal(isHealthQuery({ ...days, cursor: { date: '2026-06-01' } }), true);
  for (const query of [
    { ...days, startDate: '2026-02-30' }, { ...days, endDate: '2026-01-03', startDate: '2025-01-01' },
    { ...days, limit: 0 }, { ...days, limit: 401 }, { ...days, cursor: {} },
    { ...days, cursor: { date: '2027-01-01' } }, { ...days, cursor: { date: '2026-06-01', key: 'meal' } },
    { ...days, extra: true },
  ]) assert.equal(isHealthQuery(query), false, JSON.stringify(query));
  assert.equal(isHealthQuery({ ...days, startDate: '2025-01-01', endDate: '2026-01-02' }), true);
  assert.equal(isHealthQuery({ ...days, startDate: '2025-01-01', endDate: '2026-01-03' }), false);
});

for (const source of [healthQuerySources.favorites, healthQuerySources.plans]) {
  test(`${source} accepts bounded collection pages with exact string IDs, not history cursors`, () => {
    assert.ok(healthQuerySchema.properties.source.enum.includes(source));
    for (const query of [{ source }, { source, limit: 1 }, { source, limit: 100, cursor: { id: '001' } }]) {
      assert.equal(isHealthQuery(query), true);
    }

    for (const patch of [
      { owner: 'foreign' }, { startDate: '2026-10-01', endDate: '2026-10-16' },
      { limit: 0 }, { limit: 101 }, { limit: '5' }, { limit: undefined },
      { cursor: {} }, { cursor: null }, { cursor: { id: 1 } }, { cursor: { id: '' } },
      { cursor: { id: ' padded' } }, { cursor: { id: 'x'.repeat(257) } },
      { cursor: { id: '001', owner: 'foreign' } },
      { cursor: { id: '001', createdAt: '2026-10-15T00:00:00Z' } },
      { cursor: { date: '2026-10-15', key: '001' } },
    ]) assert.equal(isHealthQuery({ source, ...patch }), false, JSON.stringify(patch));
  });
}

test('retained brief selectors preserve exact legacy IDs and stored-text cursors without dates or write authority', () => {
  const history = healthQuerySources.briefs;
  const detail = healthQuerySources.brief;
  for (const query of [{ source: history }, { source: history, limit: 100, cursor: { startedAt: '', id: ' padded ' } },
    { source: detail, briefId: ' padded ' }]) assert.equal(isHealthQuery(query), true);
  for (const patch of [{ owner: 'foreign' }, { startDate: '2026-10-01' }, { limit: 101 },
    { cursor: { id: 'id' } }, { cursor: { startedAt: null, id: 'id' } }, { cursor: { startedAt: 'raw', id: '' } },
    { cursor: { startedAt: 'x'.repeat(65), id: 'id' } }, { cursor: { startedAt: 'raw', id: 'id', owner: 'foreign' } }]) {
    assert.equal(isHealthQuery({ source: history, ...patch }), false);
  }
  for (const briefId of [null, '', 0, undefined, 'x'.repeat(257)]) assert.equal(isHealthQuery({ source: detail, briefId }), false);
  for (const patch of [{ cursor: { id: 'id' } }, { owner: 'foreign' }, { operation: 'send' }]) {
    assert.equal(isHealthQuery({ source: detail, briefId: 'id', ...patch }), false);
  }
});

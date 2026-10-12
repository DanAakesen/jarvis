import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyViewIds, dailyModuleId, dailyContractVersion } from './index.js';

test('Daily reserves four distinct stable view IDs without registering renderers', () => {
  assert.equal(dailyModuleId, 'daily');
  assert.equal(dailyContractVersion, 1);
  assert.deepEqual(dailyViewIds, {
    status: 'daily-status', recomp: 'daily-recomp', review: 'daily-review', ready: 'daily-ready',
  });
  assert.equal(new Set(Object.values(dailyViewIds)).size, 4);
  assert.ok(Object.isFrozen(dailyViewIds));
});

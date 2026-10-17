import { describe, expect, it } from 'vitest';
import { dailyFeedInput } from './schema.js';

const from = '2026-10-17T00:00:00Z';
const to = '2026-10-18T00:00:00Z';
describe('strict Daily feed operations', () => {
  it.each([
    { operation: 'read_attention' }, { operation: 'read_suppressions' },
    { operation: 'refresh', from, to },
    { operation: 'dismiss_thread', id: 'exact-thread' }, { operation: 'receive_order', id: 'producer-order' },
    { operation: 'clear_suppression', type: 'order', key: 'consumer:order key' },
    { operation: 'clear_suppression', type: 'thread', key: ' exact imported key ' },
  ])('accepts only the bounded exact shape $operation', input => {
    expect(dailyFeedInput.parse(input)).toEqual(input);
    for (const extra of ['owner', 'account', 'provider', 'confirmed', 'explicitIntent']) {
      expect(dailyFeedInput.safeParse({ ...input, [extra]: true }).success).toBe(false);
    }
  });
  it.each([
    { operation: 'refresh' }, { operation: 'refresh', from, to: from },
    { operation: 'refresh', from: '2026-02-30T00:00:00Z', to },
    { operation: 'refresh', from: '2026-10-17', to },
    { operation: 'refresh', from, to: new Date(Date.parse(from) + 62 * 86400_000 + 1).toISOString() },
    { operation: 'dismiss_thread', id: 'x'.repeat(257) }, { operation: 'receive_order', id: '' },
    { operation: 'clear_suppression', type: 'calendar', key: 'exact' },
    { operation: 'read_attention', id: 'ignored' }, { operation: 'read_suppressions', from },
  ])('rejects invalid operation/selectors %#', input => {
    expect(dailyFeedInput.safeParse(input).success).toBe(false);
  });
});

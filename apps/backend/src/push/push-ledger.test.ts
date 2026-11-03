import { describe, expect, it } from 'vitest';
import { createPushLedger } from './push-ledger.js';

describe('push ledger', () => {
  it('lets each event push once and keeps one log entry for it', () => {
    let time = 1_000;
    const ledger = createPushLedger(() => time);
    expect(ledger.claim('approval', 'a1')).toBe(true);
    expect(ledger.claim('approval', 'a1')).toBe(false);
    expect(ledger.claim('reply', 'm1')).toBe(true);
    expect(ledger.claim('reply', 'm1')).toBe(false);
    expect(ledger.entries().map(({ key }) => key)).toEqual(['approval:a1', 'reply:m1']);
    time += 2 * 60 * 60_000;
    expect(ledger.claim('approval', 'a1')).toBe(true);
  });

  it('drops the reply of the turn that staged an approval, because the approval push carried it', () => {
    let time = 10_000;
    const ledger = createPushLedger(() => time);
    const turnStartedAt = time;
    time += 500;
    expect(ledger.claim('approval', 'a1')).toBe(true);
    time += 500;
    expect(ledger.claimReply('m1', turnStartedAt)).toBe(false);
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.claimReply('m2', time)).toBe(true);
  });
});

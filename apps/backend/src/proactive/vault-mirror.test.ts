import { describe, expect, it, vi } from 'vitest';
import type { VaultMirrorStatusView } from '@jarvis/contracts';
import { vaultMirrorFinding } from './vault-mirror.js';
import { createMemoryProactiveStore } from './store.js';
import { createProactiveEngine } from './engine.js';
import { createProactiveAlertHook } from './alerts.js';

const now = new Date('2026-10-19T12:00:00Z');
describe('vault mirror proactive rule', () => {
  it.each([
    ['not-set-up', null, false], ['read-error', null, false],
    ['healthy', '2026-10-19T11:00:00Z', false],
    ['stale', '2026-10-19T10:59:59Z', true],
    ['stale', null, false], ['needs-attention', null, true], ['failed', null, true],
  ] as const)('applies threshold and owner precedence: %s %s', (state, lastSuccessAt, expected) => {
    const result = vaultMirrorFinding({ state, lastSuccessAt }, now);
    expect(Boolean(result)).toBe(expected);
    if (result) expect(result).toMatchObject({ urgency: 'normal', category: 'status', evidence: [] });
    expect(JSON.stringify(result ?? null)).not.toContain('conflictPaths');
  });

  it('deduplicates by Copenhagen day and reason across DST and ignores private paths', async () => {
    const store = createMemoryProactiveStore();
    const status: VaultMirrorStatusView = {
      state: 'failed', lastSuccessAt: null, conflictPaths: ['private/note.md'],
    };
    const first = vaultMirrorFinding(status, new Date('2026-10-25T00:30:00Z'))!;
    const second = vaultMirrorFinding(status, new Date('2026-10-25T01:30:00Z'))!;
    const a = await store.items.upsertFinding(first);
    await store.items.applyFeedback(a.id, 'dismiss');
    const b = await store.items.upsertFinding(second);
    expect(b.id).toBe(a.id);
    expect(b.state).toBe('dismissed');
    expect(first.dedupeKey).toBe('vault-mirror:2026-10-25:failed');
    expect(JSON.stringify(b)).not.toContain('private/note.md');
    expect(vaultMirrorFinding(status, new Date('2026-10-25T23:01:00Z'))?.dedupeKey)
      .toBe('vault-mirror:2026-10-26:failed');
    expect(vaultMirrorFinding({ state: 'stale', lastSuccessAt: '2026-10-24T01:00:00Z' },
      new Date('2026-10-25T01:30:00Z'))?.dedupeKey).toBe('vault-mirror:2026-10-25:stale');
    expect(vaultMirrorFinding(status, new Date('2026-03-29T00:30:00Z'))?.dedupeKey)
      .toBe(vaultMirrorFinding(status, new Date('2026-03-29T01:30:00Z'))?.dedupeKey);
  });

  it('keeps distinct fixed owner reasons once each per day with a plain explanation and action', async () => {
    const store = createMemoryProactiveStore();
    const status: VaultMirrorStatusView = { state: 'needs-attention', lastSuccessAt: null, reason: 'auth' };
    const auth = vaultMirrorFinding(status, now)!;
    const conflict = vaultMirrorFinding({ ...status, reason: 'conflict' }, now)!;
    expect(auth.dedupeKey).toBe('vault-mirror:2026-10-19:auth');
    expect(conflict.dedupeKey).toBe('vault-mirror:2026-10-19:conflict');
    expect(auth.body).toBe('The vault mirror could not authenticate. Open System status and review the vault mirror.');
    expect(conflict.body).toBe('The vault mirror found conflicting changes. Open System status and review the vault mirror.');
    await store.items.upsertFinding(auth);
    await store.items.upsertFinding(conflict);
    await store.items.upsertFinding(auth);
    await store.items.upsertFinding(conflict);
    expect(await store.items.list('all', 10, now)).toHaveLength(2);
  });

  it('stores the deterministic finding in the existing engine without model or push delivery', async () => {
    const store = createMemoryProactiveStore();
    const send = vi.fn();
    const listSubscriptions = vi.fn();
    const summarize = vi.fn();
    const hook = createProactiveAlertHook({
      store, ownerObjectId: 'owner',
      pushStore: { listSubscriptions } as never,
      ledger: {} as never,
      send, now: () => now,
    });
    const engine = createProactiveEngine({
      store, sources: [],
      model: { worstCaseDkk: async () => 0, summarize },
      now: () => now,
      vaultMirrorStatusReader: { read: async () => ({ state: 'failed', lastSuccessAt: null }) },
      onFindingsStored: [hook],
    });
    for (let i = 0; i < 2; i++) {
      const claim = await store.runs.claim({ trigger: 'scheduled', slot: `2026-10-19T${i ? '18' : '07'}:00`, now });
      await engine(claim!);
    }
    const items = await store.items.list('all', 10, now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ urgency: 'normal', category: 'status', language: 'en' });
    expect((await store.runs.latest())?.status).toBe('done');
    expect(summarize).not.toHaveBeenCalled();
    expect(listSubscriptions).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

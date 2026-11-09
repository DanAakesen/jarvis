import { describe, expect, it, vi } from 'vitest';
import { HomeBriefService } from './brief.js';
import { flattenSettings, type SettingsStore } from '../core/settings.js';
import type { ProactiveSource } from '../proactive/types.js';

function fixture() {
  let now = Date.parse('2026-11-02T13:00:00Z');
  const values: Record<string, unknown> = {};
  const store: SettingsStore = {
    read: async () => ({ ...values }),
    write: async settings => { for (const { key, value } of flattenSettings(settings)) values[key] = value; },
  };
  const sources: ProactiveSource[] = ['calendar', 'todos'].map(id => ({
    id: id as 'calendar' | 'todos', label: id,
    read: vi.fn(async () => ({ source: id as 'calendar' | 'todos', state: 'ok' as const, reason: null,
      facts: [{ kind: 'event' as const, ref: id, label: 'Review', text: 'Review at 15:00',
        observedAt: new Date(now).toISOString() }], observedAt: new Date(now).toISOString() })),
  }));
  const model = vi.fn(async () => JSON.stringify({ text: 'Review starts at 15:00.', evidenceRefs: ['calendar'] }));
  const service = new HomeBriefService({ ownerObjectId: 'owner', settingsStore: store, sources, model, now: () => now });
  return { service, model, sources, store, advance: (ms: number) => { now += ms; } };
}

describe('grounded Home brief', () => {
  it('coalesces renders and source refreshes without regenerating unchanged evidence', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.service.read('en'), f.service.read('en')]);
    expect(a).toEqual(b);
    expect(a.state).toBe('generated');
    expect(a.maxVisibleLines).toBe(3);
    await f.service.read('en', true);
    expect(f.model).toHaveBeenCalledTimes(1);
    f.service.close();
  });
  it('preserves saved Home scope and regenerates on instruction and language changes', async () => {
    const f = fixture();
    await f.service.read('en');
    await f.store.write({ homeBrief: { instruction: 'Focus on deadlines', maxVisibleLines: 6 } });
    const result = await f.service.read('da');
    expect(result.language).toBe('da');
    expect(result.maxVisibleLines).toBe(6);
    expect(f.model).toHaveBeenCalledTimes(2);
    f.service.close();
  });
  it('invalidates cached output after meaningful source changes and Copenhagen midnight', async () => {
    const f = fixture();
    await f.service.read('en');
    vi.mocked(f.sources[0]!.read).mockResolvedValue({
      source: 'calendar', state: 'ok', reason: null, observedAt: '2026-11-02T13:01:00Z',
      facts: [{ kind: 'event', ref: 'calendar', label: 'Review', text: 'Review moved to 16:00',
        observedAt: '2026-11-02T13:01:00Z' }],
    });
    f.service.invalidate();
    await f.service.read('en');
    expect(f.model).toHaveBeenCalledTimes(2);
    f.advance(24 * 60 * 60_000);
    await f.service.read('en');
    expect(f.model).toHaveBeenCalledTimes(3);
    f.service.close();
  });
  it('never treats a failed commitment source as a clear day', async () => {
    const f = fixture();
    vi.mocked(f.sources[0]!.read).mockRejectedValue(new Error('offline'));
    const result = await f.service.read('en');
    expect(result.state).toBe('unavailable');
    expect(result.unavailableSources).toContain('calendar');
    expect(f.model).not.toHaveBeenCalled();
    expect(result.text).not.toMatch(/day is clear/i);
    f.service.close();
  });
  it('rejects unsupported citations and retries after the generation budget recovers', async () => {
    const f = fixture();
    f.model.mockResolvedValue(JSON.stringify({ text: 'Invented', evidenceRefs: ['unknown'] }));
    expect((await f.service.read('en')).state).toBe('unavailable');
    f.advance(61_000);
    f.model.mockResolvedValue(JSON.stringify({ text: 'Review starts at 15:00.', evidenceRefs: ['calendar'] }));
    expect((await f.service.read('en')).state).toBe('generated');
    f.service.close();
  });
});

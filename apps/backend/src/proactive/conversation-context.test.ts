import { describe, expect, it, vi } from 'vitest';
import { createMemoryProactiveStore } from './store.js';
import { createProactiveConversationContext, type ConversationSelection } from './conversation-context.js';

const owner = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
async function fixture() {
  let timestamp = new Date('2026-11-09T12:00:00Z');
  let selection: ConversationSelection | undefined;
  const store = createMemoryProactiveStore(owner);
  const item = await store.items.upsertFinding({
    dedupeKey: 'fixture', title: 'Training progress',
    body: 'Two workouts this week; one more reaches your own target.',
    category: 'suggestion', urgency: 'normal', dueAt: null,
    evidence: [{ source: 'health', label: 'Workout history', observedAt: timestamp.toISOString() }],
    language: 'en', runId: null,
  });
  const select = vi.fn(async (value: ConversationSelection) => { selection = value; });
  const service = createProactiveConversationContext(owner, store.items, {
    read: async () => selection, select,
  }, () => timestamp);
  return { service, item, select, store, advance: () => { timestamp = new Date(timestamp.getTime() + 86_400_000); } };
}

describe('notification conversation continuity', () => {
  it('selects saved evidence, keeps duplicate taps idempotent, and sends nothing', async () => {
    const { service, item, select } = await fixture();
    const listener = vi.fn(async () => {});
    const unsubscribe = service.subscribe(listener);
    expect(await service.read(owner)).toBeUndefined();
    expect(await service.select(owner, item.id)).toBe(true);
    expect(await service.select(owner.toUpperCase(), item.id.toUpperCase())).toBe(true);
    expect(select).toHaveBeenCalledOnce();
    const context = await service.read(owner);
    expect(context).toContain(item.body);
    expect(context).toContain('Workout history');
    expect(context).toContain('2026-11-09T12:00:00.000Z');
    expect(context).toContain('not approval');
    expect(context).toContain('untrusted source data');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await service.select(owner, item.id);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('rejects foreign owners, malformed IDs and missing findings without replacing context', async () => {
    const { service, item, select } = await fixture();
    expect(await service.select('another-owner', item.id)).toBe(false);
    expect(await service.select(owner, '../anything')).toBe(false);
    expect(await service.select(owner, '00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(select).not.toHaveBeenCalled();
    await service.select(owner, item.id);
    expect(await service.read('another-owner')).toBeUndefined();
  });
  it('expires context and revalidates source policy rather than treating old findings as current facts', async () => {
    const { service, item, store, advance } = await fixture();
    await service.select(owner, item.id);
    await store.settings.patch({ categories: { suggestion: false } });
    expect(await service.read(owner)).toBeUndefined();
    await store.settings.patch({ categories: { suggestion: true } });
    expect(await service.read(owner)).toContain(item.body);
    advance();
    expect(await service.read(owner)).toBeUndefined();
    expect(await service.select(owner, item.id)).toBe(true);
    expect(await service.read(owner)).toContain(item.body);
  });
});

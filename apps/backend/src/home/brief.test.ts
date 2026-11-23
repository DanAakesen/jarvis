import { expect, it } from 'vitest';
import type { ProactiveSource, SourceFact } from '../proactive/types.js';
import { HomeBriefService } from './brief.js';

it('gives the Home brief urgent tasks and near meetings on a busy calendar', async () => {
  const now = Date.parse('2026-11-23T07:00:00Z');
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const observedAt = at(0);
  const source = (id: 'calendar' | 'todos', facts: SourceFact[]): ProactiveSource => ({
    id, label: id, read: async () => ({ source: id, state: 'ok', facts, reason: null, observedAt }),
  });
  const calendar = Array.from({ length: 40 }, (_, i) => ({
    kind: 'event' as const, ref: 'event-' + i, label: 'Meeting', text: 'Meeting', startsAt: at(i + 1), observedAt,
  })).reverse();
  const tasks = Array.from({ length: 40 }, (_, i) => ({
    kind: 'todo' as const, ref: 'task-' + i, label: 'Task', text: 'Task', dueAt: at(i + 1), highPriority: i === 39, observedAt,
  }));
  let sent: SourceFact[] = [];
  const brief = new HomeBriefService({
    now: () => now, ownerObjectId: 'owner', settingsStore: { read: async () => ({}), write: async () => {} },
    sources: [source('calendar', calendar), source('todos', tasks)],
    model: async ({ user }) => {
      sent = (JSON.parse(user) as { facts: SourceFact[] }).facts;
      return JSON.stringify({ text: 'Review the urgent task before your meeting.', evidenceRefs: ['task-39', 'event-0'] });
    },
  });
  try {
    expect(await brief.read()).toMatchObject({ state: 'generated', evidenceRefs: ['task-39', 'event-0'] });
    expect(sent).toHaveLength(30);
    expect(sent.map(fact => fact.ref)).not.toContain('event-39');
  } finally { brief.close(); }
});

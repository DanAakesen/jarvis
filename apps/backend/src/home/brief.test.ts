import { expect, it } from 'vitest';
import { createFoundryJsonCompletion } from '../core/approval-interpreter-foundry.js';
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
    kind: 'event' as const, ref: 'event-' + i, label: 'Meeting', text: `Meeting ${i}`, startsAt: at(i + 1), observedAt,
  })).reverse();
  const tasks = Array.from({ length: 40 }, (_, i) => ({
    kind: 'todo' as const, ref: 'task-' + i, label: 'Task', text: `Task ${i}`, dueAt: at(i + 1), highPriority: i === 39, observedAt,
  }));
  let sent: SourceFact[] = [];
  const brief = new HomeBriefService({
    now: () => now, ownerObjectId: 'owner', settingsStore: { read: async () => ({}), write: async () => {} },
    sources: [source('calendar', calendar), source('todos', tasks)],
    model: async ({ user }) => {
      sent = (JSON.parse(user) as { facts: SourceFact[] }).facts;
      return JSON.stringify({ text: 'Review the urgent task before your meeting.', evidenceRefs: ['Task 39', 'Meeting 0'].map(text => sent.find(fact => fact.text === text)?.ref) });
    },
  });
  try {
    expect(await brief.read()).toMatchObject({ state: 'generated', evidenceRefs: ['task-39', 'event-0'] });
    expect(sent).toHaveLength(30);
    expect(sent.map(fact => fact.text)).not.toContain('Meeting 39');
  } finally { brief.close(); }
});

it('cites distinct long calendar IDs through the bounded completion transport', async () => {
  const observedAt = '2026-11-23T07:00:00Z';
  const events = Array.from({ length: 30 }, (_, index) => {
    const ref = 'calendar-event:' + 'a'.repeat(1022) + String(index).padStart(2, '0');
    return { kind: 'event' as const, ref, identity: ref, label: 'Calendar', text: 'Meeting', observedAt };
  });
  const model = createFoundryJsonCompletion({
    endpoint: new URL('https://foundry.invalid'), scope: 'test', getToken: async () => 'test',
    selectModel: async () => ({ model: 'fixture', reasoningEffort: 'none', maxCompletionTokens: 200 }),
    recordUsage: async () => {},
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const facts = (JSON.parse(request.messages[1]!.content) as { facts: SourceFact[] }).facts;
      expect(facts).toHaveLength(30);
      expect(facts.every(fact => !('identity' in fact))).toBe(true);
      const refs = facts.slice(-12).map(fact => fact.ref);
      return Response.json({ usage: { prompt_tokens: 1600, completion_tokens: 60 }, choices: [{
        finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Calendar is busy.', evidenceRefs: refs }) },
      }] });
    },
  });
  const brief = new HomeBriefService({
    now: () => Date.parse(observedAt), ownerObjectId: 'owner', settingsStore: { read: async () => ({}), write: async () => {} },
    sources: (['calendar', 'todos'] as const).map(id => ({
      id, label: id, read: async () => ({ source: id, state: 'ok', facts: id === 'calendar' ? events : [], reason: null, observedAt }),
    })), model,
  });
  try {
    expect(await brief.read()).toMatchObject({ state: 'generated', evidenceRefs: events.slice(-12).map(fact => fact.ref) });
  } finally { brief.close(); }
});

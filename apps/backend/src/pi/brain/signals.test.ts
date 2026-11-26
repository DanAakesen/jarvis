import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createPiAuth } from '../../auth/pi-credential.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import { mapGithubWebhook } from '../../github/webhook-mapping.js';
import { WEBHOOK_FIXTURE_NOW as NOW, queuedWebhooks } from '../../github/webhook.testkit.js';
import { createMemoryEventQueueStore, normalizeEvent } from '../../proactive/events/event-queue.js';
import { clashEvents, githubEvent, reminderFailureEvent } from '../../proactive/events/producers.js';
import type { ProactiveEventInput } from '../../proactive/events/types.js';
import { createMemoryProactiveStore } from '../../proactive/store.js';
import type { FindingCategory, SourceFact, SourceId } from '../../proactive/types.js';
import { createPiArea } from '../area.js';
import { createPiRoutes } from '../routes.js';
import type { PiSituationService } from '../situation.js';
import { createMemoryPiStore } from '../store.js';
import { createPiTurnRegistry } from '../turns.js';
import { memoryConversations, memoryVault, scriptedGateway, type ScriptedWake } from './brain.testkit.js';
import { createBrainComms } from './comms.js';
import { createDecisionLog } from './decision-log.js';
import { createBrain } from './runner.js';
import { createBrainTools } from './tools.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const owner = config.auth.ownerObjectId;
const secret = 'A'.repeat(43);
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const signal = () => new AbortController().signal;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const githubSignal = (name: keyof typeof queuedWebhooks) => {
  const { event, payload } = queuedWebhooks[name]!;
  return githubEvent(mapGithubWebhook(event, payload)!, NOW)!;
};
const timed = (id: string, startsAt: string, endsAt: string): SourceFact => ({
  ref: `cal:${id}`, identity: `calendar-event:${id}`, kind: 'event', label: 'Calendar', text: `Planning ${id}`,
  observedAt: NOW.toISOString(), startsAt, endsAt, allDay: false,
});
const clash = clashEvents([
  timed('a', '2026-11-21T13:00:00.000Z', '2026-11-21T14:00:00.000Z'),
  timed('b', '2026-11-21T13:30:00.000Z', '2026-11-21T14:30:00.000Z'),
], NOW)[0]!;
const failedReminder = reminderFailureEvent({
  scheduleId: '5a1d6a34-0000-4000-8000-000000000001', occurrenceAt: new Date('2026-11-21T11:00:00.000Z'),
  title: 'Send the final draft', reason: 'provider_rejected', providerOutcome: 'provider_rejected',
  attempts: 1, recipients: 1, accepted: 0,
}, NOW);

const emptySituation = (): Awaited<ReturnType<PiSituationService['read']>> => ({
  state: null, revision: 1, hash: 'a'.repeat(64), policyRevision: 'b'.repeat(64), staleSources: [], missingSources: [],
  disabledSources: [], freshSources: [], asOf: null, updatedAt: null, lastActivation: null,
});

/** The real brain loop and the real `message_dan` behind the real `/pi/mcp` door, with a scripted stand-in for the model. */
function setup(decide: (wake: ScriptedWake, tell: (arguments_: Record<string, unknown>) => Promise<{ outcome: string; result: Record<string, unknown> }>) => Promise<void> = async () => {}) {
  const queue = createMemoryEventQueueStore();
  const piStore = createMemoryPiStore(() => NOW);
  const proactive = createMemoryProactiveStore(owner);
  const vault = memoryVault();
  const conversations = memoryConversations();
  const pushes: unknown[] = [];
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const comms = createBrainComms({
    conversations: conversations.store, ownerObjectId: owner, push: (message) => pushes.push(message), announce: () => {}, now: () => NOW,
  });
  const situation = { async read() { return emptySituation(); } } as never;
  const app = buildApp(config, undefined, {
    modules: [coreModule, {
      id: 'pi',
      tools: createBrainTools({ registry, comms, proactive, situation, area: createPiArea({ vault }), now: () => NOW }),
      registerRoutes: createPiRoutes({ gateway: { stream: async function* () {} } as never, registry, auth, monthlyCapDkk: 250, bridges: [] }),
    }],
    auth: async () => { throw new Error('rejected'); },
    toolCallStore: { record: async () => {} },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  async function tool(name: string, args: Record<string, unknown>) {
    id += 1;
    const response = await app.inject({
      method: 'POST', url: '/pi/mcp', remoteAddress: '10.0.0.9',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18', authorization: bearer(`jp.${secret}`),
      },
      payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    });
    const line = response.body.split('\n').find((candidate) => candidate.startsWith('data:'))!;
    return JSON.parse(JSON.parse(line.slice(5)).result.content[0].text as string) as { outcome: string; result: Record<string, unknown> };
  }
  const gateway = scriptedGateway(async (wake) => {
    // The grant carries the very run the brain loop built for this wake, evidence included.
    const grant = registry.open({ ownerObjectId: owner, sessionId: '', messageId: '', brain: wake.run, signal: signal() });
    await tool('find_tools', { turn: grant.turn, query: 'message dan' });
    await decide(wake, (arguments_) => tool('call_tool', { turn: grant.turn, name: 'message_dan', arguments: arguments_ }));
    return { text: 'Handled.' };
  });
  const brain = createBrain({
    queue, gateway, proactive, piStore, comms, decisionLog: createDecisionLog({ area: createPiArea({ vault }) }), owner,
    timeZone: 'Europe/Copenhagen', now: () => NOW,
  });
  const ready = piStore.writeBrainSwitch(owner, true, NOW, signal());
  const tick = async () => { await ready; return brain.tick(signal()); };
  // What the queue's entrance does after an insert: tell the loop there is work.
  const offer = async (event: ProactiveEventInput) => { await queue.enqueue(event, NOW); brain.wake(); };
  return { queue, proactive, conversations, pushes, gateway, tick, offer };
}

/** What a model can read off a wake: the event's ID, both printed instants, its summary and the detail. Nothing else. */
function printedEvent(body: string, kind: string) {
  const line = body.split('\n').find((candidate) => candidate.includes(`:${kind} |`));
  const match = /^- (\S+) \| \S+ \| observed (\S+) \| verified (\S+) \([^)]*\) \| (.*)$/u.exec(line ?? '');
  if (!match) throw new Error(`The wake does not print a ${kind} event:\n${body}`);
  const [, id, observed, verified, rest] = match;
  return { line: line!, id: id!, observed: observed!, verified: verified!, summary: rest!.split(' detail=')[0]!.slice(0, 160) };
}

describe('a wake about each new signal can tell Dan through the real message_dan', () => {
  const signals: ReadonlyArray<readonly [string, ProactiveEventInput, SourceId, FindingCategory]> = [
    ['calendar.clash', clash, 'calendar', 'clash'],
    // A failed reminder rests on the task behind it, so its evidence is Todos.
    ['reminder.delivery_failed', failedReminder, 'todos', 'todo'],
  ];

  it.each(Object.keys(queuedWebhooks) as Array<keyof typeof queuedWebhooks>)('skips queued GitHub activity: %s', async (name) => {
    const t = setup();
    await t.offer(githubSignal(name));
    expect(await t.tick()).toMatchObject({ outcome: 'filtered', claimed: 1 });
    expect(t.gateway.wakes).toHaveLength(0);
    expect(t.pushes).toHaveLength(0);
  });

  it.each(signals)('%s', async (kind, input, source, category) => {
    const outcomes: Array<{ outcome: string; result: Record<string, unknown> }> = [];
    const t = setup(async (wake, tell) => {
      const printed = printedEvent(wake.body, kind);
      outcomes.push(await tell({
        text: `Dan, ${kind} needs a look.`,
        category,
        suggestionScope: 'unknown',
        evidenceSources: [source],
        evidence: [{
          source, ref: printed.id, identity: null, label: printed.summary,
          observedAt: printed.observed, verifiedAt: printed.verified,
        }],
      }));
    });
    await t.offer(input);
    expect(await t.tick()).toMatchObject({ outcome: 'done', claimed: 1 });
    expect(outcomes, JSON.stringify(outcomes)).toMatchObject([{ outcome: 'ok' }]);
    expect(t.pushes).toHaveLength(1);
    const normalized = normalizeEvent(input);
    expect([...t.conversations.proactiveReceipts.values()][0]?.evidence).toMatchObject([{
      source, identity: normalized.identity, label: normalized.summary, origin: 'event',
    }]);
  });

  it('prints the source a failed reminder rests on, so the model is told and does not have to guess', async () => {
    const t = setup();
    await t.offer(failedReminder);
    await t.tick();
    expect(printedEvent(t.gateway.wakes[0]!.body, 'reminder.delivery_failed').line).toContain('detail={"evidenceSources":["todos"]');
  });
});

describe('a failed reminder follows the Todos switch', () => {
  it('is settled as source disabled when Todos goes off after it was queued, and a later offer is a new event', async () => {
    const t = setup();
    await t.offer(failedReminder);
    await t.proactive.settings.patch({ sources: { todos: false } });
    expect(await t.tick()).toMatchObject({ outcome: 'filtered', claimed: 1 });
    expect(t.gateway.wakes).toEqual([]);
    expect(t.pushes).toEqual([]);

    await t.proactive.settings.patch({ sources: { todos: true } });
    expect(await t.queue.enqueue(failedReminder, NOW)).toMatchObject({ inserted: true });
  });
});

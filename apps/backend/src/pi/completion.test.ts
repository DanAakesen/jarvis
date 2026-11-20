import { describe, expect, it } from 'vitest';
import { createToolRegistry, type JarvisTool } from '../core/tool-registry.js';
import { createBrowserAgentModule } from '../core/browser-agent.js';
import { coreModule } from '../core/index.js';
import { createHtmlResearchModule } from '../core/research.js';
import { createWorkspacesModule } from '../core/workspaces.js';
import { factoryModule } from '../factory/index.js';
import { createGoogleModule } from '../google/tools.js';
import { createHealthModules } from '../health/index.js';
import { createInboxModule } from '../inbox/module.js';
import { createPcBridgeModule } from '../pc-bridge/bridge.js';
import { createOwnerReminderTool } from '../proactive/owner-reminder-tools.js';
import type { PiCompletionEvidence } from './completion.js';
import {
  completionEvidence, completionPlan, completionRequirement, missingCompletionEvidence,
} from './completion.js';

const healthModules = () => createHealthModules(
  true,
  { query: {}, gymTools: {}, health: {}, nutrition: {}, coach: {} } as never,
  undefined,
  {} as never,
  {} as never,
  {} as never,
);
const completionModules = () => [
  coreModule,
  createGoogleModule({} as never, { timeZone: 'Europe/Copenhagen' }),
  createPcBridgeModule(),
  createBrowserAgentModule({} as never),
  createWorkspacesModule({} as never, {} as never),
  createInboxModule({
    store: {} as never, memoryStore: {} as never,
    credentials: {} as never, ops: {} as never,
  }),
  {
    id: 'reminders',
    tools: [createOwnerReminderTool({
      ownerObjectId: '11111111-1111-4111-8111-111111111111',
      store: {} as never, vault: {} as never, now: () => new Date(),
    })],
    registerRoutes: async () => {},
  },
  createHtmlResearchModule(() => ({} as never), 'fixture-model', {} as never),
  factoryModule,
  ...healthModules(),
];
let completionRegistry: ReturnType<typeof createToolRegistry> | undefined;
const contracts = () => completionRegistry ??= createToolRegistry(completionModules());

const action = (name: string, defaultEffect: 'read' | 'action' = 'action') =>
  contracts().get(name) ?? { name, execution: { defaultEffect } } as const;

const tool = (name: string, defaultEffect: 'read' | 'action'): JarvisTool => ({
  name,
  description: 'Completion contract fixture.',
  inputSchema: {
    type: 'object',
    properties: name === 'mail_send'
      ? { to: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, body: { type: 'string' } }
      : {},
    additionalProperties: false,
  },
  execution: { defaultEffect },
  completion: contracts().get(name)?.completion,
  execute: async () => ({}),
});

describe('PI completion contract registry', () => {
  it('compiles authoritative contracts and rejects missing or divergent action contracts', () => {
    const registry = createToolRegistry([{ id: 'fixture', tools: [tool('mail_send', 'action')] }]);
    expect(registry.get('mail_send')?.completion).toMatchObject({
      domain: 'mail', operation: 'send',
      requestTargetFields: ['to', 'subject'],
      executionId: 'fixture:mail_send',
    });
    expect(() => createToolRegistry([{ id: 'fixture', tools: [tool('send_probe', 'action')] }]))
      .toThrow('missing PI completion contract');
    expect(() => createToolRegistry([{ id: 'fixture', tools: [tool('mail_send', 'read')] }]))
      .toThrow('diverges from tool execution');
    expect(() => createToolRegistry([{ id: 'fixture', tools: [{
      ...tool('mail_send', 'action'),
      inputSchema: {
        type: 'object',
        properties: { to: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    }] }])).toThrow('request fields diverge');
    expect(() => createToolRegistry([{ id: 'fixture', tools: [{
      name: 'inbox_nudge_style',
      description: 'Divergent operation fixture.',
      inputSchema: {
        type: 'object',
        properties: { operation: { type: 'string', enum: ['get'] }, text: { type: 'string' } },
        additionalProperties: false,
      },
      execution: { defaultEffect: 'unclassified', operation: { field: 'operation', effects: { get: 'action' } } },
      completion: contracts().get('inbox_nudge_style')?.completion,
      execute: async () => ({}),
    }] }])).toThrow('diverges from tool execution');
  });

  it('constructs all registered optional action contracts with matching schemas and execution effects', () => {
    expect(() => createToolRegistry(completionModules())).not.toThrow();
  });
});

describe('PI completion planning', () => {
  it('treats ordinary questions as conversation but external requests as evidence-dependent', () => {
    expect(completionRequirement('Hello, how are you?')).toBe('conversation');
    expect(completionRequirement('Tell me a task joke')).toBe('conversation');
    expect(completionRequirement('What is a GitHub issue?')).toBe('conversation');
    expect(completionRequirement('How does email work?')).toBe('conversation');
    expect(completionRequirement('What is on my calendar today?')).toBe('retrieved');
    expect(completionRequirement('Weather in Copenhagen tomorrow')).toBe('retrieved');
    expect(completionRequirement('Could you email Alice about the build?')).toBe('committed');
    expect(completionRequirement('Please deal with the email from Bob.')).toBe('committed');
    expect(completionRequirement('Forward this email to Alice.')).toBe('committed');
    expect(completionRequirement('Book a hotel room in Paris.')).toBe('committed');
    expect(completionRequirement('Opret en påmindelse for Alice.')).toBe('committed');
    expect(completionRequirement('Kan du venligst åbne Chrome på min pc?')).toBe('committed');
    expect(completionRequirement('Research the latest battery chemistry.')).toBe('durable_job');
    expect(completionRequirement('Implement issue 1967 in my repo')).toBe('durable_job');
    for (const question of [
      'How many emails did I send Alice?',
      'Did you send the email to Alice?',
      'Has the calendar changed?',
      'Is the Azure resource healthy?',
      'Are there open GitHub issues?',
    ]) {
      const plan = completionPlan(question);
      expect(plan.kind).toBe('retrieved');
      expect(plan.requirements.every(requirement => requirement.operation === 'read')).toBe(true);
    }
    for (const question of [
      'Kan du venligst læse e-mailen fra Alice?',
      'Kan du se kalenderaftalen?',
      'Kan du fortælle mig hvad kalenderen viser?',
      'Hvor mange e-mails har jeg?',
      'Har du sendt e-mailen til Alice?',
      'Er kalenderaftalen ændret?',
      'Hvad stod der i den?',
      'Hvordan står det til med Azure?',
      'Står Azure stadig oppe?',
      'Viser GitHub nogen fejl?',
      'Ser GitHub pull request 7 sund ud?',
      'Why is Azure down?',
      'Explain why Azure is down.',
      'Hvorfor fejler GitHub?',
    ]) {
      expect(completionPlan(question)).toMatchObject({
        kind: question === 'Hvad stod der i den?' ? 'conversation' : 'retrieved',
      });
    }
    expect(completionPlan('Why is Azure down?').requirements[0]).toMatchObject({
      domain: 'azure', operation: 'read', kind: 'retrieved', targetHashes: [],
    });
    expect(completionPlan('Star DanAakesen/jarvis on GitHub.')).toMatchObject({
      kind: 'committed',
      requirements: [expect.objectContaining({ domain: 'github', operation: 'update' })],
    });
    const asked = completionPlan('Did I send Alice an email?');
    expect(completionEvidence(
      asked,
      action('mail_send'),
      { to: ['alice@example.com'], subject: 'Build', body: 'It passed.' },
      { status: 'completed' },
    )).toBeUndefined();
    expect(completionEvidence(
      asked,
      action('mail_search', 'read'),
      { query: 'alice@example.com sent' },
      { messages: [{ id: 'mail-1', to: 'Alice <alice@example.com>', subject: 'Build' }] },
    )).toMatchObject({ kind: 'retrieved' });
  });

  it('requires every source domain in a compound external action', () => {
    const plan = completionPlan('Email Alice today’s calendar and the weather in Copenhagen.');
    expect(plan.requirements.map(({ kind, domain }) => [kind, domain])).toEqual([
      ['committed', 'mail'],
      ['retrieved', 'calendar'],
      ['retrieved', 'weather'],
    ]);
    const compound = completionPlan('Book a meeting with Alice and email Bob the details.');
    expect(compound.requirements.map(({ kind, domain }) => [kind, domain])).toEqual([
      ['committed', 'calendar'],
      ['committed', 'mail'],
    ]);
    expect(completionPlan('Read GitHub issue 1967.')
      .requirements.map(({ kind, domain }) => [kind, domain])).toEqual([
      ['retrieved', 'github'],
    ]);
    expect(completionPlan('Remember this preference about Alice.')
      .requirements.map(({ kind, domain }) => [kind, domain])).toEqual([
      ['committed', 'memory'],
    ]);
  });
});

describe('PI completion receipts', () => {
  it('keeps the direct receipt helper compatible for fixture and smoke callers', () => {
    expect(completionEvidence(
      action('calendar_create_event'),
      { summary: 'Planning' },
      { status: 'completed' },
    )).toMatchObject({ kind: 'committed', domain: 'calendar' });
  });

  it('binds exact tool, arguments and target to the classified request', () => {
    const plan = completionPlan('Open Spotify on my PC.');
    const valid = completionEvidence(
      plan,
      action('pc_open'),
      { target: 'app', value: 'Spotify' },
      { opened: true },
    );
    expect(valid).toMatchObject({ tool: 'pc_open', kind: 'committed', domain: 'pc' });
    expect(completionEvidence(
      plan,
      action('pc_open'),
      { target: 'app', value: 'Chrome' },
      { opened: true },
    )).toBeUndefined();
    expect(completionEvidence(
      completionPlan('What is the weather in Copenhagen?'),
      action('calendar_list_events', 'read'),
      { query: 'Copenhagen' },
      { events: [] },
    )).toBeUndefined();
    expect(completionEvidence(
      completionPlan('What is on my calendar today?'),
      action('calendar_today_agenda', 'read'),
      {},
      { events: [] },
    )).toMatchObject({ kind: 'retrieved', domain: 'calendar' });
    const readPlan = completionPlan('What is on my calendar?');
    const writeReceipt = completionEvidence(
      readPlan,
      action('calendar_create_event'),
      { summary: 'Planning' },
      { status: 'completed' },
    );
    expect(writeReceipt).toBeUndefined();
    expect(missingCompletionEvidence(readPlan, { evidence: writeReceipt ? [writeReceipt] : [] }))
      .toMatchObject({ kind: 'retrieved', domain: 'calendar' });
  });

  it('requires target identifiers in an action receipt and rejects unrelated IDs', () => {
    const plan = completionPlan('Open workspace item 77.');
    expect(completionEvidence(
      plan,
      action('workspaces_open'),
      { id: '77' },
      { id: '77', title: 'Quarterly report', kind: 'research', opened: true },
    )).toMatchObject({ kind: 'committed' });
    expect(completionEvidence(
      plan,
      action('workspaces_open'),
      { id: '77' },
      { id: '88', title: 'Unrelated item', kind: 'research', opened: true },
    )).toBeUndefined();
    expect(completionEvidence(
      completionPlan('Delete calendar event 42.'),
      action('calendar_update_event'),
      { eventId: '42', title: 'Still here' },
      { status: 'completed' },
    )).toBeUndefined();
  });

  it('uses terminal-success predicates instead of arbitrary receipt-looking fields', () => {
    const email = completionPlan('Email Alice about the build.');
    expect(completionEvidence(
      email,
      action('mail_send'),
      { to: ['alice@example.com'], subject: 'Build', body: 'It passed.' },
      { status: 'completed', messageId: 'gmail-1' },
    )).toMatchObject({ kind: 'committed' });
    for (const status of ['partial', 'cancelled', 'awaiting_confirmation', 'unverified']) {
      expect(completionEvidence(
        email,
        action('mail_send'),
        { to: ['alice@example.com'], subject: 'Build', body: 'It passed.' },
        { status, messageId: 'gmail-1' },
      )).toBeUndefined();
    }
    expect(completionEvidence(
      completionPlan('Send the calendar invitation to Alice.'),
      action('calendar_create_event'),
      { summary: 'Alice planning', start: '2026-11-21T10:00:00Z' },
      { id: 'event-1', status: 'unverified' },
    )).toBeUndefined();
    expect(completionEvidence(
      completionPlan('Send Alice an email.'),
      action('unknown_write'),
      { recipient: 'alice@example.com' },
      { id: 'random-1', status: 'completed' },
    )).toBeUndefined();
    expect(completionEvidence(
      completionPlan('Merge GitHub pull request 42.'),
      action('github_write'),
      { operation: 'pr_merge', repository: 'DanAakesen/jarvis', number: 42, method: 'squash' },
      {
        status: 'merged', repository: 'DanAakesen/jarvis', number: 42,
        sha: 'a'.repeat(40), message: 'Merged.',
      },
    )).toMatchObject({ kind: 'committed', domain: 'github' });
  });

  it('never treats mail draft updates as send evidence and binds only draft/recipient fields', () => {
    const update = completionPlan('Update draft draft-77 for Alice.');
    expect(completionEvidence(
      update,
      action('mail_update_draft'),
      { draftId: 'draft-77', to: ['alice@example.com'], subject: 'Alpha', body: 'Private body.' },
      { status: 'completed' },
    )).toMatchObject({ operation: 'update', kind: 'committed' });

    const create = completionPlan('Create the draft for Alice.');
    expect(completionEvidence(
      create,
      action('mail_update_draft'),
      { draftId: 'draft-77', to: ['alice@example.com'], subject: 'Alpha', body: 'Private body.' },
      { status: 'completed' },
    )).toMatchObject({ operation: 'update', kind: 'committed' });

    const send = completionPlan('Send the draft to Alice.');
    expect(completionEvidence(
      send,
      action('mail_update_draft'),
      { draftId: 'draft-77', to: ['alice@example.com'], subject: 'Alpha', body: 'Private body.' },
      { status: 'completed' },
    )).toBeUndefined();

    const bodyOnly = completionPlan('Update draft draft-77 about Project Alpha.');
    expect(completionEvidence(
      bodyOnly,
      action('mail_update_draft'),
      { draftId: 'draft-77', to: ['bob@example.com'], subject: 'Gamma', body: 'Project Alpha details.' },
      { status: 'completed' },
    )).toBeUndefined();
  });

  it('keeps provider-specific operations aligned for calendar, mail and browser work', () => {
    expect(completionEvidence(
      completionPlan('Create calendar event Project Alpha.'),
      action('calendar_create_event'),
      { subject: 'Project Alpha', startDateTime: '2026-11-21T10:00:00Z', endDateTime: '2026-11-21T11:00:00Z' },
      { status: 'completed' },
    )).toMatchObject({ operation: 'create', domain: 'calendar' });

    const archivePlan = completionPlan('Archive Alice’s email.');
    const aliceMessage = completionEvidence(
      archivePlan,
      action('mail_search', 'read'),
      { query: 'from:alice@example.com' },
      { messages: [{ id: 'mail-1', from: 'Alice <alice@example.com>', subject: 'Build' }] },
    );
    expect(completionEvidence(
      archivePlan,
      action('mail_archive'),
      { messageId: 'mail-1' },
      { status: 'completed' },
      aliceMessage ? [aliceMessage] : [],
    )).toMatchObject({ operation: 'delete', domain: 'mail' });

    expect(completionEvidence(
      completionPlan('Book a hotel in Paris.'),
      action('browser_do'),
      { goal: 'Book a hotel in Paris' },
      { status: 'completed', tabId: 'tab-1' },
    )).toMatchObject({ operation: 'create', domain: 'web' });

    expect(completionEvidence(
      completionPlan('Create a reminder for Alice tomorrow.'),
      action('owner_reminders'),
      { operation: 'create', task: 'Alice', fireAt: '2026-11-21T09:00:00Z' },
      { created: true, reminder: { id: 'reminder-1', task: 'Alice', state: 'scheduled' } },
    )).toMatchObject({ operation: 'create', domain: 'tasks' });
    expect(completionEvidence(
      completionPlan('Cancel Alice’s reminder.'),
      action('owner_reminders'),
      { operation: 'cancel', id: 'reminder-1', task: 'Alice' },
      { cancelled: true, reminder: { id: 'reminder-1', task: 'Alice', state: 'cancelled' } },
    )).toMatchObject({ operation: 'delete', domain: 'tasks' });
    const cancelPlan = completionPlan('Cancel worker 77.');
    expect(cancelPlan).toMatchObject({
      kind: 'committed',
      requirements: [{ kind: 'committed', domain: 'factory', operation: 'delete' }],
    });
    const cancelTool = action('cancel_task');
    expect(cancelTool).toMatchObject({
      completion: { domain: 'factory', operation: 'delete' },
    });
    expect(cancelTool.completion?.evaluate(
      { taskId: '77' },
      { id: '77', state: 'Cancelled' },
    )).toBe(true);
    expect(completionEvidence(
      action('cancel_task'),
      { taskId: '77' },
      { id: '77', state: 'Cancelled' },
    )).toMatchObject({ kind: 'durable_job', operation: 'delete', domain: 'factory' });
    expect(completionEvidence(
      cancelPlan,
      action('cancel_task'),
      { taskId: '77' },
      { id: '77', state: 'Cancelled' },
    )).toMatchObject({ operation: 'delete', kind: 'durable_job', domain: 'factory' });

    expect(completionEvidence(
      completionPlan('Issue an inbox credential for iPhone.'),
      action('inbox_capture_credential'),
      { operation: 'issue', label: 'iPhone', scope: 'write' },
      { credential: 'shown-once', id: 'abcdef123456', label: 'iPhone', scope: 'write' },
    )).toMatchObject({ operation: 'create', domain: 'settings' });

    expect(completionEvidence(
      action('manage_model_deployment'),
      { action: 'create', model: 'gpt-6', version: '2026-11', sku: 'GlobalStandard', capacity: 1 },
      { status: 'accepted', name: 'gpt-6-2026-11', model: 'gpt-6', version: '2026-11' },
    )).toMatchObject({ operation: 'create', domain: 'settings' });

    const mealPreference = action('health_nutrition_history');
    expect(mealPreference.completion?.evaluate(
      { operation: 'set_meal_preference', mealKey: 'favorite:1', preference: 'like' },
      { status: 'unchanged', mealKey: 'favorite:1', preference: 'like' },
    )).toBe(true);
    expect(completionEvidence(
      mealPreference,
      { operation: 'set_meal_preference', mealKey: 'favorite:1', preference: 'like' },
      { status: 'unchanged', mealKey: 'favorite:1', preference: 'like' },
    )).toMatchObject({ operation: 'update', domain: 'health' });
    expect(completionEvidence(
      action('health_nutrition_targets'),
      { operation: 'set_targets', targets: { proteinGrams: 180 } },
      { status: 'unchanged', targets: { proteinGrams: 180 } },
    )).toMatchObject({ operation: 'update', domain: 'health' });
    expect(completionEvidence(
      action('health_saved_food'),
      { operation: 'save_plan', name: 'Weekday plan', entries: [] },
      { status: 'already-applied', operation: 'save_plan', record: { id: 'plan-1' } },
    )).toMatchObject({ operation: 'create', domain: 'health' });

    const click = completionPlan('Click Checkout on my PC.');
    const snapshot = completionEvidence(
      click,
      action('pc_browser_snapshot', 'read'),
      { tabId: 'tab-1' },
      { tabId: 'tab-1', snapshotId: 'snapshot-1', elements: [{ index: 2, name: 'Checkout' }] },
    );
    expect(completionEvidence(
      click,
      action('pc_browser_act'),
      { tabId: 'tab-1', snapshotId: 'snapshot-1', elementIndex: 2, action: 'click' },
      { acted: true, action: 'click' },
      snapshot ? [snapshot] : [],
    )).toMatchObject({ operation: 'update', domain: 'pc' });
    expect(completionEvidence(
      click,
      action('pc_browser_act'),
      { tabId: 'tab-1', snapshotId: 'snapshot-1', elementIndex: 2, action: 'click' },
      { acted: true, action: 'type' },
      snapshot ? [snapshot] : [],
    )).toBeUndefined();
  });

  it('accepts an exact opened true receipt but not a false or unrelated one', () => {
    const plan = completionPlan('Open the saved workspace report Alpha.');
    expect(completionEvidence(
      plan,
      action('workspaces_open'),
      { query: 'Alpha' },
      { id: 'report-1', title: 'Alpha', kind: 'research', opened: true },
    )).toMatchObject({ kind: 'committed' });
    expect(completionEvidence(
      plan,
      action('workspaces_open'),
      { query: 'Alpha' },
      { id: 'report-1', title: 'Alpha', kind: 'research', opened: false },
    )).toBeUndefined();
  });

  it('uses the declared workspace action discriminator and terminal result', () => {
    const deletion = completionEvidence(
      completionPlan('Delete workspace item 77.'),
      action('workspaces_manage'),
      { id: '77', action: 'delete' },
      { id: '77', title: 'Old report', deleted: true },
    );
    expect(deletion).toMatchObject({ operation: 'delete', kind: 'committed' });
    expect(completionEvidence(
      completionPlan('Delete workspace item 77.'),
      action('workspaces_manage'),
      { id: '77', action: 'delete' },
      { id: '77', title: 'Old report', action: 'rename' },
    )).toBeUndefined();
    expect(completionEvidence(
      completionPlan('Pin workspace item 77.'),
      action('workspaces_manage'),
      { id: '77', action: 'pin' },
      { id: '77', title: 'Old report', action: 'pin', pinned: true },
    )).toMatchObject({ operation: 'update' });
    expect(completionEvidence(
      completionPlan('Unpin workspace item 77.'),
      action('workspaces_manage'),
      { id: '77', action: 'unpin' },
      { id: '77', title: 'Old report', action: 'pin', pinned: true },
    )).toBeUndefined();
  });

  it('links an opaque action ID back to the retrieved target before accepting it', () => {
    const plan = completionPlan('Draft a reply to the email from Alice.');
    const read = completionEvidence(
      plan,
      action('mail_search', 'read'),
      { query: 'from:alice@example.com' },
      {
        messages: [
          { id: 'mail-1', from: 'Alice <alice@example.com>', subject: 'Hello' },
          { id: 'mail-2', from: 'Bob <bob@example.com>', subject: 'Other' },
        ],
      },
    );
    expect(read).toMatchObject({ kind: 'retrieved', domain: 'mail' });
    const reply = completionEvidence(
      plan,
      action('mail_draft_reply'),
      { messageId: 'mail-1', replyBody: 'Thanks, Alice.' },
      { status: 'completed' },
      read ? [read] : [],
    );
    expect(reply).toMatchObject({ kind: 'committed', tool: 'mail_draft_reply' });
    expect(completionEvidence(
      plan,
      action('mail_draft_reply'),
      { messageId: 'mail-2', replyBody: 'Thanks.' },
      { status: 'completed' },
      read ? [read] : [],
    )).toBeUndefined();
  });

  it('requires trusted same-turn context for contextual actions and keeps the requested operation', () => {
    const deletion = completionPlan('Delete it.');
    const direct = completionEvidence(
      deletion,
      action('workspaces_manage'),
      { id: '77', action: 'delete' },
      { id: '77', title: 'Old report', deleted: true },
    );
    expect(direct).toBeUndefined();

    const read = completionEvidence(
      action('workspaces_search', 'read'),
      { query: 'Old report' },
      { items: [{ id: '77', title: 'Old report', kind: 'research' }] },
    );
    expect(read).toMatchObject({ kind: 'retrieved' });
    const resolved = completionEvidence(
      deletion,
      action('workspaces_manage'),
      { id: '77', action: 'delete' },
      { id: '77', title: 'Old report', deleted: true },
      read ? [read] : [],
    );
    expect(resolved).toMatchObject({ kind: 'committed', operation: 'delete' });
    expect(completionEvidence(
      deletion,
      action('workspaces_manage'),
      { id: '77', action: 'rename', title: 'New report' },
      { id: '77', title: 'New report', action: 'rename' },
      read ? [read] : [],
    )).toBeUndefined();

    const ambiguousRead = completionEvidence(
      action('workspaces_search', 'read'),
      { query: 'recent report' },
      {
        items: [
          { id: '77', title: 'Old report', kind: 'research' },
          { id: '88', title: 'New report', kind: 'research' },
        ],
      },
    );
    expect(completionEvidence(
      deletion,
      action('workspaces_manage'),
      { id: '77', action: 'delete' },
      { id: '77', title: 'Old report', deleted: true },
      ambiguousRead ? [ambiguousRead] : [],
    )).toBeUndefined();
  });

  it('requires a unique trusted prior identity for contextual reads', () => {
    const plan = completionPlan('Read it.');
    const result = {
      messages: [{ id: 'mail-1', from: 'Alice <alice@example.com>', subject: 'Build' }],
    };
    const readBinding = completionEvidence(
      action('mail_search', 'read'),
      { query: 'from:alice@example.com' },
      result,
    );
    expect(readBinding).toMatchObject({ kind: 'retrieved', domain: 'mail' });
    expect(completionEvidence(
      plan,
      action('mail_search', 'read'),
      { query: 'mail-1' },
      result,
    )).toBeUndefined();
    expect(completionEvidence(
      plan,
      action('mail_search', 'read'),
      { query: 'mail-1' },
      result,
      readBinding ? [readBinding] : [],
    )).toMatchObject({ kind: 'retrieved', domain: 'mail' });

    const ambiguousBinding = completionEvidence(
      action('mail_search', 'read'),
      { query: 'recent mail' },
      {
        messages: [
          ...result.messages,
          { id: 'mail-2', from: 'Bob <bob@example.com>', subject: 'Other' },
        ],
      },
    );
    expect(completionEvidence(
      completionPlan('What did it say?'),
      action('mail_search', 'read'),
      { query: 'mail-1' },
      result,
      ambiguousBinding ? [ambiguousBinding] : [],
    )).toBeUndefined();
    expect(missingCompletionEvidence(plan, { evidence: [] }))
      .toMatchObject({ kind: 'retrieved', domain: 'generic', operation: 'read' });
  });

  it('binds Danish read grammar while preserving phrase-identifiers as targets', () => {
    const mailPlan = completionPlan('Kan du fortælle mig hvad der står i e-mailen fra Alice?');
    expect(mailPlan.requirements[0]).toMatchObject({
      kind: 'retrieved', domain: 'mail', operation: 'read',
    });
    expect(completionEvidence(
      mailPlan,
      action('mail_search', 'read'),
      { query: 'from:alice@example.com' },
      { messages: [{ id: 'mail-1', from: 'Alice <alice@example.com>', subject: 'Build' }] },
    )).toMatchObject({ kind: 'retrieved', domain: 'mail' });

    const azurePlan = completionPlan('Kan du forklare hvorfor Azure-statusen er nede?');
    expect(azurePlan.requirements[0]).toMatchObject({
      kind: 'retrieved', domain: 'azure', operation: 'read',
    });
    expect(azurePlan.requirements[0]?.targetHashes).toHaveLength(1);
    expect(completionEvidence(
      azurePlan,
      action('az_group_list', 'read'),
      { query: 'Azure-statusen' },
      { status: 'down', resources: [] },
    )).toMatchObject({ kind: 'retrieved', domain: 'azure' });

    const pathPlan = completionPlan('Read check-config.ts.');
    expect(pathPlan.runtimeTargetHashes).toHaveLength(1);
    expect(completionEvidence(
      pathPlan,
      action('vault_read', 'read'),
      { path: 'check-config.ts' },
      { path: 'check-config.ts', url: 'file://check-config.ts' },
    )).toMatchObject({ kind: 'retrieved', domain: 'notes' });

    const hyphenPlan = completionPlan('Check GitHub status-update.');
    expect(hyphenPlan).toMatchObject({
      kind: 'retrieved',
      requirements: [expect.objectContaining({ operation: 'read', domain: 'github' })],
    });
    expect(hyphenPlan.requirements[0]?.targetHashes).toHaveLength(1);
    expect(completionPlan('Update GitHub status-update.')).toMatchObject({
      kind: 'committed',
      requirements: [expect.objectContaining({ operation: 'update', domain: 'github' })],
    });
  });
});

describe('durable work completion', () => {
  it('does not let an issue receipt finish prescribed own-code work', () => {
    const plan = completionPlan('Implement issue 1967 in my code.');
    const issue = completionEvidence(
      plan,
      action('create_issue'),
      {
        title: 'Fix issue 1967',
        body: 'Implement issue 1967 in DanAakesen/jarvis.',
      },
      { number: 2000, url: 'https://github.com/DanAakesen/jarvis/issues/2000', taskCode: 'P11-99' },
    );
    expect(issue).toBeUndefined();
    expect(missingCompletionEvidence(plan, { evidence: issue ? [issue] : [] }))
      .toMatchObject({ kind: 'durable_job', domain: 'factory' });
    expect(completionEvidence(
      plan,
      action('create_task'),
      { projectId: '1', prompt: 'Implement issue 1967.' },
      { task: { id: '77', title: 'Implement issue 1967', state: 'Ready', agent: 'jarvis' } },
    )).toBeUndefined();
  });

  it('requires a durable active task status and rejects read-only old task evidence', () => {
    const plan = completionPlan('Start issue 1967 as a worker.');
    const started = completionEvidence(
      plan,
      action('start_issue'),
      { issue: 1967 },
      {
        task: { id: '77', title: 'Issue 1967', state: 'Ready', agent: 'jarvis' },
        issue: { number: 1967, url: 'https://github.com/DanAakesen/jarvis/issues/1967' },
      },
    );
    expect(started).toMatchObject({ kind: 'durable_job' });
    const oldRead = completionEvidence(
      plan,
      action('get_work_status', 'read'),
      { issueNumber: 1967 },
      { tasks: [{ id: '77', state: 'Done' }] },
    );
    expect(oldRead).toMatchObject({ tool: 'get_work_status', kind: 'retrieved' });
    const evidence = started ? [started] as PiCompletionEvidence[] : [];
    expect(missingCompletionEvidence(plan, { evidence })).toBeUndefined();
  });

  it('requires a background research job path, not only retrieved web text', () => {
    const plan = completionPlan('Research the latest battery chemistry.');
    const read = completionEvidence(
      plan,
      action('web_research', 'read'),
      { query: 'latest battery chemistry' },
      { answer: 'Solid-state batteries are improving.', sources: [] },
    );
    expect(read).toMatchObject({ kind: 'retrieved' });
    expect(missingCompletionEvidence(plan, { evidence: read ? [read] : [] }))
      .toMatchObject({ kind: 'durable_job', domain: 'web' });
    const job = completionEvidence(
      plan,
      action('research'),
      { topic: 'latest battery chemistry' },
      { jobId: '00000000-0000-4000-8000-000000000077', status: 'running' },
    );
    expect(job).toMatchObject({ kind: 'durable_job', domain: 'web' });
  });

  it('rejects a durable task whose nested issue receipt belongs to another target', () => {
    const plan = completionPlan('Start issue 1967 as a worker.');
    expect(completionEvidence(
      plan,
      action('start_issue'),
      { issue: 1967 },
      {
        task: { id: '77', title: 'Another issue', state: 'Ready' },
        issue: { number: 1968, url: 'https://github.com/DanAakesen/jarvis/issues/1968' },
      },
    )).toBeUndefined();
  });
});

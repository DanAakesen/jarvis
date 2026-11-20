import { describe, expect, it } from 'vitest';
import type { PiCompletionEvidence } from './completion.js';
import {
  completionEvidence, completionPlan, completionRequirement, missingCompletionEvidence,
} from './completion.js';

const action = (name: string, defaultEffect: 'read' | 'action' = 'action') => ({
  name,
  execution: { defaultEffect },
} as const);

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
    expect(completionRequirement('Research the latest battery chemistry.')).toBe('durable_job');
    expect(completionRequirement('Implement issue 1967 in my repo')).toBe('durable_job');
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

  it('links an opaque action ID back to the retrieved target before accepting it', () => {
    const plan = completionPlan('Reply to the email from Alice.');
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

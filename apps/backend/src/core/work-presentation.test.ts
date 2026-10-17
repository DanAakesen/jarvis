import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { isGeneratedView, isJarvisActivityEvent, type JarvisActivityEvent, type WorkspaceCommand } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { BackendModule } from '../modules.js';
import { coreModule } from './index.js';
import { createToolRegistry, ToolRefusal } from './tool-registry.js';
import { redactWorkContent, startWorkPresentation } from './work-presentation.js';
import { defaultSettings, type SettingsStore } from './settings.js';
import { executeReflexAction } from './reflex.js';
import { executeRealtimeToolCall } from '../voice/realtime.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(options: { setting?: boolean; mode?: 'present' | 'on_the_move'; settingsStore?: SettingsStore } = {}) {
  const app = buildApp(config, undefined, {
    modules: [],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    settingsStore: options.settingsStore ?? {
      read: async () => ({ 'presentation.show_work': options.setting ?? true }),
      write: async () => {},
    },
    awayModeStore: {
      read: async () => ({ mode: options.mode ?? 'present', source: 'manual', changedAt: new Date().toISOString() }),
      set: async (mode) => ({ mode, source: 'manual', changedAt: new Date().toISOString() }),
      markPresent: async () => ({ mode: 'present', source: 'manual', changedAt: new Date().toISOString() }),
    },
  });
  apps.push(app);
  const events: JarvisActivityEvent[] = [];
  app.jarvisActivityHub.subscribe((event) => { if (isJarvisActivityEvent(event)) events.push(event); });
  const commands: WorkspaceCommand[] = [];
  const connection = app.workspaceCommands.connect(app.ownerObjectId, (event, data) => {
    if (event === 'workspace-command') {
      commands.push(data.command);
      queueMicrotask(() => app.workspaceCommands.acknowledge(app.ownerObjectId, connection.sessionId, data.command.commandId, true));
    }
    return true;
  });
  const request = { server: app } as FastifyRequest;
  const start = (tool: string, input: unknown = {}, turn = '101', signal = new AbortController().signal, surface: 'chat' | 'voice' = 'voice') =>
    startWorkPresentation(tool, input, request, randomUUID(), turn, signal, surface);
  return { app, events, commands, start, connection };
}

async function settled() {
  // Flush settings, publication, and broker acknowledgements without a timer delay.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const proposalSummary = 'Create 2 calendar events:\n\n1. Hotel North: 12-13 February 2027.\n\n2. Hotel South: 20-21 February 2027.';
const proposal = { status: 'awaiting_confirmation', summary: proposalSummary, confirmationCode: '12345678' };

function realtimeFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options);
  const execute = vi.fn(async () => proposal);
  const confirm = vi.fn(async () => ({ status: 'completed' }));
  const tools = createToolRegistry([{
    id: 'voice-preview-test',
    tools: [
      ...['calendar_create_events', 'calendar_get_pending_change'].map((name) => ({
        name, description: 'Synthetic calendar receipt.', sensitive: true,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute,
      })),
      {
        name: 'calendar_confirm_change', description: 'Synthetic calendar write.', sensitive: true,
        inputSchema: { type: 'object' }, execute: confirm,
      },
    ],
  }]);
  f.app.post<{ Params: { tool: string } }>('/test/realtime/:tool', async (request, reply) => {
    request.jarvisMemorySourceMessageId = '101';
    return reply.type('application/json').send(await executeRealtimeToolCall({
      type: 'response.function_call_arguments.done', name: request.params.tool,
      call_id: 'call-preview', arguments: JSON.stringify(request.body),
    }, tools, request, new AbortController().signal));
  });
  const invoke = (tool = 'calendar_create_events', input: Record<string, unknown> = {}) => f.app.inject({
    method: 'POST', url: `/test/realtime/${tool}`,
    headers: { authorization: ['Bearer', 'header.agent.signature'].join(' ') }, payload: input,
  });
  return { ...f, execute, confirm, invoke };
}

describe('realtime voice work presentation', () => {
  it.each(['calendar_create_events', 'calendar_get_pending_change'])(
    'shows the returned two-event proposal for %s without confirming it', async (tool) => {
      const { invoke, commands, events, confirm } = realtimeFixture();
      const response = await invoke(tool);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json()).toMatchObject({ outcome: 'ok', result: proposal });
      await settled();
      expect(commands[0]).toMatchObject({
        operation: 'create', viewId: 'google-101',
        view: { renderer: 'text', data: { format: 'plain', content: proposalSummary } },
      });
      expect(commands[1]).toMatchObject({ operation: 'focus', viewId: 'google-101' });
      expect(commands[0] && 'view' in commands[0] && isGeneratedView(commands[0].view)).toBe(true);
      expect(events.map((event) => event.type)).toEqual(['work-started', 'work-finished']);
      expect(JSON.stringify(commands)).not.toContain(proposal.confirmationCode);
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it.each([{ setting: false }, { mode: 'on_the_move' as const }])(
    'preserves automatic-presentation preferences for %j', async (options) => {
      const { invoke, commands, events } = realtimeFixture(options);
      expect((await invoke()).json().outcome).toBe('ok');
      await settled();
      expect(commands).toEqual([]);
      expect(events).toEqual([]);
    },
  );

  it('never displays a refused or invalid proposal and never confirms it', async () => {
    const { invoke, execute, confirm, commands, events } = realtimeFixture();
    execute.mockRejectedValueOnce(new ToolRefusal('Nothing was staged.'));
    expect((await invoke()).json().outcome).toBe('refused');
    await settled();
    expect(commands).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['work-started', 'work-finished']);
    expect((await invoke('calendar_create_events', { unexpected: 'private-value' })).json().outcome).toBe('refused');
    await settled();
    expect(execute).toHaveBeenCalledOnce();
    expect(commands).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not fail the staged result when no screen is connected', async () => {
    const { invoke, connection, commands, events, confirm } = realtimeFixture();
    connection.close();
    expect((await invoke()).json()).toMatchObject({ outcome: 'ok', result: proposal });
    await settled();
    expect(commands).toEqual([]);
    expect(events).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('best-effort work presentation', () => {
  it('pairs safe activity details and ends them even on refusal', async () => {
    const { start, events, commands } = fixture();
    const work = start('vault_search', { query: 'Ignite token=private-value' });
    await settled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'work-started', kind: 'vault_search', text: 'Searching your vault for Ignite token=[REDACTED]' });
    work.finish({ refused: 'private refusal' }, false);
    await settled();
    expect(events[1]).toEqual({ type: 'work-finished', activityId: events[0].activityId });
    expect(JSON.stringify(events)).not.toContain('private');
    expect(commands).toHaveLength(0);
  });

  it('updates one Code view per turn with escaped, bounded, redacted lines', async () => {
    const { start, commands } = fixture();
    start('repo_read', { path: 'src/a.ts' }).finish({
      repository: 'DanAakesen/jarvis', path: 'src/a.ts', startLine: 15,
      content: '<script>alert(1)</script>\n"password": "private-value"\n' + Array(500).fill('line').join('\n'),
    }, true);
    await settled();
    start('repo_read', { path: 'src/b.ts' }).finish({ repository: 'DanAakesen/jarvis', path: 'src/b.ts', content: 'second' }, true);
    await settled();
    const views = commands.filter((command) => command.operation === 'create' || command.operation === 'update');
    expect(views.map((command) => [command.operation, command.viewId])).toEqual([['create', 'code-101'], ['update', 'code-101']]);
    const first = views[0];
    expect(first && 'view' in first && isGeneratedView(first.view)).toBe(true);
    if (!first || !('view' in first) || first.view.renderer !== 'code') throw new Error('Missing Code view');
    expect(first.view.data.content).toContain('&lt;script&gt;');
    expect(first.view.data.content).not.toContain('private-value');
    expect(first.view.data.content).not.toContain('<script>');
    expect(first.view.data.content.split('\n')).toHaveLength(400);
    expect(first.view.data.highlight).toEqual([{ from: 15, to: 414 }]);
    expect(commands.filter((command) => command.operation === 'focus')).toHaveLength(2);
    start('repo_list', { path: '.' }, '102').finish({ repository: 'DanAakesen/jarvis', entries: [] }, true);
    await settled();
    expect(commands.at(-2)).toMatchObject({ operation: 'create', viewId: 'code-102' });
  });

  it('shows code-search matches with their paths and actual source line numbers', async () => {
    const { start, commands } = fixture();
    start('repo_search', { query: 'needle' }).finish({
      repository: 'DanAakesen/jarvis',
      results: [{ path: 'a.ts', line: 42, snippet: 'needle' }, { path: 'b.ts', line: 87, snippet: '<needle>' }],
    }, true);
    await settled();
    expect(commands[0]).toMatchObject({ view: { renderer: 'code', data: {
      query: 'needle', content: 'a.ts:42 needle\nb.ts:87 &lt;needle&gt;', highlight: [{ from: 1, to: 1 }, { from: 2, to: 2 }],
    } } });
  });

  it('reuses the graph and highlights only returned note paths', async () => {
    const { start, commands } = fixture();
    start('vault_search', { query: 'Ignite' }).finish({ results: [{ path: 'Work/Ignite.md' }] }, true);
    await settled();
    start('vault_read', { path: 'Work/Next.md' }).finish({ path: 'Work/Next.md', content: 'private note body' }, true);
    await settled();
    start('memory_search', { query: 'empty' }, '102').finish({ memories: [] }, true);
    await settled();
    expect(commands[0]).toMatchObject({ operation: 'create', viewId: 'knowledge-graph', view: { data: {
      query: 'Ignite', highlight: [createHash('sha256').update('Work/Ignite.md').digest('hex')],
    } } });
    expect(commands[2]).toMatchObject({ operation: 'update', viewId: 'knowledge-graph', view: { data: { query: 'Work/Next.md' } } });
    expect(commands[4]).toMatchObject({ operation: 'update', view: { data: { highlight: [] } } });
    expect(JSON.stringify(commands)).not.toContain('private note body');
  });

  it('recreates a graph closed in a newer workspace snapshot', async () => {
    const { app, start, commands, connection } = fixture();
    const snapshot = (windows: { viewId: string; title: string }[]) =>
      app.workspaceCommands.updateSnapshot(app.ownerObjectId, connection.sessionId, { windows, contextPanelOpen: false });
    snapshot([]);
    start('vault_search', { query: 'first' }).finish({ results: [] }, true);
    await settled();
    snapshot([{ viewId: 'knowledge-graph', title: 'Knowledge graph' }]);
    start('vault_search', { query: 'second' }, '102').finish({ results: [] }, true);
    await settled();
    snapshot([]);
    start('vault_search', { query: 'third' }, '103').finish({ results: [] }, true);
    await settled();
    start('vault_search', { query: 'fourth' }, '104').finish({ results: [] }, true);
    await settled();
    expect(commands.filter((command) => command.operation === 'create' || command.operation === 'update')
      .map((command) => command.operation)).toEqual(['create', 'update', 'create', 'update']);
  });

  it.each(['create_task', 'steer_task', 'retry_task'])('focuses the task after %s succeeds', async (tool) => {
    const { start, commands } = fixture();
    start(tool, { taskId: '55' }).finish(tool === 'create_task' ? { id: '56' } : { status: 'ok' }, true);
    await settled();
    expect(commands).toEqual([expect.objectContaining({ operation: 'navigate', page: 'factory', taskId: tool === 'create_task' ? '56' : '55' })]);
  });

  it.each(['calendar_create_event', 'mail_draft_reply'])('previews staged %s without confirmation codes', async (tool) => {
    const { start, commands } = fixture();
    start(tool).finish({ status: 'awaiting_confirmation', summary: '<draft>\npassword=private-value', confirmationCode: '12345678' }, true);
    await settled();
    expect(commands[0]).toMatchObject({ view: { renderer: 'text', data: { format: 'plain', content: '<draft>\npassword=[REDACTED]' } } });
    expect(JSON.stringify(commands)).not.toMatch(/12345678|private-value/u);
  });

  it('shows calendar results as a readable agenda in the calendar time zone, never escaped JSON', async () => {
    const { start, commands } = fixture();
    start('calendar_list_events').finish({
      timeZone: 'Europe/Copenhagen',
      events: [
        { id: 'abc', subject: 'Hente "Brænde"', start: '2026-10-10T19:00:00.000Z', end: '2026-10-10T20:00:00.000Z' },
        { id: 'def', subject: 'Fix loft opening', start: '2026-10-11T08:00:00.000Z', end: '2026-10-11T09:00:00.000Z', location: 'Home' },
        { id: 'ghi', subject: 'Holiday', start: '2026-10-12', end: '2026-10-13', allDay: true },
      ],
      truncated: true,
    }, true);
    await settled();
    const content = (commands[0] as { view: { data: { content: string } } }).view.data.content;
    expect(content).toContain('21:00–22:00 · Hente "Brænde"');
    expect(content).toContain('10:00–11:00 · Fix loft opening (Home)');
    expect(content).toContain('All day · Holiday');
    expect(content).toContain('More events exist than are shown.');
    expect(content).not.toMatch(/&quot;|&amp;|"id"|abc|def/u);
  });

  it('shows mail search results as a clean list of subject, sender and date, never JSON or message bodies', async () => {
    const { start, commands } = fixture();
    start('mail_search', { query: 'hotel' }).finish({
      messages: [
        {
          id: 'msg-secret-1', subject: 'Booking "confirmed" & paid', from: { name: 'Hotel Alpha', address: 'bookings@alpha.example' },
          receivedDateTime: '2026-10-12T08:30:00.000Z', body: 'Confirmation 4455. password=private-value', bodySource: 'text',
          bodyTruncated: false, contentWarnings: [],
        },
        { id: 'msg-secret-2', subject: '', from: { name: '', address: 'noreply@beta.example' }, receivedDateTime: 'not-a-date', body: 'private-body' },
      ],
      truncated: false,
    }, true);
    await settled();
    expect(commands[0]).toMatchObject({
      operation: 'create', viewId: 'google-101',
      view: {
        renderer: 'list', title: 'Mail results',
        data: { items: [
          { title: 'Booking "confirmed" & paid', description: 'Hotel Alpha · 12 Oct 2026' },
          { title: '(no subject)', description: 'noreply@beta.example' },
        ] },
      },
    });
    expect(commands[0] && 'view' in commands[0] && isGeneratedView(commands[0].view)).toBe(true);
    expect(commands[1]).toMatchObject({ operation: 'focus', viewId: 'google-101' });
    expect(JSON.stringify(commands)).not.toMatch(/msg-secret|Confirmation 4455|private-value|private-body|bodySource|contentWarnings/u);
  });

  it('bounds a mail list and says so when a search finds nothing', async () => {
    const many = fixture();
    many.start('mail_search').finish({
      messages: Array.from({ length: 60 }, (_, index) => ({ id: `m${index}`, subject: `Message ${index}`, from: { address: 'a@example.test' } })),
    }, true);
    const none = fixture();
    none.start('mail_search').finish({ messages: [], truncated: false }, true);
    await settled();
    expect((many.commands[0] as { view: { data: { items: unknown[] } } }).view.data.items).toHaveLength(50);
    expect(none.commands[0]).toMatchObject({ view: { renderer: 'text', title: 'Mail results', data: { content: 'No matching messages found.' } } });
  });

  it('shows mail drafts as a list without their bodies or identifiers', async () => {
    const { start, commands } = fixture();
    start('mail_list_drafts').finish({
      drafts: [{ draftId: 'draft-secret', messageId: 'm1', to: 'ann@example.test', subject: 'Check-in time', body: 'private-body' }],
      truncated: false,
    }, true);
    await settled();
    expect(commands[0]).toMatchObject({
      view: { renderer: 'list', title: 'Mail drafts', data: { items: [{ title: 'Check-in time', description: 'To ann@example.test' }] } },
    });
    expect(JSON.stringify(commands)).not.toMatch(/draft-secret|private-body/u);
  });

  it('shows free slots and the next event as readable text', async () => {
    const slots = fixture();
    slots.start('calendar_find_free_slots').finish({
      timeZone: 'Europe/Copenhagen', durationMinutes: 60, truncated: false,
      slots: [{
        start: '2026-11-12T08:00:00.000Z', end: '2026-11-12T09:00:00.000Z',
        startLocal: '12 November 2026, 09:00', endLocal: '12 November 2026, 10:00',
      }],
    }, true);
    const next = fixture();
    next.start('calendar_next_event').finish({
      timeZone: 'Europe/Copenhagen', truncated: false,
      event: { id: 'evt-secret', subject: 'Hotel check-in', start: '2026-11-12T13:00:00.000Z', end: '2026-11-12T14:00:00.000Z' },
    }, true);
    const empty = fixture();
    empty.start('calendar_next_event').finish({ timeZone: 'UTC', event: null, truncated: false }, true);
    await settled();
    expect(slots.commands[0]).toMatchObject({
      view: { renderer: 'text', title: 'Free time', data: { content: 'Free 60-minute slots:\n12 November 2026, 09:00 to 12 November 2026, 10:00' } },
    });
    const nextContent = (next.commands[0] as { view: { data: { content: string } } }).view.data.content;
    expect(nextContent).toContain('14:00–15:00 · Hotel check-in');
    expect(nextContent).not.toContain('evt-secret');
    expect(empty.commands[0]).toMatchObject({ view: { data: { content: 'No upcoming event in the next 60 days.' } } });
  });

  describe('incomplete Google results', () => {
    type Shown = {
      view: {
        renderer: string;
        title: string;
        source: Record<string, unknown>;
        data: { content?: string; items?: { title: string; description?: string }[] };
      };
    };
    const shown = (commands: WorkspaceCommand[]) => commands[0] as unknown as Shown;
    const note = {
      moreEvents: 'More events exist than are shown.',
      noEvents: 'No events were found in the part of the calendar that was searched.',
      noNextEvent: 'No upcoming event found in the part of your calendar that was searched.',
      uncertainSlots: 'Calendar results were incomplete, so some of these slots may not be free.',
      noSlots: 'No free slots were found in the part of the calendar that was searched.',
      moreSlots: 'More free slots exist than are shown.',
    };
    const validView = (commands: WorkspaceCommand[]) => Boolean(commands[0] && 'view' in commands[0] && isGeneratedView(commands[0].view));
    // The reason is the same static text the view shows; the web chrome does not render it, so the in-view note is the visible signal.
    const expectPartial = (commands: WorkspaceCommand[], reason: string) => {
      expect(shown(commands).view.source).toStrictEqual({ id: 'now', status: 'partial', updatedAt: expect.any(String), reason });
      expect(validView(commands)).toBe(true);
    };
    const expectComplete = (commands: WorkspaceCommand[]) => {
      expect(shown(commands).view.source).toStrictEqual({ id: 'now', status: 'complete', updatedAt: expect.any(String) });
      expect(validView(commands)).toBe(true);
    };
    async function present(tool: string, result: Record<string, unknown>) {
      const { start, commands } = fixture();
      start(tool).finish(result, true);
      await settled();
      return commands;
    }

    describe('calendar_find_free_slots', () => {
      const slot = (index: number) => ({
        start: '2026-11-12T08:00:00.000Z', end: '2026-11-12T09:00:00.000Z',
        startLocal: `Slot ${String(index)} starts`, endLocal: `Slot ${String(index)} ends`,
      });
      const result = (extra: Record<string, unknown>) => ({
        timeZone: 'Europe/Copenhagen', durationMinutes: 60, nextPageToken: 'private-page-token', ...extra,
      });

      it('warns that free time may be wrong and marks the source partial when the events it read were truncated', async () => {
        const commands = await present('calendar_find_free_slots', result({ truncated: true, slots: [slot(0)] }));
        expect(shown(commands).view).toMatchObject({
          renderer: 'text', title: 'Free time',
          data: { content: `Free 60-minute slots:\nSlot 0 starts to Slot 0 ends\n\n${note.uncertainSlots}` },
        });
        expectPartial(commands, note.uncertainSlots);
        expect(JSON.stringify(commands)).not.toContain('private-');
      });

      it('shows no note and a complete source when the result is complete', async () => {
        const commands = await present('calendar_find_free_slots', result({ truncated: false, slots: [slot(0)] }));
        expect(shown(commands).view.data.content).toBe('Free 60-minute slots:\nSlot 0 starts to Slot 0 ends');
        expectComplete(commands);
      });

      it('says more slots exist when it shows only the first 50, and joins both notes for a truncated result', async () => {
        const slots = Array.from({ length: 60 }, (_, index) => slot(index));
        const cut = await present('calendar_find_free_slots', result({ truncated: false, slots }));
        const lines = shown(cut).view.data.content?.split('\n') ?? [];
        expect(lines).toHaveLength(1 + 50 + 2);
        expect(lines).toContain('Slot 49 starts to Slot 49 ends');
        expect(lines).not.toContain('Slot 50 starts to Slot 50 ends');
        expect(lines[lines.length - 1]).toBe(note.moreSlots);
        expectPartial(cut, note.moreSlots);
        const both = await present('calendar_find_free_slots', result({ truncated: true, slots }));
        expect(shown(both).view.data.content?.endsWith(`\n\n${note.uncertainSlots} ${note.moreSlots}`)).toBe(true);
        expectPartial(both, `${note.uncertainSlots} ${note.moreSlots}`);
      });

      it('never claims there are no free slots when the result is incomplete', async () => {
        const incomplete = await present('calendar_find_free_slots', result({ truncated: true, slots: [] }));
        expect(shown(incomplete).view.data.content).toBe(note.noSlots);
        expectPartial(incomplete, note.noSlots);
        const complete = await present('calendar_find_free_slots', result({ truncated: false, slots: [] }));
        expect(shown(complete).view.data.content).toBe('No free 60-minute slots found in that period.');
        expectComplete(complete);
      });
    });

    interface MailPresenter {
      tool: string;
      key: 'messages' | 'drafts';
      title: string;
      none: string;
      noneIncomplete: string;
      more: string;
      row: (index: number) => Record<string, unknown>;
    }
    const mailPresenters: MailPresenter[] = [
      {
        tool: 'mail_search', key: 'messages', title: 'Mail results', none: 'No matching messages found.',
        noneIncomplete: 'No matching messages were found in the part of the mailbox that was searched.',
        more: 'More messages may exist than are shown.',
        row: (index) => ({ id: `private-id-${String(index)}`, subject: `Subject ${String(index)}`, from: { address: 'a@example.test' }, body: 'private-body' }),
      },
      {
        tool: 'mail_list_drafts', key: 'drafts', title: 'Mail drafts', none: 'No drafts found.',
        noneIncomplete: 'No drafts were found in the part of the mailbox that was searched.',
        more: 'More drafts may exist than are shown.',
        row: (index) => ({ draftId: `private-id-${String(index)}`, subject: `Subject ${String(index)}`, to: 'a@example.test', body: 'private-body' }),
      },
    ];

    describe.each(mailPresenters)('$tool', ({ tool, key, title, none, noneIncomplete, more, row }) => {
      const result = (count: number, truncated?: boolean) => ({
        [key]: Array.from({ length: count }, (_, index) => row(index)),
        ...(truncated === undefined ? {} : { truncated }),
        nextPageToken: 'private-page-token',
      });

      it('ends a truncated list with a plain note item and marks the source partial', async () => {
        const commands = await present(tool, result(2, true));
        const { view } = shown(commands);
        expect(view).toMatchObject({ renderer: 'list', title });
        expect(view.data.items?.map((item) => item.title)).toEqual(['Subject 0', 'Subject 1', more]);
        expect(view.data.items?.[2]).toStrictEqual({ title: more });
        expectPartial(commands, more);
        expect(JSON.stringify(commands)).not.toContain('private-');
      });

      it('shows no note and a complete source when the result is complete', async () => {
        const commands = await present(tool, result(2, false));
        expect(shown(commands).view.data.items?.map((item) => item.title)).toEqual(['Subject 0', 'Subject 1']);
        expectComplete(commands);
      });

      it('keeps the list within 50 items, the last being the note, when more rows came back than fit', async () => {
        const commands = await present(tool, result(60));
        const items = shown(commands).view.data.items ?? [];
        expect(items).toHaveLength(50);
        expect(items[48]?.title).toBe('Subject 48');
        expect(items[49]).toStrictEqual({ title: more });
        expectPartial(commands, more);
      });

      it('never says nothing exists when an empty result is incomplete', async () => {
        const incomplete = await present(tool, result(0, true));
        expect(shown(incomplete).view).toMatchObject({ renderer: 'text', title, data: { content: noneIncomplete } });
        expectPartial(incomplete, noneIncomplete);
        const complete = await present(tool, result(0, false));
        expect(shown(complete).view.data.content).toBe(none);
        expectComplete(complete);
      });
    });

    describe.each(['calendar_list_events', 'calendar_today_agenda'])('%s', (tool) => {
      const event = (index: number, subject = `Meeting ${String(index)}`) => ({
        id: `private-id-${String(index)}`, subject, start: '2026-10-10T08:00:00.000Z', end: '2026-10-10T08:30:00.000Z',
      });
      const result = (count: number, truncated: boolean) => ({
        timeZone: 'UTC', events: Array.from({ length: count }, (_, index) => event(index)), truncated, nextPageToken: 'private-page-token',
      });

      it('ends a truncated agenda with a note and marks the source partial', async () => {
        const commands = await present(tool, result(2, true));
        const content = shown(commands).view.data.content ?? '';
        expect(content).toContain('08:00–08:30 · Meeting 1');
        expect(content.endsWith(`\n\n${note.moreEvents}`)).toBe(true);
        expectPartial(commands, note.moreEvents);
        expect(JSON.stringify(commands)).not.toContain('private-');
      });

      it('shows no note and a complete source when the result is complete', async () => {
        const commands = await present(tool, result(2, false));
        expect(shown(commands).view.data.content).not.toContain(note.moreEvents);
        expectComplete(commands);
      });

      it('never says the calendar is empty when an empty result is incomplete', async () => {
        const incomplete = await present(tool, result(0, true));
        expect(shown(incomplete).view.data.content).toBe(note.noEvents);
        expectPartial(incomplete, note.noEvents);
        const complete = await present(tool, result(0, false));
        expect(shown(complete).view.data.content).toBe('No events in this period.');
        expectComplete(complete);
      });

      it('stops at a whole event and adds the note when the agenda would exceed the text cap', async () => {
        const events = Array.from({ length: 100 }, (_, index) => event(index, `${'x'.repeat(190)} ${String(index).padStart(3, '0')}`));
        const commands = await present(tool, { timeZone: 'UTC', events, truncated: false });
        const content = shown(commands).view.data.content ?? '';
        expect(content.length).toBeLessThanOrEqual(10_000);
        expect(content).toContain(`${'x'.repeat(190)} 000`);
        expect(content).not.toContain(`${'x'.repeat(190)} 099`);
        expect(content.endsWith(`\n\n${note.moreEvents}`)).toBe(true);
        expectPartial(commands, note.moreEvents);
      });
    });

    describe('calendar_next_event', () => {
      const event = { id: 'private-event-id', subject: 'Hotel check-in', start: '2026-11-12T13:00:00.000Z', end: '2026-11-12T14:00:00.000Z' };

      it('says the search was partial when no event was found in an incomplete search', async () => {
        const commands = await present('calendar_next_event', { timeZone: 'UTC', event: null, truncated: true });
        expect(shown(commands).view.data.content).toBe(note.noNextEvent);
        expectPartial(commands, note.noNextEvent);
      });

      it('keeps the 60-day wording and a complete source for a complete empty search', async () => {
        const commands = await present('calendar_next_event', { timeZone: 'UTC', event: null, truncated: false });
        expect(shown(commands).view.data.content).toBe('No upcoming event in the next 60 days.');
        expectComplete(commands);
      });

      it('shows no note for a found event, and a note if the tool still reports the result as truncated', async () => {
        const found = await present('calendar_next_event', { timeZone: 'UTC', event, truncated: false, nextPageToken: 'private-page-token' });
        expect(shown(found).view.data.content).toContain('13:00–14:00 · Hotel check-in');
        expect(shown(found).view.data.content).not.toContain(note.moreEvents);
        expectComplete(found);
        const flagged = await present('calendar_next_event', { timeZone: 'UTC', event, truncated: true });
        expect(shown(flagged).view.data.content?.endsWith(`\n\n${note.moreEvents}`)).toBe(true);
        expectPartial(flagged, note.moreEvents);
        expect(JSON.stringify([found, flagged])).not.toContain('private-');
      });
    });
  });

  it.each([
    ['completed', 'Done.'],
    ['cancelled', 'Cancelled. Nothing was changed.'],
    ['partial', 'Partly done. Check what was applied before retrying.'],
  ])('shows a %s staged action as its summary under a plain outcome, never its raw result', async (status, label) => {
    const { start, commands } = fixture();
    start('mail_confirm_action').finish({
      status, summary: 'Archived 2 messages.', detail: 'private-detail', items: [{ id: 'msg-secret' }],
    }, true);
    await settled();
    expect(commands[0]).toMatchObject({
      view: { renderer: 'text', title: 'Mail', data: { format: 'plain', content: `${label}\n\nArchived 2 messages.` } },
    });
    expect(JSON.stringify(commands)).not.toMatch(/private-detail|msg-secret/u);
  });

  it('puts nothing on screen for a Google result it cannot present instead of dumping raw JSON', async () => {
    const { start, commands, events } = fixture();
    start('mail_archive').finish({ id: 'm1', body: 'private-body', nested: { list: [1, 2, 3] } }, true);
    await settled();
    expect(commands).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['work-started', 'work-finished']);
  });

  it.each(['calendar_list_events', 'repo_read', 'vault_search', 'web_search'])(
    'opens nothing on its own in chat for %s; the chat answer carries the data',
    async (tool) => {
      const { start, events, commands } = fixture();
      start(tool, { query: 'x', path: 'a.ts' }, '101', new AbortController().signal, 'chat')
        .finish({ timeZone: 'UTC', events: [], content: 'code', results: [] }, true);
      await settled();
      expect(events).toEqual([]);
      expect(commands).toEqual([]);
    },
  );
  it.each(['calendar_list_events', 'repo_read'])('still opens its window in voice for %s', async (tool) => {
    const { start, events, commands } = fixture();
    start(tool, { path: 'a.ts' }).finish(
      { timeZone: 'UTC', events: [], repository: 'DanAakesen/jarvis', path: 'a.ts', content: 'code' }, true,
    );
    await settled();
    expect(events.map((event) => event.type)).toEqual(['work-started', 'work-finished']);
    expect(commands[0]).toMatchObject({ operation: 'create' });
  });

  it.each([{ setting: false }, { mode: 'on_the_move' as const }])('suppresses status and views for %j', async (options) => {
    const { start, events, commands } = fixture(options);
    start('repo_read').finish({ repository: 'DanAakesen/jarvis', path: 'a.ts', content: 'code' }, true);
    await settled();
    expect(events).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('does not await settings, acknowledgements, or failed delivery', async () => {
    const { app, start, events, commands } = fixture();
    vi.spyOn(app.workspaceCommands, 'execute').mockRejectedValue(new Error('UI unavailable'));
    const work = start('repo_list', { path: '.' });
    work.finish({ repository: 'DanAakesen/jarvis', entries: [] }, true);
    await settled();
    expect(events.map((event) => event.type)).toEqual(['work-started', 'work-finished']);
    expect(commands).toEqual([]);
    const unavailable = fixture({ settingsStore: { read: async () => { throw new Error('SQL unavailable'); }, write: async () => {} } });
    unavailable.start('vault_read').finish({}, true);
    await settled();
    expect(unavailable.events).toEqual([]);
  });

  it('stops on disconnect or cancellation and bounds stalled settings reads', async () => {
    const offline = fixture();
    offline.connection.close();
    offline.start('repo_read').finish({}, true);
    const cancelled = fixture();
    const controller = new AbortController();
    const work = cancelled.start('repo_read', {}, '101', controller.signal);
    await settled();
    controller.abort();
    work.finish({}, false);
    await settled();
    expect(offline.events).toEqual([]);
    expect(cancelled.commands).toEqual([]);
    expect(cancelled.events.map((event) => event.type)).toEqual(['work-started', 'work-finished']);
    vi.useFakeTimers();
    const stalled = fixture({ settingsStore: { read: () => new Promise(() => {}), write: async () => {} } });
    stalled.start('repo_read').finish({}, true);
    await vi.advanceTimersByTimeAsync(250);
    expect(stalled.events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('redacts credentials before truncation, including multiline keys and JSON values', () => {
    const url = ['https://', 'user', ':', 'pass', '@host/'].join('');
    expect(redactWorkContent(`"api_key": "private-value"\n${['Bearer', 'private-token'].join(' ')}\n${url}`)).not.toMatch(/private-value|private-token|user:pass/u);
    expect(redactWorkContent('-----BEGIN PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----'))
      .toBe(Array(3).fill('[REDACTED PRIVATE KEY]').join('\n'));
    expect(redactWorkContent('api_key = `private-value\nmore-private-value`\nconst safe = true;'))
      .toBe('api_key = [REDACTED]\n[REDACTED]\nconst safe = true;');
    expect(defaultSettings.presentation.showWork).toBe(true);
  });

  it.each(['Basic', 'Bearer', 'Digest', 'Negotiate'])('redacts the entire unquoted %s authorization header', (scheme) => {
    const header = ['Authorization:', scheme, 'private-credential'].join(' ');
    const proxy = ['Proxy-Authorization:', scheme, 'private-credential'].join(' ');
    expect(redactWorkContent(`${header}\n${proxy}`)).not.toContain('private-credential');
    expect(redactWorkContent(`${header}\nconst safe = true;`)).toContain('const safe = true;');
  });

  it('presents direct reflex tool execution through the same lifecycle', async () => {
    const { app, events, commands } = fixture();
    app.toolCallStore = { record: vi.fn(async () => {}) };
    const request = {
      server: app,
      principal: { objectId: app.ownerObjectId },
      routeOptions: { url: '/voice/sessions/41/turns' },
      compileValidationSchema: () => () => true,
    } as unknown as FastifyRequest;
    const result = await executeReflexAction({
      addressed: true, intent: 'action', confidence: 1, needsConfirmation: false,
      target: { choice: 'test', arguments: { path: 'src/reflex.ts' }, tool: {
        moduleId: 'work-test', name: 'repo_read', description: 'Read test code.', reflexSafe: true,
        inputSchema: { type: 'object' },
        execute: async () => ({ repository: 'DanAakesen/jarvis', path: 'src/reflex.ts', content: 'code' }),
      } },
    }, request, '103', new AbortController().signal);
    await settled();
    expect(result?.outcome).toBe('ok');
    expect(events.filter((event) => event.type.startsWith('work-')).map((event) => event.type))
      .toEqual(['work-started', 'work-finished']);
    expect(commands[0]).toMatchObject({ operation: 'create', viewId: 'code-103' });
  });
});

describe('shared chat and voice dispatcher integration', () => {
  it.each(['chat', 'voice'] as const)('publishes paired details only for voice, not chat (%s) without awaiting the workspace', async (source) => {
    const toolModule: BackendModule = {
      id: 'work-test',
      tools: [{
        name: 'repo_read', description: 'Read test code.', sensitive: true,
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        execute: async (input) => {
          const { path } = input as { path: string };
          if (path === 'refuse') throw new ToolRefusal('Not available.');
          return { repository: 'DanAakesen/jarvis', path, content: 'code' };
        },
      }],
      registerRoutes: async () => {},
    };
    const app = buildApp(config, undefined, {
      modules: [coreModule, toolModule],
      auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
      toolCallStore: { record: vi.fn(async () => {}) },
    });
    apps.push(app);
    const events: unknown[] = [];
    app.jarvisActivityHub.subscribe((event) => events.push(event));
    // Deliberately never acknowledge: the tool response must still finish.
    app.workspaceCommands.connect(app.ownerObjectId, () => true);
    const headers = { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101',
      ...(source === 'voice' ? { 'x-jarvis-voice-item-id': 'item_101' } : {}) };
    const response = await app.inject({ method: 'POST', url: '/tools/repo_read', headers, payload: { path: 'src/a.ts' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', confirmation: 'Done: repo_read succeeded.' });
    await settled();
    const presented = (list: unknown[]) => list.filter((event) => (event as { type: string }).type.startsWith('work-'));
    if (source === 'chat') {
      expect(presented(events)).toEqual([]);
      return;
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'work-started', kind: 'repo_read', text: 'Reading your code src/a.ts' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'work-finished' }));
    const before = events.length;
    const invalid = await app.inject({ method: 'POST', url: '/tools/repo_read', headers, payload: { unexpected: 'secret' } });
    expect(invalid.json()).toMatchObject({ outcome: 'refused' });
    expect(events).toHaveLength(before);
    const refusal = await app.inject({ method: 'POST', url: '/tools/repo_read', headers, payload: { path: 'refuse' } });
    expect(refusal.json()).toMatchObject({ outcome: 'refused' });
    await settled();
    expect(events.filter((event) => (event as { type: string }).type === 'work-finished')).toHaveLength(2);
  });
});

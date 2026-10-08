import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { isGeneratedView, isJarvisActivityEvent, type JarvisActivityEvent, type WorkspaceCommand } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { BackendModule } from '../modules.js';
import { coreModule } from './index.js';
import { ToolRefusal } from './tool-registry.js';
import { redactWorkContent, startWorkPresentation } from './work-presentation.js';
import { defaultSettings, type SettingsStore } from './settings.js';
import { executeReflexAction } from './reflex.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(options: { setting?: boolean; mode?: 'present' | 'on_the_move'; settingsStore?: SettingsStore } = {}) {
  const app = buildApp(config, undefined, {
    modules: [],
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
  const start = (tool: string, input: unknown = {}, turn = '101', signal = new AbortController().signal) =>
    startWorkPresentation(tool, input, request, randomUUID(), turn, signal);
  return { app, events, commands, start, connection };
}

async function settled() {
  // Flush settings, publication, and broker acknowledgements without a timer delay.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

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
    expect(commands[0]).toMatchObject({ view: { renderer: 'text', data: { format: 'plain', content: '&lt;draft&gt;\npassword=[REDACTED]' } } });
    expect(JSON.stringify(commands)).not.toMatch(/12345678|private-value/u);
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
    expect(redactWorkContent('-----BEGIN PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----')).toBe('[REDACTED PRIVATE KEY]');
    expect(defaultSettings.presentation.showWork).toBe(true);
  });

  it('presents direct reflex tool execution through the same lifecycle', async () => {
    const { app, events, commands } = fixture();
    app.toolCallStore = { record: vi.fn(async () => {}) };
    const request = {
      server: app,
      principal: { objectId: app.ownerObjectId },
      routeOptions: { url: '/conversation/sessions/41/turns' },
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
  it.each(['chat', 'voice'] as const)('publishes paired details for %s without awaiting the workspace', async (source) => {
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

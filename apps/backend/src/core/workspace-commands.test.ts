import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from './index.js';
import { runModelToolCall } from './tool-origin.js';
import { MAX_TOOL_DESCRIPTION_CHARACTERS, ToolFailure, ToolRefusal } from './tool-registry.js';
import { isWorkspaceReflexOperation, WorkspaceCommandBroker, workspaceCommandTool } from './workspace-commands.js';
import { dailyQuerySources, workspaceNavigationPages, type DailyQueryResult, type WorkspaceCommand } from '@jarvis/contracts';
import { executeReflexAction, reflexTargets, registerChatReflex, undoPartialReflexAction } from './reflex.js';
import { toModelToolSchema, executeRealtimeToolCall } from '../voice/realtime.js';
import type { BackendModule } from '../modules.js';
import { createDailyModules } from '../daily/index.js';
import { createDailyChanges } from '../daily/revisions.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const agentHeaders = { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' };
const userHeaders = { authorization: ['Bearer', 'header.user.signature'].join(' ') };
const view = {
  version: 1,
  title: 'Research summary',
  renderer: 'list',
  source: { id: 'factory.tasks', status: 'complete' },
  data: { items: [{ title: 'Source-linked finding' }] },
} as const;
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(dailyEnabled = false, extraModules: readonly BackendModule[] = [], dailyQuery = vi.fn()) {
  const broker = new WorkspaceCommandBroker();
  const records: unknown[] = [];
  const app = buildApp(config, undefined, {
    modules: [coreModule, ...createDailyModules(dailyEnabled, { query: { query: dailyQuery }, changes: createDailyChanges() }), ...extraModules],
    auth: async (token) => token === 'header.user.signature'
      ? { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' }
      : { kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId },
    toolCallStore: { record: async (call) => { records.push(call); } },
    workspaceCommands: broker,
  });
  apps.push(app);
  return { app, broker, records, dailyQuery };
}

describe('workspace command delivery', () => {
  it('keeps the session tool schema a plain model-facing object', () => {
    const schema = toModelToolSchema(workspaceCommandTool.inputSchema);
    expect(schema).toHaveProperty('type', 'object');
    for (const key of ['oneOf', 'anyOf', 'allOf', 'not']) expect(schema).not.toHaveProperty(key);
    expect(schema).toMatchObject({
      required: ['commandId', 'operation'], additionalProperties: false,
      properties: {
        operation: { enum: expect.arrayContaining([
          'session', 'place', 'arrange', 'minimise-all', 'restore-all', 'close-all', 'pin', 'unpin',
        ]) },
        action: { enum: expect.arrayContaining(['language', 'voice', 'camera']) },
        value: { type: 'string', enum: ['da', 'en', 'end', 'front', 'rear', 'off'] },
        target: { enum: ['active', 'desktop', 'phone', 'all'] },
      },
    });
    expect(workspaceCommandTool.description).toContain('current session, not saved defaults');
    expect(workspaceCommandTool.description).toContain('backend never requests browser permissions');
    expect(workspaceCommandTool.description).toContain('tell Dan to grant permission in the browser');
    expect(workspaceCommandTool.description).toContain('Target defaults to active');
  });

  it('describes snapshot-backed window intents, ordering, phone behavior, and confirmed pins', () => {
    expect(workspaceCommandTool.description).toContain('act by intent rather than coordinates');
    expect(workspaceCommandTool.description).toContain('snapshot titles and front');
    expect(workspaceCommandTool.description).toContain('"X right, Y left" uses viewIds [Y, X]');
    expect(workspaceCommandTool.description).toContain('viewIds are front-to-back, first frontmost—put the desired top window first');
    expect(workspaceCommandTool.description).toContain('arrange with auto ("tidy up")');
    expect(workspaceCommandTool.description).toContain('Minimise, restore or close everything with minimise-all, restore-all or close-all');
    expect(workspaceCommandTool.description).toContain('Pin or unpin on request');
    expect(workspaceCommandTool.description).toContain('only when the result confirms storage succeeded');
    expect(workspaceCommandTool.description).toContain('On phones, geometry requests focus the named window');
  });

  it.each([
    { action: 'language', value: 'da' }, { action: 'language', value: 'en' },
    { action: 'voice', value: 'end' },
    { action: 'camera', value: 'front' }, { action: 'camera', value: 'rear' }, { action: 'camera', value: 'off' },
  ])('applies session $action $value only after the page acknowledges it', async (fields) => {
    const { app, broker } = fixture();
    const command = { commandId: 'session-applied', operation: 'session', ...fields };
    let delivered!: WorkspaceCommand;
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') delivered = data.command;
      return true;
    });
    let settled = false;
    const pending = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    }).then((response) => { settled = true; return response; });
    await vi.waitFor(() => expect(delivered).toEqual(command));
    expect(settled).toBe(false);
    expect(isWorkspaceReflexOperation(command)).toBe(true);
    const ack = await app.inject({
      method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers: userHeaders,
      payload: { sessionId: connection.sessionId, applied: true },
    });
    expect(ack.statusCode).toBe(204);
    expect((await pending).json()).toMatchObject({ outcome: 'ok', result: { applied: true, ...command } });
    connection.close();
  });

  it.each([
    { action: 'camera', value: 'rear', reason: 'Grant camera permission in the browser first.' },
    { action: 'language', value: 'da', reason: 'Grant microphone permission in the browser first.' },
    { action: 'voice', value: 'end', reason: 'Voice mode is not active in this tab.' },
  ])('relays the page refusal reason for session $action', async ({ reason, ...fields }) => {
    const { app, broker } = fixture();
    const command = { commandId: 'session-refused', operation: 'session', ...fields };
    let delivered!: WorkspaceCommand;
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') delivered = data.command;
      return true;
    });
    const pending = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    await vi.waitFor(() => expect(delivered).toEqual(command));
    const ack = await app.inject({
      method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers: userHeaders,
      payload: { sessionId: connection.sessionId, applied: false, reason },
    });
    expect(ack.statusCode).toBe(204);
    expect((await pending).json()).toMatchObject({
      outcome: 'refused', result: { refused: reason }, confirmation: expect.stringContaining(reason),
    });
    connection.close();
  });

  it.each([
    {}, { action: 'camera' }, { value: 'da' }, { action: 'open', value: 'front' },
    { action: 'language', value: 'de' }, { action: 'language', value: 'end' },
    { action: 'voice', value: 'start' }, { action: 'voice', value: 'off' },
    { action: 'camera', value: 'en' }, { action: 'camera', value: null },
    { action: 'camera', value: 'rear', extra: true },
    { action: 'language', value: 'da', page: 'settings' },
  ])('refuses invalid session arguments before delivery: %j', async (fields) => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    broker.connect(ownerId, send);
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'session-invalid', operation: 'session', ...fields },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves HTML artifact/window references only from owner-scoped applied commands', async () => {
    const broker = new WorkspaceCommandBroker();
    const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
    const command: WorkspaceCommand = {
      commandId: 'html-reference', operation: 'update', viewId: 'research-existing',
      view: { version: 1, title: 'Report', renderer: 'html-app',
        source: { id: 'research', status: 'complete' }, data: { artifactId: artifactId.toUpperCase() } },
    };
    const connection = broker.connect(ownerId, () => true);
    const pending = broker.execute(ownerId, command, new AbortController().signal);
    expect(broker.htmlView(ownerId, { viewId: command.viewId })).toBeUndefined();
    broker.acknowledge(ownerId, connection.sessionId, command.commandId, true);
    await pending;
    expect(broker.htmlView(ownerId, { viewId: command.viewId })).toEqual({ viewId: command.viewId, artifactId });
    expect(broker.htmlView(ownerId, { artifactId })).toEqual({ viewId: command.viewId, artifactId });
    expect(broker.htmlView(ownerId, { artifactId: artifactId.toUpperCase() })).toEqual({ viewId: command.viewId, artifactId });
    expect(broker.htmlView('another-owner', { artifactId })).toBeUndefined();
    connection.close();
  });

  it('describes ordered timeline events and dates or period labels to the model', () => {
    expect(workspaceCommandTool.description).toContain('For readable summaries or dates, reuse the matching existing window');
    expect(workspaceCommandTool.description).toContain('"renderer":"text"');
    expect(workspaceCommandTool.description).toContain('"source":{"id":"now","status":"complete"}');
    expect(workspaceCommandTool.description).toContain('"format":"plain","content":"Actual returned summary"');
    expect(workspaceCommandTool.description).toContain('chart or timeline requests');
    expect(workspaceCommandTool.description).toContain('chart data uses kind line, bar or area and 1–5 named series of x/y points, up to 1,000 points total');
    expect(workspaceCommandTool.description).toContain('data.events in the given order');
    expect(workspaceCommandTool.description).toContain('at or label (or both)');
    expect(workspaceCommandTool.description).toContain('label (1–40 characters) for seasons or periods');
    expect(workspaceCommandTool.description).toContain('at (RFC 3339 date-time or YYYY-MM-DD) for precise dates');
    expect(workspaceCommandTool.description).toContain('Use an HTML view for richer visuals');
  });

  it('delivers mixed timeline dates and periods unchanged in the given order', async () => {
    const { app, broker } = fixture();
    const command = {
      commandId: 'timeline-history', operation: 'create', viewId: 'history',
      view: {
        ...view, renderer: 'timeline',
        data: { events: [
          { at: '2026-09-29', label: 'Sept 2026', title: 'Today' },
          { label: '2009/10', title: 'Season' },
          { at: '1880-11-13', title: 'Founded' },
        ] },
      },
    };
    const delivered: WorkspaceCommand[] = [];
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        delivered.push(data.command);
        broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, true);
      }
      return true;
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: command.view } });
    expect(delivered).toEqual([command]);
    connection.close();
  });

  it.each(['show', 'hide'])('shows or hides the conversation only after an applied acknowledgement (%s)', async (action) => {
    const { app, broker } = fixture();
    const command = { commandId: `conversation-${action}`, operation: 'conversation', action };
    let delivered!: WorkspaceCommand;
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') delivered = data.command;
      return true;
    });
    let settled = false;
    const pending = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    }).then((response) => { settled = true; return response; });
    await vi.waitFor(() => expect(delivered).toEqual(command));
    expect(settled).toBe(false);
    expect(isWorkspaceReflexOperation(command)).toBe(true);
    const ack = await app.inject({
      method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers: userHeaders,
      payload: { sessionId: connection.sessionId, applied: true },
    });
    expect(ack.statusCode).toBe(204);
    expect((await pending).json()).toMatchObject({ outcome: 'ok', result: { applied: true, ...command } });
    connection.close();
  });

  it('relays a refusal when a client cannot change conversation visibility', async () => {
    const { app, broker } = fixture();
    const command = { commandId: 'conversation-refused', operation: 'conversation', action: 'hide' };
    let delivered!: WorkspaceCommand;
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') delivered = data.command;
      return true;
    });
    const pending = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    await vi.waitFor(() => expect(delivered).toEqual(command));
    const reason = 'The conversation is not available in this tab.';
    const ack = await app.inject({
      method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers: userHeaders,
      payload: { sessionId: connection.sessionId, applied: false, reason },
    });
    expect(ack.statusCode).toBe(204);
    expect((await pending).json()).toMatchObject({
      outcome: 'refused', result: { refused: reason }, confirmation: expect.stringContaining('Not done:'),
    });
    connection.close();
  });

  it.each(['open', 'close', 'toggle', 'shown', '', undefined])('refuses invalid conversation actions before delivery (%s)', async (action) => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    broker.connect(ownerId, send);
    const command = {
      commandId: 'conversation-invalid', operation: 'conversation',
      ...(action === undefined ? {} : { action }),
    };
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(workspaceNavigationPages)('delivers navigation to %s through the shared tool', async (page) => {
    const { app, broker } = fixture(page === 'daily' || page === 'health');
    const command = { commandId: `navigate-${page}`, operation: 'navigate', page };
    const delivered: WorkspaceCommand[] = [];
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        delivered.push(data.command);
        broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, true);
      }
      return true;
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { applied: true, ...command } });
    // Tabs opened before the rename only know the legacy page value, so Health is delivered as `daily`.
    expect(delivered).toEqual([page === 'health' ? { ...command, page: 'daily' } : command]);
    connection.close();
  });
  it.each(['daily', 'health'] as const)('refuses %s navigation before delivery when its data module is absent', async (page) => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    const connection = broker.connect(ownerId, send);
    try {
      const response = await app.inject({ method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
        payload: { commandId: `disabled-${page}`, operation: 'navigate', page } });
      const refusal = response.json().result.refused as string;
      expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('not enabled') } });
      expect(refusal).not.toMatch(/\bdaily\b/iu);
      expect(send).not.toHaveBeenCalled();
    } finally { connection.close(); }
  });

  it.each([
    { commandId: 'place-intent', operation: 'place', viewId: 'report', region: 'left' },
    { commandId: 'arrange-intent', operation: 'arrange', layout: 'grid', viewIds: ['report', 'chart'] },
    { commandId: 'cascade-intent', operation: 'arrange', layout: 'cascade', viewIds: ['front', 'behind'] },
    { commandId: 'minimise-all-intent', operation: 'minimise-all' },
    { commandId: 'restore-all-intent', operation: 'restore-all' },
    { commandId: 'close-all-intent', operation: 'close-all' },
    { commandId: 'pin-intent', operation: 'pin', viewId: 'report' },
    { commandId: 'unpin-intent', operation: 'unpin', viewId: 'report' },
  ] as const)('relays the $operation window intent unchanged', async (command) => {
    const { app, broker } = fixture();
    let delivered: WorkspaceCommand | undefined;
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        delivered = data.command;
        broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, true);
      }
      return true;
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    expect(delivered).toEqual(command);
    expect(isWorkspaceReflexOperation(command)).toBe(true);
    expect(response.json()).toMatchObject({
      outcome: 'ok', result: { applied: true, commandId: command.commandId, operation: command.operation },
    });
    connection.close();
  });

  it('broadcasts navigation only to owner tabs and waits for an authenticated applied acknowledgement', async () => {
    const { app, broker } = fixture();
    const command = { commandId: 'navigate-settings', operation: 'navigate', page: 'settings', section: 'voice', target: 'all' };
    const delivered: WorkspaceCommand[] = [];
    let onDelivery!: () => void;
    const delivery = new Promise<void>((resolve) => { onDelivery = resolve; });
    const connect = () => broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        delivered.push(data.command);
        if (delivered.length === 2) onDelivery();
      }
      return true;
    });
    const first = connect();
    const second = connect();
    const otherOwner = vi.fn(() => true);
    broker.connect('other-owner', otherOwner);
    let settled = false;
    const pending = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    }).then((response) => { settled = true; return response; });
    await delivery;
    expect(settled).toBe(false);
    expect(delivered).toEqual([command, command]);
    expect(otherOwner).not.toHaveBeenCalled();
    const ack = (sessionId: string, applied: boolean, headers = userHeaders) => app.inject({
      method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers,
      payload: { sessionId, applied, ...(applied ? {} : { reason: 'Navigation is unavailable in this tab.' }) },
    });
    expect((await ack(first.sessionId, true, agentHeaders)).statusCode).toBe(403);
    expect((await ack(first.sessionId, false)).statusCode).toBe(204);
    expect(settled).toBe(false);
    expect((await ack(second.sessionId, true)).statusCode).toBe(204);
    expect((await pending).json()).toMatchObject({ outcome: 'ok', result: { applied: true, ...command } });
    const replay = await app.inject({
      method: 'POST', url: '/tools/workspace_command',
      headers: { ...agentHeaders, 'x-jarvis-message-id': '102' }, payload: command,
    });
    expect(replay.json()).toMatchObject({ outcome: 'ok' });
    expect(delivered).toHaveLength(2);
    const reused = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { ...command, section: 'appearance' },
    });
    expect(reused.json()).toMatchObject({ outcome: 'refused' });
  });

  it.each([
    { page: 'factory', taskId: '42', reason: 'Task no longer exists.' },
    { page: 'factory', issueNumber: 567, reason: 'Issue card was not found.' },
    { page: 'folio', reason: 'Folio is not available yet.' },
    { page: 'status', reason: 'Status is not available yet.' },
  ])('reports UI navigation refusal with its reason: %j', async ({ reason, ...destination }) => {
    const { app, broker } = fixture();
    const command = { commandId: 'navigate-refused', operation: 'navigate', ...destination };
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        expect(data.command).toEqual(command);
        broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, false, reason);
      }
      return true;
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: reason },
      confirmation: expect.stringContaining('Not done:'),
    });
    connection.close();
    const offline = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { ...command, commandId: 'navigate-offline' },
    });
    expect(offline.json()).toMatchObject({
      outcome: 'refused', result: { refused: 'No active signed-in workspace is connected.' },
    });
  });

  it.each([567, '567'])('delivers normalized Factory issue navigation (%s) and waits for the tab outcome', async (issueNumber) => {
    const { app, broker } = fixture();
    const command = { commandId: 'navigate-issue', operation: 'navigate', page: 'factory', issueNumber: 567 };
    let onDelivery!: () => void;
    const delivery = new Promise<void>((resolve) => { onDelivery = resolve; });
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        expect(data.command).toEqual(command);
        onDelivery();
      }
      return true;
    });
    let settled = false;
    const pending = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: { ...command, issueNumber },
    }).then((response) => { settled = true; return response; });
    await delivery;
    expect(settled).toBe(false);
    const ack = await app.inject({
      method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers: userHeaders,
      payload: { sessionId: connection.sessionId, applied: true },
    });
    expect(ack.statusCode).toBe(204);
    expect((await pending).json()).toMatchObject({ outcome: 'ok', result: { applied: true, ...command } });
    connection.close();
  });

  it.each([
    { operation: 'navigate' },
    { operation: 'navigate', page: 'factory', section: 'voice' },
    { operation: 'navigate', page: 'settings', taskId: '42' },
    { operation: 'navigate', page: 'settings', issueNumber: 567 },
    { operation: 'navigate', page: 'factory', taskId: '9223372036854775808' },
    { operation: 'create', viewId: 'research' },
    { operation: 'move', viewId: 'research', x: 0.1 },
    { operation: 'layout' },
    { operation: 'context-panel' },
  ])('refuses incomplete or mismatched operation fields without delivery: %j', async (fields) => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    broker.connect(ownerId, send);
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'invalid-fields', ...fields },
    });
    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { page: '/settings' }, { page: 'kanban' }, { page: 'settings', section: 'unknown' },
    { page: 'factory', taskId: '01' }, { page: 'knowledge-graph' },
    ...['global', 'new-projects', 'task-recipes'].map((section) => ({ page: 'settings', section })),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'not-an-issue', null]
      .map((issueNumber) => ({ page: 'factory', issueNumber })),
  ])('rejects invalid navigation field schemas before execution: %j', async (fields) => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    broker.connect(ownerId, send);
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'invalid-navigation', operation: 'navigate', ...fields },
    });
    // P9-42: invalid arguments come back as a recoverable refusal, not a bare 400.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('undoes a contradicted partial window close using the same restore contract', async () => {
    const { app, broker } = fixture();
    const commands: WorkspaceCommand[] = [];
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        const command = data.command;
        commands.push(command);
        broker.acknowledge(ownerId, connection.sessionId, command.commandId, true);
      }
      return true;
    });
    broker.updateSnapshot(ownerId, connection.sessionId, {
      windows: [{ viewId: 'board', title: 'Board' }], contextPanelOpen: false,
    });
    app.post('/test/undo', async (request) => {
      const target = (await reflexTargets(request)).find(({ arguments: args }) => args.operation === 'close')!;
      return undoPartialReflexAction(target, request, '101', new AbortController().signal);
    });
    const undo = await app.inject({ method: 'POST', url: '/test/undo', headers: userHeaders });
    expect(undo.json()).toMatchObject({ outcome: 'ok' });
    expect(commands).toEqual([expect.objectContaining({ operation: 'restore', viewId: 'board' })]);
    connection.close();
  });

  it('accepts bounded snapshots only from the active owner session and clears them on reconnect', async () => {
    const { app, broker } = fixture();
    const connection = broker.connect(ownerId, () => true);
    const payload = {
      sessionId: connection.sessionId,
      windows: [{
        viewId: 'tasks', title: 'Tasks', state: 'open', placement: 'region', region: 'left', pinned: true, front: true,
      }],
      contextPanelOpen: false,
      frame: {
        widthPx: 1280,
        heightPx: 900,
        device: 'desktop',
        theme: 'dark',
        reducedMotion: false,
        density: 'comfortable',
        designTokens: { '--text': '#ffffff' },
        fonts: { body: 'system-ui', heading: 'system-ui', mono: 'monospace' },
        layout: 'tiled',
        pinned: false,
      },
    };
    const publish = (body = payload, headers = userHeaders) => app.inject({
      method: 'POST', url: '/now/workspace/state', headers, payload: body,
    });
    expect((await publish()).statusCode).toBe(204);
    expect(broker.snapshot(ownerId)?.windows).toEqual(payload.windows);
    expect(broker.snapshot(ownerId)?.frame).toEqual(payload.frame);
    expect((await publish({ ...payload, frame: { ...payload.frame, widthPx: 0 } })).statusCode).toBe(400);
    expect((await publish({
      ...payload,
      windows: [{ viewId: 'tasks', title: 'Tasks', region: 'left' }],
    })).statusCode).toBe(400);
    expect((await publish(payload, agentHeaders)).statusCode).toBe(403);
    const create = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: { ...userHeaders, 'x-jarvis-message-id': '101' },
      payload: { commandId: 'owner-create', operation: 'create', viewId: 'research', view },
    });
    expect(create.json()).toMatchObject({ outcome: 'refused' });
    expect((await publish({ ...payload, windows: Array.from({ length: 33 }, () => payload.windows[0]!) })).statusCode).toBe(400);
    // A second tab keeps the first tab's layout until it reports its own; the newest report wins.
    const current = broker.connect(ownerId, () => true);
    expect(broker.snapshot(ownerId)?.windows).toEqual(payload.windows);
    expect((await publish({ ...payload, sessionId: current.sessionId, windows: [] })).statusCode).toBe(204);
    expect(broker.snapshot(ownerId)?.windows).toEqual([]);
    current.close();
    expect(broker.snapshot(ownerId)?.windows).toEqual(payload.windows);
    connection.close();
    expect(broker.snapshot(ownerId)).toBeUndefined();
    expect((await publish()).statusCode).toBe(409);
  });

  it('retains current and previous view metadata and refuses invalid locations', async () => {
    const { app, broker } = fixture();
    const connection = broker.connect(ownerId, () => true);
    const view = {
      page: 'factory', taskId: '10', issueNumber: 587, focusedViewId: 'report', folioOpen: true,
      previous: { page: 'settings', section: 'voice' },
    };
    const publish = (currentView: unknown) => app.inject({
      method: 'POST', url: '/now/workspace/state', headers: userHeaders,
      payload: { sessionId: connection.sessionId, windows: [], contextPanelOpen: false, view: currentView },
    });
    expect((await publish(view)).statusCode).toBe(204);
    expect(broker.snapshot(ownerId)?.view).toEqual(view);
    for (const invalid of [
      { page: 'missing' }, { page: 'home', section: 'voice' },
      { page: 'factory', taskId: '0' }, { page: 'factory', issueNumber: 1.5 },
      { page: 'home', previous: { page: 'home', taskId: '10' } },
      { page: 'home', folioOpen: 'yes' }, { page: 'home', focusedViewId: '../report' },
    ]) {
      expect((await publish(invalid)).statusCode).toBe(400);
      expect(broker.snapshot(ownerId)?.view).toEqual(view);
    }
  });

  it.each([undefined, 'active', 'desktop', 'phone', 'all'] as const)(
    'routes target %s and counts acknowledgements only from recipients', async (target) => {
      const broker = new WorkspaceCommandBroker();
      const desktopSend = vi.fn(() => true);
      const phoneSend = vi.fn(() => true);
      const desktop = broker.connect(ownerId, desktopSend);
      const phone = broker.connect(ownerId, phoneSend);
      broker.updateSnapshot(ownerId, phone.sessionId, {
        windows: [], contextPanelOpen: false, device: { kind: 'phone' },
      });
      broker.updateSnapshot(ownerId, desktop.sessionId, {
        windows: [], contextPanelOpen: false, device: { kind: 'desktop' },
      });
      const command: WorkspaceCommand = {
        commandId: 'targeted', operation: 'minimise-all', ...(target ? { target } : {}),
      };
      let settled = false;
      const pending = broker.execute(ownerId, command, new AbortController().signal)
        .then(() => { settled = true; });
      expect(desktopSend).toHaveBeenCalledTimes(target === 'phone' ? 0 : 1);
      expect(phoneSend).toHaveBeenCalledTimes(target === 'phone' || target === 'all' ? 1 : 0);
      if (target !== 'all') {
        const other = target === 'phone' ? desktop : phone;
        expect(broker.acknowledge(ownerId, other.sessionId, command.commandId, false, 'Wrong tab.').status).toBe('stale');
        expect(broker.acknowledge(ownerId, other.sessionId, command.commandId, true).status).toBe('stale');
        other.close();
        await Promise.resolve();
        expect(settled).toBe(false);
      }
      const recipient = target === 'phone' ? phone : desktop;
      expect(broker.acknowledge(ownerId, recipient.sessionId, command.commandId, true).status).toBe('accepted');
      await pending;
      broker.dispose();
    },
  );

  it('follows changing snapshots and falls back after the active tab disconnects', async () => {
    const broker = new WorkspaceCommandBroker();
    const firstSend = vi.fn(() => true);
    const secondSend = vi.fn(() => true);
    const first = broker.connect(ownerId, firstSend);
    const second = broker.connect(ownerId, secondSend);
    for (const [index, active] of [first, second, first].entries()) {
      broker.updateSnapshot(ownerId, active.sessionId, { windows: [], contextPanelOpen: false });
      const commandId = `active-${index}`;
      const pending = broker.execute(ownerId, { commandId, operation: 'minimise-all' }, new AbortController().signal);
      expect(active === first ? firstSend : secondSend).toHaveBeenLastCalledWith(
        'workspace-command', expect.objectContaining({ command: expect.objectContaining({ commandId }) }),
      );
      broker.acknowledge(ownerId, active.sessionId, commandId, true);
      await pending;
    }
    first.close();
    expect(broker.deviceContext(ownerId)).toBe('unknown device connected; commands go to the unknown device');
    const pending = broker.execute(ownerId, { commandId: 'fallback', operation: 'minimise-all' }, new AbortController().signal);
    broker.acknowledge(ownerId, second.sessionId, 'fallback', true);
    await expect(pending).resolves.toBeUndefined();
    broker.dispose();
  });

  it('selects one legacy tab without snapshots, while all includes unknown devices', async () => {
    const broker = new WorkspaceCommandBroker();
    const firstSend = vi.fn(() => true);
    const secondSend = vi.fn(() => true);
    const first = broker.connect(ownerId, firstSend);
    const second = broker.connect(ownerId, secondSend);
    const active = broker.execute(ownerId, { commandId: 'legacy', operation: 'minimise-all' }, new AbortController().signal);
    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(secondSend).not.toHaveBeenCalled();
    broker.acknowledge(ownerId, first.sessionId, 'legacy', true);
    await active;
    broker.updateSnapshot(ownerId, second.sessionId, { windows: [], contextPanelOpen: false, device: { kind: 'phone' } });
    const all = broker.execute(ownerId, { commandId: 'legacy-all', operation: 'minimise-all', target: 'all' }, new AbortController().signal);
    expect(firstSend).toHaveBeenCalledTimes(2);
    expect(secondSend).toHaveBeenCalledTimes(1);
    broker.acknowledge(ownerId, first.sessionId, 'legacy-all', true);
    await all;
    broker.dispose();
  });

  it('targets only the latest tab of a named kind and preserves recipients on replay', async () => {
    const broker = new WorkspaceCommandBroker();
    const sends = [vi.fn(() => true), vi.fn(() => true)];
    const tabs = sends.map((send) => broker.connect(ownerId, send));
    for (const tab of tabs) {
      broker.updateSnapshot(ownerId, tab.sessionId, { windows: [], contextPanelOpen: false, device: { kind: 'phone' } });
    }
    const command: WorkspaceCommand = { commandId: 'phone-tab', operation: 'minimise-all', target: 'phone' };
    const pending = broker.execute(ownerId, command, new AbortController().signal);
    broker.updateSnapshot(ownerId, tabs[0]!.sessionId, { windows: [], contextPanelOpen: false, device: { kind: 'phone' } });
    const replay = broker.execute(ownerId, command, new AbortController().signal);
    expect(sends[0]).not.toHaveBeenCalled();
    expect(sends[1]).toHaveBeenCalledTimes(1);
    expect(broker.acknowledge(ownerId, tabs[0]!.sessionId, command.commandId, true).status).toBe('stale');
    broker.acknowledge(ownerId, tabs[1]!.sessionId, command.commandId, true);
    await Promise.all([pending, replay]);
    broker.dispose();
  });

  it('cancels only the delivered-to tab even after the active snapshot changes', async () => {
    const broker = new WorkspaceCommandBroker();
    const firstSend = vi.fn(() => true);
    const secondSend = vi.fn(() => true);
    const first = broker.connect(ownerId, firstSend);
    const second = broker.connect(ownerId, secondSend);
    const controller = new AbortController();
    const pending = broker.execute(ownerId, { commandId: 'cancel-target', operation: 'minimise-all' }, controller.signal);
    const failure = expect(pending).rejects.toBeInstanceOf(ToolFailure);
    broker.updateSnapshot(ownerId, second.sessionId, { windows: [], contextPanelOpen: false });
    controller.abort();
    await failure;
    expect(firstSend).toHaveBeenLastCalledWith('workspace-cancel', { commandId: 'cancel-target' });
    expect(secondSend).not.toHaveBeenCalled();
    first.close();
    broker.dispose();
  });

  it('fails when the sole recipient disconnects instead of rerouting to another tab', async () => {
    const broker = new WorkspaceCommandBroker();
    const first = broker.connect(ownerId, () => true);
    const otherSend = vi.fn(() => true);
    broker.connect(ownerId, otherSend);
    const pending = broker.execute(ownerId, { commandId: 'lost-target', operation: 'minimise-all' }, new AbortController().signal);
    const failure = expect(pending).rejects.toBeInstanceOf(ToolFailure);
    first.close();
    await failure;
    expect(otherSend).not.toHaveBeenCalled();
    broker.dispose();
  });

  it('refuses a disconnected kind and lists connected kinds without untrusted labels', async () => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    const phone = broker.connect(ownerId, send);
    const desktop = broker.connect(ownerId, send);
    const tablet = broker.connect(ownerId, send);
    broker.connect(ownerId, send);
    for (const [connection, kind] of [[phone, 'phone'], [desktop, 'desktop'], [tablet, 'tablet']] as const) {
      expect((await app.inject({
        method: 'POST', url: '/now/workspace/state', headers: userHeaders,
        payload: { sessionId: connection.sessionId, windows: [], contextPanelOpen: false, device: { kind, label: 'private device label' } },
      })).statusCode).toBe(204);
    }
    phone.close();
    const refusal = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'missing-phone', operation: 'minimise-all', target: 'phone' },
    });
    expect(refusal.json()).toMatchObject({
      outcome: 'refused', result: { refused: 'No phone workspace is connected. Connected devices: desktop, tablet, unknown device.' },
    });
    expect(send).not.toHaveBeenCalled();
    broker.dispose();
    await expect(broker.execute(ownerId, {
      commandId: 'no-desktop', operation: 'minimise-all', target: 'desktop',
    }, new AbortController().signal)).rejects.toThrow('Connected devices: none.');
  });

  it.each([{ kind: 'watch' }, { kind: 'phone', label: '' }, { kind: 'phone', label: 'x'.repeat(61) }, { kind: 'phone', label: {} }])(
    'rejects invalid snapshot device %j', async (device) => {
      const { app, broker } = fixture();
      const connection = broker.connect(ownerId, () => true);
      expect((await app.inject({
        method: 'POST', url: '/now/workspace/state', headers: userHeaders,
        payload: { sessionId: connection.sessionId, windows: [], contextPanelOpen: false, device },
      })).statusCode).toBe(400);
      expect(broker.snapshot(ownerId)).toBeUndefined();
    },
  );

  it('delivers explicit all commands to all open tabs and refuses only when every tab refuses', async () => {
    const broker = new WorkspaceCommandBroker();
    const deliveries: Array<{ tab: string; commandId: string }> = [];
    const tab = (name: string) => {
      const connection = broker.connect(ownerId, (event, data) => {
        if (event === 'workspace-command') {
          deliveries.push({ tab: name, commandId: data.command.commandId });
        }
        return true;
      });
      return connection;
    };
    const first = tab('first');
    const second = tab('second');
    expect(broker.isConnected(ownerId)).toBe(true);

    const shown = broker.execute(ownerId, { commandId: 'show-both', operation: 'layout', arrangement: 'tiled', target: 'all' },
      new AbortController().signal);
    expect(deliveries.filter(({ commandId }) => commandId === 'show-both').map(({ tab: name }) => name))
      .toEqual(['first', 'second']);
    expect(broker.acknowledge(ownerId, first.sessionId, 'show-both', false, 'Not here.').status).toBe('accepted');
    expect(broker.acknowledge(ownerId, second.sessionId, 'show-both', true).status).toBe('accepted');
    await expect(shown).resolves.toBeUndefined();

    const refused = broker.execute(ownerId, { commandId: 'refuse-both', operation: 'show', viewId: 'missing', target: 'all' },
      new AbortController().signal);
    broker.acknowledge(ownerId, first.sessionId, 'refuse-both', false, 'View no longer exists.');
    broker.acknowledge(ownerId, second.sessionId, 'refuse-both', false, 'View no longer exists.');
    await expect(refused).rejects.toBeInstanceOf(ToolRefusal);

    const survived = broker.execute(ownerId, { commandId: 'one-left', operation: 'layout', arrangement: 'layered', target: 'all' },
      new AbortController().signal);
    first.close();
    expect(broker.acknowledge(ownerId, second.sessionId, 'one-left', true).status).toBe('accepted');
    await expect(survived).resolves.toBeUndefined();

    second.close();
    expect(broker.isConnected(ownerId)).toBe(false);
  });

  it.each(['final', 'partial'] as const)('executes %s workspace reflexes and replays the agent action despite a new command ID', async (mode) => {
    const { app, broker, records } = fixture();
    const delivered: WorkspaceCommand[] = [];
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        const command = data.command;
        delivered.push(command);
        broker.acknowledge(ownerId, connection.sessionId, command.commandId, true);
      }
      return true;
    });
    broker.updateSnapshot(ownerId, connection.sessionId, { windows: [], contextPanelOpen: false });
    app.post('/test/reflex', async (request) => {
      const target = (await reflexTargets(request)).find(({ arguments: args }) => args.arrangement === 'tiled')!;
      const finish = registerChatReflex('101');
      const result = await executeReflexAction({
        addressed: true, intent: 'action', confidence: 0.99, needsConfirmation: false,
        completeCommand: true, target,
      }, request, '101', new AbortController().signal, mode);
      finish(result);
      return result;
    });
    const reflex = await app.inject({ method: 'POST', url: '/test/reflex', headers: userHeaders });
    expect(reflex.json()).toMatchObject({ outcome: 'ok', result: { applied: true, operation: 'layout' } });
    const agent = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'agent-different-id', operation: 'layout', arrangement: 'tiled' },
    });
    expect(agent.json()).toMatchObject({ outcome: 'ok', confirmation: expect.stringContaining('Reflex already did') });
    expect(delivered).toHaveLength(1);
    expect(records).toHaveLength(1);
    connection.close();
  });

  it('refuses disconnected workspaces and rejects invalid command schemas at the tool boundary', async () => {
    const { app, records } = fixture();
    const disconnected = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'offline-1', operation: 'create', viewId: 'research', view },
    });
    expect(disconnected.json()).toMatchObject({ outcome: 'refused' });
    expect(disconnected.json().result.refused).toContain('No active signed-in workspace');

    const invalidGeometry = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'bad-geometry', operation: 'resize', viewId: 'research', width: 0.1, height: 0.5 },
    });
    const invalidOperation = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'bad-operation', operation: 'execute' },
    });
    for (const invalid of [invalidGeometry, invalidOperation]) {
      expect(invalid.statusCode).toBe(200);
      expect(invalid.json()).toMatchObject({
        outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') },
      });
    }
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      arguments: { redacted: true },
      result: { redacted: true },
    });
  });

  it('delivers a validated generated view and acknowledges only the active signed-in client', async () => {
    const { app, broker, records } = fixture();
    let delivered!: { command: WorkspaceCommand; expiresAt: number };
    let onDelivery!: () => void;
    const deliveredPromise = new Promise<void>((resolve) => { onDelivery = resolve; });
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        delivered = data;
        onDelivery();
      }
      return true;
    });
    const command: WorkspaceCommand = {
      commandId: 'create-research',
      operation: 'create',
      viewId: 'research',
      view,
    };
    const firstCall = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    await deliveredPromise;
    expect(delivered.command).toEqual(command);
    expect(delivered.expiresAt).toBeGreaterThan(Date.now());

    const duplicateCall = app.inject({
      method: 'POST', url: '/tools/workspace_command',
      headers: { ...agentHeaders, 'x-jarvis-message-id': '102' },
      payload: command,
    });
    const staleAgentAck = await app.inject({
      method: 'POST',
      url: `/now/workspace/commands/${command.commandId}/ack`,
      headers: agentHeaders,
      payload: { sessionId: connection.sessionId, applied: true },
    });
    expect(staleAgentAck.statusCode).toBe(403);

    const ack = await app.inject({
      method: 'POST',
      url: `/now/workspace/commands/${command.commandId}/ack`,
      headers: userHeaders,
      payload: { sessionId: connection.sessionId, applied: true },
    });
    expect(ack.statusCode).toBe(204);
    const [first, duplicate] = await Promise.all([firstCall, duplicateCall]);
    expect(first.json()).toMatchObject({
      outcome: 'ok',
      result: { type: 'generated-view', view },
    });
    expect(duplicate.json()).toEqual(first.json());
    expect(records).toHaveLength(2);
    expect(records.every((record) => JSON.stringify(record).includes('"redacted":true'))).toBe(true);
    connection.close();
  });

  it('creates, refreshes and closes an acknowledged Health chart across chat and voice requests', async () => {
    const result: DailyQueryResult = {
      source: dailyQuerySources.metrics,
      period: { startDate: '2026-10-11', endDate: '2026-10-17', timeZone: 'Europe/Copenhagen' },
      items: [
        { metric_date: '2026-10-16', metric_name: 'step_count', value: 1234, avg_value: null, unit: 'count' },
        { metric_date: '2026-10-17', metric_name: 'step_count', value: 2345, avg_value: null, unit: 'count' },
      ],
      status: 'available',
      units: { unit: 'retained per-record unit' },
      provenance: { store: 'daily-sql', detail: 'retained-record', calculations: 'existing-read-model', consistency: 'independent-committed-reads' },
      freshness: { observedAt: '2026-10-17T19:26:00.000Z', sourceProcessedCommittedAt: null,
        latestReturnedRecordUpdatedAt: null, staleness: 'unknown' },
      coverage: { returned: 2, hasMore: false, next: null, sourceCompleteness: 'unknown' },
      revision: '0'.repeat(64),
    };
    const dailyQuery = vi.fn().mockResolvedValue(result);
    const { app, broker } = fixture(true, [], dailyQuery);
    const delivered: WorkspaceCommand[] = [];
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') delivered.push(data.command);
      return true;
    });
    const acknowledge = async (index: number, operation: string, applied: boolean, reason?: string) => {
      await vi.waitFor(() => expect(delivered).toHaveLength(index + 1));
      const command = delivered[index]!;
      expect(command.operation).toBe(operation);
      const ack = await app.inject({
        method: 'POST', url: `/now/workspace/commands/${command.commandId}/ack`, headers: userHeaders,
        payload: { sessionId: connection.sessionId, applied, ...(reason ? { reason } : {}) },
      });
      expect(ack.statusCode).toBe(204);
      return command;
    };
    const input = {
      source: dailyQuerySources.metrics, startDate: '2026-10-11', endDate: '2026-10-17',
      metric: 'step_count', display: 'chart',
    };

    const creating = app.inject({ method: 'POST', url: '/tools/daily_show', headers: agentHeaders, payload: input });
    const update = await acknowledge(0, 'update', false, 'That view is not open.');
    const create = await acknowledge(1, 'create', true);
    expect(create.viewId).toBe(update.viewId);
    expect(create.view?.renderer).toBe('chart');
    expect(create.view?.data).toMatchObject({
      kind: 'bar',
      series: [{ name: 'Step count (count)', points: [{ x: '16 Oct', y: 1234 }, { x: '17 Oct', y: 2345 }] }],
    });
    expect((await creating).json()).toMatchObject({
      outcome: 'ok', result: { view: { operation: 'created', viewId: create.viewId, renderer: 'chart', rowsShown: 2 } },
    });

    const refreshing = app.inject({
      method: 'POST', url: '/tools/daily_show',
      headers: { ...agentHeaders, 'x-jarvis-message-id': '102', 'x-jarvis-voice-item-id': 'voice-102' },
      payload: input,
    });
    const refreshed = await acknowledge(2, 'update', true);
    const refreshedForeground = await acknowledge(3, 'show', true);
    expect(refreshed.viewId).toBe(create.viewId);
    expect(refreshedForeground.viewId).toBe(create.viewId);
    expect((await refreshing).json()).toMatchObject({
      outcome: 'ok', result: { view: { operation: 'refreshed', viewId: create.viewId, renderer: 'chart', rowsShown: 2 } },
    });
    expect(dailyQuery).toHaveBeenCalledTimes(2);
    expect(dailyQuery.mock.calls.map(([query]) => query)).toEqual([
      { source: dailyQuerySources.metrics, startDate: input.startDate, endDate: input.endDate, metric: 'step_count', limit: 200 },
      { source: dailyQuerySources.metrics, startDate: input.startDate, endDate: input.endDate, metric: 'step_count', limit: 200 },
    ]);

    const closing = app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: { ...agentHeaders, 'x-jarvis-message-id': '103' },
      payload: { commandId: 'close-health-chart', operation: 'close', viewId: create.viewId },
    });
    const close = await acknowledge(4, 'close', true);
    expect(close.viewId).toBe(create.viewId);
    expect((await closing).json()).toMatchObject({
      outcome: 'ok', result: { applied: true, commandId: 'close-health-chart', operation: 'close' },
    });
    connection.close();
  });

  it('keeps command IDs idempotent and reports stale clients, cancellations, timeouts, and a full queue', async () => {
    const broker = new WorkspaceCommandBroker();
    await expect(broker.execute(ownerId, {
      commandId: 'offline', operation: 'layout', arrangement: 'tiled',
    }, new AbortController().signal)).rejects.toBeInstanceOf(ToolRefusal);

    const events: unknown[] = [];
    const first = broker.connect(ownerId, (_event, data) => { events.push(data); return true; });
    const command: WorkspaceCommand = { commandId: 'same-command', operation: 'layout', arrangement: 'layered' };
    const pending = broker.execute(ownerId, command, new AbortController().signal);
    const duplicate = broker.execute(ownerId, command, new AbortController().signal);
    expect(events).toHaveLength(1);
    await expect(broker.execute(ownerId, {
      ...command, arrangement: 'tiled',
    }, new AbortController().signal)).rejects.toBeInstanceOf(ToolRefusal);
    const pendingFailure = expect(pending).rejects.toBeInstanceOf(ToolFailure);
    const duplicateFailure = expect(duplicate).rejects.toBeInstanceOf(ToolFailure);
    first.close();
    await Promise.all([pendingFailure, duplicateFailure]);

    const current = broker.connect(ownerId, (_event, data) => { events.push(data); return true; });
    expect(broker.acknowledge(ownerId, first.sessionId, command.commandId, true).status).toBe('stale');
    const rejected = broker.execute(ownerId, {
      commandId: 'unsupported-view', operation: 'show', viewId: 'missing',
    }, new AbortController().signal);
    expect(broker.acknowledge(ownerId, current.sessionId, 'unsupported-view', false, 'View no longer exists.').status)
      .toBe('accepted');
    await expect(rejected).rejects.toBeInstanceOf(ToolRefusal);
    expect(broker.acknowledge(ownerId, current.sessionId, 'unsupported-view', false, 'View no longer exists.').status)
      .toBe('duplicate');

    const controller = new AbortController();
    const cancelled = broker.execute(ownerId, {
      commandId: 'cancel-me', operation: 'layout', arrangement: 'tiled',
    }, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(ToolFailure);

    vi.useFakeTimers();
    const timedOut = broker.execute(ownerId, {
      commandId: 'time-out', operation: 'layout', arrangement: 'tiled',
    }, new AbortController().signal);
    const timeoutFailure = expect(timedOut).rejects.toBeInstanceOf(ToolFailure);
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutFailure;
    vi.useRealTimers();

    const queued = Array.from({ length: 8 }, (_, index) => broker.execute(ownerId, {
      commandId: `queued-${index}`, operation: 'layout', arrangement: 'tiled',
    }, new AbortController().signal));
    await expect(broker.execute(ownerId, {
      commandId: 'queue-overflow', operation: 'layout', arrangement: 'tiled',
    }, new AbortController().signal)).rejects.toBeInstanceOf(ToolRefusal);
    current.close();
    expect((await Promise.allSettled(queued)).every(({ status }) => status === 'rejected')).toBe(true);
  });
});

describe('Jarvis control of its own workspace views', () => {
  const hotels = {
    version: 1,
    title: 'Hotels found',
    renderer: 'list',
    source: { id: 'now', status: 'complete' },
    data: {
      items: [
        { title: 'Hotel Alpha', description: 'Booked 12 Nov, 3 nights' },
        { title: 'Hotel Beta', description: 'Booked 20 Nov, 2 nights' },
      ],
    },
  } as const;

  function autoAckTab(broker: WorkspaceCommandBroker) {
    const delivered: WorkspaceCommand[] = [];
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        delivered.push(data.command);
        queueMicrotask(() => { broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, true); });
      }
      return true;
    });
    return { delivered, connection };
  }

  function directRequest(principal: { objectId: string } | null) {
    const execute = vi.fn(async () => undefined);
    const request = {
      headers: {},
      log: { info: vi.fn(), warn: vi.fn() },
      principal,
      agentPrincipal: null,
      server: {
        ownerObjectId: ownerId,
        jarvisTools: { list: () => [], get: () => undefined },
        workspaceCommands: { execute },
      },
    } as unknown as FastifyRequest;
    return { request, execute };
  }

  it('lets Jarvis create, update, arrange and close a clean list view', async () => {
    const { app, broker } = fixture();
    const { delivered, connection } = autoAckTab(broker);
    const send = (payload: Record<string, unknown>) => app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload,
    });
    const created = await send({ commandId: 'hotels-create', operation: 'create', viewId: 'hotels-found', view: hotels });
    expect(created.json()).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: hotels } });
    const revised = { ...hotels, title: 'Hotels found (3)', data: { items: [...hotels.data.items, { title: 'Hotel Gamma' }] } };
    expect((await send({
      commandId: 'hotels-update', operation: 'update', viewId: 'hotels-found', view: revised,
    })).json()).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: revised } });
    expect((await send({
      commandId: 'hotels-place', operation: 'place', viewId: 'hotels-found', region: 'left',
    })).json()).toMatchObject({ outcome: 'ok', result: { applied: true, operation: 'place' } });
    expect((await send({
      commandId: 'hotels-arrange', operation: 'arrange', layout: 'side-by-side', viewIds: ['hotels-found', 'tasks'],
    })).json()).toMatchObject({ outcome: 'ok', result: { applied: true, operation: 'arrange' } });
    expect((await send({
      commandId: 'hotels-close', operation: 'close', viewId: 'hotels-found',
    })).json()).toMatchObject({ outcome: 'ok', result: { applied: true, operation: 'close' } });
    expect(delivered.map(({ operation }) => operation)).toEqual(['create', 'update', 'place', 'arrange', 'close']);
    connection.close();
  });

  it.each([
    { commandId: 'owner-create', operation: 'create', viewId: 'hotels-found', view: hotels },
    { commandId: 'owner-update', operation: 'update', viewId: 'hotels-found', view: hotels },
    { commandId: 'owner-navigate', operation: 'navigate', page: 'settings' },
    { commandId: 'owner-panel', operation: 'context-panel', action: 'open', view: hotels },
  ])('keeps $operation Jarvis-only for the owner’s own browser session', async (command) => {
    const { app, broker } = fixture();
    const { delivered, connection } = autoAckTab(broker);
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command',
      headers: { ...userHeaders, 'x-jarvis-message-id': '101' }, payload: command,
    });
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.any(String) } });
    const refusal = String((response.json() as { result: { refused: string } }).result.refused);
    expect(refusal).toContain('Creating, updating or navigating views is done by Jarvis');
    expect(refusal).toContain('Nothing was changed or shown');
    expect(refusal).not.toMatch(/workspace owner can/i);
    expect(delivered).toEqual([]);
    connection.close();
  });

  it('still lets the signed-in owner control existing windows from the browser', async () => {
    const { app, broker } = fixture();
    const { delivered, connection } = autoAckTab(broker);
    const close = { commandId: 'owner-close', operation: 'close', viewId: 'hotels-found' };
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command',
      headers: { ...userHeaders, 'x-jarvis-message-id': '101' }, payload: close,
    });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { applied: true, operation: 'close' } });
    expect(delivered).toEqual([close]);
    connection.close();
  });

  it('treats a model-issued call on the owner’s own request as Jarvis, and nothing else', async () => {
    const create = { commandId: 'voice-create', operation: 'create', viewId: 'hotels-found', view: hotels };
    const signal = new AbortController().signal;

    const model = directRequest({ objectId: ownerId });
    await expect(runModelToolCall(model.request, () => workspaceCommandTool.execute(create, model.request, signal)))
      .resolves.toMatchObject({ type: 'generated-view', view: hotels });
    expect(model.execute).toHaveBeenCalledWith(ownerId, create, signal);

    const browser = directRequest({ objectId: ownerId });
    await expect(workspaceCommandTool.execute(create, browser.request, signal))
      .rejects.toThrow('Creating, updating or navigating views is done by Jarvis');
    expect(browser.execute).not.toHaveBeenCalled();

    for (const principal of [{ objectId: 'someone-else' }, null]) {
      const stranger = directRequest(principal);
      await expect(runModelToolCall(stranger.request, () =>
        workspaceCommandTool.execute(create, stranger.request, signal)))
        .rejects.toThrow('available only to Jarvis and the signed-in workspace owner');
      expect(stranger.execute).not.toHaveBeenCalled();
    }
  });

  it('shows a worked clean-list example and tells the model to retry a refusal once', () => {
    expect(workspaceCommandTool.description).toContain('create a clean list view');
    expect(workspaceCommandTool.description).toContain('never raw JSON or full message bodies');
    expect(workspaceCommandTool.description).toContain('"viewId":"hotels-found"');
    expect(workspaceCommandTool.description).toContain('create and update both need viewId and view');
    expect(workspaceCommandTool.description).toContain('view is a JSON object, never a string of JSON');
    expect(workspaceCommandTool.description).toContain('position a new view with a separate place, arrange, move or resize command');
    expect(workspaceCommandTool.description).toContain('correct it and retry once');
    expect(Array.from(workspaceCommandTool.description).length).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION_CHARACTERS);
  });

  describe('specific refusals in chat and voice', () => {
    const listView = {
      version: 1, title: 'private-title', renderer: 'list', source: { id: 'now', status: 'complete' },
      data: { items: [{ title: 'private-hotel', description: 'private-description' }] },
    };
    const create = (value: unknown, extra: Record<string, unknown> = {}) =>
      ({ commandId: 'refused-1', operation: 'create', viewId: 'private-view', view: value, ...extra });
    const refusal = (explanation: string) =>
      `Invalid arguments: ${explanation}. Nothing was changed or shown by this call. Retry with arguments matching the tool schema.`;
    const viewExample = '{"version":1,"title":"...","renderer":"list","source":{"id":"now","status":"complete"},"data":{"items":[{"title":"..."}]}}';
    const viewIdRule = 'viewId: is required, and must start with a letter, then letters, digits, _ or - (up to 64 characters)';
    const refusedShapes = [
      {
        name: 'a source.id the model made up (gmail)',
        payload: create({ ...listView, source: { id: 'gmail', status: 'complete' } }),
        explanation: 'view.source.id: must be one of now, factory.tasks, factory.projects, usage, image_generation, html_generation, research or knowledge_graph (use now when none of the others fit)',
      },
      {
        name: 'a call-tool action for a tool that is not registered',
        payload: create({ ...listView, actions: [{ type: 'call-tool', tool: 'gmail_search' }] }),
        explanation: 'view.actions[0].tool: is not a registered tool (use an exact tool name from your tool list, or leave the action out)',
      },
      {
        name: 'an open-link action on a host that is not allowed',
        payload: create({
          ...listView,
          data: { items: [{ title: 'private-hotel', action: { type: 'open-link', url: 'https://booking.example/private-hotel', label: 'Open' } }] },
        }),
        explanation: 'view.data.items[0].action.url: must be an https link on github.com, learn.microsoft.com, azure.com or *.azure.com, with no port or login details',
      },
      {
        name: 'a view sent as a JSON string',
        payload: create(JSON.stringify(listView)),
        explanation: `view: must be a JSON object, not text containing JSON, like ${viewExample}`,
      },
      {
        name: 'create without viewId and view',
        payload: { commandId: 'refused-1', operation: 'create' },
        explanation: `${viewIdRule}; view: is required, and must be a JSON object like ${viewExample}`,
      },
      {
        name: 'create without a viewId',
        payload: { commandId: 'refused-1', operation: 'create', view: listView },
        explanation: viewIdRule,
      },
      {
        name: 'create with placement fields',
        payload: create(listView, { region: 'left', x: 0.1, y: 0.1 }),
        explanation: 'region, x, y: not allowed with operation create, which takes viewId and view only (position a view with a separate place, arrange, move or resize command)',
      },
      {
        name: 'a table row with the wrong number of cells',
        payload: create({
          version: 1, title: 'private-title', renderer: 'table', source: { id: 'now', status: 'complete' },
          data: { columns: ['Hotel', 'Nights'], rows: [['private-a', 2], ['private-b']] },
        }),
        explanation: 'view.data.rows[1]: has 1 cell but there are 2 columns, so give every row exactly one cell per column',
      },
      {
        name: 'a timeline event with a date that does not exist',
        payload: create({
          version: 1, title: 'private-title', renderer: 'timeline', source: { id: 'now', status: 'complete' },
          data: { events: [{ at: '2026-02-31', title: 'private-trip' }] },
        }),
        explanation: 'view.data.events[0].at: must be a real date such as 2026-01-31 or a date-time with a timezone such as 2026-01-31T09:00:00Z (use label for a period)',
      },
    ];
    const channels = [
      { channel: 'chat', url: '/tools/workspace_command', headers: agentHeaders },
      { channel: 'voice', url: '/test/voice', headers: userHeaders },
    ];

    // The voice route runs the model-issued call the way the relay does: on the owner's request, inside its call scope.
    function chatAndVoice() {
      const voiceProbe: BackendModule = {
        id: 'voice-probe', tools: [],
        registerRoutes: async (instance) => {
          instance.post('/test/voice', async (request) => JSON.parse(await runModelToolCall(request, () =>
            executeRealtimeToolCall({
              type: 'response.function_call_arguments.done', name: 'workspace_command', call_id: 'call-1',
              arguments: JSON.stringify(request.body),
            }, instance.jarvisTools, request, new AbortController().signal))));
        },
      };
      return fixture(false, [voiceProbe]);
    }

    it.each(refusedShapes)('refuses $name with one specific message in chat and voice', async ({ payload, explanation }) => {
      const { app, broker } = chatAndVoice();
      const { delivered, connection } = autoAckTab(broker);
      const chat = await app.inject({ method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload });
      const voice = await app.inject({ method: 'POST', url: '/test/voice', headers: userHeaders, payload });
      expect(chat.statusCode).toBe(200);
      expect(voice.statusCode).toBe(200);
      expect(chat.json()).toEqual({
        tool: 'workspace_command', outcome: 'refused', result: { refused: refusal(explanation) },
        confirmation: `Not done: workspace_command was refused. ${refusal(explanation)}`,
      });
      expect(voice.json()).toEqual(chat.json());
      expect(Array.from(chat.json().result.refused as string).length).toBeLessThanOrEqual(500);
      expect(chat.body + voice.body).not.toContain('private-');
      expect(delivered).toEqual([]);
      connection.close();
    });

    it.each(channels)('accepts the same clean list in $channel and shows it', async ({ channel, url, headers }) => {
      const { app, broker } = chatAndVoice();
      const { delivered, connection } = autoAckTab(broker);
      const response = await app.inject({
        method: 'POST', url, headers,
        payload: { commandId: `hotels-${channel}`, operation: 'create', viewId: 'hotels-found', view: hotels },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: hotels } });
      expect(delivered.map(({ commandId }) => commandId)).toEqual([`hotels-${channel}`]);
      connection.close();
    });

    it.each(channels)('lets Jarvis fix the named field and retry once in $channel', async ({ url, headers }) => {
      const { app, broker } = chatAndVoice();
      const { delivered, connection } = autoAckTab(broker);
      const send = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers, payload });
      const refused = await send({ commandId: 'retry-1', operation: 'create', view: hotels });
      expect(refused.json()).toMatchObject({
        outcome: 'refused', result: { refused: expect.stringContaining(`${viewIdRule}.`) },
      });
      expect(delivered).toEqual([]);
      const retried = await send({ commandId: 'retry-2', operation: 'create', viewId: 'hotels-found', view: hotels });
      expect(retried.json()).toMatchObject({ outcome: 'ok', result: { type: 'generated-view', view: hotels } });
      expect(delivered.map(({ commandId }) => commandId)).toEqual(['retry-2']);
      connection.close();
    });

    it('still gives the browser the owner-only refusal, not a validation hint, for an invalid create', async () => {
      const { app, broker } = chatAndVoice();
      const { delivered, connection } = autoAckTab(broker);
      const response = await app.inject({
        method: 'POST', url: '/tools/workspace_command', headers: { ...userHeaders, 'x-jarvis-message-id': '101' },
        payload: { commandId: 'owner-invalid', operation: 'create' },
      });
      expect(response.json()).toMatchObject({ outcome: 'refused' });
      const reason = String(response.json().result.refused);
      expect(reason).toContain('Creating, updating or navigating views is done by Jarvis');
      expect(reason).not.toContain('viewId');
      expect(delivered).toEqual([]);
      connection.close();
    });
  });
});

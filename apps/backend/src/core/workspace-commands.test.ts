import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from './index.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { WorkspaceCommandBroker } from './workspace-commands.js';
import { workspaceNavigationPages, type WorkspaceCommand } from '@jarvis/contracts';
import { executeReflexAction, reflexTargets, registerChatReflex, undoPartialReflexAction } from './reflex.js';

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

function fixture() {
  const broker = new WorkspaceCommandBroker();
  const records: unknown[] = [];
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async (token) => token === 'header.user.signature'
      ? { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' }
      : { kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId },
    toolCallStore: { record: async (call) => { records.push(call); } },
    workspaceCommands: broker,
  });
  apps.push(app);
  return { app, broker, records };
}

describe('workspace command delivery', () => {
  it.each(workspaceNavigationPages)('delivers navigation to %s through the shared tool', async (page) => {
    const { app, broker } = fixture();
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
    expect(delivered).toEqual([command]);
    connection.close();
  });

  it('broadcasts navigation only to owner tabs and waits for an authenticated applied acknowledgement', async () => {
    const { app, broker } = fixture();
    const command = { commandId: 'navigate-settings', operation: 'navigate', page: 'settings', section: 'voice' };
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

  it('reports navigation refusal without claiming the page changed', async () => {
    const { app, broker } = fixture();
    const command = { commandId: 'navigate-task', operation: 'navigate', page: 'factory', taskId: '42' };
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') {
        expect(data.command).toEqual(command);
        broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, false, 'Task no longer exists.');
      }
      return true;
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders, payload: command,
    });
    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: 'Task no longer exists.' },
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

  it.each([
    { operation: 'navigate' },
    { operation: 'navigate', page: 'factory', section: 'voice' },
    { operation: 'navigate', page: 'settings', taskId: '42' },
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
    { page: 'factory', taskId: '01' },
  ])('rejects invalid navigation field schemas before execution: %j', async (fields) => {
    const { app, broker } = fixture();
    const send = vi.fn(() => true);
    broker.connect(ownerId, send);
    const response = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: agentHeaders,
      payload: { commandId: 'invalid-navigation', operation: 'navigate', ...fields },
    });
    expect(response.statusCode).toBe(400);
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
      windows: [{ viewId: 'tasks', title: 'Tasks' }],
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

  it('delivers every command to all open tabs and refuses only when every tab refuses', async () => {
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

    const shown = broker.execute(ownerId, { commandId: 'show-both', operation: 'layout', arrangement: 'tiled' },
      new AbortController().signal);
    expect(deliveries.filter(({ commandId }) => commandId === 'show-both').map(({ tab: name }) => name))
      .toEqual(['first', 'second']);
    expect(broker.acknowledge(ownerId, first.sessionId, 'show-both', false, 'Not here.').status).toBe('accepted');
    expect(broker.acknowledge(ownerId, second.sessionId, 'show-both', true).status).toBe('accepted');
    await expect(shown).resolves.toBeUndefined();

    const refused = broker.execute(ownerId, { commandId: 'refuse-both', operation: 'show', viewId: 'missing' },
      new AbortController().signal);
    broker.acknowledge(ownerId, first.sessionId, 'refuse-both', false, 'View no longer exists.');
    broker.acknowledge(ownerId, second.sessionId, 'refuse-both', false, 'View no longer exists.');
    await expect(refused).rejects.toBeInstanceOf(ToolRefusal);

    const survived = broker.execute(ownerId, { commandId: 'one-left', operation: 'layout', arrangement: 'layered' },
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
    expect(invalidGeometry.statusCode).toBe(400);
    expect(invalidOperation.statusCode).toBe(400);
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

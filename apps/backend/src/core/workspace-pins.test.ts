import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import {
  WorkspacePinLimitExceeded,
  type WorkspacePinStore,
} from '../database/workspace-pin-store.js';
import { createWorkspacePinsModule } from './workspace-pins.js';
import { coreModule } from './index.js';
import { WorkspaceCommandBroker } from './workspace-commands.js';
import type { WorkspaceCommand } from '@jarvis/contracts';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const otherId = '1b475880-a077-40cd-90b7-3278bfc45b5b';
const view = {
  version: 1 as const,
  title: 'Research',
  renderer: 'text' as const,
  source: { id: 'research' as const, status: 'complete' as const },
  data: { format: 'plain' as const, content: 'Findings' },
};
const first = { viewId: 'research-report', view, pinnedAt: '2026-10-08T10:00:00.000Z' };
const second = { viewId: 'research-summary', view, pinnedAt: '2026-10-08T11:00:00.000Z' };
const apps: ReturnType<typeof buildApp>[] = [];
const authorization = (token: string) => ({ authorization: ['Bearer', token].join(' ') });

function fixture(initialPins: typeof first[] = [first]) {
  let pins = [...initialPins];
  const list = vi.fn(async () => [...pins].sort((left, right) => left.pinnedAt.localeCompare(right.pinnedAt)));
  const pin = vi.fn(async (_owner: string, viewId: string, newView: typeof view) => {
    const existing = pins.find((item) => item.viewId === viewId);
    if (existing) {
      const updated = { ...existing, view: newView };
      pins = pins.map((item) => item.viewId === viewId ? updated : item);
      return updated;
    }
    if (pins.length >= 20) throw new WorkspacePinLimitExceeded();
    const created = { viewId, view: newView, pinnedAt: '2026-10-08T12:00:00.000Z' };
    pins = [...pins, created];
    return created;
  });
  const unpin = vi.fn(async (_owner: string, viewId: string) => {
    const previousLength = pins.length;
    pins = pins.filter((item) => item.viewId !== viewId);
    return pins.length !== previousLength;
  });
  const auth: TokenVerifier = async (token) => {
    if (token === 'agent.e30.sig') return { kind: 'jarvis-agent', objectId: ownerId, tenantId: config.auth.tenantId };
    if (token === 'other.e30.sig') return { objectId: otherId, tenantId: config.auth.tenantId, displayName: 'Other' };
    return { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' };
  };
  const store = { list, pin, unpin } as unknown as WorkspacePinStore;
  const broker = new WorkspaceCommandBroker();
  const record = vi.fn(async () => {});
  const app = buildApp(config, undefined, {
    auth, modules: [coreModule, createWorkspacePinsModule(store)],
    workspaceCommands: broker, toolCallStore: { record },
  });
  apps.push(app);
  return { app, list, pin, unpin, broker, record };
}

function callTool(app: ReturnType<typeof buildApp>, name: string, payload: Record<string, unknown> = {}, token = 'agent.e30.sig') {
  return app.inject({
    method: 'POST', url: `/tools/${name}`,
    headers: { ...authorization(token), 'x-jarvis-message-id': '42' }, payload,
  });
}

function connect(data: ReturnType<typeof fixture>, applied = true) {
  const commands: WorkspaceCommand[] = [];
  const connection = data.broker.connect(ownerId, (event, frame) => {
    if (event === 'workspace-command' && 'command' in frame) {
      commands.push(frame.command);
      queueMicrotask(() => data.broker.acknowledge(
        ownerId, connection.sessionId, frame.command.commandId, applied,
        applied ? undefined : 'Window cannot be opened.',
      ));
    }
    return true;
  });
  return { commands, connection };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('saved workspace pin tools', () => {
  it('lists only bounded oldest-first metadata for owner and agent, without requiring a workspace', async () => {
    const data = fixture([second, first]);
    for (const token of ['owner.e30.sig', 'agent.e30.sig']) {
      const response = await callTool(data.app, 'pins_list', {}, token);
      expect(response.json()).toMatchObject({
        outcome: 'ok', result: { untrusted: true, pins: [first, second].map((pin) => ({
          viewId: pin.viewId, title: pin.view.title, renderer: pin.view.renderer, pinnedAt: pin.pinnedAt,
        })) },
      });
    }
    expect(data.list).toHaveBeenCalledWith(ownerId, expect.any(AbortSignal));
    expect(data.record).toHaveBeenLastCalledWith(expect.objectContaining({
      arguments: { redacted: true }, result: { redacted: true },
    }));
    const full = fixture(Array.from({ length: 20 }, (_, index) => ({ ...first, viewId: `pin-${index}` })));
    expect((await callTool(full.app, 'pins_list')).json().result.pins).toHaveLength(20);
    full.list.mockResolvedValueOnce(Array.from({ length: 21 }, () => first));
    expect((await callTool(full.app, 'pins_list')).json().outcome).toBe('error');
    expect((await callTool(fixture([]).app, 'pins_list')).json().result.pins).toEqual([]);
  });

  it.each([false, true])('restores a pin with acknowledged create/update then focus (already open: %s)', async (open) => {
    const data = fixture();
    const { commands, connection } = connect(data);
    data.broker.updateSnapshot(ownerId, connection.sessionId, {
      windows: open ? [{ viewId: first.viewId, title: view.title }] : [], contextPanelOpen: false,
    });
    const response = await callTool(data.app, 'pin_restore', open ? { viewId: first.viewId } : { query: ' RESEARCH ' });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { viewId: first.viewId, restored: true, untrusted: true } });
    expect(commands).toEqual([
      expect.objectContaining({ operation: open ? 'update' : 'create', viewId: first.viewId, view }),
      expect.objectContaining({ operation: 'focus', viewId: first.viewId }),
    ]);
    expect(commands[0]!.commandId).not.toBe(commands[1]!.commandId);
    expect(data.pin).not.toHaveBeenCalled();
    expect(data.unpin).not.toHaveBeenCalled();
    expect(data.record).toHaveBeenLastCalledWith(expect.objectContaining({
      arguments: { redacted: true }, result: { redacted: true },
    }));
    connection.close();
  });

  it('refuses unknown and ambiguous names without delivering commands', async () => {
    const data = fixture([first, second]);
    const { commands, connection } = connect(data);
    for (const payload of [{ query: 'missing' }, { viewId: 'missing' }, { query: 'Research' }]) {
      expect((await callTool(data.app, 'pin_restore', payload)).json().outcome).toBe('refused');
    }
    expect((await callTool(data.app, 'pin_restore', { query: 'Research' })).json().result.refused).toContain('Ask Dan to choose');
    expect(commands).toEqual([]);
    connection.close();
  });

  it('refuses restoration when no owner workspace is connected', async () => {
    const data = fixture();
    const other = data.broker.connect(otherId, () => true);
    const response = await callTool(data.app, 'pin_restore', { viewId: first.viewId });
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: 'No active signed-in workspace is connected.' } });
    other.close();
  });

  it('rejects unauthorized access and invalid selectors', async () => {
    const data = fixture();
    for (const name of ['pins_list', 'pin_restore']) {
      expect((await callTool(data.app, name, name === 'pins_list' ? {} : { query: 'Research' }, 'other.e30.sig')).json().outcome).toBe('refused');
    }
    expect(data.list).not.toHaveBeenCalled();
    for (const payload of [{}, { query: ' ' }, { query: 'Research', viewId: first.viewId }, { viewId: '1-invalid' }, { query: 'x'.repeat(201) }]) {
      expect((await callTool(data.app, 'pin_restore', payload)).json().outcome).toBe('refused');
    }
    expect(data.list).not.toHaveBeenCalled();
  });

  it('revalidates stored views, including registered actions, before delivery', async () => {
    const data = fixture();
    const { commands, connection } = connect(data);
    for (const invalidView of [
      { ...view, renderer: 'script' },
      { ...view, actions: [{ id: 'run', label: 'Run', tool: 'not_registered', arguments: {} }] },
    ]) {
      data.list.mockResolvedValueOnce([{ ...first, view: invalidView as typeof view }]);
      expect((await callTool(data.app, 'pin_restore', { viewId: first.viewId })).json().outcome).toBe('error');
    }
    expect(commands).toEqual([]);
    connection.close();
  });

  it('does not focus or report success when the workspace refuses creation', async () => {
    const data = fixture();
    const { commands, connection } = connect(data, false);
    expect((await callTool(data.app, 'pin_restore', { viewId: first.viewId })).json().outcome).toBe('refused');
    expect(commands.map((command) => command.operation)).toEqual(['create']);
    connection.close();
  });
});

describe('workspace pin routes', () => {
  it('allows only the owner and returns pins oldest first', async () => {
    const data = fixture([second, first]);
    expect((await data.app.inject({ url: '/workspace/pins' })).statusCode).toBe(401);
    expect((await data.app.inject({ url: '/workspace/pins', headers: authorization('agent.e30.sig') })).statusCode).toBe(403);
    expect((await data.app.inject({ url: '/workspace/pins', headers: authorization('other.e30.sig') })).statusCode).toBe(403);

    const response = await data.app.inject({ url: '/workspace/pins', headers: authorization('owner.e30.sig') });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual({ pins: [first, second] });
    expect(data.list).toHaveBeenCalledWith(ownerId, expect.any(AbortSignal));
  });

  it('updates an existing pin without changing its original timestamp and rejects new pins at capacity', async () => {
    const data = fixture();
    const response = await data.app.inject({
      method: 'PUT',
      url: `/workspace/pins/${first.viewId}`,
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, title: 'Updated research' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().pin).toEqual({ ...first, view: { ...view, title: 'Updated research' } });
    expect(data.pin).toHaveBeenCalledWith(ownerId, first.viewId, { ...view, title: 'Updated research' }, expect.any(AbortSignal));

    const full = fixture(Array.from({ length: 20 }, (_item, index) => ({
      viewId: `pin-${index}`,
      view,
      pinnedAt: `2026-10-08T10:${String(index).padStart(2, '0')}:00.000Z`,
    })));
    const conflict = await full.app.inject({
      method: 'PUT',
      url: '/workspace/pins/new-pin',
      headers: authorization('owner.e30.sig'),
      payload: { view },
    });
    expect(conflict.statusCode).toBe(409);

    const fullRepin = fixture(Array.from({ length: 20 }, (_item, index) => ({
      viewId: `pin-${index}`,
      view,
      pinnedAt: `2026-10-08T10:${String(index).padStart(2, '0')}:00.000Z`,
    })));
    const existing = await fullRepin.app.inject({
      method: 'PUT',
      url: '/workspace/pins/pin-5',
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, title: 'Updated at capacity' } },
    });
    expect(existing.statusCode).toBe(200);
    expect(existing.json().pin.pinnedAt).toBe('2026-10-08T10:05:00.000Z');
  });

  it('rejects invalid views, view IDs and oversized requests', async () => {
    const data = fixture();
    const invalidView = await data.app.inject({
      method: 'PUT',
      url: '/workspace/pins/research-report',
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, renderer: 'script' } },
    });
    expect(invalidView.statusCode).toBe(400);

    const invalidId = await data.app.inject({
      method: 'PUT',
      url: '/workspace/pins/1-invalid',
      headers: authorization('owner.e30.sig'),
      payload: { view },
    });
    expect(invalidId.statusCode).toBe(400);

    const oversized = await data.app.inject({
      method: 'PUT',
      url: '/workspace/pins/research-report',
      headers: authorization('owner.e30.sig'),
      payload: { view: { ...view, data: { format: 'plain', content: 'x'.repeat(300_000) } } },
    });
    expect(oversized.statusCode).toBe(413);
  });

  it('deletes a pin with 204 and reports missing pins as 404', async () => {
    const data = fixture();
    expect((await data.app.inject({
      method: 'DELETE',
      url: `/workspace/pins/${first.viewId}`,
      headers: authorization('owner.e30.sig'),
    })).statusCode).toBe(204);
    expect((await data.app.inject({
      method: 'DELETE',
      url: `/workspace/pins/${first.viewId}`,
      headers: authorization('owner.e30.sig'),
    })).statusCode).toBe(404);
    expect(data.unpin).toHaveBeenCalledWith(ownerId, first.viewId, expect.any(AbortSignal));
  });
});

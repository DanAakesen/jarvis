import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { WorkspaceItemNotFound, type WorkspaceItemsStore } from '../database/workspace-items-store.js';
import type { ConfirmationStore } from '../database/confirmation-store.js';
import { createOwnerInteractionService, type OwnerInteractionService } from './owner-interactions.js';
import type { AwayModeStore } from './away-mode.js';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import type { WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import type { WorkspaceSnapshot } from '@jarvis/contracts';
import type { ToolCallStore } from './tool-calls.js';
import { coreModule } from './index.js';
import { createWorkspacesModule } from './workspaces.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const otherId = '1b475880-a077-40cd-90b7-3278bfc45b5b';
const sourceId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const item = {
  id: `research:${sourceId}`,
  kind: 'research' as const,
  title: 'Ignite report',
  createdAt: '2026-10-06T10:00:00.000Z',
  promptSummary: 'Research Ignite battery storage',
  pinned: false,
};
const apps: ReturnType<typeof buildApp>[] = [];
const authorization = (token: string) => ({ authorization: ['Bearer', token].join(' ') });

function fixture(options: { ownerInteractions?: OwnerInteractionService; awayModeStore?: AwayModeStore } = {}) {
  const search = vi.fn(async () => [item]);
  const get = vi.fn(async (_owner: string, id: string) => ({
    item: { ...item, id }, sourceId: id.slice('research:'.length),
  }));
  const update = vi.fn(async () => ({ ...item, pinned: true }));
  const remove = vi.fn(async () => {});
  const store = { search, get, update, delete: remove } as unknown as WorkspaceItemsStore;
  const read = vi.fn(async () => ({}));
  const htmlArtifacts = { read } as unknown as WorkspaceHtmlArtifactStore;
  const readUrl = vi.fn(async () => 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sig=test');
  const imageArtifacts = { readUrl } as unknown as WorkspaceArtifactStore;
  const execute = vi.fn(async () => {});
  const snapshot = vi.fn((): WorkspaceSnapshot | undefined => undefined);
  const workspaceCommands = {
    snapshot,
    execute,
    dispose: vi.fn(),
  };
  const record = vi.fn(async () => {});
  const auth: TokenVerifier = async (token) => {
    if (token === 'agent.e30.sig') return { kind: 'jarvis-agent', objectId: ownerId, tenantId: config.auth.tenantId };
    if (token === 'other.e30.sig') return { objectId: otherId, tenantId: config.auth.tenantId, displayName: 'Other' };
    return { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' };
  };
  const app = buildApp(config, undefined, {
    auth,
    modules: [coreModule, createWorkspacesModule(store, htmlArtifacts, imageArtifacts)],
    toolCallStore: { record } as unknown as ToolCallStore,
    workspaceCommands: workspaceCommands as never,
    ...options,
  });
  apps.push(app);
  return { app, search, get, update, remove, read, readUrl, execute, record, snapshot };
}

function presence(mode: 'present' | 'away' | 'on_the_move' = 'present'): AwayModeStore {
  return {
    read: vi.fn(async () => ({ mode, source: 'manual' as const, changedAt: null })),
    set: vi.fn(),
    markPresent: vi.fn(),
  };
}

function approvals() {
  const store = {
    createConfirmation: vi.fn(async () => {}),
    resolveConfirmation: vi.fn(async (_id, _owner, _conversation, decision) =>
      decision === 'approve' ? 'approved' : 'rejected'),
    consumeApproval: vi.fn(async () => true),
    cancelConfirmation: vi.fn(async () => {}),
  } as unknown as ConfirmationStore;
  return createOwnerInteractionService({
    ownerObjectId: ownerId, store, onWebNotification: async () => {},
  });
}

function manage(app: ReturnType<typeof buildApp>, payload: Record<string, unknown>, token = 'agent.e30.sig') {
  return app.inject({
    method: 'POST', url: '/tools/workspaces_manage',
    headers: { ...authorization(token), 'x-jarvis-message-id': '42' }, payload,
  });
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Workspaces API and Jarvis tools', () => {
  it('restricts the API to the owner and returns bounded search results', async () => {
    const fixtureData = fixture();
    expect((await fixtureData.app.inject({ url: '/workspaces' })).statusCode).toBe(401);
    expect((await fixtureData.app.inject({ url: '/workspaces', headers: authorization('other.e30.sig') })).statusCode).toBe(403);
    expect((await fixtureData.app.inject({ url: '/folio', headers: authorization('other.e30.sig') })).statusCode).toBe(403);
    const response = await fixtureData.app.inject({
      url: '/workspaces?q=Ignite&kind=research&before=2026-10-07T00%3A00%3A00.000Z',
      headers: authorization('owner.e30.sig'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json().items).toEqual([item]);
    expect(fixtureData.search).toHaveBeenCalledWith(ownerId, {
      q: 'Ignite', kind: 'research', before: '2026-10-07T00:00:00.000Z',
    }, expect.any(AbortSignal));
  });

  it('opens an item through the workspace broker, then supports rename/pin and confirmed removal', async () => {
    const fixtureData = fixture();
    const opened = await fixtureData.app.inject({
      method: 'POST',
      url: `/workspaces/${encodeURIComponent(item.id)}/open`,
      headers: authorization('owner.e30.sig'),
      payload: {},
    });

    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toEqual(item);
    expect(fixtureData.read).toHaveBeenCalledWith(sourceId, ownerId, expect.any(AbortSignal));
    expect(fixtureData.execute).toHaveBeenCalledTimes(2);
    expect(fixtureData.execute.mock.calls[0]?.[1]).toMatchObject({
      operation: 'create',
      view: { title: item.title, renderer: 'html-app', data: { artifactId: sourceId } },
    });

    const patched = await fixtureData.app.inject({
      method: 'PATCH',
      url: `/workspaces/${encodeURIComponent(item.id)}`,
      headers: authorization('owner.e30.sig'),
      payload: { title: 'Pinned Ignite report', pinned: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(fixtureData.update).toHaveBeenCalledWith(ownerId, item.id, {
      title: 'Pinned Ignite report', pinned: true,
    }, expect.any(AbortSignal));

    expect((await fixtureData.app.inject({
      method: 'DELETE',
      url: `/workspaces/${encodeURIComponent(item.id)}`,
      headers: authorization('owner.e30.sig'),
      payload: { confirm: false },
    })).statusCode).toBe(400);
    expect(fixtureData.remove).not.toHaveBeenCalled();
    const deleted = await fixtureData.app.inject({
      method: 'DELETE',
      url: `/workspaces/${encodeURIComponent(item.id)}`,
      headers: authorization('owner.e30.sig'),
      payload: { confirm: true },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(fixtureData.remove).toHaveBeenCalledWith(ownerId, item.id, expect.any(AbortSignal));
  });

  it('recovers a saved research result under its stable window id and records only acknowledged delivery', async () => {
    const fixtureData = fixture();
    const job = await fixtureData.app.backgroundJobs.start('research', 'Research: Recovered report', 2);
    const resultId = `research:${job.jobId}`;
    const resultViewId = `research-${job.jobId.replaceAll('-', '')}`;
    await job.done(resultViewId, 'Report saved', { resultId, resultDelivery: 'pending' });

    const denied = await fixtureData.app.inject({
      method: 'POST',
      url: `/jobs/${job.jobId}/open-result`,
      headers: authorization('other.e30.sig'),
    });
    expect(denied.statusCode).toBe(403);
    expect(fixtureData.execute).not.toHaveBeenCalled();

    const opened = await fixtureData.app.inject({
      method: 'POST',
      url: `/jobs/${job.jobId}/open-result`,
      headers: authorization('owner.e30.sig'),
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toEqual({ opened: true });
    expect(fixtureData.get).toHaveBeenCalledWith(ownerId, resultId, expect.any(AbortSignal));
    expect(fixtureData.execute).toHaveBeenNthCalledWith(1, ownerId, expect.objectContaining({
      operation: 'create', viewId: resultViewId,
    }), expect.any(AbortSignal));
    expect((await fixtureData.app.backgroundJobs.details(job.jobId))?.details.job.resultDelivery).toBe('delivered');

    fixtureData.snapshot.mockReturnValue({
      windows: [{ viewId: resultViewId, title: 'Recovered report', state: 'open' }],
      contextPanelOpen: false,
    });
    const openedAgain = await fixtureData.app.inject({
      method: 'POST',
      url: `/jobs/${job.jobId}/open-result`,
      headers: authorization('owner.e30.sig'),
    });
    expect(openedAgain.statusCode).toBe(200);
    expect(fixtureData.execute).toHaveBeenNthCalledWith(3, ownerId, expect.objectContaining({
      operation: 'update', viewId: resultViewId,
    }), expect.any(AbortSignal));
  });

  it('does not mark acknowledged presentation failed when delivery-state persistence fails', async () => {
    const fixtureData = fixture();
    const job = await fixtureData.app.backgroundJobs.start('research', 'Research: Recovered report', 2);
    await job.done(`research-${job.jobId.replaceAll('-', '')}`, 'Report saved', {
      resultId: `research:${job.jobId}`,
      resultDelivery: 'pending',
    });
    vi.spyOn(fixtureData.app.backgroundJobs, 'setResultDelivery')
      .mockRejectedValueOnce(new Error('database unavailable'));

    const response = await fixtureData.app.inject({
      method: 'POST',
      url: `/jobs/${job.jobId}/open-result`,
      headers: authorization('owner.e30.sig'),
    });

    expect(response.statusCode).toBe(503);
    expect(fixtureData.execute).toHaveBeenCalledTimes(2);
    expect((await fixtureData.app.backgroundJobs.details(job.jobId))?.details.job.resultDelivery).toBe('pending');
  });

  it('exposes canonical private Workspaces tools and retains their legacy aliases', async () => {
    const fixtureData = fixture();
    const listed = await fixtureData.app.inject({ url: '/tools', headers: authorization('agent.e30.sig') });
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('workspaces_search');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('workspaces_open');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('workspaces_manage');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('folio_search');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('folio_open');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('folio_manage');
    const result = await fixtureData.app.inject({
      method: 'POST',
      url: '/tools/workspaces_open',
      headers: { ...authorization('agent.e30.sig'), 'x-jarvis-message-id': '42' },
      payload: { query: 'pull up the Ignite research again' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      tool: 'workspaces_open',
      outcome: 'ok',
      result: { id: item.id, title: item.title, opened: true },
    });
    expect(fixtureData.search).toHaveBeenCalledWith(ownerId, { q: 'pull up the Ignite research again' }, expect.any(AbortSignal));
    expect(fixtureData.record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'workspaces_open',
      arguments: { redacted: true },
      result: { redacted: true },
    }));
  });

  it('continues to serve legacy Folio API routes and tool aliases', async () => {
    const fixtureData = fixture();
    const headers = authorization('owner.e30.sig');
    expect((await fixtureData.app.inject({ url: '/folio', headers })).json()).toEqual({ items: [item] });
    expect((await fixtureData.app.inject({
      method: 'POST', url: `/folio/${encodeURIComponent(item.id)}/open`, headers, payload: {},
    })).statusCode).toBe(200);
    expect((await fixtureData.app.inject({
      method: 'PATCH', url: `/folio/${encodeURIComponent(item.id)}`, headers, payload: { pinned: true },
    })).statusCode).toBe(200);
    expect((await fixtureData.app.inject({
      method: 'DELETE', url: `/folio/${encodeURIComponent(item.id)}`, headers, payload: { confirm: true },
    })).statusCode).toBe(200);
    const alias = await fixtureData.app.inject({
      method: 'POST', url: '/tools/folio_open',
      headers: { ...authorization('agent.e30.sig'), 'x-jarvis-message-id': '42' },
      payload: { id: item.id },
    });
    expect(alias.json()).toMatchObject({ tool: 'folio_open', outcome: 'ok' });
  });

  it.each([
    { action: 'rename', title: 'New report', patch: { title: 'New report' } },
    { action: 'pin', patch: { pinned: true } },
    { action: 'unpin', patch: { pinned: false } },
  ])('supports reversible $action without confirmation', async ({ action, title, patch }) => {
    const data = fixture();
    data.update.mockResolvedValueOnce({ ...item, ...patch });
    const response = await manage(data.app, { query: 'Ignite', action, ...(title ? { title } : {}) });
    expect(response.json()).toMatchObject({
      outcome: 'ok', result: { id: item.id, title: item.title, pinned: item.pinned, ...patch, action, untrusted: true },
    });
    expect(data.update).toHaveBeenCalledWith(ownerId, item.id, patch, expect.any(AbortSignal));
    expect(data.record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'workspaces_manage', arguments: { redacted: true }, result: { redacted: true },
    }));
    expect(data.remove).not.toHaveBeenCalled();
  });

  it('accepts the owner and rejects other users before accessing Workspaces', async () => {
    const data = fixture();
    expect((await manage(data.app, { id: item.id, action: 'pin' }, 'other.e30.sig')).json().outcome).toBe('refused');
    expect(data.update).not.toHaveBeenCalled();
    expect((await manage(data.app, { id: item.id, action: 'pin' }, 'owner.e30.sig')).json().outcome).toBe('ok');
  });

  it('asks Dan to choose bounded ambiguous matches and refuses empty searches', async () => {
    const data = fixture();
    data.search.mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ ...item, title: 'x'.repeat(200) })));
    const ambiguous = await manage(data.app, { query: 'report', action: 'pin' });
    expect(ambiguous.json().outcome).toBe('refused');
    expect(ambiguous.json().result.refused).toContain('Ask Dan to choose');
    expect(ambiguous.json().result.refused.length).toBeLessThanOrEqual(500);
    data.search.mockResolvedValue([]);
    expect((await manage(data.app, { query: 'missing', action: 'delete' })).json().outcome).toBe('refused');
    expect((await manage(data.app, { query: 'missing', action: 'rename', title: 'New' })).json().result.refused)
      .toContain('No Workspaces item matched');
    expect(data.update).not.toHaveBeenCalled();
    expect(data.remove).not.toHaveBeenCalled();
  });

  it.each(['rename', 'pin', 'unpin', 'delete'])('refuses an unknown id for $action', async (action) => {
    const data = fixture({ awayModeStore: presence(), ownerInteractions: approvals() });
    data.update.mockRejectedValueOnce(new WorkspaceItemNotFound());
    data.get.mockRejectedValueOnce(new WorkspaceItemNotFound());
    const response = await manage(data.app, { id: item.id, action, ...(action === 'rename' ? { title: 'New' } : {}) });
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: 'That Workspaces item was not found.' } });
    expect(data.remove).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'pin' },
    { id: item.id, query: 'Ignite', action: 'pin' },
    { id: item.id, action: 'rename' },
    { id: item.id, action: 'pin', title: 'Unexpected' },
  ])('refuses invalid action fields %j', async (payload) => {
    const data = fixture();
    expect((await manage(data.app, payload)).json().outcome).toBe('refused');
    expect(data.update).not.toHaveBeenCalled();
  });

  it.each([
    { id: item.id, action: 'rename', title: ' '.repeat(3) },
    { id: item.id, action: 'rename', title: 'x'.repeat(201) },
    { id: item.id, action: 'destroy' },
    { id: item.id, action: 'delete', confirm: true },
    { query: ' ', action: 'pin' },
  ])('rejects out-of-schema input %j', async (payload) => {
    const data = fixture();
    expect((await manage(data.app, payload)).json().outcome).toBe('refused');
    expect(data.update).not.toHaveBeenCalled();
    expect(data.remove).not.toHaveBeenCalled();
  });

  it.each(['present', 'away', 'on_the_move'] as const)('deletes the requested item directly while %s', async mode => {
    const service = approvals();
    const data = fixture({ ownerInteractions: service, awayModeStore: presence(mode) });
    const response = await manage(data.app, { id: item.id, action: 'delete' });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { id: item.id, deleted: true } });
    expect(service.pendingBrowserConfirmations()).toEqual([]);
    expect(data.remove).toHaveBeenCalledOnce();
    expect(data.remove).toHaveBeenCalledWith(ownerId, item.id, expect.any(AbortSignal));
    expect(data.read).not.toHaveBeenCalled();
  });

  it('refuses a changed item before deleting it', async () => {
    const data = fixture({ ownerInteractions: approvals() });
    data.get.mockResolvedValueOnce({ item, sourceId });
    data.get.mockResolvedValueOnce({ item: { ...item, title: 'Different report' }, sourceId });
    expect((await manage(data.app, { id: item.id, action: 'delete' })).json().outcome).toBe('refused');
    expect(data.remove).not.toHaveBeenCalled();
  });

  it('does not depend on presence and reports unavailable execution', async () => {
    const data = fixture({ ownerInteractions: approvals() });
    expect((await manage(data.app, { id: item.id, action: 'delete' })).json().outcome).toBe('ok');
    const unavailable = fixture();
    expect((await manage(unavailable.app, { id: item.id, action: 'delete' })).json().outcome).toBe('refused');
    expect(unavailable.remove).not.toHaveBeenCalled();
  });
});

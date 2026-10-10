import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { FolioItemNotFound, type FolioStore } from '../database/folio-store.js';
import type { TeamsNotificationStore } from '../database/teams-notification-store.js';
import { createTeamsNotificationService, type TeamsNotificationService } from '../teams/service.js';
import type { AwayModeStore } from './away-mode.js';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import type { WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import type { ToolCallStore } from './tool-calls.js';
import { coreModule } from './index.js';
import { createFolioModule } from './folio.js';

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

function fixture(options: { teamsNotifications?: TeamsNotificationService; awayModeStore?: AwayModeStore } = {}) {
  const search = vi.fn(async () => [item]);
  const get = vi.fn(async () => ({ item, sourceId }));
  const update = vi.fn(async () => ({ ...item, pinned: true }));
  const remove = vi.fn(async () => {});
  const store = { search, get, update, delete: remove } as unknown as FolioStore;
  const read = vi.fn(async () => ({}));
  const htmlArtifacts = { read } as unknown as WorkspaceHtmlArtifactStore;
  const readUrl = vi.fn(async () => 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sig=test');
  const imageArtifacts = { readUrl } as unknown as WorkspaceArtifactStore;
  const execute = vi.fn(async () => {});
  const workspaceCommands = {
    snapshot: vi.fn(() => undefined),
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
    modules: [coreModule, createFolioModule(store, htmlArtifacts, imageArtifacts)],
    toolCallStore: { record } as unknown as ToolCallStore,
    workspaceCommands: workspaceCommands as never,
    ...options,
  });
  apps.push(app);
  return { app, search, get, update, remove, read, readUrl, execute, record };
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
  } as unknown as TeamsNotificationStore;
  return createTeamsNotificationService({
    ownerObjectId: ownerId, tenantId: config.auth.tenantId, store, isAway: async () => false,
  });
}

function manage(app: ReturnType<typeof buildApp>, payload: Record<string, unknown>, token = 'agent.e30.sig') {
  return app.inject({
    method: 'POST', url: '/tools/folio_manage',
    headers: { ...authorization(token), 'x-jarvis-message-id': '42' }, payload,
  });
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Folio API and Jarvis tools', () => {
  it('restricts the API to the owner and returns bounded search results', async () => {
    const fixtureData = fixture();
    expect((await fixtureData.app.inject({ url: '/folio' })).statusCode).toBe(401);
    expect((await fixtureData.app.inject({ url: '/folio', headers: authorization('other.e30.sig') })).statusCode).toBe(403);
    const response = await fixtureData.app.inject({
      url: '/folio?q=Ignite&kind=research&before=2026-10-07T00%3A00%3A00.000Z',
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
      url: `/folio/${encodeURIComponent(item.id)}/open`,
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
      url: `/folio/${encodeURIComponent(item.id)}`,
      headers: authorization('owner.e30.sig'),
      payload: { title: 'Pinned Ignite report', pinned: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(fixtureData.update).toHaveBeenCalledWith(ownerId, item.id, {
      title: 'Pinned Ignite report', pinned: true,
    }, expect.any(AbortSignal));

    expect((await fixtureData.app.inject({
      method: 'DELETE',
      url: `/folio/${encodeURIComponent(item.id)}`,
      headers: authorization('owner.e30.sig'),
      payload: { confirm: false },
    })).statusCode).toBe(400);
    expect(fixtureData.remove).not.toHaveBeenCalled();
    const deleted = await fixtureData.app.inject({
      method: 'DELETE',
      url: `/folio/${encodeURIComponent(item.id)}`,
      headers: authorization('owner.e30.sig'),
      payload: { confirm: true },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(fixtureData.remove).toHaveBeenCalledWith(ownerId, item.id, expect.any(AbortSignal));
  });

  it('registers private Folio tools and resolves a natural-language reopen request', async () => {
    const fixtureData = fixture();
    const listed = await fixtureData.app.inject({ url: '/tools', headers: authorization('agent.e30.sig') });
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('folio_search');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('folio_open');
    expect(listed.json().map((tool: { name: string }) => tool.name)).toContain('folio_manage');
    const result = await fixtureData.app.inject({
      method: 'POST',
      url: '/tools/folio_open',
      headers: { ...authorization('agent.e30.sig'), 'x-jarvis-message-id': '42' },
      payload: { query: 'pull up the Ignite research again' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      tool: 'folio_open',
      outcome: 'ok',
      result: { id: item.id, title: item.title, opened: true },
    });
    expect(fixtureData.search).toHaveBeenCalledWith(ownerId, { q: 'pull up the Ignite research again' }, expect.any(AbortSignal));
    expect(fixtureData.record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'folio_open',
      arguments: { redacted: true },
      result: { redacted: true },
    }));
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
      tool: 'folio_manage', arguments: { redacted: true }, result: { redacted: true },
    }));
    expect(data.remove).not.toHaveBeenCalled();
  });

  it('accepts the owner and rejects other users before accessing Folio', async () => {
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
    data.search.mockResolvedValueOnce([]);
    expect((await manage(data.app, { query: 'missing', action: 'delete' })).json().outcome).toBe('refused');
    expect((await manage(data.app, { query: 'missing', action: 'rename', title: 'New' })).json().result.refused)
      .toContain('No Folio item matched');
    expect(data.update).not.toHaveBeenCalled();
    expect(data.remove).not.toHaveBeenCalled();
  });

  it.each(['rename', 'pin', 'unpin', 'delete'])('refuses an unknown id for $action', async (action) => {
    const data = fixture({ awayModeStore: presence(), teamsNotifications: approvals() });
    data.update.mockRejectedValueOnce(new FolioItemNotFound());
    data.get.mockRejectedValueOnce(new FolioItemNotFound());
    const response = await manage(data.app, { id: item.id, action, ...(action === 'rename' ? { title: 'New' } : {}) });
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: 'That Folio item was not found.' } });
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

  it.each(['approve', 'reject'] as const)('waits for Now %s naming the item before removal', async (decision) => {
    const service = approvals();
    const data = fixture({ teamsNotifications: service, awayModeStore: presence() });
    data.remove.mockImplementationOnce(async () => { data.search.mockResolvedValue([]); });
    const operation = manage(data.app, { query: 'Ignite', action: 'delete' });
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const confirmation = service.pendingBrowserConfirmations()[0]!;
    expect(confirmation).toMatchObject({ actionKind: 'delete' });
    expect(confirmation.summary).toContain(item.title);
    expect(confirmation.summary).toContain(item.id);
    expect(data.remove).not.toHaveBeenCalled();
    expect((await manage(data.app, { id: item.id, action: 'delete' })).json().result.refused)
      .toContain('already awaiting');
    await service.resolveBrowserConfirmation(confirmation.id, decision);
    const response = await operation;
    expect(response.json().outcome).toBe(decision === 'approve' ? 'ok' : 'refused');
    if (decision === 'approve') {
      expect(response.json().result).toMatchObject({ id: item.id, deleted: true, untrusted: true });
      expect(data.remove).toHaveBeenCalledWith(ownerId, item.id, expect.any(AbortSignal));
      const listed = await data.app.inject({ url: '/folio', headers: authorization('owner.e30.sig') });
      expect(listed.json().items).toEqual([]);
      expect(data.read).not.toHaveBeenCalled();
    } else {
      expect(data.remove).not.toHaveBeenCalled();
    }
  });

  it.each(['away', 'on_the_move'] as const)('refuses deletion while %s without staging approval', async (mode) => {
    const service = approvals();
    const data = fixture({ teamsNotifications: service, awayModeStore: presence(mode) });
    const response = await manage(data.app, { id: item.id, action: 'delete' });
    expect(response.json().outcome).toBe('refused');
    expect(service.pendingBrowserConfirmations()).toEqual([]);
    expect(data.get).not.toHaveBeenCalled();
    expect(data.remove).not.toHaveBeenCalled();
  });

  it.each(['presence', 'title'] as const)('rechecks $0 after approval and does not delete a changed item', async (change) => {
    const service = approvals();
    const awayModeStore = presence();
    const data = fixture({ teamsNotifications: service, awayModeStore });
    const operation = manage(data.app, { id: item.id, action: 'delete' });
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    if (change === 'presence') vi.mocked(awayModeStore.read).mockResolvedValue({ mode: 'away', source: 'manual', changedAt: null });
    else data.get.mockResolvedValue({ item: { ...item, title: 'Different report' }, sourceId });
    await service.resolveBrowserConfirmation(service.pendingBrowserConfirmations()[0]!.id, 'approve');
    expect((await operation).json().outcome).toBe('refused');
    expect(data.remove).not.toHaveBeenCalled();
  });

  it('fails closed when presence or the approval service is unavailable', async () => {
    const service = approvals();
    const withoutPresence = fixture({ teamsNotifications: service });
    expect((await manage(withoutPresence.app, { id: item.id, action: 'delete' })).json().outcome).toBe('refused');
    const withoutApproval = fixture({ awayModeStore: presence() });
    expect((await manage(withoutApproval.app, { id: item.id, action: 'delete' })).json().result.refused)
      .toContain('approval service is unavailable');
    expect(withoutApproval.remove).not.toHaveBeenCalled();
    const unavailable = presence();
    vi.mocked(unavailable.read).mockRejectedValue(new Error('private provider detail'));
    const data = fixture({ teamsNotifications: service, awayModeStore: unavailable });
    const response = await manage(data.app, { id: item.id, action: 'delete' });
    expect(response.json().outcome).toBe('refused');
    expect(response.body).not.toContain('private provider detail');
  });
});

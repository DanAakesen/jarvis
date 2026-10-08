import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { FolioStore } from '../database/folio-store.js';
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

function fixture() {
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
  });
  apps.push(app);
  return { app, search, get, update, remove, read, readUrl, execute, record };
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
});

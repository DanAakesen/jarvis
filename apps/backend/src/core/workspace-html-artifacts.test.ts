import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import { WorkspaceArtifactNotFound } from '../database/workspace-artifact-store.js';
import { coreModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const artifactId = '12345678-1234-4234-8234-123456789abc';
const artifact = {
  id: artifactId,
  kind: 'html' as const,
  title: 'Research app',
  html: '<h1>Research</h1>',
  sources: [{ title: 'Source', url: 'https://example.com/source' }],
  createdAt: '2026-10-06T10:00:00.000Z',
  pinned: true,
};
const userHeaders = { authorization: ['Bearer', 'header.user.signature'].join(' ') };
const agentHeaders = { authorization: ['Bearer', 'header.agent.signature'].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture() {
  const store = {
    dispose: vi.fn(),
    listPinnedHtml: vi.fn(async () => [{ ...artifact, html: undefined }]),
    getHtml: vi.fn(async () => artifact),
    pinHtml: vi.fn(async () => artifact),
    unpinHtml: vi.fn(async () => {}),
  } as unknown as WorkspaceArtifactStore;
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async (token) => token === 'header.user.signature'
      ? { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' }
      : { kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId },
    workspaceArtifacts: store,
  });
  apps.push(app);
  return { app, store };
}

describe('workspace HTML artifact routes', () => {
  it('lists pinned metadata and returns the owner-authorized artifact source', async () => {
    const { app, store } = fixture();
    const list = await app.inject({ method: 'GET', url: '/factory/workspace-artifacts/html', headers: userHeaders });
    expect(list.statusCode).toBe(200);
    expect(list.headers['cache-control']).toContain('no-store');
    expect(list.json()).toMatchObject({ artifacts: [{ id: artifactId, title: 'Research app', pinned: true }] });
    expect(list.json().artifacts[0]).not.toHaveProperty('html');
    expect(store.listPinnedHtml).toHaveBeenCalledWith(ownerId, expect.any(AbortSignal));

    const read = await app.inject({
      method: 'GET', url: `/factory/workspace-artifacts/html/${artifactId}`, headers: userHeaders,
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    expect(read.json()).toEqual(artifact);
    expect(store.getHtml).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));
  });

  it('requires Dan’s verified identity and conceals artifacts outside the owner scope', async () => {
    const { app, store } = fixture();
    const denied = await app.inject({
      method: 'GET', url: `/factory/workspace-artifacts/html/${artifactId}`, headers: agentHeaders,
    });
    expect(denied.statusCode).toBe(403);
    store.getHtml = vi.fn(async () => { throw new WorkspaceArtifactNotFound(); }) as never;
    const missing = await app.inject({
      method: 'GET', url: `/factory/workspace-artifacts/html/${artifactId}`, headers: userHeaders,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'Workspace artifact was not found' });
  });

  it('pins and unpins through owner-authenticated routes', async () => {
    const { app, store } = fixture();
    const pin = await app.inject({
      method: 'POST', url: `/factory/workspace-artifacts/html/${artifactId}/pin`, headers: userHeaders,
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json()).toMatchObject({ artifact: { id: artifactId, pinned: true } });
    expect(store.pinHtml).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));

    const unpin = await app.inject({
      method: 'DELETE', url: `/factory/workspace-artifacts/html/${artifactId}/pin`, headers: userHeaders,
    });
    expect(unpin.statusCode).toBe(204);
    expect(store.unpinHtml).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));
  });
});

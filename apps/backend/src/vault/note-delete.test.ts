import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type { VaultIndexStore } from '../database/memory-store.js';
import { createVaultModule } from './index.js';
import { createGitHubVaultClient, VaultWriteConflictError } from './github-client.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const sha = 'a'.repeat(40);
const path = 'Personal/example.md';
const headers = { authorization: `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(auth?: BuildAppOptions['auth']) {
  const client = {
    read: vi.fn(async () => ({ path, sha, content: 'note' }) as { path: string; sha: string; content: string } | null),
    delete: vi.fn(async () => 'b'.repeat(40)),
    tree: vi.fn(async () => []),
  };
  const index = {
    deleteFiles: vi.fn(async () => {}),
    files: vi.fn(async () => []),
  };
  const module = createVaultModule({
    client: client as unknown as ReturnType<typeof createGitHubVaultClient>,
    indexStore: index as unknown as VaultIndexStore,
    memoryStore: { getSourceMessage: vi.fn() },
  });
  const app = buildApp(config, undefined, {
    modules: [module],
    auth: auth ?? (async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' })),
  });
  apps.push(app);
  const call = (payload: unknown, authenticated = true) => app.inject({
    method: 'DELETE', url: '/notes/note', headers: authenticated ? headers : {}, payload,
  });
  return { client, index, module, call };
}

describe('owner note deletion', () => {
  it('requires authentication and the owner principal', async () => {
    const owner = fixture();
    expect((await owner.call({ path, sha }, false)).statusCode).toBe(401);
    const agent = fixture(async () => ({ kind: 'jarvis-agent', objectId: 'agent', tenantId: 'tenant' }));
    expect((await agent.call({ path, sha })).statusCode).toBe(403);
    const other = fixture(async () => ({ objectId: 'other', tenantId: config.auth.tenantId, displayName: 'Other' }));
    expect((await other.call({ path, sha })).statusCode).toBe(403);
    expect(owner.client.read).not.toHaveBeenCalled();
    expect(agent.client.read).not.toHaveBeenCalled();
    expect(other.client.read).not.toHaveBeenCalled();
  });

  it('deletes the exact matching version and clears the index', async () => {
    const { call, client, index } = fixture();
    const response = await call({ path, sha: sha.toUpperCase() });
    expect(response.statusCode).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(client.delete).toHaveBeenCalledOnce();
    expect(client.delete).toHaveBeenCalledWith(path, sha, expect.stringContaining('jarvis: forget vault note'), expect.any(AbortSignal));
    expect(index.deleteFiles).toHaveBeenCalledWith([path], expect.any(AbortSignal));
  });

  it.each([
    '.github/test.md', 'Personal/.hidden/test.md', 'Personal/.secret.md',
    '../test.md', '/test.md', 'Personal//test.md', 'Personal/test.txt',
    'Personal/test%2emd', 'Personal/e\u0301.md', 'Personal/password.md',
  ])('rejects unsafe or non-exact path %s', async (invalidPath) => {
    const { call, client } = fixture();
    expect((await call({ path: invalidPath, sha })).statusCode).toBe(400);
    expect(client.read).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid SHA and missing fields', async () => {
    const { call, client } = fixture();
    for (const payload of [{ path }, { sha }, { path, sha: 'a'.repeat(39) }, { path, sha: 'z'.repeat(40) }]) {
      expect((await call(payload)).statusCode).toBe(400);
    }
    expect(client.read).not.toHaveBeenCalled();
  });

  it('does not delete missing, inaccessible, or stale notes', async () => {
    const { call, client } = fixture();
    client.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ path: 'Personal/Example.md', sha, content: 'other note' })
      .mockRejectedValueOnce(new Error('private upstream details'))
      .mockResolvedValueOnce({ path, sha: 'c'.repeat(40), content: 'changed' });
    expect((await call({ path, sha })).statusCode).toBe(404);
    expect((await call({ path, sha })).statusCode).toBe(404);
    const inaccessible = await call({ path, sha });
    expect(inaccessible.statusCode).toBe(503);
    expect(inaccessible.body).not.toContain('private upstream details');
    expect((await call({ path, sha })).statusCode).toBe(409);
    expect(client.delete).not.toHaveBeenCalled();
  });

  it('reports a concurrent upstream conflict without retrying', async () => {
    const { call, client } = fixture();
    client.delete.mockRejectedValueOnce(new VaultWriteConflictError());
    expect((await call({ path, sha })).statusCode).toBe(409);
    expect(client.delete).toHaveBeenCalledTimes(1);
  });

  it('reports unknown outcomes and schedules index recovery after a failed delete or index update', async () => {
    const first = fixture();
    first.client.delete.mockRejectedValueOnce(new Error('private upstream details'));
    const result = await first.call({ path, sha });
    expect(result.statusCode).toBe(503);
    expect(result.body).toContain('Refresh before retrying');
    expect(result.body).not.toContain('private upstream details');
    expect(first.client.delete).toHaveBeenCalledTimes(1);
    expect(first.client.tree).toHaveBeenCalled();

    const second = fixture();
    second.index.deleteFiles.mockRejectedValueOnce(new Error('private index details'));
    const partial = await second.call({ path, sha });
    expect(partial.statusCode).toBe(503);
    expect(partial.body).toContain('Refresh before retrying');
    expect(partial.body).not.toContain('private index details');
    expect(second.client.delete).toHaveBeenCalledTimes(1);
    expect(second.client.tree).toHaveBeenCalled();
  });

  it('blocks overlapping deletes for the same path until the first finishes', async () => {
    const { call, client } = fixture();
    let release!: () => void;
    let notify!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { notify = resolve; });
    client.delete.mockImplementationOnce(async () => { notify(); await gate; return 'b'.repeat(40); });
    const pending = Promise.resolve(call({ path, sha }));
    try {
      await started;
      expect((await call({ path, sha })).statusCode).toBe(409);
    } finally {
      release();
      expect((await pending).statusCode).toBe(204);
    }
    expect(client.delete).toHaveBeenCalledTimes(1);
  });
});

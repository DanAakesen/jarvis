import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type { VaultIndexStore } from '../database/memory-store.js';
import { parseTodosWithContext } from '../proactive/todo-file.js';
import { createVaultModule } from './index.js';
import { createGitHubVaultClient, VaultWriteConflictError } from './github-client.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const sha = 'a'.repeat(40);
const path = 'Personal/Task inbox.md';
const content = '# Inbox\n\n- [ ] Pay rent 📅 2026-11-20\n- [ ] Call back\n';
const headers = { authorization: `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(auth?: BuildAppOptions['auth']) {
  const client = {
    read: vi.fn(async () => ({ path, sha, content }) as { path: string; sha: string; content: string } | null),
    write: vi.fn(async () => 'b'.repeat(40)),
    tree: vi.fn(async () => []),
  };
  const module = createVaultModule({
    client: client as unknown as ReturnType<typeof createGitHubVaultClient>,
    indexStore: { files: vi.fn(async () => []) } as unknown as VaultIndexStore,
    memoryStore: { getSourceMessage: vi.fn() },
  });
  const app = buildApp(config, undefined, {
    modules: [module],
    auth: auth ?? (async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' })),
  });
  apps.push(app);
  const identity = () => {
    const task = parseTodosWithContext(content, path).find((candidate) => candidate.line === 3)!;
    return { path, line: task.line, text: task.text, version: task.version };
  };
  const call = (payload: unknown, authenticated = true) => app.inject({
    method: 'DELETE', url: '/vault/tasks', headers: authenticated ? headers : {}, payload,
  });
  return { client, call, identity };
}

describe('owner task deletion', () => {
  it('requires the owner principal', async () => {
    const owner = fixture();
    expect((await owner.call(owner.identity(), false)).statusCode).toBe(401);
    const agent = fixture(async () => ({ kind: 'jarvis-agent', objectId: 'agent', tenantId: 'tenant' }));
    expect((await agent.call(agent.identity())).statusCode).toBe(403);
    expect(agent.client.read).not.toHaveBeenCalled();
  });

  it('removes only the identified task line and keeps the note', async () => {
    const { call, client, identity } = fixture();
    const response = await call(identity());
    expect(response.statusCode).toBe(204);
    expect(client.write).toHaveBeenCalledOnce();
    expect(client.write).toHaveBeenCalledWith(
      path, '# Inbox\n\n- [ ] Call back\n', expect.stringContaining('jarvis: delete a task'), sha, expect.any(AbortSignal),
    );
  });

  it('refuses a task that changed since it was read, without writing', async () => {
    const { call, client, identity } = fixture();
    const stale = { ...identity(), text: 'Something else' };
    expect((await call(stale)).statusCode).toBe(409);
    expect((await call({ ...identity(), version: 'f'.repeat(64) })).statusCode).toBe(409);
    expect(client.write).not.toHaveBeenCalled();
  });

  it('rejects malformed input and notes outside the task scope', async () => {
    const { call, client, identity } = fixture();
    expect((await call({ path, line: 3 })).statusCode).toBe(400);
    expect((await call({ ...identity(), path: 'Inbox/idea.md' })).statusCode).toBe(400);
    expect(client.read).not.toHaveBeenCalled();
  });

  it('reports an upstream conflict and never reports false success', async () => {
    const { call, client, identity } = fixture();
    client.write.mockRejectedValue(new VaultWriteConflictError());
    expect((await call(identity())).statusCode).toBe(409);
    client.write.mockRejectedValue(new Error('private upstream details'));
    const failed = await call(identity());
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private upstream details');
  });
});

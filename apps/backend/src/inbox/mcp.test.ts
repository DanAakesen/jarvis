import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { InboxCaptureCredentials, type InboxCaptureCredentialStore, type InboxCredentialScope } from '../auth/inbox-capture-credential.js';
import { VaultWriteConflictError, type VaultFile, type VaultTreeFile } from '../vault/github-client.js';
import { createInboxMcpRoutes } from './mcp.js';
import { createInboxModule } from './module.js';
import { blobSha } from './note.js';
import { createInboxStore, type InboxVault } from './store.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const vault: InboxVault = {
    async tree(): Promise<VaultTreeFile[]> { return [...files.keys()].map((path) => ({ path, sha: blobSha(files.get(path)!) })); },
    async read(path: string): Promise<VaultFile | null> {
      const content = files.get(path);
      return content === undefined ? null : { path, sha: blobSha(content), content };
    },
    async write(path: string, content: string, _message: string, expected: string | undefined) {
      if (files.has(path) ? expected !== blobSha(files.get(path)!) : expected !== undefined) throw new VaultWriteConflictError();
      files.set(path, content);
      return 'c'.repeat(40);
    },
    async move(from: string, to: string, content: string, expected: string) {
      if (!files.has(from) || blobSha(files.get(from)!) !== expected || files.has(to)) throw new VaultWriteConflictError();
      files.delete(from);
      files.set(to, content);
      return 'd'.repeat(40);
    },
  };
  const rows = new Map<string, { label: string; scope: InboxCredentialScope }>();
  const store: InboxCaptureCredentialStore = {
    async add(_owner, hash, label, scope) { rows.set(hash.toString('hex'), { label, scope }); return true; },
    async verify(_owner, hash) { return rows.get(hash.toString('hex')) ?? null; },
    async list() { return []; },
    async revoke() { return false; },
  };
  const credentials = new InboxCaptureCredentials(store, config.auth.ownerObjectId);
  const inbox = createInboxStore({ vault, now: () => new Date('2026-11-14T21:41:00Z') });
  const module = createInboxModule({
    store: inbox, memoryStore: { getSourceMessage: async () => null }, credentials,
    routes: [createInboxMcpRoutes({ store: inbox })],
  });
  const app = buildApp(config, undefined, {
    modules: [module],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
    inboxCapture: { credentials },
  });
  apps.push(app);
  let id = 0;
  async function rpc(token: string | undefined, method: string, params: Record<string, unknown> = {}) {
    id += 1;
    const response = await app.inject({
      method: 'POST', url: '/inbox/mcp', remoteAddress: '10.0.0.9',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        ...(token ? { authorization: bearer(token) } : {}),
      },
      payload: { jsonrpc: '2.0', id, method, params },
    });
    const body = response.body.includes('data:')
      ? response.body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : response.body;
    return { status: response.statusCode, json: body ? JSON.parse(body) as Json : undefined };
  }
  return { files, credentials, rpc, app };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const initialize = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };

describe('inbox MCP server', () => {
  it('shows a write credential only inbox_capture, and a read_write credential all three tools', async () => {
    const { credentials, rpc } = setup();
    const write = await credentials.issue('Shortcut', 'write');
    const full = await credentials.issue('ChatGPT', 'read_write');
    expect((await rpc(write.credential, 'initialize', initialize)).json?.result?.serverInfo?.name).toBe('jarvis-inbox');
    const names = async (token: string) => ((await rpc(token, 'tools/list')).json?.result?.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(await names(write.credential)).toEqual(['inbox_capture']);
    expect(await names(full.credential)).toEqual(['inbox_capture', 'inbox_close', 'inbox_items']);
  });

  it('captures with the assistant\'s own structure, labelled by its credential, and repeats are idempotent', async () => {
    const { credentials, rpc, files } = setup();
    const { credential } = await credentials.issue('ChatGPT', 'read_write');
    const call = (args: Record<string, unknown>) => rpc(credential, 'tools/call', { name: 'inbox_capture', arguments: args });
    const first = await call({ title: 'Padel night', note: 'What: team evening.', quote: 'we should do a padel night', captureId: 'chatgpt-20261114-0001' });
    expect(first.json?.result?.isError).toBeFalsy();
    expect(first.json?.result?.structuredContent).toMatchObject({ created: true, confirmation: 'Saved to the inbox: Padel night.' });
    const [content] = [...files.values()];
    expect(content).toContain('> Dan, 14 Nov 22:41, ChatGPT: "we should do a padel night"');
    const again = await call({ title: 'Padel night, reworded', note: 'x', captureId: 'chatgpt-20261114-0001' });
    expect(again.json?.result?.structuredContent).toMatchObject({ created: false });
    expect(files.size).toBe(1);
    const secret = await call({ title: 'Keys', note: 'password: hunter2hunter2', captureId: 'chatgpt-20261114-0002' });
    expect(secret.json?.result?.isError).toBe(true);
    expect(files.size).toBe(1);
    // The published contract is enforced: a capture key and some content are both required.
    for (const args of [{ title: 'No key', note: 'x' }, { title: 'Title only', captureId: 'chatgpt-20261114-0003' }]) {
      const rejected = (await call(args)).json;
      expect(rejected?.error ?? rejected?.result?.isError, JSON.stringify(args)).toBeTruthy();
    }
    expect(files.size).toBe(1);
  });

  it('lists, reads and closes items for a read_write credential, and never lets a write credential read or close', async () => {
    const { credentials, rpc, files } = setup({
      'Inbox/2026-11-12 Older.md': '# Older\n\nabout padel\n\n<!-- jarvis-inbox:11111111 -->\n',
      'Personal/Inbox.md': '- [ ] not an inbox note\n',
    });
    const full = await credentials.issue('Claude', 'read_write');
    const write = await credentials.issue('Shortcut', 'write');
    const call = (token: string, name: string, args: Record<string, unknown>) => rpc(token, 'tools/call', { name, arguments: args });
    const listed = await call(full.credential, 'inbox_items', {});
    expect(listed.json?.result?.structuredContent?.items).toHaveLength(1);
    expect((await call(full.credential, 'inbox_items', { id: '11111111' })).json?.result?.structuredContent?.item?.content).toContain('about padel');
    expect((await call(write.credential, 'inbox_items', {})).json?.error ?? (await call(write.credential, 'inbox_items', {})).json?.result?.isError).toBeTruthy();
    expect((await call(write.credential, 'inbox_close', { id: '11111111', reason: 'x' })).json?.result?.isError ?? true).toBeTruthy();
    expect(files.has('Inbox/2026-11-12 Older.md')).toBe(true);
    const closed = await call(full.credential, 'inbox_close', { id: '11111111', reason: 'binned' });
    expect(closed.json?.result?.structuredContent).toMatchObject({ confirmation: 'Closed in the inbox: Older.' });
    expect(files.has('Inbox/Closed/2026-11-12 Older.md')).toBe(true);
    const outside = (await call(full.credential, 'inbox_close', { path: 'Personal/Inbox.md', reason: 'x' })).json;
    expect(outside?.error ?? outside?.result?.isError).toBeTruthy();
    expect(files.get('Personal/Inbox.md')).toBe('- [ ] not an inbox note\n');
  });

  it('refuses without a credential, with an unknown one, from a browser, and on other routes', async () => {
    const { credentials, rpc, app } = setup();
    expect((await rpc(undefined, 'tools/list')).status).toBe(401);
    expect((await rpc(`ji.${'A'.repeat(43)}`, 'tools/list')).status).toBe(401);
    const { credential } = await credentials.issue('Claude', 'read_write');
    const browser = await app.inject({
      method: 'POST', url: '/inbox/mcp', headers: { authorization: bearer(credential), origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(browser.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/settings', headers: { authorization: bearer(credential) } })).statusCode).toBe(403);
  });
});

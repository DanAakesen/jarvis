import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '../core/conversation-store.js';
import type { JarvisTool } from '../core/tool-registry.js';

vi.mock('jose', () => ({ SignJWT: class {} }));
let githubWrite: JarvisTool;
beforeAll(async () => {
  const { githubAppTools } = await import('./github-app-tools.js');
  githubWrite = githubAppTools.find(tool => tool.name === 'github_write')!;
}, 120_000);
afterEach(() => { vi.unstubAllGlobals(); });
const repository = 'example-org/example-repo';
const input = { operation: 'file_write', repository, path: 'notes.txt', branch: 'main', content: 'hello', message: 'Update notes' };
const source = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: '10', sessionId: '7', role: 'dan', text: 'Publish the notes.', model: null, at: new Date(), ...overrides,
});
function fixture(surface: 'chat' | 'voice') {
  let latest = source();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'PUT'
    ? Response.json({ commit: { sha: 'b'.repeat(40) }, content: { html_url: 'https://example.invalid/notes.txt' } })
    : Response.json({ default_branch: 'main', private: false }));
  vi.stubGlobal('fetch', fetcher);
  const decide = vi.fn(() => { throw new Error('No second approval interpreter should run'); });
  const server = {
    approvalInterpreter: { decide },
    githubAppTokenIssuer: {
      readInstallationPermissions: async () => ({ contents: 'write' }),
      issueWithPermissions: async () => 'scoped-installation-token',
    },
    conversationStore: { getHistory: async () => ({ messages: [latest], nextCursor: null }) },
  };
  const request = (message: ConversationMessage) => {
    latest = message;
    return { server, log: { info: vi.fn(), error: vi.fn() },
      ...(surface === 'voice'
        ? { jarvisConversationMessage: message, principal: { id: 'dan' }, agentPrincipal: null, headers: {} }
        : { headers: { 'x-jarvis-message-id': message.id }, principal: null, agentPrincipal: { id: 'jarvis-agent' } }),
    };
  };
  const write = (message = source(), change = {}, signal = new AbortController().signal) =>
    githubWrite.execute({ ...input, ...change }, request(message) as never, signal);
  const writes = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
  return { write, writes, decide, fetcher };
}

describe.each(['chat', 'voice'] as const)('direct requested GitHub writes in %s', surface => {
  it('writes the requested public/default-branch file without a second approval', async () => {
    const f = fixture(surface);
    expect(await f.write()).toMatchObject({ status: 'written', repository, branch: 'main', path: 'notes.txt' });
    expect(f.writes()).toHaveLength(1);
    expect(f.decide).not.toHaveBeenCalled();
  });
  it('shares the receipt across parallel and later duplicate calls from the same request', async () => {
    const f = fixture(surface);
    const [first, second] = await Promise.all([f.write(), f.write()]);
    expect(second).toEqual(first);
    expect(await f.write()).toEqual(first);
    expect(f.writes()).toHaveLength(1);
  });
  it('distinguishes different files and separate owner messages', async () => {
    const f = fixture(surface);
    await f.write();
    await f.write(source(), { path: 'other.txt' });
    await f.write(source({ id: '11' }));
    expect(f.writes()).toHaveLength(3);
  });
  it.each([{ sessionId: '' }, { role: 'jarvis' as const }, { id: '011' }])('refuses unverifiable source %j before writing', async change => {
    const f = fixture(surface);
    await expect(f.write(source(change))).rejects.toThrow();
    expect(f.writes()).toHaveLength(0);
  });
  it('honors cancellation without a write', async () => {
    const f = fixture(surface);
    const controller = new AbortController(); controller.abort();
    await expect(f.write(source(), {}, controller.signal)).rejects.toThrow();
    expect(f.writes()).toHaveLength(0);
  });
  it('retains an uncertain write failure instead of replaying it', async () => {
    const f = fixture(surface);
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (...args) => {
      if (args[1]?.method === 'PUT') throw new Error('connection lost after provider accepted the write');
      return original(...args);
    });
    await expect(f.write()).rejects.toThrow();
    await expect(f.write()).rejects.toThrow();
    expect(f.writes()).toHaveLength(1);
  });
  it.each([{ approved: true }, { confirmed: true }, { confirmationCode: '12345678' }])('rejects synthetic authority fields %j', async change => {
    const f = fixture(surface);
    await expect(f.write(source(), change)).rejects.toThrow();
    expect(f.writes()).toHaveLength(0);
  });
});

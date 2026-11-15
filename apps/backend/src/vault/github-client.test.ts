import { describe, expect, it } from 'vitest';
import { VaultWriteConflictError, createGitHubVaultClient } from './github-client.js';

const head = '1'.repeat(40);
const baseTree = '2'.repeat(40);
const newTree = '3'.repeat(40);
const newCommit = '4'.repeat(40);
const sourceSha = '5'.repeat(40);
const signal = new AbortController().signal;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function file(path: string, sha: string) {
  return json({ type: 'file', path, sha, encoding: 'base64', content: Buffer.from('note').toString('base64') });
}

function fixture(options: { source?: string | null; target?: boolean; refStatus?: number } = {}) {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (url.endsWith('/git/ref/heads/master')) return json({ object: { sha: head } });
    if (url.endsWith(`/git/commits/${head}`)) return json({ tree: { sha: baseTree } });
    if (url.includes('/contents/Inbox/a.md')) {
      return options.source === null ? json({}, 404) : file('Inbox/a.md', options.source ?? sourceSha);
    }
    if (url.includes('/contents/Inbox/Closed/a.md')) return options.target ? file('Inbox/Closed/a.md', sourceSha) : json({}, 404);
    if (method === 'POST' && url.endsWith('/git/trees')) return json({ sha: newTree });
    if (method === 'POST' && url.endsWith('/git/commits')) return json({ sha: newCommit });
    if (method === 'PATCH' && url.endsWith('/git/refs/heads/master')) return json({}, options.refStatus ?? 200);
    return json({}, 500);
  }) as typeof fetch;
  const client = createGitHubVaultClient({
    tokenIssuer: { issueForContentsWrite: async () => 'token' },
    fetcher,
  });
  return { client, requests };
}

describe('vault client move', () => {
  it('renames one note in a single commit, fast-forward only', async () => {
    const { client, requests } = fixture();
    const commit = await client.move('Inbox/a.md', 'Inbox/Closed/a.md', 'closed', sourceSha, 'close', signal);
    expect(commit).toBe(newCommit);
    expect(requests.find((entry) => entry.url.endsWith('/git/trees'))?.body).toEqual({
      base_tree: baseTree,
      tree: [
        { path: 'Inbox/Closed/a.md', mode: '100644', type: 'blob', content: 'closed' },
        { path: 'Inbox/a.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
    expect(requests.find((entry) => entry.url.endsWith('/git/commits'))?.body).toEqual({
      message: 'close', tree: newTree, parents: [head],
    });
    expect(requests.at(-1)).toMatchObject({ method: 'PATCH', body: { sha: newCommit, force: false } });
  });

  it('writes nothing when the source changed, vanished, or the target exists', async () => {
    for (const options of [{ source: '6'.repeat(40) }, { source: null }, { target: true }]) {
      const { client, requests } = fixture(options);
      await expect(client.move('Inbox/a.md', 'Inbox/Closed/a.md', 'c', sourceSha, 'close', signal))
        .rejects.toBeInstanceOf(VaultWriteConflictError);
      expect(requests.some((entry) => entry.method !== 'GET')).toBe(false);
    }
  });

  it('reports a branch that moved while committing as a conflict', async () => {
    const { client } = fixture({ refStatus: 422 });
    await expect(client.move('Inbox/a.md', 'Inbox/Closed/a.md', 'c', sourceSha, 'close', signal))
      .rejects.toBeInstanceOf(VaultWriteConflictError);
  });
});

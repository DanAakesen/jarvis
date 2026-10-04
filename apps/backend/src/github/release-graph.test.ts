import { describe, expect, it, vi } from 'vitest';
import { createGitHubReleaseGraphReader } from './release-graph.js';

const firstSha = 'a'.repeat(40);
const secondSha = 'b'.repeat(40);
const token = 'contents-token-fixture';

function commit(sha: string, message: string, committedAt: string, parents: string[] = []) {
  return {
    sha,
    commit: { message, author: { name: 'Dan', date: committedAt } },
    parents: parents.map((parentSha) => ({ sha: parentSha })),
  };
}

describe('GitHub release graph', () => {
  it('reads a bounded history for each branch with a contents-read token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/branches')) {
        return new Response(JSON.stringify([
          { name: 'main', commit: { sha: secondSha } },
          { name: 'feature/release-view', commit: { sha: firstSha } },
        ]));
      }
      const branch = url.searchParams.get('sha');
      return new Response(JSON.stringify(branch === 'main'
        ? [commit(secondSha, 'Merge release', '2026-10-04T12:00:00Z', [firstSha]), commit(firstSha, 'Add release', '2026-10-03T12:00:00Z')]
        : [commit(firstSha, 'Add release', '2026-10-03T12:00:00Z')]));
    });
    const tokenIssuer = { issueForContents: vi.fn(async () => token) };
    const reader = createGitHubReleaseGraphReader(tokenIssuer, fetchImpl, () => Date.parse('2026-10-04T13:00:00Z'));

    const graph = await reader.read('DanAakesen/jarvis', 'main');

    expect(tokenIssuer.issueForContents).toHaveBeenCalledWith('DanAakesen/jarvis');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.every(([, options]) =>
      (options?.headers as Record<string, string>).Authorization === `${['Bear', 'er'].join('')} ${token}`,
    )).toBe(true);
    expect(graph).toEqual({
      fetchedAt: '2026-10-04T13:00:00.000Z',
      truncated: false,
      branches: [
        { name: 'main', commits: [secondSha, firstSha] },
        { name: 'feature/release-view', commits: [firstSha] },
      ],
      commits: [
        {
          sha: firstSha, message: 'Add release', author: 'Dan', committedAt: '2026-10-03T12:00:00.000Z', parents: [],
        },
        {
          sha: secondSha, message: 'Merge release', author: 'Dan',
          committedAt: '2026-10-04T12:00:00.000Z', parents: [firstSha],
        },
      ],
    });
    expect(JSON.stringify(graph)).not.toContain(token);
  });

  it('rejects invalid repository input before requesting a token', async () => {
    const tokenIssuer = { issueForContents: vi.fn(async () => token) };
    const reader = createGitHubReleaseGraphReader(tokenIssuer, vi.fn<typeof fetch>());

    await expect(reader.read('github.com/DanAakesen/jarvis', 'main')).rejects.toThrow('repository or branch is invalid');
    expect(tokenIssuer.issueForContents).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createGitHubActionsLogClient, extractJobLog } from './actions-logs.js';

const repository = 'DanAakesen/jarvis-test-target';
const zip = (name: string, contents: string) =>
  Buffer.from(zipSync({ [name]: strToU8(contents) }));

describe('GitHub Actions job logs', () => {
  it.each(['failure', 'cancelled'])('resolves stable workflow identity and %s independently of webhook order', async (conclusion) => {
    const tokenIssuer = { issueForActions: vi.fn(async () => 'actions-read-token') };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 987, workflow_id: 42, conclusion,
    })));
    await expect(createGitHubActionsLogClient(tokenIssuer, fetch).readWorkflowRun(repository, 987))
      .resolves.toEqual({ workflowId: 42, cancelled: conclusion === 'cancelled' });
    expect(tokenIssuer.issueForActions).toHaveBeenCalledWith(repository);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/DanAakesen/jarvis-test-target/actions/runs/987',
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it.each([
    new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ id: 988, workflow_id: 42 })),
    new Response(JSON.stringify({ id: 987, workflow_id: '42' })),
    new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } }),
  ])('rejects unavailable, invalid or oversized workflow metadata %#', async (response) => {
    const client = createGitHubActionsLogClient(
      { issueForActions: vi.fn(async () => 'actions-read-token') },
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
    );
    await expect(client.readWorkflowRun(repository, 987)).rejects.toThrow();
  });

  it('fetches failed jobs using an Actions-read token and extracts their bounded text logs', async () => {
    const tokenIssuer = { issueForActions: vi.fn(async () => 'actions-read-token') };
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 2,
        jobs: [
          { id: 13, name: 'Web tests', conclusion: 'failure' },
          { id: 12, name: 'Backend tests', conclusion: 'success' },
        ],
      })))
      .mockResolvedValueOnce(new Response(zip('13_web-tests.txt', 'Expected 2, received 1')));
    const client = createGitHubActionsLogClient(tokenIssuer, fetch);

    await expect(client.downloadFailedJobLogs(repository, 987, new AbortController().signal)).resolves.toEqual({
      content: Buffer.from('===== Web tests =====\nExpected 2, received 1\n'),
      jobs: ['Web tests'],
    });
    expect(tokenIssuer.issueForActions).toHaveBeenCalledOnce();
    expect(tokenIssuer.issueForActions).toHaveBeenCalledWith(repository);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [jobsUrl, jobsOptions] = fetch.mock.calls[0]!;
    expect(jobsUrl).toBe(
      'https://api.github.com/repos/DanAakesen/jarvis-test-target/actions/runs/987/jobs?filter=latest&per_page=100',
    );
    expect((jobsOptions?.headers as Record<string, string>).Authorization)
      .toBe(`${['Bear', 'er'].join('')} actions-read-token`);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/repos/DanAakesen/jarvis-test-target/actions/jobs/13/logs',
    );
  });

  it('rejects invalid, unbounded, or oversized job responses and archives', async () => {
    expect(() => extractJobLog(zip('notes.md', 'not a job log'))).toThrow('contains no text log');
    expect(() => extractJobLog(Buffer.from(zipSync({
      'first.txt': strToU8('first'),
      'second.txt': strToU8('second'),
    })))).toThrow('archive is invalid');
    expect(() => extractJobLog(zip('large.txt', 'x'.repeat(8 * 1024 * 1024 + 1))))
      .toThrow('archive is invalid');

    const tokenIssuer = { issueForActions: vi.fn(async () => 'actions-read-token') };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      total_count: 101,
      jobs: [],
    })));
    await expect(createGitHubActionsLogClient(tokenIssuer, fetch).downloadFailedJobLogs(repository, 1))
      .rejects.toThrow('job response is invalid');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not issue a token for invalid repositories and rejects non-HTTPS log redirects', async () => {
    const tokenIssuer = { issueForActions: vi.fn(async () => 'actions-read-token') };
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createGitHubActionsLogClient(tokenIssuer, fetch);

    await expect(client.downloadFailedJobLogs('bad/repo/name', 1)).rejects.toThrow('run is invalid');
    expect(tokenIssuer.issueForActions).not.toHaveBeenCalled();

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      total_count: 1, jobs: [{ id: 3, name: 'Tests', conclusion: 'failure' }],
    }))).mockImplementationOnce(async () => {
      const response = new Response(zip('3_tests.txt', 'failure'));
      Object.defineProperty(response, 'url', { value: 'http://example.test/logs.zip' });
      return response;
    });
    await expect(client.downloadFailedJobLogs(repository, 1)).rejects.toThrow('response is invalid');
  });

  it('does not forward the GitHub token to the signed log-download URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total_count: 1, jobs: [{ id: 7, name: 'Tests', conclusion: 'failure' }],
      })))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://pipelines.actions.githubusercontent.com/job.zip?signature=private' },
      }))
      .mockResolvedValueOnce(new Response(zip('7_tests.txt', 'failure')));
    const client = createGitHubActionsLogClient({ issueForActions: async () => 'actions-read-token' }, fetch);

    await expect(client.downloadFailedJobLogs(repository, 8)).resolves.toMatchObject({
      jobs: ['Tests'],
      content: Buffer.from('===== Tests =====\nfailure\n'),
    });
    expect((fetch.mock.calls[1]?.[1]?.headers as Record<string, string>).Authorization)
      .toBe(`${['Bear', 'er'].join('')} actions-read-token`);
    expect(fetch.mock.calls[2]?.[0]?.toString())
      .toBe('https://pipelines.actions.githubusercontent.com/job.zip?signature=private');
    expect(fetch.mock.calls[2]?.[1]?.headers).toEqual({ Accept: 'application/zip' });
  });

  it('rejects a log redirect to an untrusted host', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        total_count: 1,
        jobs: [{ id: 9, name: 'Tests', conclusion: 'failure' }],
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://127.0.0.1/private' },
      }));
    const client = createGitHubActionsLogClient({ issueForActions: async () => 'actions-read-token' }, fetch);

    await expect(client.downloadFailedJobLogs(repository, 8)).rejects.toThrow('GitHub job log response is invalid');

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

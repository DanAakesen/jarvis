import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskReleaseBar } from './TaskReleaseBar';

const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();

function releaseView(projectId: string, name: string, sha: string, fetchedAt: string) {
  return {
    project: { id: projectId, name, repo: `org/${name.toLowerCase()}`, defaultBranch: 'main' },
    releases: [{
      id: `release-${projectId}`, version: '8', sha, status: 'failed',
      createdAt: '2026-10-04T12:00:00.000Z', releasedAt: null,
    }],
    pullRequests: [],
    workflowRuns: [{
      id: `run-${projectId}`, workflow: 'Build and test', trigger: 'push', headSha: sha,
      status: 'completed', conclusion: 'failure', startedAt: '2026-10-04T11:00:00.000Z',
      completedAt: '2026-10-04T11:30:00.000Z', releaseId: `release-${projectId}`,
      pullRequestNumber: null, taskId: null,
    }],
    deployments: [{
      id: `deployment-${projectId}`, releaseId: `release-${projectId}`, environment: 'production',
      status: 'failure', at: '2026-10-04T12:30:00.000Z',
    }],
    graph: {
      fetchedAt: fetchedAt,
      truncated: false,
      branches: [{ name: 'main', commits: [sha] }],
      commits: [{
        sha, message: `${name} commit`, author: 'Dan', committedAt: '2026-10-04T10:00:00.000Z', parents: [],
      }],
    },
  };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderBar(projectId: string) {
  return render(
    <MemoryRouter>
      <TaskReleaseBar backendUrl="https://api.example.com" getAccessToken={getAccessToken} projectId={projectId} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  getAccessToken.mockClear();
});

describe('TaskReleaseBar', () => {
  it('asks for a project instead of fetching another project release', () => {
    vi.stubGlobal('fetch', fetchMock);
    renderBar('');

    expect(screen.getByText('Select a project to view its release and commit context.')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never shows one project graph under a newly selected project label', async () => {
    let finishOldRequest: (() => void) | undefined;
    fetchMock.mockImplementation((input) => {
      const projectId = new URL(String(input)).pathname.split('/').at(-2);
      if (projectId === '7') {
        return new Promise<Response>((resolve) => {
          finishOldRequest = () => resolve(response(releaseView(
            '7', 'Old project', 'aaaaaaa1111111', '2026-10-04T10:00:00.000Z',
          )));
        });
      }
      return Promise.resolve(response(releaseView(
        '8', 'New project', 'bbbbbbb2222222', '2026-10-04T10:00:00.000Z',
      )));
    });
    vi.stubGlobal('fetch', fetchMock);
    const page = renderBar('7');
    await waitFor(() => expect(finishOldRequest).toBeDefined());

    page.rerender(
      <MemoryRouter>
        <TaskReleaseBar backendUrl="https://api.example.com" getAccessToken={getAccessToken} projectId="8" />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Old project')).toBeNull();
    expect(screen.queryByText(/aaaaaaa/)).toBeNull();
    expect(await screen.findByRole('link', { name: 'New project' })).not.toBeNull();
    expect(screen.queryByText('org/new project')).toBeNull();
    expect(screen.getByRole('link', { name: /failureBuild and test/ })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'v8' })).not.toBeNull();
    expect(screen.getByRole('link', { name: /bbbbbbb/ })).not.toBeNull();
    expect(screen.getAllByText('failure').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Commit data may be stale/)).not.toBeNull();

    finishOldRequest?.();
    await waitFor(() => {
      expect(screen.queryByText('Old project')).toBeNull();
      expect(screen.getByRole('link', { name: 'New project' })).not.toBeNull();
    });
  });

  it('distinguishes an empty release list from unavailable commit history', async () => {
    fetchMock.mockResolvedValue(response({
      ...releaseView('9', 'Empty project', 'ccccccc3333333', '2026-10-04T10:00:00.000Z'),
      releases: [],
      workflowRuns: [],
      deployments: [],
      graph: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderBar('9');

    expect(await screen.findByText('No releases have been recorded for this project.')).not.toBeNull();
    expect(screen.getByText('Commit history is unavailable.')).not.toBeNull();
    expect(screen.getAllByText('Not reported').length).toBe(2);
  });

  it('shows a recoverable error if release data is unavailable', async () => {
    fetchMock.mockResolvedValue(response({ error: 'unavailable' }, 503));
    vi.stubGlobal('fetch', fetchMock);
    renderBar('7');

    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry release data' })).not.toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReleasePage } from './ReleasePage';

const sha = 'a'.repeat(40);
const project = { id: '42', name: 'Jarvis', repo: 'DanAakesen/jarvis', defaultBranch: 'main' };
const responseData = {
  project,
  releases: [{
    id: '7', version: '18', sha, status: 'released', createdAt: '2026-10-04T11:00:00Z',
    releasedAt: '2026-10-04T11:15:00Z',
  }],
  pullRequests: [{
    id: '9', number: 3, branch: 'task/release-view', headSha: sha, state: 'merged', checks: 'passed', taskId: '11',
  }],
  workflowRuns: [{
    id: '9871', workflow: 'Release', trigger: 'push', headSha: sha, status: 'completed', conclusion: 'success',
    startedAt: '2026-10-04T11:01:00Z', completedAt: '2026-10-04T11:14:00Z',
    releaseId: '7', pullRequestNumber: 3, taskId: '11',
  }],
  deployments: [{
    id: '123', releaseId: '7', environment: 'production', status: 'success', at: '2026-10-04T11:15:00Z',
  }],
  graph: {
    fetchedAt: '2026-10-04T12:00:00Z',
    truncated: false,
    branches: [{ name: 'main', commits: [sha] }],
    commits: [{ sha, message: 'Add the release view', author: 'Dan', committedAt: '2026-10-04T11:00:00Z', parents: [] }],
  },
};
const fetchMock = vi.fn<typeof fetch>();
const getAccessToken = vi.fn(async () => 'fixture-token');
const props = { backendUrl: 'https://backend.example', getAccessToken };

function renderPage(path = '/factory/projects/42/releases') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/factory/projects/:projectId/releases" element={<ReleasePage {...props} />} />
        <Route path="/factory/projects/:projectId/releases/:releaseId" element={<ReleasePage {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('project release view', () => {
  it('shows GitHub history, release records, related tasks, runs, deployments, and links', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const releaseLink = (await screen.findAllByRole('link', { name: 'Build 18' }))[0]!;
    expect(screen.getByRole('heading', { name: 'Jarvis releases' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Git history' })).not.toBeNull();
    expect(screen.getByRole('link', { name: /Commit aaaaaaa: Add the release view/ }).getAttribute('href'))
      .toBe(`https://github.com/DanAakesen/jarvis/commit/${sha}`);
    expect(screen.getByRole('link', { name: 'Release · success' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/actions/runs/9871');
    expect(screen.getByRole('link', { name: 'PR #3 · merged · checks passed' }).getAttribute('href'))
      .toBe('https://github.com/DanAakesen/jarvis/pull/3');
    expect(screen.getAllByRole('link', { name: 'Task #11' }).every((link) => link.getAttribute('href') === '/factory/tasks/11'))
      .toBe(true);
    expect(releaseLink.getAttribute('href')).toBe('/factory/projects/42/releases/7');
    expect(screen.getByText(/production · success · Oct 4, 2026/)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://backend.example/factory/projects/42/releases',
      expect.objectContaining({ cache: 'no-store' }),
    );

    fireEvent.click(releaseLink);
    expect(await screen.findByRole('heading', { name: 'Release 18' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close release details' })).not.toBeNull();
  });

  it('offers retry and keeps persisted records usable when graph data is unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...responseData, releases: [], graph: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    expect(await screen.findByRole('alert')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/No release has been recorded/)).not.toBeNull();
    expect(screen.getByText(/The GitHub graph is unavailable/)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('announces refresh feedback and refetches when requested', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await screen.findAllByRole('link', { name: 'Build 18' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh releases and graph' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Refresh releases and graph' })).toHaveProperty('disabled', false);
  });
});

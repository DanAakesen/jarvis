import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanelProvider } from '../ContextPanel';
import { FactoryArea } from './FactoryArea';
import { ProjectsPage } from './ProjectsPage';

const project = {
  id: '7',
  name: 'Jarvis',
  repo: 'DanAakesen/jarvis',
  default_branch: 'main',
  default_agent: 'copilot' as const,
  policy: 'deliver_pr' as const,
  merge_rules: null,
  sandbox_size: '1x2' as const,
  tech: 'node',
  max_parallel_tasks: 1,
  active: true,
};

const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();
let projects: typeof project[];
let repositories: {
  fullName: string;
  name: string;
  defaultBranch: string;
  pushedAt: string | null;
  language: string | null;
}[];

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderFactory(path = '/settings') {
  return render(
    <ContextPanelProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={<ProjectsPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />} />
          <Route path="/factory/*" element={
            <FactoryArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
          } />
        </Routes>
      </MemoryRouter>
    </ContextPanelProvider>,
  );
}

beforeEach(() => {
  getAccessToken.mockClear();
  projects = [{ ...project }];
  repositories = [{
    fullName: 'DanAakesen/second-project',
    name: 'second-project',
    defaultBranch: 'develop',
    pushedAt: '2026-10-03T12:00:00Z',
    language: 'C#',
  }];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/factory/tasks?state=Running&limit=100')) {
      return response({ tasks: [{ projectId: '7', state: 'Running' }], limit: 100, offset: 0 });
    }
    if (url.includes('/factory/repositories') && method === 'GET') {
      return response({ repositories, fetchedAt: '2026-10-04T09:00:00.000Z' });
    }
    if (url.endsWith('/factory/projects') && method === 'GET') return response(projects);
    if (url.endsWith('/factory/projects/manage') && method === 'POST') {
      const repository = repositories.find((item) => item.fullName === JSON.parse(String(init?.body)).repository);
      if (!repository) return response({ error: 'not found' }, 404);
      const managed = {
        ...project,
        id: '8',
        name: repository.name,
        repo: repository.fullName,
        default_branch: repository.defaultBranch,
        default_agent: 'copilot' as const,
        policy: 'deliver_pr' as const,
        tech: 'dotnet',
      };
      projects = [...projects, managed];
      repositories = repositories.filter((item) => item.fullName !== repository.fullName);
      return response(managed, 201);
    }
    if (url.endsWith('/factory/projects/7') && method === 'PATCH') {
      const updated = { ...project, ...JSON.parse(String(init?.body)) };
      projects = projects.map((item) => item.id === '7' ? updated : item);
      return response(updated);
    }
    if (url.endsWith('/factory/projects/7') && method === 'DELETE') {
      projects = [];
      return response(null, 204);
    }
    return response({ error: 'Unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Projects page', () => {
  it('redirects the old Projects address to the Projects section in Settings', async () => {
    renderFactory('/factory/projects');
    expect(await screen.findByRole('heading', { level: 2, name: 'Projects' })).not.toBeNull();
  });

  it('adds an existing repository from the Kanban Create project dialog', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/kanban');
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const list = await within(dialog).findByRole('list', { name: 'Repositories you can add' });
    expect(within(list).getByText('DanAakesen/second-project')).not.toBeNull();
    expect(within(list).queryByText('DanAakesen/jarvis')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Ask Jarvis to create it' })).toHaveProperty('disabled', true);

    await user.click(within(list).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Added DanAakesen/second-project as a project.')).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Create project' })).toBeNull();
    const manage = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/factory/projects/manage') && init?.method === 'POST');
    expect(JSON.parse(String(manage?.[1]?.body))).toEqual({ repository: 'DanAakesen/second-project' });
  });

  it('lists project settings, running tasks, and honest release availability', async () => {
    renderFactory();

    const row = await screen.findByRole('article', { name: 'Jarvis' });
    expect(within(row).getByText('DanAakesen/jarvis')).not.toBeNull();
    expect(within(row).getByText('Copilot')).not.toBeNull();
    expect(within(row).getByText('Deliver a pull request')).not.toBeNull();
    expect(within(row).getByText('node')).not.toBeNull();
    expect(within(row).getByText('1')).not.toBeNull();
    expect(within(row).getByRole('link', { name: 'View releases' }).getAttribute('href'))
      .toBe('/factory/projects/7/releases');
    expect(screen.queryByText('Counts update when you refresh projects.')).toBeNull();
    expect(screen.queryByText('All repositories in the GitHub App installation are managed.')).toBeNull();
    const available = screen.getByRole('article', { name: 'DanAakesen/second-project' });
    expect(within(available).getByText((_text, element) => element?.tagName === 'TIME').getAttribute('dateTime'))
      .toBe('2026-10-03T12:00:00Z');
    expect(within(available).getByText('C#')).not.toBeNull();
    expect(within(available).getByRole('button', { name: 'Manage with Jarvis' })).not.toBeNull();

    const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/factory/projects'))?.[1];
    expect(request?.headers).toMatchObject({ Authorization: ['Bearer', 'test-access-token'].join(' ') });
  });

  it('manages an existing repository without a form and refreshes the list on demand', async () => {
    const user = userEvent.setup();
    renderFactory();

    const row = await screen.findByRole('article', { name: 'DanAakesen/second-project' });
    await user.click(within(row).getByRole('button', { name: 'Manage with Jarvis' }));

    expect(await screen.findByText('Managed DanAakesen/second-project with Jarvis.')).not.toBeNull();
    expect(screen.getByRole('article', { name: 'second-project' })).not.toBeNull();
    expect(screen.queryByRole('article', { name: 'DanAakesen/second-project' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/factory/projects/manage') && init?.method === 'POST' &&
      JSON.stringify(JSON.parse(String(init.body))) === JSON.stringify({ repository: 'DanAakesen/second-project' }),
    )).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Refresh projects and repositories' }));
    await screen.findByRole('article', { name: 'second-project' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/factory/repositories?refresh=true'))).toBe(true);
  });

  it('explains when an existing repository is no longer available to manage', async () => {
    const user = userEvent.setup();
    const fallback = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/factory/projects/manage')) return response({ error: 'not found' }, 404);
      return fallback!(input, init);
    });
    renderFactory();

    const repository = await screen.findByRole('article', { name: 'DanAakesen/second-project' });
    await user.click(within(repository).getByRole('button', { name: 'Manage with Jarvis' }));

    expect((await screen.findByRole('alert')).textContent)
      .toContain('This repository is no longer available through the GitHub App.');
  });

  it('does not expose a project creation form or link', async () => {
    renderFactory();
    await screen.findByRole('heading', { name: 'Projects' });

    expect(screen.queryByRole('link', { name: 'New project' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    renderFactory('/factory/projects/new');
    expect((await screen.findByRole('alert')).textContent).toContain('This project address is invalid.');
    expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull();
  });

  it('saves changed settings and confirms archive before retaining history', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/projects/7');

    const branch = await screen.findByRole('textbox', { name: 'Default branch' });
    await user.clear(branch);
    await user.type(branch, 'stable');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByText('Saved for new tasks.')).not.toBeNull();
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall?.[1]?.body).toBe(JSON.stringify({ default_branch: 'stable' }));

    await user.click(screen.getByRole('button', { name: 'Archive project' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm project archive' });
    expect(screen.getByText(/task history stays available/)).not.toBeNull();
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm archive' }));

    expect(await screen.findByRole('heading', { name: 'No managed projects' })).not.toBeNull();
    expect(screen.getByText(/Project archived\. Its task history is retained/)).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('keeps project records visible when running-task counts cannot be loaded', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes('/factory/tasks')) return response({ error: 'unavailable' }, 503);
      if ((init?.method ?? 'GET') === 'GET') return response(projects);
      return response({ error: 'Unexpected request' }, 500);
    });
    renderFactory();

    const row = await screen.findByRole('article', { name: 'Jarvis' });
    expect(within(row).getByText('Unavailable')).not.toBeNull();
    expect(screen.getByText(/Running task counts are unavailable/)).not.toBeNull();
    expect(within(row).getByRole('link', { name: 'Edit settings' })).not.toBeNull();
  });
});

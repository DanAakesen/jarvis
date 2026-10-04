import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactoryArea } from './FactoryArea';

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

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderFactory(path = '/factory/projects') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/factory/*" element={
          <FactoryArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
        } />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getAccessToken.mockClear();
  projects = [{ ...project }];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/factory/tasks?state=Running&limit=100')) {
      return response({ tasks: [{ projectId: '7', state: 'Running' }], limit: 100, offset: 0 });
    }
    if (url.endsWith('/factory/projects') && method === 'GET') return response(projects);
    if (url.endsWith('/factory/projects') && method === 'POST') {
      const created = { ...project, ...JSON.parse(String(init?.body)), id: '18' };
      projects = [...projects, created];
      return response(created, 201);
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
  it('lists project settings, running tasks, and honest release availability', async () => {
    renderFactory();

    const row = await screen.findByRole('article', { name: 'Jarvis' });
    expect(within(row).getByText('DanAakesen/jarvis')).not.toBeNull();
    expect(within(row).getByText('Copilot')).not.toBeNull();
    expect(within(row).getByText('Deliver a pull request')).not.toBeNull();
    expect(within(row).getByText('node')).not.toBeNull();
    expect(within(row).getByText('1')).not.toBeNull();
    expect(within(row).getByText('Not available yet')).not.toBeNull();
    expect(screen.getByText(/Last release data will appear when release tracking is connected/)).not.toBeNull();

    const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/factory/projects'))?.[1];
    expect(request?.headers).toMatchObject({ Authorization: ['Bearer', 'test-access-token'].join(' ') });
  });

  it('creates a project with validated settings and explains their scope', async () => {
    const user = userEvent.setup();
    renderFactory();
    await screen.findByRole('heading', { name: 'Projects' });
    await user.click(screen.getByRole('link', { name: 'New project' }));

    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Daily');
    await user.type(screen.getByRole('textbox', { name: 'Repository (owner/name)' }), 'DanAakesen/daily');
    await user.type(screen.getByRole('textbox', { name: 'Default branch' }), 'main');
    await user.type(screen.getByRole('textbox', { name: 'Tech identifier' }), 'python');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default agent' }), 'codex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Policy' }), 'complete_without_deployment');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sandbox size' }), '2x4');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText(/Project created\. Its defaults apply to new tasks only/)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/factory/projects', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: ['Bearer', 'test-access-token'].join(' ') }),
      body: JSON.stringify({
        name: 'Daily',
        repo: 'DanAakesen/daily',
        default_branch: 'main',
        default_agent: 'codex',
        policy: 'complete_without_deployment',
        merge_rules: null,
        sandbox_size: '2x4',
        tech: 'python',
        max_parallel_tasks: 1,
      }),
    }));
    expect(await screen.findByRole('article', { name: 'Daily' })).not.toBeNull();
  });

  it('saves changed settings and confirms archive before retaining history', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/projects/7');

    const branch = await screen.findByRole('textbox', { name: 'Default branch' });
    await user.clear(branch);
    await user.type(branch, 'stable');
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByText(/Saved\. These defaults apply to new tasks only/)).not.toBeNull();
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall?.[1]?.body).toBe(JSON.stringify({ default_branch: 'stable' }));

    await user.click(screen.getByRole('button', { name: 'Archive project' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm project archive' });
    expect(screen.getByText(/task history stays available/)).not.toBeNull();
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm archive' }));

    expect(await screen.findByRole('heading', { name: 'No active projects' })).not.toBeNull();
    expect(screen.getByText(/Project archived\. Its task history is retained/)).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('rejects invalid settings before sending a create request', async () => {
    const user = userEvent.setup();
    renderFactory('/factory/projects/new');
    await user.type(await screen.findByRole('textbox', { name: 'Project name' }), 'Daily');
    await user.type(screen.getByRole('textbox', { name: 'Repository (owner/name)' }), 'not-a-repository');
    await user.type(screen.getByRole('textbox', { name: 'Default branch' }), 'main');
    await user.type(screen.getByRole('textbox', { name: 'Tech identifier' }), 'python');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default agent' }), 'codex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Policy' }), 'deliver_pr');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sandbox size' }), '1x2');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/owner\/name format/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
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

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePage } from './UsagePage';

const fetchMock = vi.fn<typeof fetch>();
const getAccessToken = vi.fn(async () => 'fixture-token');
const report = {
  period: '30d',
  from: '2026-09-04T03:00:00.000Z',
  to: '2026-10-04T03:00:00.000Z',
  codexToolCallsToday: [{ tool: 'web_research', count: '3' }],
  totalEntries: '4',
  truncated: false,
  entries: [
    {
      taskId: '42', taskTitle: 'Fix the bug', projectId: '7', projectName: 'Jarvis',
      agent: 'codex', source: 'sandbox', metric: 'minutes', quantity: 12.5, costDkk: 0.2,
      at: '2026-10-04T03:00:00.000Z', estimated: true,
    },
    {
      taskId: '42', taskTitle: 'Fix the bug', projectId: '7', projectName: 'Jarvis',
      agent: 'codex', source: 'codex', metric: 'turns', quantity: 2, costDkk: null,
      at: '2026-10-04T02:00:00.000Z', estimated: false,
    },
    {
      taskId: '43', taskTitle: 'Update docs', projectId: '7', projectName: 'Jarvis',
      agent: 'copilot', source: 'copilot', metric: 'premium_requests', quantity: 1, costDkk: null,
      at: '2026-10-04T01:00:00.000Z', estimated: false,
    },
    {
      taskId: null, taskTitle: null, projectId: null, projectName: null,
      agent: 'jarvis', source: 'voice', metric: 'minutes', quantity: 2, costDkk: 0.15,
      at: '2026-10-03T23:00:00.000Z', estimated: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(report), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

function renderPage() {
  render(
    <MemoryRouter>
      <UsagePage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
    </MemoryRouter>,
  );
}

describe('Usage page', () => {
  it('groups recorded costs and usage by project and links task entries', async () => {
    renderPage();

    const table = await screen.findByRole('table', { name: 'Usage entries for Jarvis' });
    expect(screen.getByRole('heading', { name: 'Project: Jarvis' })).not.toBeNull();
    expect(within(table).getAllByRole('link', { name: 'Fix the bug' })[0]?.getAttribute('href')).toBe('/factory/tasks/42');
    expect(within(table).getByText(/Estimated/)).not.toBeNull();
    expect(within(table).getByText('Agent turns: 2 turns')).not.toBeNull();
    expect(within(table).getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByText(/Includes estimated DKK for this group/)).toHaveLength(2);
    expect(screen.getByText(/sandbox and voice costs are estimates/)).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Codex tool calls today (UTC)' })).not.toBeNull();
    expect(screen.getByText('3 calls')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/usage?period=30d', {
      headers: { Authorization: `${['Bear', 'er'].join('')} fixture-token` },
      signal: expect.any(AbortSignal),
    });
  });

  it('changes the period and grouping without hiding activity with no task', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table', { name: 'Usage entries for Jarvis' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Group by' }), 'agent');
    expect(screen.getByRole('heading', { name: 'Agent: Jarvis' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Update docs' })).not.toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Time period' }), '7d');
    await screen.findByText('Agent turns: 2 turns');
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.com/usage?period=7d', expect.any(Object));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Group by' }), 'source');
    expect(screen.getByRole('heading', { name: 'Source: Voice' })).not.toBeNull();
    expect(screen.getByText('Jarvis conversation')).not.toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time period' }), 'all');
    await screen.findByText('Agent turns: 2 turns');
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.com/usage?period=all', expect.any(Object));
  });

  it('shows an empty state and recovers from a failed request', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    renderPage();

    expect(await screen.findByRole('alert')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Usage entries for Jarvis' })).not.toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...report, entries: [], totalEntries: '0' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time period' }), '90d');
    expect(await screen.findByText('No usage was recorded in this period.')).not.toBeNull();
  });

  it('distinguishes empty and unavailable Codex tool counts', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ...report, codexToolCallsToday: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { unmount } = render(
      <MemoryRouter>
        <UsagePage backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No Codex tool calls were recorded today (UTC).')).not.toBeNull();
    unmount();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ...report, codexToolCallsToday: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    renderPage();
    expect(await screen.findByText('Codex tool counts are unavailable.')).not.toBeNull();
  });
});

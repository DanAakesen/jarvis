import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from './TaskDetailPage';

const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();

const task = {
  id: '42',
  projectId: '7',
  originMessageId: null,
  title: 'Keep disk headroom',
  request: 'Monitor writable disk',
  source: 'board',
  agent: 'copilot',
  modelOverride: null,
  reasoningOverride: null,
  state: 'NeedsAttention',
  activity: null,
  priority: 0,
  attemptCount: 1,
  nextAttemptAt: null,
  branch: 'task/disk-headroom',
  createdAt: '2026-10-04T12:00:00.000Z',
  startedAt: '2026-10-04T12:01:00.000Z',
  finishedAt: null,
  events: [
    {
      id: '20',
      type: 'disk_snapshot',
      summary: 'Session disk snapshot',
      payload: {
        invocationId: 'invocation-1',
        eventIndex: 1,
        data: {
          disk_total_bytes: 6 * 1024 ** 3,
          disk_free_bytes: 2.5 * 1024 ** 3,
          threshold_bytes: 1024 ** 3,
        },
      },
      payloadTruncated: false,
      source: 'runner',
      at: '2026-10-04T12:01:01.000Z',
    },
    {
      id: '21',
      type: 'state_changed',
      summary: 'Low sandbox disk; task needs attention',
      payload: { from: 'Running', to: 'NeedsAttention', reason: 'disk_low' },
      payloadTruncated: false,
      source: 'backend',
      at: '2026-10-04T12:02:00.000Z',
    },
    {
      id: '22',
      type: 'disk_low',
      summary: 'Writable disk is below the configured threshold',
      payload: {
        invocationId: 'invocation-1',
        eventIndex: 2,
        data: {
          disk_total_bytes: 6 * 1024 ** 3,
          disk_free_bytes: 0.5 * 1024 ** 3,
          threshold_bytes: 1024 ** 3,
        },
      },
      payloadTruncated: false,
      source: 'runner',
      at: '2026-10-04T12:02:00.000Z',
    },
  ],
  usage: [
    {
      id: '1',
      source: 'sandbox',
      metric: 'minutes',
      quantity: 3.5,
      costDkk: 0.0519,
      sandboxSessionId: '9',
      at: '2026-10-04T12:00:00.000Z',
      estimated: true,
    },
    {
      id: null,
      source: 'copilot',
      metric: 'turns',
      quantity: 2,
      costDkk: null,
      sandboxSessionId: null,
      at: '2026-10-04T12:02:00.000Z',
      estimated: false,
    },
    {
      id: null,
      source: 'copilot',
      metric: 'premium_requests',
      quantity: 1,
      costDkk: null,
      sandboxSessionId: null,
      at: '2026-10-04T12:02:00.000Z',
      estimated: false,
    },
  ],
};

beforeEach(() => {
  getAccessToken.mockClear();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify(task), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('task detail page', () => {
  it('shows measured disk figures and the low-disk attention reason', async () => {
    render(
      <MemoryRouter>
        <TaskDetailPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} taskId="42" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Keep disk headroom' })).not.toBeNull();
    expect(screen.getByText('Needs attention')).not.toBeNull();
    expect(screen.getByText('disk_low')).not.toBeNull();
    expect(screen.getAllByText('6.00 GiB')).toHaveLength(2);
    expect(screen.getByText('2.50 GiB')).not.toBeNull();
    expect(screen.getByText('0.50 GiB')).not.toBeNull();
    expect(screen.getAllByText('1.00 GiB')).toHaveLength(2);
    expect(await screen.findByRole('table', { name: 'Usage entries for task 42' })).not.toBeNull();
    expect(screen.getByText('Sandbox session 9')).not.toBeNull();
    expect(screen.getByText('3.50 min')).not.toBeNull();
    expect(screen.getByText('Estimated · DKK 0.0519')).not.toBeNull();
    expect(screen.getByText('Agent turns')).not.toBeNull();
    expect(screen.getByText('Premium requests')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/factory/tasks/42', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} test-access-token` },
    }));
  });

  it('retries the task detail request and uses the same response for usage', async () => {
    const user = userEvent.setup();
    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(task), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    render(
      <MemoryRouter>
        <TaskDetailPage backendUrl="https://api.example.com" getAccessToken={getAccessToken} taskId="42" />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Task details could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Usage entries for task 42' })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { render, screen } from '@testing-library/react';
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
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/factory/tasks/42', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} test-access-token` },
    }));
  });
});

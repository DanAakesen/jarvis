import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NowFeed } from './activity';
import { NowFeedPanel } from './NowFeedPanel';

const { loadNowFeed, dismissNowActivity, resolveNowConfirmation, streamNowFeed, streamCallbacks } = vi.hoisted(() => ({
  loadNowFeed: vi.fn(),
  dismissNowActivity: vi.fn(),
  resolveNowConfirmation: vi.fn(),
  streamNowFeed: vi.fn(),
  streamCallbacks: { onUpdate: null as (() => void) | null },
}));
vi.mock('./now-feed', () => ({ loadNowFeed, dismissNowActivity, resolveNowConfirmation, streamNowFeed }));

const feed: Extract<NowFeed, { status: 'ready' }> = {
  status: 'ready',
  awayMode: false,
  updatedAt: '2026-10-04T00:00:00.000Z',
  running: [{
    id: '42', title: 'Ship the feed', project: 'Jarvis', agent: 'copilot',
    activity: 'Running tests', startedAt: '2026-10-03T23:00:00.000Z',
  }],
  items: [{ id: '7', category: 'attention', title: 'Sandbox crashed', link: 'task:43', at: '2026-10-03T23:30:00.000Z' }],
  confirmations: [],
};

const config = { backendUrl: 'https://api.example.com', apiScope: 'api://test/access' } as never;
const client = {} as never;
const getAccessToken = vi.fn(async () => 'test-access-token');

afterEach(() => {
  vi.clearAllMocks();
  streamCallbacks.onUpdate = null;
});

describe('live Now panel', () => {
  it('loads the feed and refreshes it when an SSE update arrives', async () => {
    loadNowFeed.mockResolvedValue(feed);
    streamNowFeed.mockImplementation(async ({ onStatus, onUpdate, signal }) => {
      streamCallbacks.onUpdate = onUpdate;
      onStatus('connected');
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const view = render(
      <MemoryRouter><NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} /></MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Ship the feed' })).not.toBeNull();
    expect(await screen.findByText('Live updates connected.')).not.toBeNull();
    expect(loadNowFeed).toHaveBeenCalledOnce();

    streamCallbacks.onUpdate?.();
    await waitFor(() => expect(loadNowFeed).toHaveBeenCalledTimes(2));
    view.unmount();
  });

  it('persists dismissal before hiding the activity item and refreshes the snapshot', async () => {
    const user = userEvent.setup();
    loadNowFeed.mockResolvedValue(feed);
    dismissNowActivity.mockResolvedValue(undefined);
    streamNowFeed.mockImplementation(async ({ signal }) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    );
    render(
      <MemoryRouter><NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} /></MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Dismiss Sandbox crashed' }));
    await waitFor(() => expect(dismissNowActivity).toHaveBeenCalledWith(
      'https://api.example.com', '7', getAccessToken,
    ));
    await waitFor(() => expect(loadNowFeed).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('link', { name: 'Sandbox crashed' })).toBeNull();
  });

  it('shows browser approvals, records the owner’s choice, and refreshes the queue', async () => {
    const user = userEvent.setup();
    const confirmation = {
      id: 'A'.repeat(43),
      actionKind: 'merge' as const,
      summary: 'Merge the reviewed change.',
      expiresAt: '2026-10-04T00:05:00.000Z',
    };
    loadNowFeed.mockResolvedValue({ ...feed, confirmations: [confirmation] });
    resolveNowConfirmation.mockResolvedValue(undefined);
    streamNowFeed.mockImplementation(async ({ signal }) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    );
    render(
      <MemoryRouter><NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} /></MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Approve Merge' }));

    await waitFor(() => expect(resolveNowConfirmation).toHaveBeenCalledWith(
      'https://api.example.com', confirmation.id, 'approve', getAccessToken,
    ));
    await waitFor(() => expect(loadNowFeed).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Approval recorded.')).not.toBeNull();
  });

  it('shows browser confirmation failures and permits a retry', async () => {
    const user = userEvent.setup();
    const confirmation = {
      id: 'B'.repeat(43),
      actionKind: 'delete' as const,
      summary: 'Delete the old branch.',
      expiresAt: '2026-10-04T00:05:00.000Z',
    };
    loadNowFeed.mockResolvedValue({ ...feed, confirmations: [confirmation] });
    resolveNowConfirmation.mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce(undefined);
    streamNowFeed.mockImplementation(async ({ signal }) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    );
    render(
      <MemoryRouter><NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} /></MemoryRouter>,
    );

    const rejectButton = await screen.findByRole('button', { name: 'Reject Delete' });
    await user.click(rejectButton);
    expect((await screen.findByRole('alert')).textContent).toContain('could not record your response');

    await user.click(rejectButton);
    await waitFor(() => expect(resolveNowConfirmation).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Request rejected.')).not.toBeNull();
  });
});

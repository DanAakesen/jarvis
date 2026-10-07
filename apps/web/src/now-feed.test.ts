import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeWorkspaceCommand,
  dismissNowActivity,
  loadNowFeed,
  NowFeedStreamError,
  resolveNowConfirmation,
  streamNowFeed,
} from './now-feed';

const fetchMock = vi.fn<typeof fetch>();
const getAccessToken = vi.fn(async () => 'test-access-token');
const payload = {
  awayMode: false,
  confirmations: [],
  running: [{
    id: '42',
    title: 'Ship the feed',
    project: 'Jarvis',
    agent: 'copilot',
    activity: 'Running tests',
    startedAt: '2026-10-03T23:00:00.000Z',
  }],
  items: [{
    id: '9223372036854775807',
    category: 'release',
    title: 'Release complete',
    link: 'release:7',
    at: '2026-10-03T23:30:00.000Z',
  }, {
    id: '43',
    category: 'alert',
    title: 'Sandbox crashed',
    link: 'task:42',
    at: '2026-10-03T23:45:00.000Z',
  }],
  updatedAt: '2026-10-04T00:00:00.000Z',
};

function eventStream(text: string): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Now feed client', () => {
  it('loads and validates the protected feed without rounding SQL bigint IDs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    await expect(loadNowFeed('https://api.example.com/', getAccessToken)).resolves.toMatchObject({
      status: 'ready',
      items: [{ id: '9223372036854775807' }, { id: '43', category: 'alert' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/now', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} test-access-token`, Accept: 'application/json' },
    }));
  });

  it('rejects malformed feed data and authentication failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, running: [{ id: 0 }] }), { status: 200 }));
    await expect(loadNowFeed('https://api.example.com', getAccessToken)).rejects.toThrow('invalid Now feed');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(loadNowFeed('https://api.example.com', getAccessToken)).rejects.toThrow('sign-in needs attention');
  });

  it('posts a dismissal and validates the item ID before requesting it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(dismissNowActivity('https://api.example.com', '7', getAccessToken)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/now/activity/7/dismiss', expect.objectContaining({
      method: 'POST',
    }));

    await expect(dismissNowActivity('https://api.example.com', '7/other', getAccessToken)).rejects.toThrow('Invalid activity ID');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('surfaces a missing activity item without reporting a successful dismissal', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(dismissNowActivity('https://api.example.com', '8', getAccessToken))
      .rejects.toThrow('no longer available');
  });

  it('posts an authenticated browser confirmation and validates its opaque ID', async () => {
    const id = 'A'.repeat(43);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(resolveNowConfirmation('https://api.example.com', id, 'approve', getAccessToken))
      .resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example.com/now/confirmations/${id}`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    }));

    await expect(resolveNowConfirmation('https://api.example.com', `${id}/other`, 'approve', getAccessToken))
      .rejects.toThrow('Invalid confirmation ID');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses authenticated SSE, refreshes on events, and exits on cancellation', async () => {
    fetchMock.mockResolvedValueOnce(eventStream(': heartbeat\n\nevent: now\ndata: {}\n\n'));
    const controller = new AbortController();
    const updates = vi.fn(() => {
      if (updates.mock.calls.length === 2) controller.abort();
    });
    const statuses: string[] = [];

    await streamNowFeed({
      backendUrl: 'https://api.example.com/',
      getAccessToken,
      onUpdate: updates,
      onStatus: (status) => statuses.push(status),
      signal: controller.signal,
    });

    expect(updates).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['connected']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/now/events', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} test-access-token`, Accept: 'text/event-stream' },
    }));
  });

  it('refreshes the feed when away-mode status changes', async () => {
    fetchMock.mockResolvedValueOnce(eventStream('event: mode\ndata: {}\n\n'));
    const controller = new AbortController();
    const updates = vi.fn(() => {
      if (updates.mock.calls.length === 2) controller.abort();
    });

    await streamNowFeed({
      backendUrl: 'https://api.example.com',
      getAccessToken,
      onUpdate: updates,
      onStatus: () => {},
      signal: controller.signal,
    });

    expect(updates).toHaveBeenCalledTimes(2);
  });

  it('forwards presence mode changes from mode_changed events', async () => {
    fetchMock.mockResolvedValueOnce(eventStream('event: mode_changed\ndata: {"mode":"on_the_move","away":true}\n\n'));
    const controller = new AbortController();
    const onPresenceMode = vi.fn();
    const updates = vi.fn(() => { if (updates.mock.calls.length === 2) controller.abort(); });

    await streamNowFeed({
      backendUrl: 'https://api.example.com',
      getAccessToken,
      onUpdate: updates,
      onStatus: () => {},
      onPresenceMode,
      signal: controller.signal,
    });

    expect(onPresenceMode).toHaveBeenCalledWith('on_the_move');
  });
  it('forwards only valid ephemeral Jarvis activity events from SSE', async () => {
    const controller = new AbortController();
    const onActivity = vi.fn(() => controller.abort());
    const activity = {
      type: 'tool-call-finished',
      activityId: '11111111-1111-4111-8111-111111111111',
      source: 'voice',
      toolName: 'workspace_command',
      outcome: 'refused',
    };
    fetchMock.mockResolvedValueOnce(eventStream([
      `event: jarvis-activity\ndata: ${JSON.stringify(activity)}`,
      `event: jarvis-activity\ndata: ${JSON.stringify({ ...activity, arguments: 'private input' })}`,
    ].join('\n\n') + '\n\n'));

    await streamNowFeed({
      backendUrl: 'https://api.example.com',
      getAccessToken,
      onUpdate: () => {},
      onStatus: () => {},
      onActivity,
      signal: controller.signal,
    });

    expect(onActivity).toHaveBeenCalledOnce();
    expect(onActivity).toHaveBeenCalledWith(activity);
  });

  it('delivers only validated workspace commands from the authenticated SSE stream', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc';
    const command = {
      commandId: 'create-view',
      operation: 'create' as const,
      viewId: 'research',
      view: {
        version: 1 as const,
        title: 'Research summary',
        renderer: 'list' as const,
        source: { id: 'factory.tasks' as const, status: 'complete' as const },
        data: { items: [{ title: 'Source-linked finding' }] },
      },
    };
    const controller = new AbortController();
    const ready = vi.fn();
    const received = vi.fn(() => controller.abort());
    fetchMock.mockResolvedValueOnce(eventStream([
      `event: workspace-ready\ndata: ${JSON.stringify({ sessionId })}`,
      `event: workspace-command\ndata: ${JSON.stringify({ command, expiresAt: Date.now() + 5_000 })}`,
    ].join('\n\n') + '\n\n'));

    await streamNowFeed({
      backendUrl: 'https://api.example.com',
      getAccessToken,
      onUpdate: () => {},
      onStatus: () => {},
      onWorkspaceReady: ready,
      onWorkspaceCommand: received,
      signal: controller.signal,
    });

    expect(ready).toHaveBeenCalledWith(sessionId, undefined);
    expect(received).toHaveBeenCalledWith(command, expect.any(Number), undefined);
  });

  it('posts authenticated command acknowledgements and rejects invalid IDs locally', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await acknowledgeWorkspaceCommand(
      'https://api.example.com',
      'command-1',
      '12345678-1234-4234-8234-123456789abc',
      true,
      getAccessToken,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/now/workspace/commands/command-1/ack',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: '12345678-1234-4234-8234-123456789abc', applied: true }),
      }),
    );
    await expect(acknowledgeWorkspaceCommand(
      'https://api.example.com',
      '../other',
      '12345678-1234-4234-8234-123456789abc',
      true,
      getAccessToken,
    )).rejects.toThrow('Invalid workspace command acknowledgement');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retry a denied SSE request', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(streamNowFeed({
      backendUrl: 'https://api.example.com',
      getAccessToken,
      onUpdate: () => {},
      onStatus: () => {},
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(NowFeedStreamError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

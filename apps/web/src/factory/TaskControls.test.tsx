import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskControls } from './TaskControls';

const getAccessToken = vi.fn(async () => 'test-access-token');
const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderControls(state: 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled') {
  const onComplete = vi.fn();
  render(
    <TaskControls
      backendUrl="https://api.example.com"
      getAccessToken={getAccessToken}
      taskId="42"
      state={state}
      onComplete={onComplete}
    />,
  );
  return onComplete;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  getAccessToken.mockClear();
});

describe('task controls', () => {
  it('sends a bounded steering message for a Running task', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(response({ id: '42', state: 'Running' }));
    vi.stubGlobal('fetch', fetchMock);
    const onComplete = renderControls('Running');

    await user.click(screen.getByRole('button', { name: 'Steer' }));
    await user.type(screen.getByRole('textbox', { name: 'Steering message' }), 'Preserve the public API.');
    await user.click(screen.getByRole('button', { name: 'Send steering message' }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42/controls',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `${['Bear', 'er'].join('')} test-access-token` }),
        body: JSON.stringify({ action: 'steer', message: 'Preserve the public API.' }),
      }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Steering message sent.');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith('Running');
  });

  it('recovers a task needing attention and refreshes it as Running', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(response({ id: '42', state: 'Running' }));
    vi.stubGlobal('fetch', fetchMock);
    const onComplete = renderControls('NeedsAttention');

    await user.click(screen.getByRole('button', { name: 'Recover' }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42/controls',
      expect.objectContaining({ body: JSON.stringify({ action: 'recover' }) }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Recovery started');
    expect(onComplete).toHaveBeenCalledWith('Running');
  });

  it('offers only state-valid actions and requires confirmation before cancelling', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(response({ id: '42', state: 'Cancelled' }));
    vi.stubGlobal('fetch', fetchMock);
    renderControls('Ready');

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel task' }));
    expect(screen.getByText('This ends the task and cannot be undone.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm cancel task' }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ action: 'cancel' }) }),
    );
  });

  it('shows pending pause status without actions while the turn is stopping', () => {
    renderControls('PauseRequested');
    expect(screen.getByRole('status').textContent).toContain('Pausing…');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains stale task state when the server rejects a control', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(response({ error: 'conflict' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    renderControls('Paused');

    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The task state changed.');
  });
});

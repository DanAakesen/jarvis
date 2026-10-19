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

function renderControls(
  state: 'Ready' | 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled',
  latestSessionEndReason?: 'done' | 'cancelled' | 'crashed' | 'idle' | 'idle_expired' | null,
) {
  const onComplete = vi.fn();
  render(
    <TaskControls
      backendUrl="https://api.example.com"
      getAccessToken={getAccessToken}
      taskId="42"
      state={state}
      latestSessionEndReason={latestSessionEndReason}
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
    const onComplete = renderControls('NeedsAttention', 'crashed');

    await user.click(screen.getByRole('button', { name: 'Recover' }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42/controls',
      expect.objectContaining({ body: JSON.stringify({ action: 'recover' }) }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Recovery started');
    expect(onComplete).toHaveBeenCalledWith('Running');
  });

  it('continues an idle-expired task from its branch instead of offering crash recovery', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(response({ id: '42', state: 'Running' }));
    vi.stubGlobal('fetch', fetchMock);
    renderControls('NeedsAttention', 'idle_expired');

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/factory/tasks/42/controls',
      expect.objectContaining({ body: JSON.stringify({ action: 'recover' }) }),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Continuation started');
  });

  it('offers Continue alongside the state-valid controls when a Running task has an idle-expired session', () => {
    renderControls('Running', 'idle_expired');

    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Steer' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel task' })).not.toBeNull();
  });

  it('offers Recover only for a crashed task and no continuation for a completed task', () => {
    const { unmount } = render(<TaskControls
      backendUrl="https://api.example.com" getAccessToken={getAccessToken} taskId="42"
      state="NeedsAttention" latestSessionEndReason="done" onComplete={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    unmount();

    renderControls('NeedsAttention', 'crashed');
    expect(screen.getByRole('button', { name: 'Recover' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('does not offer Continue for a Done task with an expired session', () => {
    renderControls('Done', 'idle_expired');

    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
  });

  it('offers only state-valid actions and requires confirmation before cancelling', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(response({ id: '42', state: 'Cancelled' }));
    vi.stubGlobal('fetch', fetchMock);
    renderControls('Ready');

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    const cancelButton = screen.getByRole('button', { name: 'Cancel task' });
    expect(cancelButton.className).toBe('danger-button');
    await user.click(cancelButton);
    expect(screen.getByText('This ends the task and cannot be undone.')).not.toBeNull();
    const confirmButton = screen.getByRole('button', { name: 'Confirm cancel task' });
    expect(confirmButton.className).toBe('danger-button danger-button--filled');
    expect([...confirmButton.parentElement!.querySelectorAll('button')].map((button) => button.textContent))
      .toEqual(['Confirm cancel task', 'Keep task']);
    await user.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ action: 'cancel' }) }),
    );
  });

  it.each([null, 'crashed', 'idle_expired', 'done'] as const)(
    'offers confirmed Cancel for attention without adding steer or resume (%s)', async (endReason) => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(response({ id: '42', state: 'Cancelled' }));
      vi.stubGlobal('fetch', fetchMock);
      const onComplete = renderControls('NeedsAttention', endReason);
      expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
      if (endReason === 'crashed') expect(screen.getByRole('button', { name: 'Recover' })).not.toBeNull();
      if (endReason === 'idle_expired') expect(screen.getByRole('button', { name: 'Continue' })).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Cancel task' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getAccessToken).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Keep task' }));
      expect(fetchMock).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Cancel task' }));
      await user.click(screen.getByRole('button', { name: 'Confirm cancel task' }));
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ action: 'cancel' }) }));
      expect(onComplete).toHaveBeenCalledWith('Cancelled');
      expect((await screen.findByRole('status')).textContent).toContain('Task cancelled.');
    },
  );

  it('keeps recovery and cancellation disabled until attention cleanup finishes, then shows a failure', async () => {
    const user = userEvent.setup();
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const onComplete = renderControls('NeedsAttention', 'crashed');
    await user.click(screen.getByRole('button', { name: 'Cancel task' }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancel task' }));
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Recover' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Keep task' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Cancelling…' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    finish(response({ error: 'Task is Cancelled, but sandbox cleanup could not be completed' }, 502));
    expect((await screen.findByRole('alert')).textContent).toContain('could not complete this action');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm cancel task' })).toHaveProperty('disabled', false);
  });

  it.each(['Done', 'Cancelled'] as const)('offers no cancellation for terminal state %s', (state) => {
    renderControls(state);
    expect(screen.queryByRole('button')).toBeNull();
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

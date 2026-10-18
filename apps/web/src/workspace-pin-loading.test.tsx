import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from './Workspace';
import type { PinnedWorkspaceView, WorkspacePinsClient } from './workspace-pins';

const saved: PinnedWorkspaceView = {
  viewId: 'saved-report',
  pinnedAt: '2026-10-12T20:00:00.000Z',
  view: {
    version: 1, title: 'Saved report', renderer: 'text',
    source: { id: 'research', status: 'complete' },
    data: { format: 'plain', content: 'Previously saved result.' },
  },
};

const client = (load: WorkspacePinsClient['load']): WorkspacePinsClient => ({
  load, pin: vi.fn(), unpin: vi.fn(),
});

describe('workspace pin loading', () => {
  it('restores saved windows as tabs without changing their content or writing storage', async () => {
    const pins = client(vi.fn().mockResolvedValue([saved]));
    render(<Workspace views={[]} pins={pins} />);
    const restore = await screen.findByRole('button', { name: 'Restore Saved report' });
    expect(screen.queryByRole('article', { name: 'Saved report' })).toBeNull();
    fireEvent.click(restore);
    expect(screen.getByText('Previously saved result.')).not.toBeNull();
    expect(pins.pin).not.toHaveBeenCalled();
    expect(pins.unpin).not.toHaveBeenCalled();
  });

  it.each(['online', 'visibilitychange'])('recovers a failed load on visible %s and stops retrying after success', async event => {
    const pins = client(vi.fn().mockRejectedValueOnce(new Error('Connection interrupted.')).mockResolvedValue([saved]));
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<Workspace views={[]} pins={pins} />);
    await screen.findByText('Connection interrupted.');
    act(() => { (event === 'online' ? window : document).dispatchEvent(new Event(event)); });
    expect(pins.load).toHaveBeenCalledOnce();
    visible.mockReturnValue('visible');
    // The retry listener is registered in a passive effect that can land after the failure text; repeat the event until it is heard.
    await waitFor(() => {
      act(() => { (event === 'online' ? window : document).dispatchEvent(new Event(event)); });
      expect(pins.load).toHaveBeenCalledTimes(2);
    });
    await screen.findByRole('button', { name: 'Restore Saved report' });
    expect(screen.queryByText('Connection interrupted.')).toBeNull();
    act(() => { (event === 'online' ? window : document).dispatchEvent(new Event(event)); });
    expect(pins.load).toHaveBeenCalledTimes(2);
    visible.mockRestore();
  });

  it('keeps failure and Retry visible instead of treating an outage as empty saved data', async () => {
    const pins = client(vi.fn().mockRejectedValueOnce(new Error('Storage unavailable.')).mockResolvedValue([saved]));
    render(<Workspace views={[]} pins={pins} />);
    await screen.findByText('Storage unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry pinned windows' }));
    await screen.findByRole('button', { name: 'Restore Saved report' });
    expect(screen.queryByText('Storage unavailable.')).toBeNull();
    expect(pins.load).toHaveBeenCalledTimes(2);
  });

  it('cancels obsolete owners and ignores their late saved-window result', async () => {
    let finish!: (pins: PinnedWorkspaceView[]) => void;
    let signal: AbortSignal | undefined;
    const oldOwner = client(vi.fn(ownerSignal => {
      signal = ownerSignal;
      return new Promise<PinnedWorkspaceView[]>(resolve => { finish = resolve; });
    }));
    const newOwner = client(vi.fn().mockResolvedValue([]));
    const view = render(<Workspace views={[]} pins={oldOwner} />);
    await waitFor(() => expect(oldOwner.load).toHaveBeenCalledOnce());
    view.rerender(<Workspace views={[]} pins={newOwner} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish([saved]); });
    expect(screen.queryByRole('button', { name: 'Restore Saved report' })).toBeNull();
  });
});

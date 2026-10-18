import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AttentionPopover } from './AttentionPopover';
import type { FeedAttention } from './activity';

const items: FeedAttention['items'] = [
  { id: 'attention-1', category: 'attention', title: 'Sandbox crashed', link: 'task:43', at: '2026-10-03T11:50:00Z' },
  { id: 'credential-1', category: 'credential', title: 'Codex login expires', link: null, at: '2026-10-03T09:00:00Z' },
];
const confirmation: NonNullable<FeedAttention>['confirmations'][number] = {
  id: 'confirmation-1', actionKind: 'delete', summary: 'Delete the temporary branch', expiresAt: '2026-10-03T12:05:00Z',
};

function view(attention: FeedAttention | null) {
  return render(<MemoryRouter><AttentionPopover attention={attention} /></MemoryRouter>);
}

describe('attention popover', () => {
  it('hides at zero and names the counted items and confirmations', () => {
    const page = view(null);
    expect(screen.queryByRole('button', { name: /need attention/ })).toBeNull();

    page.rerender(<MemoryRouter><AttentionPopover attention={{ items: [items[0]!], confirmations: [confirmation] }} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: '2 items need attention' });
    expect(trigger.title).toBe('2 items need attention');
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(within(trigger).getByRole('img', { name: '2 items need attention' })).not.toBeNull();
  });

  it('lists linked and unlinked items with times and dismisses through the existing handler', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    view({ items, confirmations: [], onDismiss });
    await user.click(screen.getByRole('button', { name: '2 items need attention' }));

    const popover = screen.getByRole('group', { name: 'Items needing attention' });
    expect(within(popover).getByRole('link', { name: 'Sandbox crashed' }).getAttribute('href')).toBe('/factory/tasks/43');
    expect(within(popover).getByText('Codex login expires')).not.toBeNull();
    expect(within(popover).getAllByRole('time')).toHaveLength(2);
    await user.click(within(popover).getByRole('button', { name: 'Dismiss Sandbox crashed' }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('attention-1'));
    expect(within(popover).queryByRole('link', { name: 'Sandbox crashed' })).toBeNull();
  });

  it('lowers the count and closes when dismissing the last item', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [remaining, setRemaining] = useState<FeedAttention['items']>([items[0]!]);
      const attention: FeedAttention = {
        items: remaining,
        confirmations: [],
        onDismiss: async (id) => setRemaining((current) => current.filter((item) => item.id !== id)),
      };
      return <AttentionPopover attention={attention} />;
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: '1 item needs attention' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Dismiss Sandbox crashed' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Items needing attention' })).toBeNull());
    expect(screen.queryByRole('button', { name: '1 item needs attention' })).toBeNull();
  });

  it.each(['approve', 'reject'] as const)('resolves a pending confirmation with %s', async (decision) => {
    const user = userEvent.setup();
    const onResolveConfirmation = vi.fn().mockResolvedValue(undefined);
    view({ items: [], confirmations: [confirmation], onResolveConfirmation });
    await user.click(screen.getByRole('button', { name: '1 item needs attention' }));
    await user.click(screen.getByRole('button', { name: `${decision === 'approve' ? 'Approve' : 'Reject'} Delete` }));
    await waitFor(() => expect(onResolveConfirmation).toHaveBeenCalledWith('confirmation-1', decision));
  });

  it('closes on Escape and returns focus, and closes on an outside click', async () => {
    const user = userEvent.setup();
    view({ items, confirmations: [] });
    const trigger = screen.getByRole('button', { name: '2 items need attention' });
    await user.click(trigger);
    const popover = screen.getByRole('group', { name: 'Items needing attention' });
    await waitFor(() => expect(popover).toBe(document.activeElement));
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Items needing attention' })).toBeNull();
    expect(trigger).toBe(document.activeElement);

    await user.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Items needing attention' })));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Items needing attention' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps focus on a newer popover when an earlier unmount queued the header focus fallback', async () => {
    const frames: FrameRequestCallback[] = [];
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    try {
      const user = userEvent.setup();
      const earlier = view({ items, confirmations: [] });
      await user.click(screen.getByRole('button', { name: '2 items need attention' }));
      earlier.unmount();
      expect(frames).toHaveLength(1);

      view({ items, confirmations: [] });
      await user.click(screen.getByRole('button', { name: '2 items need attention' }));
      const popover = screen.getByRole('group', { name: 'Items needing attention' });
      await waitFor(() => expect(popover).toBe(document.activeElement));
      frames.forEach((callback) => callback(0));
      expect(popover).toBe(document.activeElement);
    } finally {
      frame.mockRestore();
    }
  });

  it('moves focus to the header when removing the last item drops it to the page', async () => {
    const frames: FrameRequestCallback[] = [];
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    try {
      const user = userEvent.setup();
      function Harness() {
        const [remaining, setRemaining] = useState<FeedAttention['items']>([items[0]!]);
        const attention: FeedAttention = {
          items: remaining,
          confirmations: [],
          onDismiss: async (id) => setRemaining((current) => current.filter((item) => item.id !== id)),
        };
        return <><a className="settings-link" href="/settings">Settings</a><AttentionPopover attention={attention} /></>;
      }
      render(<MemoryRouter><Harness /></MemoryRouter>);
      await user.click(screen.getByRole('button', { name: '1 item needs attention' }));
      await user.click(screen.getByRole('button', { name: 'Dismiss Sandbox crashed' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: '1 item needs attention' })).toBeNull());
      expect(frames).toHaveLength(1);
      frames.forEach((callback) => callback(0));
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Settings' }));
    } finally {
      frame.mockRestore();
    }
  });
});

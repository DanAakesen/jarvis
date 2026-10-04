import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Workspace, type WorkspaceView } from './Workspace';

const views: WorkspaceView[] = [
  { id: 'research', title: 'Research summary', content: { status: 'ready', content: <p>Source-linked findings</p> } },
  { id: 'sources', title: 'Sources', content: { status: 'loading' } },
];

describe('Workspace', () => {
  it('shows an honest empty state without arrangement controls', () => {
    render(<Workspace views={[]} />);

    expect(screen.getByRole('heading', { name: 'Workspace' })).not.toBeNull();
    expect(screen.getByText('No temporary views are open. Views created during this session will appear here.')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Workspace arrangement' })).toBeNull();
  });

  it('supports multiple views, switching layout, keyboard movement and order announcements', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);

    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    expect(within(canvas).getAllByRole('group').map((view) => view.getAttribute('aria-labelledby')))
      .toHaveLength(2);
    expect(screen.getByText('Source-linked findings')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    expect(screen.getByRole('button', { name: 'Layer views' }).getAttribute('aria-pressed')).toBe('true');
    const move = screen.getByRole('button', { name: 'Move Research summary. Use arrow keys to move or reorder.' });
    move.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Research summary moved.').getAttribute('role')).toBe('status');
    expect(within(canvas).getByRole('group', { name: 'Research summary' }).getAttribute('style')).toContain('--workspace-x: 18%');

    await user.click(screen.getByRole('button', { name: 'Send backward Research summary' }));
    expect(within(canvas).getAllByRole('group')[0]?.getAttribute('aria-labelledby')).toContain('view-0');
  });

  it('keeps views added during the active session in the current workspace', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Workspace views={[views[0]!]} />);

    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    rerender(<Workspace views={views} />);

    expect(screen.getByRole('heading', { name: 'Research summary' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Sources' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Layer views' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('reorders tiled views and resizes with the keyboard', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);

    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    await user.click(screen.getByRole('button', { name: 'Move later Research summary' }));
    expect(within(canvas).getAllByRole('group').map((view) => view.textContent?.includes('Research summary')))
      .toEqual([false, true]);

    const resize = screen.getByRole('button', { name: 'Resize Research summary. Use arrow keys to resize.' });
    resize.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(canvas).getByRole('group', { name: 'Research summary' }).getAttribute('style')).toContain('--workspace-columns: 2');
  });

  it('shows empty, loading, error and interrupted states and recovers failed actions', async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockRejectedValue(new Error('private detail'));
    const resume = vi.fn().mockResolvedValue(undefined);
    render(<Workspace views={[
      { id: 'empty', title: 'Empty view', content: { status: 'empty' } },
      { id: 'loading', title: 'Loading view', content: { status: 'loading' } },
      { id: 'error', title: 'Failed view', content: { status: 'error', message: 'The source is unavailable.', retry } },
      { id: 'interrupted', title: 'Interrupted view', content: { status: 'interrupted', message: 'Generation stopped. Some results are available.', content: <p>Partial result</p>, resume } },
    ]} />);

    expect(screen.getByText('This view has no content yet.')).not.toBeNull();
    expect(screen.getByText('Loading view…').getAttribute('role')).toBe('status');
    expect(screen.getByText('The source is unavailable.').getAttribute('role')).toBe('alert');
    expect(screen.getByText('Partial result')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry view' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(await screen.findByText('This view could not continue. Try again.')).not.toBeNull();
    expect(screen.queryByText('private detail')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue view' }));
    expect(resume).toHaveBeenCalledOnce();
    expect(screen.getByText('Continue requested.').getAttribute('role')).toBe('status');
  });

  it('keeps view composition in memory rather than local storage', async () => {
    const user = userEvent.setup();
    const before = window.localStorage.length;
    const { unmount } = render(<Workspace views={views} />);

    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    await user.click(screen.getByRole('button', { name: 'Bring forward Sources' }));
    unmount();

    expect(window.localStorage.length).toBe(before);
  });
});

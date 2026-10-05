import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createRef, useMemo, useRef, useState } from 'react';
import { Workspace, type WorkspaceController, type WorkspaceView } from './Workspace';
import { useWorkspaceCommands, WorkspaceCommandContext } from './workspace-command-state';

const views: WorkspaceView[] = [
  { id: 'research', title: 'Research summary', content: { status: 'ready', content: <p>Source-linked findings</p> } },
  { id: 'sources', title: 'Sources', content: { status: 'loading' } },
];

function JarvisRequestButtons() {
  const workspace = useWorkspaceCommands();
  return (
    <div>
      <button type="button" onClick={() => workspace.dispatch({ operation: 'minimise', viewId: 'research' })}>
        Jarvis minimises Research summary
      </button>
      <button type="button" onClick={() => workspace.dispatch({ operation: 'restore', viewId: 'research' })}>
        Jarvis restores Research summary
      </button>
    </div>
  );
}

function JarvisWorkspaceRequest() {
  const controller = useRef<WorkspaceController>(null);
  const commands = useMemo(() => ({
    dispatch: (command: Parameters<WorkspaceController['dispatch']>[0]) => (
      controller.current?.dispatch(command) ?? false
    ),
    minimiseAll: () => controller.current?.minimiseAll(),
    hasVisibleViews: () => controller.current?.hasVisibleViews() ?? false,
  }), []);
  return (
    <WorkspaceCommandContext.Provider value={commands}>
      <Workspace ref={controller} views={views} />
      <JarvisRequestButtons />
    </WorkspaceCommandContext.Provider>
  );
}

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
    expect(within(canvas).getAllByRole('article').map((view) => view.getAttribute('aria-labelledby')))
      .toHaveLength(2);
    expect(screen.getByText('Source-linked findings')).not.toBeNull();

    await user.click(within(screen.getByRole('heading', { name: 'Workspace' }).parentElement!).getByText('Arrange'));
    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    expect(screen.getByRole('button', { name: 'Layer views' }).getAttribute('aria-pressed')).toBe('true');
    const researchWindow = within(canvas).getByRole('article', { name: 'Research summary' });
    await user.click(within(researchWindow).getByText('Arrange'));
    const move = screen.getByRole('button', { name: 'Move Research summary. Use arrow keys to move or reorder.' });
    move.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Research summary moved.').getAttribute('role')).toBe('status');
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).getAttribute('style')).toContain('--workspace-x: 18%');

    await user.click(screen.getByRole('button', { name: 'Send backward Research summary' }));
    expect(within(canvas).getAllByRole('article')[0]?.getAttribute('aria-labelledby')).toContain('view-0');
  });

  it('keeps views added during the active session in the current workspace', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Workspace views={[views[0]!]} />);

    await user.click(within(screen.getByRole('heading', { name: 'Workspace' }).parentElement!).getByText('Arrange'));
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
    const researchWindow = within(canvas).getByRole('article', { name: 'Research summary' });
    await user.click(within(researchWindow).getByText('Arrange'));
    await user.click(screen.getByRole('button', { name: 'Move later Research summary' }));
    expect(within(canvas).getAllByRole('article').map((view) => view.textContent?.includes('Research summary')))
      .toEqual([false, true]);

    const resize = screen.getByRole('button', { name: 'Resize Research summary. Use arrow keys to resize.' });
    resize.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).getAttribute('style')).toContain('--workspace-columns: 2');
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

    await user.click(within(screen.getByRole('heading', { name: 'Workspace' }).parentElement!).getByText('Arrange'));
    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    const sourcesWindow = screen.getByRole('article', { name: 'Sources' });
    await user.click(within(sourcesWindow).getByText('Arrange'));
    await user.click(screen.getByRole('button', { name: 'Bring forward Sources' }));
    unmount();

    expect(window.localStorage.length).toBe(before);
  });

  it('exposes voice layout state and minimises every visible view into restorable tabs', () => {
    const controller = createRef<WorkspaceController>();
    const onVisibleViewsChange = vi.fn();
    render(<Workspace ref={controller} views={views} onVisibleViewsChange={onVisibleViewsChange} />);

    expect(controller.current?.hasVisibleViews()).toBe(true);
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(true);
    act(() => controller.current?.minimiseAll());

    expect(controller.current?.hasVisibleViews()).toBe(false);
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(false);
    expect(screen.getAllByRole('button', { name: /^Restore /u })).toHaveLength(2);
    act(() => controller.current?.dispatch({ operation: 'restore', viewId: 'research' }));
    expect(controller.current?.hasVisibleViews()).toBe(true);
  });

  it('minimises into a tab, preserves mounted content, and restores focus by keyboard', async () => {
    const user = userEvent.setup();
    function StatefulContent() {
      const [count, setCount] = useState(0);
      return <button type="button" onClick={() => setCount((current) => current + 1)}>Count {count}</button>;
    }
    render(<Workspace views={[
      { id: 'counter', title: 'Counter', content: { status: 'ready', content: <StatefulContent /> } },
    ]} />);

    await user.click(screen.getByRole('button', { name: 'Count 0' }));
    await user.click(screen.getByRole('button', { name: 'Minimise Counter' }));
    const tab = screen.getByRole('button', { name: 'Restore Counter' });
    expect(screen.getByText('Count 1')).not.toBeNull();
    expect(document.querySelector('.workspace-window[aria-hidden="true"]')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(tab);

    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Counter' })).toBe(document.activeElement);
    expect(screen.getByRole('button', { name: 'Count 1' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Minimise Counter' }));
    await user.click(screen.getByRole('button', { name: 'Restore Counter' }));
    expect(screen.getByRole('button', { name: 'Count 1' })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Counter' }));
  });

  it('exposes idempotent Jarvis minimise and restore commands for the active workspace', async () => {
    const user = userEvent.setup();
    render(<JarvisWorkspaceRequest />);

    const minimise = screen.getByRole('button', { name: 'Jarvis minimises Research summary' });
    await user.click(minimise);
    expect(screen.getByRole('button', { name: 'Restore Research summary' })).not.toBeNull();
    await user.click(minimise);

    await user.click(screen.getByRole('button', { name: 'Jarvis restores Research summary' }));
    expect(screen.getByRole('article', { name: 'Research summary' }).hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Jarvis restores Research summary' }));
    await user.click(screen.getByRole('button', { name: 'Jarvis restores Research summary' }));
    expect(screen.queryByRole('button', { name: 'Restore Research summary' })).toBeNull();
  });

  it('handles interrupted commands and title-bar maximise and close actions', async () => {
    const user = userEvent.setup();
    let workspace: WorkspaceController | null = null;
    render(<Workspace ref={(controller) => { workspace = controller; }} views={views} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });

    expect(workspace).not.toBeNull();
    const componentController = workspace!;
    let accepted = false;
    act(() => {
      accepted = componentController!.dispatch({ operation: 'minimise', viewId: 'research' });
      componentController!.dispatch({ operation: 'restore', viewId: 'research' });
      componentController!.dispatch({ operation: 'minimise', viewId: 'research' });
      componentController!.dispatch({ operation: 'restore', viewId: 'research' });
    });
    expect(accepted).toBe(true);
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).hasAttribute('inert')).toBe(false);
    expect(componentController?.dispatch({ operation: 'restore', viewId: 'missing' })).toBe(false);

    expect(screen.getByRole('button', { name: 'Maximise Research summary' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close Research summary' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Maximise Research summary' }));
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).className).toContain('workspace-window-maximized');
    await user.click(screen.getByRole('button', { name: 'Restore size of Research summary' }));
    await user.click(screen.getByRole('button', { name: 'Close Research summary' }));
    expect(within(canvas).queryByRole('article', { name: 'Research summary' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
  });
});

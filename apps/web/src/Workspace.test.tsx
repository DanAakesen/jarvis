import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createRef, useMemo, useRef, useState } from 'react';
import { Workspace, type WorkspaceController, type WorkspaceView } from './Workspace';
import { useWorkspaceCommands, WorkspaceCommandContext } from './workspace-command-state';
import { readFileSync } from 'node:fs';

const views: WorkspaceView[] = [
  { id: 'research', title: 'Research summary', content: { status: 'ready', content: <p>Source-linked findings</p> } },
  { id: 'sources', title: 'Sources', content: { status: 'loading' } },
];

function arrangeTrigger(view: HTMLElement, title: string) {
  return within(view).getByRole('button', { name: `Arrange ${title}` });
}

function JarvisRequestButtons() {
  const workspace = useWorkspaceCommands();
  return (
    <div>
      <button type="button" onClick={() => workspace.dispatch({ commandId: 'jarvis-minimise', operation: 'minimise', viewId: 'research' })}>
        Jarvis minimises Research summary
      </button>
      <button type="button" onClick={() => workspace.dispatch({ commandId: 'jarvis-restore', operation: 'restore', viewId: 'research' })}>
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

  it('keeps each window Arrange control in an overflow beside three lifecycle actions', () => {
    render(<Workspace views={views} />);

    for (const view of views) {
      const window = screen.getByRole('article', { name: view.title });
      const trigger = arrangeTrigger(window, view.title);
      const actions = window.querySelector('.workspace-window-actions')!;

      expect(trigger.getAttribute('aria-label')).toBe(`Arrange ${view.title}`);
      expect(actions.querySelectorAll(':scope > details.workspace-arrange-menu')).toHaveLength(1);
      expect(actions.querySelectorAll(':scope > button.workspace-icon-control')).toHaveLength(3);
    }
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
    await user.click(arrangeTrigger(researchWindow, 'Research summary'));
    const move = screen.getByRole('button', { name: 'Move Research summary. Use arrow keys to move or reorder.' });
    move.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Research summary moved.').getAttribute('role')).toBe('status');
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).getAttribute('style')).toContain('--workspace-x: 12%');

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
    await user.click(arrangeTrigger(researchWindow, 'Research summary'));
    await user.click(screen.getByRole('button', { name: 'Move later Research summary' }));
    expect(within(canvas).getAllByRole('article').map((view) => view.textContent?.includes('Research summary')))
      .toEqual([false, true]);

    const resize = screen.getByRole('button', { name: 'Resize Research summary. Use arrow keys to resize.' });
    resize.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).getAttribute('style')).toContain('--workspace-columns: 2');
  });

  it('keeps keyboard controls in Arrange, describes shortcuts and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);
    const research = screen.getByRole('article', { name: 'Research summary' });
    expect(within(research).getByRole('button', { name: /^Move Research summary\./ }).closest('details')?.open).toBe(false);
    const summary = arrangeTrigger(research, 'Research summary');
    expect(summary.getAttribute('aria-label')).toBe('Arrange Research summary');
    summary.focus();
    await user.keyboard('{Enter}');
    const move = within(research).getByRole('button', { name: /^Move Research summary\./ });
    const resize = within(research).getByRole('button', { name: /^Resize Research/ });
    expect(document.getElementById(move.getAttribute('aria-describedby')!)?.textContent).toContain('Focus Move or Resize, then use arrow keys.');
    move.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('article').map((view) => view.getAttribute('aria-labelledby'))[1])
      .toBe(research.getAttribute('aria-labelledby'));
    expect(document.activeElement).toBe(move);
    resize.focus();
    await user.keyboard('{ArrowDown}');
    expect(research.style.getPropertyValue('--workspace-rows')).toBe('2');
    const documentEscape = vi.fn();
    const listenForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') documentEscape();
    };
    document.addEventListener('keydown', listenForEscape);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', listenForEscape);
    expect(documentEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(summary);
    expect(summary.closest('details')?.open).toBe(false);
    expect(resize.closest('details')?.open).toBe(false);
  });

  it('moves and resizes layered views with arrows and larger Shift steps without jumping on focus', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);
    await user.click(within(screen.getByRole('heading', { name: 'Workspace' }).parentElement!).getByText('Arrange'));
    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    const research = screen.getByRole('article', { name: 'Research summary' });
    await user.click(arrangeTrigger(research, 'Research summary'));
    const move = within(research).getByRole('button', { name: /^Move Research summary\./ });
    move.focus();
    expect(research.style.getPropertyValue('--workspace-x')).toBe('8%');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(research.style.getPropertyValue('--workspace-x')).toBe('18%');
    const resize = within(research).getByRole('button', { name: /^Resize Research/ });
    resize.focus();
    await user.keyboard('{ArrowLeft}{Shift>}{ArrowUp}{/Shift}');
    expect(research.style.getPropertyValue('--workspace-width')).toBe('67%');
    expect(research.style.getPropertyValue('--workspace-height')).toBe('62%');
    expect(document.activeElement).toBe(resize);
  });

  it('drags titles, resizes individual edges and cancels pointer changes', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);
    await user.click(within(screen.getByRole('heading', { name: 'Workspace' }).parentElement!).getByText('Arrange'));
    await user.click(screen.getByRole('button', { name: 'Layer views' }));
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    });
    const research = screen.getByRole('article', { name: 'Research summary' });
    function gesture(target: Element, dx: number, dy: number, cancel = false) {
      Object.defineProperties(target, {
        setPointerCapture: { value: vi.fn(), configurable: true },
        hasPointerCapture: { value: () => true, configurable: true },
        releasePointerCapture: { value: vi.fn(), configurable: true },
      });
      fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
      expect(research.className).toContain('workspace-window-dragging');
      fireEvent.pointerMove(target, { pointerId: 1, clientX: dx, clientY: dy });
      if (cancel) fireEvent.pointerCancel(target, { pointerId: 1 });
      else fireEvent.pointerUp(target, { pointerId: 1, clientX: dx, clientY: dy });
      expect(research.className).not.toContain('workspace-window-dragging');
    }
    gesture(within(research).getByRole('heading'), 100, 50);
    expect(research.style.getPropertyValue('--workspace-x')).toBe('18%');
    expect(research.style.getPropertyValue('--workspace-y')).toBe('18%');
    gesture(research.querySelector('.workspace-resize-edge-right')!, -100, 50);
    expect(research.style.getPropertyValue('--workspace-width')).toBe('62%');
    expect(research.style.getPropertyValue('--workspace-height')).toBe('72%');
    gesture(research.querySelector('.workspace-resize-edge-bottom')!, 100, -50);
    expect(research.style.getPropertyValue('--workspace-width')).toBe('62%');
    expect(research.style.getPropertyValue('--workspace-height')).toBe('62%');
    gesture(within(research).getByRole('heading'), 100, 50, true);
    expect(research.style.getPropertyValue('--workspace-x')).toBe('18%');
    expect(screen.getByText('Arrangement cancelled.')).not.toBeNull();
  });

  it('keeps content available without motion callbacks and disables movement without hiding reduced-motion states', () => {
    render(<Workspace views={views} />);
    expect(screen.getByRole('heading', { name: 'Research summary' })).not.toBeNull();
    expect(screen.getByText('Source-linked findings')).not.toBeNull();
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    expect(workspaceStyles).toContain('display var(--motion-state) allow-discrete');
    expect(workspaceStyles).toContain('@starting-style');
    const visibleWindow = workspaceStyles.match(/\.workspace-window \{([^}]+)\}/)?.[1];
    expect(visibleWindow).toContain('display: flex');
    expect(visibleWindow).not.toMatch(/opacity:\s*0|visibility:\s*hidden/);
    const reducedMotion = workspaceStyles.slice(workspaceStyles.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedMotion).toContain('.workspace-window { transition: none; transform: none; }');
    expect(reducedMotion).toContain('.workspace-tab { animation: none; transition: none; }');
    const reducedWindow = reducedMotion.match(/\.workspace-window \{([^}]+)\}/)?.[1];
    expect(reducedWindow).not.toMatch(/opacity:\s*0|display:\s*none|visibility:\s*hidden/);
  });

  it('bounds Arrange to its window and keeps mobile lifecycle actions in one row with 44px targets', () => {
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    expect(workspaceStyles).toMatch(/\.workspace-window-heading \{\s*position: relative;/);
    expect(workspaceStyles).toContain('.workspace-arrange-menu { position: static; }');
    expect(workspaceStyles).toContain('width: min(300px, 100%); min-width: 0; max-width: 100%;');
    const mobile = workspaceStyles.slice(workspaceStyles.indexOf('@media (max-width: 900px)'));
    expect(mobile).toContain('.workspace-window-heading h3 { flex-basis: 100%; }');
    expect(mobile).toContain('grid-template-columns: repeat(4, 44px); justify-content: end; gap: 4px;');
    expect(mobile).toContain('.workspace-arrange-menu > summary { width: 44px; padding: 0; }');
  });

  it('does not raise an open Arrange window above a different maximised window', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    const raisedSelector = workspaceStyles.match(/([^{}]+)\{\s*z-index: 1001;\s*\}/)?.[1]?.trim();
    expect(raisedSelector).toBe('.workspace-canvas:not(.workspace-canvas-has-maximized) .workspace-window:has(.workspace-arrange-menu[open])');
    const research = screen.getByRole('article', { name: 'Research summary' });
    await user.click(arrangeTrigger(research, 'Research summary'));
    expect(research.matches(raisedSelector!)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Maximise Sources' }));
    expect(research.querySelector('details')?.open).toBe(true);
    expect(research.matches(raisedSelector!)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Restore size of Sources' }));
    expect(research.matches(raisedSelector!)).toBe(true);
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
    await user.click(arrangeTrigger(sourcesWindow, 'Sources'));
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
    act(() => controller.current?.dispatch({ commandId: 'voice-restore', operation: 'restore', viewId: 'research' }));
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
      accepted = componentController!.dispatch({ commandId: 'minimise-1', operation: 'minimise', viewId: 'research' });
      componentController!.dispatch({ commandId: 'restore-1', operation: 'restore', viewId: 'research' });
      componentController!.dispatch({ commandId: 'minimise-2', operation: 'minimise', viewId: 'research' });
      componentController!.dispatch({ commandId: 'restore-2', operation: 'restore', viewId: 'research' });
    });
    expect(accepted).toBe(true);
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).hasAttribute('inert')).toBe(false);
    expect(componentController?.dispatch({ commandId: 'restore-missing', operation: 'restore', viewId: 'missing' })).toBe(false);
    act(() => { componentController.dispatch({ commandId: 'focus-sources-1', operation: 'focus', viewId: 'sources' }); });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
    act(() => { componentController.dispatch({ commandId: 'focus-sources-2', operation: 'focus', viewId: 'sources' }); });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));

    expect(screen.getByRole('button', { name: 'Maximise Research summary' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close Research summary' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Maximise Research summary' }));
    expect(within(canvas).getByRole('article', { name: 'Research summary' }).className).toContain('workspace-window-maximized');
    await user.click(screen.getByRole('button', { name: 'Restore size of Research summary' }));
    await user.click(screen.getByRole('button', { name: 'Close Research summary' }));
    expect(within(canvas).queryByRole('article', { name: 'Research summary' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
  });

  it('creates, updates, arranges, moves, resizes, shows, and closes declarative views in memory', () => {
    let workspace: WorkspaceController | null = null;
    render(<Workspace ref={(controller) => { workspace = controller; }} views={[]} />);
    const dispatch: WorkspaceController['dispatch'] = (command) => workspace!.dispatch(command);
    const initialView = {
      version: 1 as const,
      title: 'Research summary',
      renderer: 'list' as const,
      source: { id: 'factory.tasks' as const, status: 'complete' as const },
      data: { items: [{ title: '<script>not executable</script>' }] },
    };

    act(() => {
      expect(dispatch({
        commandId: 'create-research',
        operation: 'create',
        viewId: 'research',
        view: initialView,
      })).toBe(true);
    });
    let article = screen.getByRole('article', { name: 'Research summary' });
    expect(article.className).toContain('workspace-window-jarvis-updating');
    expect(article.textContent).toContain('<script>not executable</script>');
    expect(document.querySelector('script')).toBeNull();

    act(() => {
      expect(dispatch({
        commandId: 'tile-views',
        operation: 'layout',
        arrangement: 'layered',
      })).toBe(true);
      expect(dispatch({
        commandId: 'move-view',
        operation: 'move',
        viewId: 'research',
        x: 0.1,
        y: 0.12,
      })).toBe(true);
      expect(dispatch({
        commandId: 'resize-view',
        operation: 'resize',
        viewId: 'research',
        x: 0.2,
        y: 0.25,
        width: 0.6,
        height: 0.5,
      })).toBe(true);
    });
    expect(screen.getByRole('region', { name: 'Temporary workspace views' }).getAttribute('data-arrangement')).toBe('layered');
    article = screen.getByRole('article', { name: 'Research summary' });
    expect(article.getAttribute('style')).toContain('--workspace-x: 20%');
    expect(article.getAttribute('style')).toContain('--workspace-width: 60%');

    act(() => {
      expect(dispatch({
        commandId: 'update-research',
        operation: 'update',
        viewId: 'research',
        view: { ...initialView, title: 'Updated research' },
      })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Updated research' })).not.toBeNull();
    expect(screen.getByRole('article', { name: 'Updated research' }).className)
      .toContain('workspace-window-jarvis-updating');
    act(() => { dispatch({ commandId: 'minimise-view', operation: 'minimise', viewId: 'research' }); });
    expect(screen.getByRole('button', { name: 'Restore Updated research' })).not.toBeNull();
    act(() => { expect(dispatch({ commandId: 'show-view', operation: 'show', viewId: 'research' })).toBe(true); });
    expect(screen.getByRole('article', { name: 'Updated research' }).hasAttribute('inert')).toBe(false);

    expect(dispatch({
      commandId: 'invalid-move',
      operation: 'move',
      viewId: 'research',
      x: 0.5,
      y: 0.5,
    })).toBe(false);
    expect(dispatch({
      commandId: 'invalid-id',
      operation: 'close',
      viewId: '../settings',
    } as never)).toBe(false);
    act(() => { expect(dispatch({ commandId: 'close-view', operation: 'close', viewId: 'research' })).toBe(true); });
    expect(screen.queryByRole('article', { name: 'Updated research' })).toBeNull();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef, Profiler, useMemo, useRef, useState } from 'react';
import { PHONE_LAYOUT_MEDIA_QUERY, Workspace, type WorkspaceController, type WorkspaceView } from './Workspace';
import { useWorkspaceCommands, WorkspaceCommandContext } from './workspace-command-state';
import { readFileSync } from 'node:fs';
import type { WorkspacePinsClient } from './workspace-pins';
import { conversationLayoutKey, phoneConversationLayoutKey } from './conversation-layout';
import type { GeneratedView, WorkspacePin } from '@jarvis/contracts';
import type { SessionCommandResult } from './session-commands';

const views: WorkspaceView[] = [
  { id: 'research', title: 'Research summary', content: { status: 'ready', content: <p>Source-linked findings</p> } },
  { id: 'sources', title: 'Sources', content: { status: 'loading' } },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.removeItem(conversationLayoutKey);
  localStorage.removeItem(phoneConversationLayoutKey);
});

function phoneViewport() {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const savedView: GeneratedView = {
  version: 1, title: 'Saved report', renderer: 'text',
  source: { id: 'research', status: 'complete' }, data: { format: 'plain', content: 'Original report' },
};
const savedPin: WorkspacePin = { viewId: 'saved-report', view: savedView, pinnedAt: '2026-10-10T08:00:00.000Z' };

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
  it('keeps a compact camera preview visible beside the foreground phone window, with tab docking and Jarvis commands', () => {
    phoneViewport();
    const ref = createRef<WorkspaceController>();
    const onClose = vi.fn();
    const shown = vi.fn();
    const preview: WorkspaceView = {
      id: 'camera-preview', title: 'Camera preview', presentation: 'camera-preview', onClose,
      content: { status: 'ready', content: <p>Front camera live</p> },
    };
    render(<Workspace ref={ref} views={[views[0]!, preview]} onVisibleViewIdsChange={shown} />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: 'Switch foreground view' })).toBeNull();
    expect(shown).toHaveBeenLastCalledWith(['research', 'camera-preview']);
    expect(ref.current?.isViewVisible?.('camera-preview')).toBe(true);
    const cameraWindow = screen.getByRole('article', { name: 'Camera preview' });
    fireEvent.click(within(cameraWindow).getByRole('button', { name: 'Minimise Camera preview' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    expect(ref.current?.snapshot?.windows.find((window) => window.viewId === 'camera-preview'))
      .toMatchObject({ title: 'Camera preview', state: 'minimised' });
    act(() => { expect(ref.current?.dispatch({ commandId: 'show-preview', operation: 'show', viewId: 'camera-preview' })).toBe(true); });
    expect(cameraWindow.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    act(() => { expect(ref.current?.dispatch({ commandId: 'close-preview', operation: 'close', viewId: 'camera-preview' })).toBe(true); });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('floats shell windows without the Arrange menu and moves them from the title with arrow keys', () => {
    const view: WorkspaceView = { id: 'notes', title: 'A very long research title', content: { status: 'ready', content: <p>Body</p> } };
    render(<Workspace views={[view]} defaultArrangement="layered" arrangeMenu={false} />);

    expect(screen.queryByRole('button', { name: 'Arrange A very long research title' })).toBeNull();
    const title = screen.getByRole('heading', { name: 'A very long research title' });
    expect(title.getAttribute('tabindex')).toBe('0');
    const article = title.closest('article')!;
    const before = Number(article.style.getPropertyValue('--workspace-y-n'));
    fireEvent.keyDown(title, { key: 'ArrowDown' });
    expect(Number(article.style.getPropertyValue('--workspace-y-n'))).toBeGreaterThan(before);
    fireEvent.keyDown(title, { key: 'ArrowRight', altKey: true });
    expect(article.style.getPropertyValue('--workspace-width')).not.toBe('72%');
  });
  it('pins windows as tabs in the shell tab bar and lets their owner close them from the tab', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onClose = vi.fn();
    const pinned: WorkspaceView = { id: 'task-7', title: 'Fix the build', initiallyMinimised: true, onClose,
      content: { status: 'ready', content: <p>Task body</p> } };
    render(<Workspace views={[pinned]} tabsHost={host} />);

    expect(within(host).getByRole('button', { name: 'Restore Fix the build' })).not.toBeNull();
    expect(screen.getByText('Task body').closest('article')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(within(host).getByRole('button', { name: 'Restore Fix the build' }));
    expect(screen.getByText('Task body').closest('article')?.getAttribute('aria-hidden')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minimise Fix the build' }));
    fireEvent.click(within(host).getByRole('button', { name: 'Close Fix the build' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    host.remove();
  });
  it('uses the one-view phone workspace without a foreground-view tab bar', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === PHONE_LAYOUT_MEDIA_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    render(<Workspace views={views} />);

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Switch foreground view' })).toBeNull();
    expect(matchMedia).toHaveBeenCalledWith(PHONE_LAYOUT_MEDIA_QUERY);
  });

  it('opens new phone views in the foreground instead of adding them to a tab bar', () => {
    phoneViewport();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[views[0]!]} />);

    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'create-phone-report',
        operation: 'create',
        viewId: 'phone-report',
        view: { ...savedView, title: 'Phone report' },
      })).toBe(true);
    });

    expect(screen.queryByRole('navigation', { name: 'Switch foreground view' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Phone report' }).getAttribute('aria-hidden')).toBeNull();
  });

  it('bounds retained agent-closed windows and invalidates retained content when an ID is reused', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[]} />);
    const create = (viewId: string, title: string) => act(() => {
      controller.current?.dispatch({
        commandId: `create-${viewId}-${title}`, operation: 'create', viewId,
        view: {
          version: 1, title, renderer: 'list', source: { id: 'factory.tasks', status: 'complete' },
          data: { items: [{ title }] },
        },
      });
    });
    for (let index = 0; index < 9; index++) {
      create(`view-${index}`, `View${index}`);
      act(() => { controller.current?.dispatch({
        commandId: `close-${index}`, operation: 'close', viewId: `view-${index}`,
      }); });
    }
    act(() => { expect(controller.current?.dispatch({
      commandId: 'evicted', operation: 'restore', viewId: 'view-0',
    })).toBe(false); });
    create('view-8', 'Replacement');
    act(() => { expect(controller.current?.dispatch({
      commandId: 'new-content', operation: 'restore', viewId: 'view-8',
    })).toBe(true); });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Replacement' })).not.toBeNull();
  });

  it('restores agent-closed generated content and geometry without generating another view', () => {
    const controller = createRef<WorkspaceController>();
    const view = {
      version: 1 as const, title: 'Board', renderer: 'list' as const,
      source: { id: 'factory.tasks' as const, status: 'complete' as const },
      data: { items: [{ title: 'Existing board content' }] },
    };
    render(<Workspace ref={controller} views={[]} />);
    act(() => { controller.current?.dispatch({ commandId: 'create-board', operation: 'create', viewId: 'board', view }); });
    act(() => { controller.current?.dispatch({
      commandId: 'resize-board', operation: 'resize', viewId: 'board', width: 0.9, height: 0.9, x: 0.05, y: 0.05,
    }); });
    act(() => { controller.current?.dispatch({ commandId: 'close-board', operation: 'close', viewId: 'board' }); });
    expect(screen.queryByText('Existing board content')).toBeNull();
    act(() => { expect(controller.current?.dispatch({
      commandId: 'undo-close', operation: 'restore', viewId: 'board',
    })).toBe(true); });
    expect(screen.getByText('Existing board content')).not.toBeNull();
    expect(screen.getByRole('article', { name: 'Board' }).style.getPropertyValue('--workspace-width')).toBe('90%');
    fireEvent.click(screen.getByRole('button', { name: 'Close Board' }));
    act(() => { expect(controller.current?.dispatch({
      commandId: 'manual-close-restore', operation: 'restore', viewId: 'board',
    })).toBe(false); });
  });

  it('applies an agent resize to tiled spans as well as layered geometry', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} />);
    act(() => { controller.current?.dispatch({
      commandId: 'bigger', operation: 'resize', viewId: 'research', width: 0.9, height: 0.9, x: 0.05, y: 0.05,
    }); });
    const window = screen.getByRole('article', { name: 'Research summary' });
    expect(window.style.getPropertyValue('--workspace-columns')).toBe('2');
    expect(window.style.getPropertyValue('--workspace-rows')).toBe('2');
    expect(window.style.getPropertyValue('--workspace-width')).toBe('90%');
  });

  it('publishes window lifecycle, placement, pin and front state, retaining minimised windows and removing closed ones', () => {
    const onOpenWindowsChange = vi.fn();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} onOpenWindowsChange={onOpenWindowsChange} />);
    expect(onOpenWindowsChange).toHaveBeenLastCalledWith([
      { viewId: 'research', title: 'Research summary', state: 'open', placement: 'auto', pinned: false, front: false },
      { viewId: 'sources', title: 'Sources', state: 'open', placement: 'auto', pinned: false, front: true },
    ]);
    act(() => { controller.current?.dispatch({ commandId: 'minimise', operation: 'minimise', viewId: 'research' }); });
    expect(onOpenWindowsChange).toHaveBeenLastCalledWith([
      { viewId: 'research', title: 'Research summary', state: 'minimised', placement: 'auto', pinned: false, front: false },
      { viewId: 'sources', title: 'Sources', state: 'open', placement: 'auto', pinned: false, front: true },
    ]);
    act(() => { controller.current?.dispatch({ commandId: 'close', operation: 'close', viewId: 'research' }); });
    expect(onOpenWindowsChange).toHaveBeenLastCalledWith([
      { viewId: 'sources', title: 'Sources', state: 'open', placement: 'auto', pinned: false, front: true },
    ]);
  });

  it('restores persistent pins as tabs, keeps them when closed, and removes them only after unpinning', async () => {
    const user = userEvent.setup();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const generated = {
      version: 1 as const,
      title: 'Pinned report',
      renderer: 'text' as const,
      source: { id: 'research' as const, status: 'complete' as const },
      data: { format: 'plain' as const, content: 'Retained result' },
    };
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockResolvedValue([{ viewId: 'pinned-report', view: generated, pinnedAt: '2026-10-10T08:00:00.000Z' }]),
      pin: vi.fn(),
      unpin: vi.fn().mockResolvedValue(undefined),
    };
    render(<Workspace views={[]} tabsHost={host} pins={pins} />);

    const restore = await within(host).findByRole('button', { name: 'Restore Pinned report' });
    expect(restore.querySelector('svg')?.innerHTML).not.toBe(within(host).getByRole('button', { name: 'Unpin Pinned report' }).querySelector('svg')?.innerHTML);
    expect(restore.parentElement?.querySelectorAll('.workspace-tab-pin')).toHaveLength(1);
    expect(within(host).getByRole('button', { name: 'Unpin Pinned report' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(host).queryByRole('button', { name: 'Close Pinned report' })).toBeNull();
    await user.click(restore);
    expect(screen.getByText('Retained result')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close Pinned report to pinned tab' }));
    expect(within(host).getByRole('button', { name: 'Restore Pinned report' })).not.toBeNull();
    await user.click(within(host).getByRole('button', { name: 'Unpin Pinned report' }));
    await waitFor(() => expect(pins.unpin).toHaveBeenCalledWith('pinned-report', expect.any(AbortSignal)));
    await waitFor(() => expect(within(host).getByRole('button', { name: 'Close Pinned report' })).not.toBeNull());
    await user.click(within(host).getByRole('button', { name: 'Close Pinned report' }));
    expect(within(host).queryByRole('button', { name: 'Restore Pinned report' })).toBeNull();
    host.remove();
  });

  it('persists pin commands and reports load and save failures with recovery', async () => {
    const user = userEvent.setup();
    const controller = createRef<WorkspaceController>();
    const generated = {
      version: 1 as const,
      title: 'Live report',
      renderer: 'text' as const,
      source: { id: 'research' as const, status: 'complete' as const },
      data: { format: 'plain' as const, content: 'Current result' },
    };
    const pins: WorkspacePinsClient = {
      load: vi.fn()
        .mockRejectedValueOnce(new Error('Pinned windows could not be loaded. Try again.'))
        .mockResolvedValue([]),
      pin: vi.fn().mockRejectedValue(new Error('You already have 20 pinned windows. Unpin one before pinning another.')),
      unpin: vi.fn(),
    };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    expect(await screen.findByText('Pinned windows could not be loaded. Try again.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry pinned windows' }));
    await waitFor(() => expect(pins.load).toHaveBeenCalledTimes(2));
    act(() => {
      controller.current?.dispatch({ commandId: 'create-live', operation: 'create', viewId: 'live-report', view: generated });
    });
    await act(async () => {
      expect(await controller.current?.applyPin?.({ commandId: 'pin-live', operation: 'pin', viewId: 'live-report' }))
        .toEqual({ applied: false, reason: 'You already have 20 pinned windows. Unpin one before pinning another.' });
    });
    expect((await screen.findByRole('alert')).textContent).toContain('You already have 20 pinned windows.');
    expect(screen.getByRole('button', { name: 'Pin Live report' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('portals pin failures into the page feedback host and keeps retry working', async () => {
    const user = userEvent.setup();
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockRejectedValueOnce(new Error('Synthetic pin failure')).mockResolvedValue([]),
      pin: vi.fn(), unpin: vi.fn(),
    };
    function Harness() {
      const [host, setHost] = useState<HTMLDivElement | null>(null);
      return <><div ref={setHost} data-testid="feedback" /><h1>Current page</h1><div data-testid="overlay"><Workspace views={[]} pins={pins} feedbackHost={host} /></div></>;
    }
    render(<Harness />);
    const alert = await screen.findByRole('alert');
    expect(screen.getByTestId('feedback').contains(alert)).toBe(true);
    expect(screen.getByTestId('overlay').contains(alert)).toBe(false);
    await user.click(within(alert).getByRole('button', { name: 'Retry pinned windows' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(pins.load).toHaveBeenCalledTimes(2);
  });

  it.each(['online', 'visibilitychange'])('recovers failed pin loading on %s without requiring a button click', async event => {
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockRejectedValueOnce(new Error('Connection interrupted.')).mockResolvedValue([]),
      pin: vi.fn(), unpin: vi.fn(),
    };
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<Workspace views={[]} pins={pins} />);
    await screen.findByText('Connection interrupted.');
    act(() => { (event === 'online' ? window : document).dispatchEvent(new Event(event)); });
    expect(pins.load).toHaveBeenCalledOnce();
    visible.mockReturnValue('visible');
    act(() => { (event === 'online' ? window : document).dispatchEvent(new Event(event)); });
    await waitFor(() => expect(pins.load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Connection interrupted.')).toBeNull());
    act(() => { (event === 'online' ? window : document).dispatchEvent(new Event(event)); });
    expect(pins.load).toHaveBeenCalledTimes(2);
    visible.mockRestore();
  });

  it.each(['online', 'visibilitychange'])('hears one %s event sent in the commit that first shows a pin load failure', async event => {
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockRejectedValueOnce(new Error('Connection interrupted.')).mockResolvedValue([]),
      pin: vi.fn(), unpin: vi.fn(),
    };
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let sent = false;
    // Profiler callbacks run in the commit's layout phase, before React can flush passive effects: the earliest moment an event can arrive.
    const onCommit = () => {
      if (sent || !document.body.textContent?.includes('Connection interrupted.')) return;
      sent = true;
      (event === 'online' ? window : document).dispatchEvent(new Event(event));
    };
    render(<Profiler id="workspace" onRender={onCommit}><Workspace views={[]} pins={pins} /></Profiler>);
    await waitFor(() => expect(sent).toBe(true));
    await waitFor(() => expect(pins.load).toHaveBeenCalledTimes(2));
  });

  it('awaits storage before acknowledging pinning, deduplicates requests and prevents closing during a save', async () => {
    const controller = createRef<WorkspaceController>();
    const save = deferred<WorkspacePin>();
    const completed = vi.fn();
    const pins: WorkspacePinsClient = { load: vi.fn().mockResolvedValue([]), pin: vi.fn(() => save.promise), unpin: vi.fn() };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    let result!: Promise<SessionCommandResult>;
    await act(async () => {
      result = controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId });
      void result.then(completed);
      void controller.current!.applyPin!({ commandId: 'pin-again', operation: 'pin', viewId: savedPin.viewId });
    });
    expect(pins.pin).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(controller.current!.snapshot!.windows[0]!.pinned).toBe(false);
    expect(screen.getByRole('button', { name: 'Close Saved report' }).hasAttribute('disabled')).toBe(true);
    act(() => { expect(controller.current!.dispatch({ commandId: 'close-during-save', operation: 'close-all' })).toBe(false); });
    expect(screen.getByRole('article', { name: 'Saved report' })).not.toBeNull();
    await act(async () => { save.resolve(savedPin); expect(await result).toEqual({ applied: true }); });
    expect(completed).toHaveBeenCalledOnce();
    expect(controller.current!.snapshot!.windows[0]!.pinned).toBe(true);
    act(() => { expect(controller.current!.dispatch({ commandId: 'close-saved', operation: 'close', viewId: savedPin.viewId })).toBe(true); });
    expect(controller.current!.snapshot!.windows[0]!.state).toBe('minimised');
  });

  it('reports an unsuccessful save honestly and retries the pin without optimistic state', async () => {
    const user = userEvent.setup();
    const controller = createRef<WorkspaceController>();
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockResolvedValue([]),
      pin: vi.fn().mockRejectedValueOnce(new Error('Pin storage is unavailable.')).mockResolvedValue(savedPin),
      unpin: vi.fn(),
    };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    await act(async () => {
      expect(await controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId }))
        .toEqual({ applied: false, reason: 'Pin storage is unavailable.' });
    });
    expect(controller.current!.snapshot!.windows[0]!.pinned).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Retry pin change' }));
    await waitFor(() => expect(controller.current!.snapshot!.windows[0]!.pinned).toBe(true));
    expect(pins.pin).toHaveBeenCalledTimes(2);
  });

  it('does not minimise an already-open window when a late pin load completes', async () => {
    const load = deferred<WorkspacePin[]>();
    const controller = createRef<WorkspaceController>();
    const pins: WorkspacePinsClient = { load: vi.fn(() => load.promise), pin: vi.fn(), unpin: vi.fn() };
    render(<Workspace ref={controller} views={[{
      id: savedPin.viewId, title: savedView.title, content: { status: 'generated', view: savedView },
    }]} pins={pins} />);
    await act(async () => { load.resolve([savedPin]); });
    expect(screen.getByRole('article', { name: 'Saved report' })).not.toBeNull();
    expect(controller.current!.snapshot!.windows[0]).toMatchObject({ state: 'open', pinned: true });
  });

  it('can unpin a saved generated view when its ID is now occupied by a page-owned window', async () => {
    const user = userEvent.setup();
    const pins: WorkspacePinsClient = { load: vi.fn().mockResolvedValue([savedPin]), pin: vi.fn(), unpin: vi.fn().mockResolvedValue(undefined) };
    render(<Workspace views={[{
      id: savedPin.viewId, title: 'Current task', content: { status: 'ready', content: <p>Current source content</p> },
    }]} pins={pins} />);
    await user.click(await screen.findByRole('button', { name: 'Unpin Current task' }));
    await waitFor(() => expect(pins.unpin).toHaveBeenCalledWith(savedPin.viewId, expect.any(AbortSignal)));
    expect(screen.getByText('Current source content')).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unpin Current task' })).toBeNull());
    expect(pins.pin).not.toHaveBeenCalled();
  });

  it('does not resurrect a pin when a retry load began during an unpin that has since completed', async () => {
    const user = userEvent.setup();
    const load = deferred<WorkspacePin[]>();
    const remove = deferred<void>();
    const controller = createRef<WorkspaceController>();
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockRejectedValueOnce(new Error('Load failed.')).mockImplementationOnce(() => load.promise),
      pin: vi.fn().mockResolvedValue(savedPin), unpin: vi.fn(() => remove.promise),
    };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    await screen.findByText('Load failed.');
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    await act(async () => { await controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId }); });
    let result!: Promise<SessionCommandResult>;
    await act(async () => { result = controller.current!.applyPin!({ commandId: 'unpin-saved', operation: 'unpin', viewId: savedPin.viewId }); });
    await user.click(screen.getByRole('button', { name: 'Retry pinned windows' }));
    await act(async () => { remove.resolve(); await result; });
    await act(async () => { load.resolve([savedPin]); });
    expect(controller.current!.snapshot!.windows[0]).toMatchObject({ state: 'open', pinned: false });
  });

  it('ignores a stale load after a confirmed pin and unpin in the current workspace', async () => {
    const load = deferred<WorkspacePin[]>();
    const controller = createRef<WorkspaceController>();
    const pins: WorkspacePinsClient = { load: vi.fn(() => load.promise), pin: vi.fn().mockResolvedValue(savedPin), unpin: vi.fn().mockResolvedValue(undefined) };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    await act(async () => { await controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId }); });
    await act(async () => { await controller.current!.applyPin!({ commandId: 'unpin-saved', operation: 'unpin', viewId: savedPin.viewId }); });
    await act(async () => { load.resolve([savedPin]); });
    expect(controller.current!.snapshot!.windows[0]).toMatchObject({ state: 'open', pinned: false });
    expect(screen.getByRole('article', { name: 'Saved report' })).not.toBeNull();
  });

  it('coalesces a pinned-window update into the save before its acknowledgement completes', async () => {
    const first = deferred<WorkspacePin>();
    const latest = deferred<WorkspacePin>();
    const controller = createRef<WorkspaceController>();
    const completed = vi.fn();
    const revised: GeneratedView = { ...savedView, title: 'Updated report', renderer: 'text', data: { format: 'plain', content: 'Revised result' } };
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockResolvedValue([]),
      pin: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise), unpin: vi.fn(),
    };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    let result!: Promise<SessionCommandResult>;
    await act(async () => {
      result = controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId });
      void result.then(completed);
    });
    act(() => { controller.current!.dispatch({ commandId: 'revise-saved', operation: 'update', viewId: savedPin.viewId, view: revised }); });
    await act(async () => { first.resolve(savedPin); });
    expect(pins.pin).toHaveBeenNthCalledWith(2, savedPin.viewId, revised, expect.any(AbortSignal));
    expect(completed).not.toHaveBeenCalled();
    await act(async () => { latest.resolve({ ...savedPin, view: revised }); await result; });
    expect(completed).toHaveBeenCalledWith({ applied: true });
    expect(controller.current!.snapshot!.windows[0]).toMatchObject({ title: 'Updated report', pinned: true });
  });

  it('keeps the window usable and offers recovery when refreshing its saved pin fails', async () => {
    const user = userEvent.setup();
    const controller = createRef<WorkspaceController>();
    const revised: GeneratedView = { ...savedView, renderer: 'text', data: { format: 'plain', content: 'Revised result' } };
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockResolvedValue([]),
      pin: vi.fn().mockResolvedValueOnce(savedPin).mockRejectedValueOnce(new Error('Storage unavailable.')).mockResolvedValue({ ...savedPin, view: revised }),
      unpin: vi.fn(),
    };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    await act(async () => { await controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId }); });
    act(() => { controller.current!.dispatch({ commandId: 'revise-saved', operation: 'update', viewId: savedPin.viewId, view: revised }); });
    expect(await screen.findByText(/saved pin update could not be confirmed/u)).not.toBeNull();
    expect(screen.getByText('Revised result')).not.toBeNull();
    expect(controller.current!.snapshot!.windows[0]!.pinned).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Retry pin change' }));
    await waitFor(() => expect(pins.pin).toHaveBeenCalledTimes(3));
    expect(pins.pin).toHaveBeenLastCalledWith(savedPin.viewId, revised, expect.any(AbortSignal));
  });

  it('cancels pending pin actions when their workspace unmounts and never acknowledges a late success', async () => {
    const save = deferred<WorkspacePin>();
    const controller = createRef<WorkspaceController>();
    const pins: WorkspacePinsClient = { load: vi.fn().mockResolvedValue([]), pin: vi.fn(() => save.promise), unpin: vi.fn() };
    const rendered = render(<Workspace ref={controller} views={[]} pins={pins} />);
    act(() => { controller.current!.dispatch({ commandId: 'create-saved', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    let result!: Promise<SessionCommandResult>;
    await act(async () => { result = controller.current!.applyPin!({ commandId: 'pin-saved', operation: 'pin', viewId: savedPin.viewId }); });
    const signal = vi.mocked(pins.pin).mock.calls[0]![2]!;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
    expect(await result).toMatchObject({ applied: false });
    save.resolve(savedPin);
    await Promise.resolve();
  });

  it('reports partial completion if a window changes during an unsuccessful unpin', async () => {
    const remove = deferred<void>();
    const controller = createRef<WorkspaceController>();
    const revised: GeneratedView = { ...savedView, renderer: 'text', data: { format: 'plain', content: 'Latest result' } };
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockResolvedValue([savedPin]), pin: vi.fn(), unpin: vi.fn(() => remove.promise),
    };
    render(<Workspace ref={controller} views={[]} pins={pins} />);
    await screen.findByRole('button', { name: 'Restore Saved report' });
    act(() => { controller.current!.dispatch({ commandId: 'restore-saved', operation: 'restore', viewId: savedPin.viewId }); });
    let result!: Promise<SessionCommandResult>;
    await act(async () => { result = controller.current!.applyPin!({ commandId: 'unpin-saved', operation: 'unpin', viewId: savedPin.viewId }); });
    act(() => { controller.current!.dispatch({ commandId: 'update-during-unpin', operation: 'update', viewId: savedPin.viewId, view: revised }); });
    await act(async () => { remove.reject(new Error('Storage unavailable.')); await result; });
    expect(screen.getByRole('alert').textContent).toContain('saved pin update could not be confirmed');
    expect(screen.getByText('Latest result')).not.toBeNull();
    expect(controller.current!.snapshot!.windows[0]!.pinned).toBe(true);
  });

  it('renders a restored private image with the host validated by the pin client', async () => {
    const user = userEvent.setup();
    const image: GeneratedView = { ...savedView, renderer: 'image', data: {
      images: [{ url: 'https://jarvisimages.blob.core.windows.net/images/result.png?sv=test', alt: 'Saved result image' }],
    } };
    const pins: WorkspacePinsClient = {
      load: vi.fn().mockResolvedValue([{ ...savedPin, view: image, trustedBlobHost: 'jarvisimages.blob.core.windows.net' }]),
      pin: vi.fn(), unpin: vi.fn(),
    };
    render(<Workspace views={[]} pins={pins} />);
    await user.click(await screen.findByRole('button', { name: 'Restore Saved report' }));
    expect(screen.getByRole('img', { name: 'Saved result image' }).getAttribute('src'))
      .toBe('https://jarvisimages.blob.core.windows.net/images/result.png?sv=test');
    expect(screen.queryByText('This generated view is invalid.')).toBeNull();
  });

  it('keeps one phone view foreground, retains state and supports workspace focus commands', async () => {
    phoneViewport();
    const user = userEvent.setup();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[
      { ...views[0]!, content: { status: 'ready', content: <input aria-label="Research note" defaultValue="Original" /> } },
      views[1]!,
    ]} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByRole('article', { name: 'Sources' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Switch foreground view' })).toBeNull();
    expect(screen.queryByText('Arrange')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Research note' }), ' retained');
    act(() => {
      expect(controller.current?.dispatch({ commandId: 'focus-sources', operation: 'focus', viewId: 'sources' })).toBe(true);
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
    expect(document.querySelector('article[hidden]')?.hasAttribute('inert')).toBe(true);
    act(() => {
      expect(controller.current?.dispatch({ commandId: 'focus-research', operation: 'focus', viewId: 'research' })).toBe(true);
    });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Research summary' }));
    expect((screen.getByRole('textbox', { name: 'Research note' }) as HTMLInputElement).value).toBe('Original retained');
  });

  it.each(['page', 'agent', 'mixed'] as const)('foregrounds phone %s views through existing commands without changing desktop order and falls back after close/minimise', async (source) => {
    phoneViewport();
    const user = userEvent.setup();
    const controller = createRef<WorkspaceController>();
    const onVisibleViewsChange = vi.fn();
    const pageViews = source === 'page' ? views : source === 'mixed' ? views.slice(0, 1) : [];
    render(<Workspace ref={controller} views={pageViews} onVisibleViewsChange={onVisibleViewsChange} />);
    for (const view of views.slice(pageViews.length)) {
      act(() => {
        expect(controller.current?.dispatch({
          commandId: `create-${view.id}`, operation: 'create', viewId: view.id,
          view: {
            version: 1, title: view.title, renderer: 'list',
            source: { id: 'factory.tasks', status: 'complete' },
            data: { items: [{ title: `${view.title} content` }] },
          },
        })).toBe(true);
      });
    }
    act(() => { expect(controller.current?.dispatch({ commandId: 'focus-sources', operation: 'focus', viewId: 'sources' })).toBe(true); });
    expect(screen.getByRole('article').getAttribute('aria-labelledby')).toContain('view-1');
    expect(screen.getByText('Sources foreground.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Minimise Sources' }));
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore Sources' }));
    await user.click(screen.getByRole('button', { name: 'Restore Sources' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
    await user.click(screen.getByRole('button', { name: 'Close Sources' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Research summary' }));
    act(() => { controller.current?.minimiseAll(); });
    expect(controller.current?.hasVisibleViews()).toBe(false);
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(false);
    act(() => { expect(controller.current?.dispatch({ commandId: 'restore-research', operation: 'restore', viewId: 'research' })).toBe(true); });
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Research summary' }));
    act(() => { expect(controller.current?.dispatch({ commandId: 'focus-missing', operation: 'focus', viewId: 'missing' })).toBe(false); });
    act(() => { expect(controller.current?.dispatch({ commandId: 'close-research', operation: 'close', viewId: 'research' })).toBe(true); });
    expect(screen.queryByRole('article')).toBeNull();
    expect(controller.current?.hasVisibleViews()).toBe(false);
    expect(onVisibleViewsChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Workspace' }));
  });

  it('falls back from a closed page view to an updated agent view and announces its current title', () => {
    phoneViewport();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[views[0]!]} />);
    const generatedView = {
      version: 1 as const, title: 'Agent sources', renderer: 'list' as const,
      source: { id: 'factory.tasks' as const, status: 'complete' as const },
      data: { items: [{ title: 'Agent findings' }] },
    };
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'create-agent', operation: 'create', viewId: 'agent', view: generatedView,
      })).toBe(true);
    });
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'show-agent', operation: 'show', viewId: 'agent',
      })).toBe(true);
    });
    expect(screen.getByText('Agent sources foreground.')).not.toBeNull();
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'update-agent', operation: 'update', viewId: 'agent',
        view: { ...generatedView, title: 'Updated sources' },
      })).toBe(true);
    });
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'show-page', operation: 'show', viewId: 'research',
      })).toBe(true);
    });
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'close-page', operation: 'close', viewId: 'research',
      })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Updated sources' }).hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Updated sources' }));
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'focus-agent', operation: 'focus', viewId: 'agent',
      })).toBe(true);
    });
    expect(screen.getByText('Updated sources foreground.')).not.toBeNull();
  });

  it('switches phone views on horizontal touch swipes but ignores scrolling, controls, small movements and cancellation', () => {
    phoneViewport();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    function swipe(target: Element, dx: number, dy = 0, cancel = false) {
      fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 150, clientY: 100 });
      if (cancel) fireEvent.pointerCancel(canvas, { pointerId: 1 });
      else fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 150 + dx, clientY: 100 + dy });
    }
    const content = screen.getByText('Source-linked findings');
    swipe(content, -20);
    swipe(content, -70, 90);
    swipe(content, -70, 0, true);
    swipe(screen.getByRole('button', { name: 'Close Research summary' }), -70);
    Object.defineProperties(content, { scrollWidth: { value: 500, configurable: true }, clientWidth: { value: 200, configurable: true } });
    swipe(content, -70);
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    Object.defineProperty(content, 'scrollWidth', { value: 0 });
    swipe(content, -70);
    expect(screen.getByRole('article', { name: 'Sources' })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
    swipe(screen.getByText('Loading view.'), -70);
    expect(screen.getByRole('article', { name: 'Sources' })).not.toBeNull();
    swipe(screen.getByText('Loading view.'), 70);
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
  });

  it('preserves desktop ordering across phone focus and a viewport resize', () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} />);
    act(() => { expect(controller.current?.dispatch({ commandId: 'focus-sources', operation: 'focus', viewId: 'sources' })).toBe(true); });
    act(() => {
      media.matches = false;
      media.addEventListener.mock.calls.forEach(([, listener]) => listener());
    });
    expect(screen.getAllByRole('article').map((view) => view.getAttribute('aria-labelledby')))
      .toEqual([expect.stringContaining('view-0'), expect.stringContaining('view-1')]);
    expect(screen.getByRole('heading', { name: 'Research summary' })).not.toBeNull();
  });

  it('keeps the desktop view being edited foreground and retains input focus when entering phone width', () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    render(<Workspace views={[
      views[0]!,
      { ...views[1]!, content: { status: 'ready', content: <input aria-label="Source note" defaultValue="Retained" /> } },
    ]} />);
    const input = screen.getByRole('textbox', { name: 'Source note' });
    input.focus();
    act(() => {
      media.matches = true;
      media.addEventListener.mock.calls.forEach(([, listener]) => listener());
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Sources' })).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('article', { name: 'Research summary' })).toBeNull();
  });

  it('reserves phone content space above the voice dock even without an open window', () => {
    const styles = readFileSync('src/ConversationHistory.css', 'utf8');
    const phone = styles.slice(styles.indexOf('@media (max-width: 700px)'));
    const statusStyles = readFileSync('src/VoiceControls.css', 'utf8');
    expect(statusStyles).toContain('.voice-status-region { bottom: calc(var(--phone-dock-bottom) + var(--phone-dock-height) + 12px); }');
    expect(phone).toContain('--phone-dock-height: var(--voice-bar-height, 60px);');
    expect(phone).toContain('.app-shell[data-phone="true"][data-voice-active="true"] { --dock-space: var(--voice-dock-top); }');
    expect(phone).toContain('[data-voice-has-windows="true"] .voice-bar { bottom: var(--phone-dock-bottom);');
    expect(phone).not.toContain('voice-orb');
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    expect(workspaceStyles).toContain('.workspace-window[hidden] { display: none; transition: none; }');
    expect(workspaceStyles).toContain('.workspace[data-phone="true"] .workspace-view-content { touch-action: pan-y pinch-zoom; }');
  });

  it('shows an honest empty state without arrangement controls', () => {
    render(<Workspace views={[]} />);

    expect(screen.getByRole('heading', { name: 'Workspace' })).not.toBeNull();
    expect(screen.getByText('No views are open.')).not.toBeNull();
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
    const arrangeDetails = summary.closest('details')!;
    arrangeDetails.open = true;
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
    fireEvent.keyDown(resize, { key: 'Escape' });
    expect(documentEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(summary);
    expect(arrangeDetails.open).toBe(false);
    expect(resize.closest('details')?.open).toBe(false);
    const closedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(summary, closedEscape);
    document.removeEventListener('keydown', listenForEscape);
    expect(closedEscape.defaultPrevented).toBe(false);
    expect(documentEscape).toHaveBeenCalledOnce();
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

  it.each(['mouse', 'touch'])('resizes desktop conversation height without first-drag jumps using %s, including cancellation', pointerType => {
    render(<Workspace views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Conversation history</p> },
    }]} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}),
    });
    vi.spyOn(conversation, 'getBoundingClientRect').mockImplementation(() => {
      const placed = conversation.hasAttribute('data-conversation-positioned');
      const x = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-x')) * 10 : 130;
      const y = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-y')) * 6 : 280;
      const width = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-width')) * 10 : 740;
      const height = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-height')) * 6 : 320;
      return { x, y, top: y, left: x, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) };
    });
    const height = () => parseFloat(conversation.style.getPropertyValue('--workspace-height')) * 6;
    const handle = within(conversation).getByRole('button', { name: 'Resize Conversation height' });
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: () => true, configurable: true },
      releasePointerCapture: { value: vi.fn(), configurable: true },
    });
    const start = { pointerId: 1, button: pointerType === 'touch' ? -1 : 0, pointerType, clientX: 400, clientY: 280 };
    fireEvent.pointerDown(handle, start);
    expect(height()).toBeCloseTo(320, 0);
    fireEvent.pointerMove(handle, { ...start, clientY: 279 });
    expect(height()).toBeCloseTo(321, 0);
    fireEvent.pointerMove(handle, { ...start, clientX: 500, clientY: 80 });
    expect(height()).toBeCloseTo(520, 0);
    expect(conversation.style.getPropertyValue('--workspace-width')).toBe('74%');
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(conversation.hasAttribute('data-conversation-positioned')).toBe(false);
    expect(localStorage.getItem(conversationLayoutKey)).toBeNull();
    expect(conversation.classList.contains('workspace-window-dragging')).toBe(false);

    fireEvent.pointerDown(handle, start);
    fireEvent.pointerMove(handle, { ...start, clientY: -1000 });
    expect(height()).toBeCloseTo(600, 0);
    fireEvent.pointerUp(handle, { ...start, clientY: -1000 });
    fireEvent.pointerDown(handle, start);
    fireEvent.pointerMove(handle, { ...start, clientY: 1000 });
    expect(height()).toBeCloseTo(160, 0);
    fireEvent.pointerUp(handle, { ...start, clientY: 1000 });

    fireEvent.pointerDown(handle, start);
    fireEvent.pointerMove(handle, { ...start, clientY: 200 });
    const beforeSecondPointer = height();
    fireEvent.pointerDown(handle, { ...start, pointerId: 2 });
    fireEvent.pointerMove(handle, { ...start, pointerId: 2, clientY: -1000 });
    expect(height()).toBe(beforeSecondPointer);
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    expect(height()).toBeCloseTo(160, 0);
    expect(conversation.classList.contains('workspace-window-dragging')).toBe(false);
  });

  it.each([[390, 844], [320, 700]])('resizes phone chat by touch at %ix%i without changing desktop geometry', (width, height) => {
    phoneViewport();
    const canvasWidth = width - 16;
    const canvasHeight = height - 160;
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: new DOMRect(0, 0, canvasWidth, canvasHeight),
          borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this);
      }
      unobserve() {}
      disconnect() {}
    });
    const desktop = JSON.stringify({ x: .1, y: .2, width: .8, height: .6, size: { width: 1000, height: 600 } });
    localStorage.setItem(conversationLayoutKey, desktop);
    const fixture: WorkspaceView[] = [{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Conversation history</p> },
    }];
    const anchor = vi.fn();
    const rendered = render(<Workspace views={fixture} onConversationPositionChange={anchor} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, canvasWidth, canvasHeight));
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    const chatHeight = () => parseFloat(conversation.style.getPropertyValue('--conversation-height')) || 300;
    vi.spyOn(conversation, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, canvasHeight - chatHeight(), canvasWidth, chatHeight()));
    const handle = within(conversation).getByRole('button', { name: 'Resize Conversation height' });
    expect(handle.className).toBe('conversation-resize-handle');
    expect(conversation.querySelector('.conversation-resize-border')).toBeNull();
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(handle, {
      setPointerCapture: { value: capture, configurable: true },
      hasPointerCapture: { value: () => true, configurable: true },
      releasePointerCapture: { value: release, configurable: true },
    });
    const start = { pointerId: 1, button: -1, pointerType: 'touch', clientX: width / 2, clientY: canvasHeight - 300 };
    fireEvent.pointerDown(handle, start);
    expect(capture).toHaveBeenCalledWith(1);
    expect(chatHeight()).toBeCloseTo(300);
    fireEvent.pointerMove(handle, { ...start, clientY: start.clientY - 80 });
    expect(chatHeight()).toBeCloseTo(380);
    fireEvent.pointerMove(handle, { ...start, pointerId: 2, clientY: -2000 });
    expect(chatHeight()).toBeCloseTo(380);
    fireEvent.pointerCancel(handle, start);
    expect(chatHeight()).toBe(300);
    expect(localStorage.getItem(phoneConversationLayoutKey)).toBeNull();
    expect(conversation.classList.contains('workspace-window-dragging')).toBe(false);

    fireEvent.pointerDown(handle, start);
    fireEvent.pointerMove(handle, { ...start, clientY: -2000 });
    expect(chatHeight()).toBeCloseTo(canvasHeight);
    fireEvent.pointerUp(handle, start);
    expect(release).toHaveBeenCalledWith(1);
    const saved = localStorage.getItem(phoneConversationLayoutKey);
    expect(saved).not.toBeNull();
    fireEvent.pointerDown(handle, start);
    fireEvent.pointerMove(handle, { ...start, clientY: 2000 });
    expect(chatHeight()).toBeCloseTo(160);
    fireEvent.lostPointerCapture(handle, start);
    expect(chatHeight()).toBeCloseTo(canvasHeight);
    expect(localStorage.getItem(phoneConversationLayoutKey)).toBe(saved);

    handle.focus();
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(chatHeight()).toBeCloseTo(160);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(chatHeight()).toBeCloseTo(192);
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(chatHeight()).toBeCloseTo(256);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(chatHeight()).toBeCloseTo(224);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(chatHeight()).toBeCloseTo(224);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(chatHeight()).toBeCloseTo(canvasHeight);
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(chatHeight()).toBeCloseTo(224);
    expect(document.activeElement).toBe(handle);
    expect(conversation.hasAttribute('data-conversation-positioned')).toBe(false);
    expect(anchor).toHaveBeenLastCalledWith(null);
    expect(localStorage.getItem(conversationLayoutKey)).toBe(desktop);

    rendered.unmount();
    render(<Workspace views={fixture} defaultArrangement="layered" arrangeMenu={false} />);
    const restored = screen.getByRole('article', { name: 'Conversation' });
    expect(parseFloat(restored.style.getPropertyValue('--conversation-height'))).toBeCloseTo(224);
  });

  it('reports phone resize storage failure without changing the desktop preference', () => {
    phoneViewport();
    render(<Workspace views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Conversation history</p> },
    }]} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 374, 600));
    vi.spyOn(conversation, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 300, 374, 300));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    fireEvent.keyDown(within(conversation).getByRole('button', { name: 'Resize Conversation height' }), { key: 'ArrowUp' });
    expect(screen.getByRole('alert').textContent).toContain('Chat layout could not be saved');
    expect(localStorage.getItem(conversationLayoutKey)).toBeNull();
  });

  it.each([
    ['top', 10, 20, 60, 380 / 6],
    ['right', 10, 100 / 6, 62, 400 / 6],
    ['bottom', 10, 100 / 6, 60, 70],
    ['left', 12, 100 / 6, 58, 400 / 6],
    ['top-left', 12, 20, 58, 380 / 6],
    ['top-right', 10, 20, 62, 380 / 6],
    ['bottom-left', 12, 100 / 6, 58, 70],
    ['bottom-right', 10, 100 / 6, 62, 70],
  ])('keeps desktop %s border pointer resizing available', (edge, x, y, width, height) => {
    render(<Workspace views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Conversation history</p> },
    }]} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
    vi.spyOn(conversation, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 600, 400));
    expect(conversation.querySelectorAll('.conversation-resize-border')).toHaveLength(8);
    expect(conversation.querySelector('.conversation-resize-handle')).toBeNull();
    const border = conversation.querySelector(`.conversation-resize-border-${edge}`)!;
    Object.defineProperties(border, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: () => true, configurable: true },
      releasePointerCapture: { value: vi.fn(), configurable: true },
    });
    fireEvent.pointerDown(border, { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(border, { pointerId: 1, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(border, { pointerId: 1 });
    for (const [property, expected] of Object.entries({ x, y, width, height })) {
      expect(parseFloat(conversation.style.getPropertyValue(`--workspace-${property}`))).toBeCloseTo(Number(expected), 1);
    }
    expect(localStorage.getItem(conversationLayoutKey)).not.toBeNull();
  });

  it('resizes conversation with keys and saves it through maximise, minimise and remount', () => {
    const fixture: WorkspaceView[] = [{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Conversation history</p> },
    }];
    const rendered = render(<Workspace views={fixture} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}),
    });
    vi.spyOn(conversation, 'getBoundingClientRect').mockReturnValue({
      x: 130, y: 280, top: 280, left: 130, right: 870, bottom: 600, width: 740, height: 320, toJSON: () => ({}),
    });
    const handle = within(conversation).getByRole('button', { name: 'Resize Conversation height' });
    const height = () => parseFloat(conversation.style.getPropertyValue('--workspace-height')) * 6;
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(height()).toBeCloseTo(352, 0);
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(height()).toBeCloseTo(416, 0);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(height()).toBeCloseTo(384, 0);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(height()).toBeCloseTo(160, 0);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(height()).toBeCloseTo(600, 0);
    expect(document.activeElement).toBe(handle);

    fireEvent.click(within(conversation).getByRole('button', { name: 'Maximise Conversation' }));
    expect(within(conversation).queryByRole('button', { name: 'Resize Conversation height' })).toBeNull();
    fireEvent.click(within(conversation).getByRole('button', { name: 'Restore size of Conversation' }));
    expect(height()).toBeCloseTo(600, 0);
    fireEvent.click(within(conversation).getByRole('button', { name: 'Minimise Conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Conversation' }));
    expect(height()).toBeCloseTo(600, 0);
    const saved = conversation.style.getPropertyValue('--workspace-width');
    rendered.unmount();
    render(<Workspace views={fixture} defaultArrangement="layered" arrangeMenu={false} />);
    const restored = screen.getByRole('article', { name: 'Conversation' });
    expect(restored.style.getPropertyValue('--workspace-width')).toBe(saved);
    expect(restored.style.getPropertyValue('--workspace-height')).toBe('100%');
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

  it('shares saved chat geometry with workspace move/resize commands and reports manual placement', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>History</p> },
    }]} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}),
    });
    vi.spyOn(conversation, 'getBoundingClientRect').mockImplementation(() => {
      const placed = conversation.hasAttribute('data-conversation-positioned');
      const x = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-x')) * 10 : 130;
      const y = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-y')) * 6 : 280;
      const width = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-width')) * 10 : 740;
      const height = placed ? parseFloat(conversation.style.getPropertyValue('--workspace-height')) * 6 : 320;
      return { x, y, top: y, left: x, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) };
    });
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'move-chat', operation: 'move', viewId: 'conversation', x: .2, y: .1,
      })).toBe(true);
    });
    expect(conversation.style.getPropertyValue('--workspace-x')).toBe('20%');
    expect(conversation.style.getPropertyValue('--workspace-y')).toBe('10%');
    expect(controller.current?.snapshot?.windows[0]?.placement).toBe('manual');
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'resize-chat', operation: 'resize', viewId: 'conversation', width: .6, height: .7,
      })).toBe(true);
    });
    expect(conversation.style.getPropertyValue('--workspace-width')).toBe('60%');
    expect(conversation.style.getPropertyValue('--workspace-height')).toBe('70%');
    expect(JSON.parse(localStorage.getItem(conversationLayoutKey)!)).toMatchObject({ x: .2, y: .1, width: .6, height: .7 });
    const saved = localStorage.getItem(conversationLayoutKey);
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'outside-chat', operation: 'move', viewId: 'conversation', x: .9, y: .1,
      })).toBe(false);
    });
    expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'minimise-chat', operation: 'minimise', viewId: 'conversation',
      })).toBe(true);
    });
    vi.mocked(conversation.getBoundingClientRect).mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
    });
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'move-minimised-chat', operation: 'move', viewId: 'conversation', x: .15, y: .2,
      })).toBe(true);
    });
    expect(JSON.parse(localStorage.getItem(conversationLayoutKey)!)).toMatchObject({ x: .15, y: .2, width: .6, height: .7 });
  });

  it.each(['mouse', 'touch'])('moves desktop chat using its header with %s, publishes the composer anchor and saves the result', pointerType => {
    const anchor = vi.fn();
    const windowUpdates = vi.fn();
    render(<Workspace views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>History</p> },
    }, ...views]} onConversationPositionChange={anchor} onOpenWindowsChange={windowUpdates} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 80, left: 20, top: 80, right: 1020, bottom: 680, width: 1000, height: 600, toJSON: () => ({}),
    });
    vi.spyOn(conversation, 'getBoundingClientRect').mockReturnValue({
      x: 150, y: 360, left: 150, top: 360, right: 890, bottom: 680, width: 740, height: 320, toJSON: () => ({}),
    });
    const move = within(conversation).getByRole('button', { name: 'Move Conversation' });
    Object.defineProperties(move, {
      setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => true }, releasePointerCapture: { value: vi.fn() },
    });
    const start = { pointerId: 1, button: pointerType === 'touch' ? -1 : 0, pointerType, clientX: 200, clientY: 360 };
    fireEvent.pointerDown(move, start);
    expect(conversation.style.getPropertyValue('--workspace-x')).toBe('13%');
    const updatesAfterPickup = windowUpdates.mock.calls.length;
    fireEvent.pointerMove(move, { ...start, clientX: 250, clientY: 260 });
    fireEvent.pointerUp(move, { ...start, clientX: 250, clientY: 260 });
    expect(windowUpdates).toHaveBeenCalledTimes(updatesAfterPickup);
    expect(conversation.style.getPropertyValue('--workspace-x')).toBe('18%');
    expect(parseFloat(conversation.style.getPropertyValue('--workspace-y'))).toBeCloseTo(30, 0);
    expect(anchor).toHaveBeenLastCalledWith(expect.objectContaining({ left: 200, top: 578, width: 740 }));
    expect(JSON.parse(localStorage.getItem(conversationLayoutKey)!)).toMatchObject({ x: .18, width: .74 });
    expect(conversation.querySelectorAll('.conversation-resize-corner')).toHaveLength(4);
    expect(conversation.querySelectorAll('.conversation-resize-border')).toHaveLength(8);
    expect(conversation.querySelector('.conversation-resize-border svg')).toBeNull();
    fireEvent.click(within(conversation).getByRole('button', { name: 'Minimise Conversation' }));
    expect(anchor).toHaveBeenLastCalledWith(expect.objectContaining({ left: 200, top: 578, width: 740 }));
  });

  it('keeps desktop geometry dormant throughout phone focus, viewport pan and window lifecycle, then restores it on desktop', async () => {
    const media = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => query === PHONE_LAYOUT_MEDIA_QUERY ? media : {
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    localStorage.setItem(conversationLayoutKey, JSON.stringify({
      x: .1, y: .2, width: .8, height: .6, size: { width: 1000, height: 600 },
    }));
    const saved = localStorage.getItem(conversationLayoutKey);
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    const anchor = vi.fn();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <textarea aria-label="Fixture message" defaultValue="Unsent draft" /> },
    }]} onConversationPositionChange={anchor} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 80, left: 10, top: 80, right: 1010, bottom: 680, width: 1000, height: 600, toJSON: () => ({}),
    });
    const conversation = screen.getByRole('article', { name: 'Conversation' });
    const input = screen.getByRole('textbox', { name: 'Fixture message' });
    input.focus();
    for (const [height, offsetTop] of [[420, 0], [420, 60], [380, 120], [844, 0]]) {
      await act(async () => {
        Object.assign(viewport, { height, offsetTop });
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      });
      expect(anchor).toHaveBeenLastCalledWith(null);
      expect(conversation.hasAttribute('data-conversation-positioned')).toBe(false);
      expect(conversation.style.getPropertyValue('--conversation-height')).toBe('');
      expect(input).toHaveProperty('value', 'Unsent draft');
      expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
    }
    expect(within(conversation).queryByRole('button', { name: 'Move Conversation' })).toBeNull();
    expect(conversation.querySelector('.conversation-resize-border')).toBeNull();
    for (const operation of ['minimise', 'restore', 'close', 'restore'] as const) {
      act(() => { controller.current?.dispatch({ commandId: `phone-${operation}`, operation, viewId: 'conversation' }); });
      expect(anchor).toHaveBeenLastCalledWith(null);
      expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
    }
    act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
    await waitFor(() => expect(anchor).toHaveBeenLastCalledWith({ left: 110, top: 558, width: 800 }));
    expect(screen.getByRole('article', { name: 'Conversation' }).hasAttribute('data-conversation-positioned')).toBe(true);
    expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(anchor).toHaveBeenLastCalledWith(null);
    expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
  });

  it('keeps the saved desktop chat and composer joined when the visual viewport pans without resizing the canvas', async () => {
    localStorage.setItem(conversationLayoutKey, JSON.stringify({ x: .1, y: .2, width: .8, height: .6 }));
    const saved = localStorage.getItem(conversationLayoutKey);
    const viewport = new EventTarget();
    vi.stubGlobal('visualViewport', viewport);
    const anchor = vi.fn();
    const view = render(<Workspace views={[{
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>History</p> },
    }]} onConversationPositionChange={anchor} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    let top = 80;
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => ({
      x: 10, y: top, left: 10, top, right: 400, bottom: top + 500, width: 390, height: 500, toJSON: () => ({}),
    }));
    viewport.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(anchor).toHaveBeenLastCalledWith({ left: 49, top: 478, width: 320 }));
    top = -20;
    viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(anchor).toHaveBeenLastCalledWith({ left: 49, top: 378, width: 320 }));
    top = 80;
    viewport.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(anchor).toHaveBeenLastCalledWith({ left: 49, top: 478, width: 320 }));
    expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
    const calls = anchor.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      viewport.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(anchor).toHaveBeenCalledTimes(calls);
    top = 600;
    viewport.dispatchEvent(new Event('scroll'));
    view.unmount();
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(anchor).toHaveBeenCalledTimes(calls);
    expect(localStorage.getItem(conversationLayoutKey)).toBe(saved);
  });

  it('bounds Arrange to its window and keeps mobile lifecycle actions in one row with 44px targets', () => {
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    expect(workspaceStyles).toMatch(/\.workspace-window-heading \{\s*position: relative;/);
    expect(workspaceStyles).toContain('.workspace-arrange-menu { position: static; }');
    expect(workspaceStyles).toContain('width: min(300px, 100%); min-width: 0; max-width: 100%;');
    const mobile = workspaceStyles.slice(workspaceStyles.indexOf('@media (max-width: 900px)'));
    expect(mobile).toContain('.workspace-window-heading h3 { flex-basis: auto; }');
    expect(mobile).toContain('.workspace-window-actions { display: flex; width: auto; flex: 0 0 auto; flex-wrap: nowrap; gap: var(--space-1); }');
    expect(workspaceStyles).toContain('.sidebar-close, .workspace-window .workspace-icon-control, .workspace-window .workspace-arrange-menu > summary { width: 44px; min-width: 44px; height: 44px; min-height: 44px; }');
    expect(mobile).toContain('.workspace-arrange-menu > summary { width: 44px; padding: 0; }');
  });

  it('does not raise an open Arrange window above a different maximised window', async () => {
    const user = userEvent.setup();
    render(<Workspace views={views} />);
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    const raisedSelector = workspaceStyles.match(/([^{}]+)\{\s*z-index: var\(--z-window-menu\);\s*\}/)?.[1]?.trim();
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

    expect(screen.getByText('This view has no content.')).not.toBeNull();
    expect(screen.getByText('Loading view.').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('The source is unavailable.').closest('[role="alert"]')).not.toBeNull();
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

  it('applies place, arrange and all-window commands while tidy up releases manual geometry', () => {
    const controller = createRef<WorkspaceController>();
    const snapshots = vi.fn();
    render(<Workspace ref={controller} views={views} defaultArrangement="layered" arrangeMenu={false}
      onOpenWindowsChange={snapshots} />);

    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'place-research', operation: 'place', viewId: 'research', region: 'right',
      })).toBe(true);
    });
    expect(snapshots.mock.calls.at(-1)?.[0]).toContainEqual(expect.objectContaining({
      viewId: 'research', placement: 'region', region: 'right',
    }));

    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'move-research', operation: 'move', viewId: 'research', x: 0.1, y: 0.1,
      })).toBe(true);
    });
    expect(snapshots.mock.calls.at(-1)?.[0]).toContainEqual(expect.objectContaining({
      viewId: 'research', placement: 'manual',
    }));

    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'tidy-windows', operation: 'arrange', layout: 'auto',
      })).toBe(true);
    });
    expect(snapshots.mock.calls.at(-1)?.[0]).toContainEqual(expect.objectContaining({
      viewId: 'research', placement: 'auto',
    }));

    act(() => {
      expect(controller.current?.dispatch({ commandId: 'minimise-everything', operation: 'minimise-all' })).toBe(true);
    });
    expect(snapshots.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ viewId: 'research', state: 'minimised' }),
      expect.objectContaining({ viewId: 'sources', state: 'minimised' }),
    ]));
    act(() => {
      expect(controller.current?.dispatch({ commandId: 'restore-everything', operation: 'restore-all' })).toBe(true);
    });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    act(() => {
      expect(controller.current?.dispatch({ commandId: 'close-everything', operation: 'close-all' })).toBe(true);
    });
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('maps phone placement and arrangement intents to the named foreground view', () => {
    phoneViewport();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} defaultArrangement="layered" arrangeMenu={false} />);

    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'place-sources', operation: 'place', viewId: 'sources', region: 'left',
      })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Sources' })).not.toBeNull();
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'arrange-research-first', operation: 'arrange', layout: 'side-by-side', viewIds: ['research', 'sources'],
      })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
  });

  it('brings a newly-created phone window forward and treats legacy coordinates as named focus requests', () => {
    phoneViewport();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} defaultArrangement="layered" arrangeMenu={false} />);
    act(() => {
      expect(controller.current!.dispatch({ commandId: 'new-phone-window', operation: 'create', viewId: savedPin.viewId, view: savedView })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Saved report' })).not.toBeNull();
    expect(controller.current!.snapshot!.windows.filter((view) => view.front)).toEqual([
      expect.objectContaining({ viewId: savedPin.viewId }),
    ]);
    act(() => {
      expect(controller.current!.dispatch({ commandId: 'phone-move', operation: 'move', viewId: 'research', x: 0.95, y: 0.95 })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    expect(controller.current!.snapshot!.windows.find((view) => view.viewId === 'research')!.placement).toBe('auto');
    act(() => {
      expect(controller.current!.dispatch({ commandId: 'phone-resize', operation: 'resize', viewId: 'sources', width: 0.8, height: 0.8 })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'Sources' })).not.toBeNull();
  });

  it('uses explicit cascade IDs front-to-back without changing side-by-side naming', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} defaultArrangement="layered" arrangeMenu={false} />);
    act(() => {
      expect(controller.current!.dispatch({ commandId: 'named-stack', operation: 'arrange', layout: 'cascade', viewIds: ['research', 'sources'] })).toBe(true);
    });

    expect(controller.current!.snapshot!.windows.filter((view) => view.front)).toEqual([
      expect.objectContaining({ viewId: 'research' }),
    ]);
    act(() => {
      expect(controller.current!.dispatch({ commandId: 'named-columns', operation: 'arrange', layout: 'side-by-side', viewIds: ['sources', 'research'] })).toBe(true);
    });
    expect(controller.current!.snapshot!.windows).toHaveLength(2);
  });

  it('brings restored and newly-created windows above an older maximised window', async () => {
    const user = userEvent.setup();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} defaultArrangement="layered" arrangeMenu={false} />);
    await user.click(screen.getByRole('button', { name: 'Maximise Research summary' }));
    expect(controller.current!.snapshot!.windows.find((view) => view.front)!.viewId).toBe('research');
    act(() => { controller.current!.dispatch({ commandId: 'focus-other', operation: 'focus', viewId: 'sources' }); });
    expect(screen.getByRole('article', { name: 'Research summary' }).className).not.toContain('workspace-window-maximized');
    expect(controller.current!.snapshot!.windows.find((view) => view.front)!.viewId).toBe('sources');
    act(() => { controller.current!.dispatch({ commandId: 'hide-research', operation: 'minimise', viewId: 'research' }); });
    act(() => { controller.current!.dispatch({ commandId: 'restore-research', operation: 'restore', viewId: 'research' }); });
    expect(controller.current!.snapshot!.windows.find((view) => view.front)!.viewId).toBe('research');
    await user.click(screen.getByRole('button', { name: 'Maximise Research summary' }));
    act(() => { controller.current!.dispatch({ commandId: 'create-above-max', operation: 'create', viewId: savedPin.viewId, view: savedView }); });
    expect(screen.getByRole('article', { name: 'Research summary' }).className).not.toContain('workspace-window-maximized');
    expect(controller.current!.snapshot!.windows.find((view) => view.front)!.viewId).toBe(savedPin.viewId);
  });

  it('includes the conversation in all-window lifecycle commands without clearing its content', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[views[0]!, {
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Preserved conversation</p> },
    }]} defaultArrangement="layered" arrangeMenu={false} />);
    act(() => { expect(controller.current!.dispatch({ commandId: 'all-to-tabs', operation: 'minimise-all' })).toBe(true); });
    expect(controller.current!.snapshot!.windows.every((view) => view.state === 'minimised')).toBe(true);
    act(() => { expect(controller.current!.dispatch({ commandId: 'all-back', operation: 'restore-all' })).toBe(true); });
    expect(controller.current!.snapshot!.windows.every((view) => view.state === 'open')).toBe(true);
    expect(screen.getByRole('article', { name: 'Conversation' })).not.toBeNull();
    act(() => { expect(controller.current!.dispatch({ commandId: 'all-closed', operation: 'close-all' })).toBe(true); });
    expect(controller.current!.snapshot!.windows).toEqual([]);
    act(() => { expect(controller.current!.dispatch({ commandId: 'conversation-back', operation: 'restore', viewId: 'conversation' })).toBe(true); });
    expect(screen.getByText('Preserved conversation')).not.toBeNull();
  });

  it('refuses desktop region or named-layout requests for the separately managed conversation before changing any window', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[views[0]!, {
      id: 'conversation', title: 'Conversation', presentation: 'conversation',
      content: { status: 'ready', content: <p>Preserved conversation</p> },
    }]} defaultArrangement="layered" arrangeMenu={false} />);
    const before = controller.current!.snapshot;
    act(() => {
      expect(controller.current!.dispatch({ commandId: 'place-chat', operation: 'place', viewId: 'conversation', region: 'left' })).toBe(false);
      expect(controller.current!.dispatch({ commandId: 'arrange-chat', operation: 'arrange', layout: 'side-by-side', viewIds: ['research', 'conversation'] })).toBe(false);
    });
    expect(controller.current!.snapshot).toEqual(before);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('restores automatic or region placement when a drag is cancelled or loses capture', () => {
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe(target: Element) {
        if (!target.classList.contains('workspace-canvas')) return;
        this.callback([{ target, contentRect: new DOMRect(0, 0, 1600, 900),
          borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this);
      }
      unobserve() {}
      disconnect() {}
    });
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} defaultArrangement="layered" arrangeMenu={false} />);
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1600, 900));
    act(() => { controller.current!.dispatch({ commandId: 'region-before-drag', operation: 'place', viewId: 'research', region: 'right' }); });
    const window = screen.getByRole('article', { name: 'Research summary' });
    const title = within(window).getByRole('heading');
    Object.defineProperties(title, {
      setPointerCapture: { value: vi.fn(), configurable: true },
      hasPointerCapture: { value: () => true, configurable: true },
      releasePointerCapture: { value: vi.fn(), configurable: true },
    });
    const previous = window.style.getPropertyValue('--workspace-x');
    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 500, clientY: 80 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 400, clientY: 110 });
    expect(controller.current!.snapshot!.windows.find((view) => view.viewId === 'research')!.placement).toBe('manual');
    fireEvent.pointerCancel(title, { pointerId: 1 });
    expect(window.style.getPropertyValue('--workspace-x')).toBe(previous);
    expect(controller.current!.snapshot!.windows.find((view) => view.viewId === 'research')).toMatchObject({ placement: 'region', region: 'right' });
    act(() => { controller.current!.dispatch({ commandId: 'auto-before-drag', operation: 'arrange', layout: 'auto' }); });
    fireEvent.pointerDown(title, { pointerId: 2, button: 0, clientX: 500, clientY: 80 });
    fireEvent.pointerMove(title, { pointerId: 2, clientX: 400, clientY: 110 });
    fireEvent.lostPointerCapture(title, { pointerId: 2 });
    expect(controller.current!.snapshot!.windows.find((view) => view.viewId === 'research')!.placement).toBe('auto');
    expect(window.className).not.toContain('workspace-window-dragging');
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


describe('camera preview ownership', () => {
it('keeps a compact camera preview visible beside the foreground phone window, with tab docking and Jarvis commands', () => {
    phoneViewport();
    const ref = createRef<WorkspaceController>();
    const onClose = vi.fn();
    const shown = vi.fn();
    const preview: WorkspaceView = {
      id: 'camera-preview', title: 'Camera preview', presentation: 'camera-preview', onClose,
      content: { status: 'ready', content: <p>Front camera live</p> },
    };
    render(<Workspace ref={ref} views={[views[0]!, preview]} onVisibleViewIdsChange={shown} />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: 'Switch foreground view' })).toBeNull();
    expect(shown).toHaveBeenLastCalledWith(['research', 'camera-preview']);
    expect(ref.current?.isViewVisible?.('camera-preview')).toBe(true);
    const cameraWindow = screen.getByRole('article', { name: 'Camera preview' });
    fireEvent.click(within(cameraWindow).getByRole('button', { name: 'Minimise Camera preview' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    expect(ref.current?.snapshot?.windows.find((window) => window.viewId === 'camera-preview'))
      .toMatchObject({ title: 'Camera preview', state: 'minimised' });
    act(() => { expect(ref.current?.dispatch({ commandId: 'show-preview', operation: 'show', viewId: 'camera-preview' })).toBe(true); });
    expect(cameraWindow.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('article', { name: 'Research summary' })).not.toBeNull();
    act(() => { expect(ref.current?.dispatch({ commandId: 'close-preview', operation: 'close', viewId: 'camera-preview' })).toBe(true); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

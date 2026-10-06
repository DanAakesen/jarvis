import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef, useMemo, useRef, useState } from 'react';
import { PHONE_LAYOUT_MEDIA_QUERY, Workspace, type WorkspaceController, type WorkspaceView } from './Workspace';
import { useWorkspaceCommands, WorkspaceCommandContext } from './workspace-command-state';
import { readFileSync } from 'node:fs';

const views: WorkspaceView[] = [
  { id: 'research', title: 'Research summary', content: { status: 'ready', content: <p>Source-linked findings</p> } },
  { id: 'sources', title: 'Sources', content: { status: 'loading' } },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function phoneViewport() {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

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
  it('uses the one-view phone workspace on short coarse-pointer landscape screens', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === PHONE_LAYOUT_MEDIA_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    render(<Workspace views={views} />);

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Switch foreground view' })).not.toBeNull();
    expect(matchMedia).toHaveBeenCalledWith(PHONE_LAYOUT_MEDIA_QUERY);
  });

  it('layers newly created views on top and cycles focus through the stack', () => {
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={[]} />);
    const create = (viewId: string, title: string) => act(() => {
      expect(controller.current?.dispatch({
        commandId: `create-${viewId}`, operation: 'create', viewId,
        view: {
          version: 1, title, renderer: 'list',
          source: { id: 'factory.tasks', status: 'complete' },
          data: { items: [{ title }] },
        },
      })).toBe(true);
    });
    create('first', 'First');
    create('second', 'Second');
    const canvas = screen.getByRole('region', { name: 'Temporary workspace views' });
    expect(canvas.getAttribute('data-arrangement')).toBe('layered');
    expect(screen.getByRole('article', { name: 'First' }).style.getPropertyValue('--workspace-depth')).toBe('1');
    expect(screen.getByRole('article', { name: 'Second' }).style.getPropertyValue('--workspace-depth')).toBe('2');
    act(() => {
      expect(controller.current?.dispatch({ commandId: 'cycle-next', operation: 'cycle', direction: 'next' })).toBe(true);
    });
    expect(screen.getByRole('article', { name: 'First' }).style.getPropertyValue('--workspace-depth')).toBe('2');
    expect(screen.getByRole('article', { name: 'Second' }).style.getPropertyValue('--workspace-depth')).toBe('1');
  });

  it('pins HTML apps into persistent tabs and applies chat pin commands without reloading the iframe', async () => {
    const controller = createRef<WorkspaceController>();
    const user = userEvent.setup();
    const artifactId = '12345678-1234-4234-8234-123456789abc';
    const loadHtmlArtifact = vi.fn(async () => ({
      id: artifactId, kind: 'html' as const, title: 'Research app', html: '<h1>Research</h1>',
      sources: [], createdAt: '2026-10-06T10:00:00.000Z', pinned: false,
    }));
    const setHtmlArtifactPinned = vi.fn(async () => {});
    render(<Workspace ref={controller} views={[]} loadHtmlArtifact={loadHtmlArtifact}
      setHtmlArtifactPinned={setHtmlArtifactPinned} />);
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'create-research-app', operation: 'create-html', viewId: 'research-app',
        title: 'Research app', artifactId, html: '<h1>Research</h1>', sources: [],
      })).toBe(true);
    });
    const iframe = await screen.findByTitle('Research app');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('Content-Security-Policy');
    await user.click(screen.getByRole('button', { name: 'Pin Research app' }));
    await waitFor(() => expect(setHtmlArtifactPinned).toHaveBeenCalledWith(artifactId, true));
    expect(screen.getByRole('navigation', { name: 'Pinned views' })).not.toBeNull();
    act(() => {
      expect(controller.current?.dispatch({
        commandId: 'unpin-research-app', operation: 'unpin', viewId: 'research-app',
      })).toBe(true);
    });
    expect(screen.queryByRole('navigation', { name: 'Pinned views' })).toBeNull();
    expect(screen.getByTitle('Research app')).toBe(iframe);
  });

  it('keeps pinned HTML views as tabs while phones show one foreground view', async () => {
    phoneViewport();
    const controller = createRef<WorkspaceController>();
    const artifactId = '12345678-1234-4234-8234-123456789abc';
    render(<Workspace ref={controller} views={[{
      id: 'saved-research', title: 'Saved research', pinned: true,
      content: { status: 'generated', view: {
        version: 1, title: 'Saved research', renderer: 'html-app',
        source: { id: 'workspace.html', status: 'complete' }, data: { artifactId },
      } },
    }]} loadHtmlArtifact={async () => ({
      id: artifactId, kind: 'html', title: 'Saved research', html: '<p>Saved</p>',
      sources: [], createdAt: '2026-10-06T10:00:00.000Z', pinned: true,
    })} setHtmlArtifactPinned={async () => {}} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Pinned views' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open pinned Saved research' })).not.toBeNull();
    act(() => {
      expect(controller.current?.dispatch({ commandId: 'close-saved', operation: 'close', viewId: 'saved-research' })).toBe(true);
    });
    expect(screen.queryByRole('article')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open pinned Saved research' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
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

  it('publishes open window titles and IDs, retaining minimised windows and removing closed ones', () => {
    const onOpenWindowsChange = vi.fn();
    const controller = createRef<WorkspaceController>();
    render(<Workspace ref={controller} views={views} onOpenWindowsChange={onOpenWindowsChange} />);
    expect(onOpenWindowsChange).toHaveBeenLastCalledWith([
      { viewId: 'research', title: 'Research summary' }, { viewId: 'sources', title: 'Sources' },
    ]);
    act(() => { controller.current?.dispatch({ commandId: 'minimise', operation: 'minimise', viewId: 'research' }); });
    expect(onOpenWindowsChange).toHaveBeenLastCalledWith([
      { viewId: 'research', title: 'Research summary' }, { viewId: 'sources', title: 'Sources' },
    ]);
    act(() => { controller.current?.dispatch({ commandId: 'close', operation: 'close', viewId: 'research' }); });
    expect(onOpenWindowsChange).toHaveBeenLastCalledWith([{ viewId: 'sources', title: 'Sources' }]);
  });

  it('keeps one phone view foreground, retains content state and supports named and keyboard switching', async () => {
    phoneViewport();
    const user = userEvent.setup();
    render(<Workspace views={[
      { ...views[0]!, content: { status: 'ready', content: <input aria-label="Research note" defaultValue="Original" /> } },
      views[1]!,
    ]} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByRole('article', { name: 'Sources' })).toBeNull();
    expect(screen.queryByText('Arrange')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Research note' }), ' retained');
    await user.click(screen.getByRole('button', { name: 'Show Sources' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' }));
    expect(screen.getByRole('button', { name: 'Show Sources' }).getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('article[hidden]')?.hasAttribute('inert')).toBe(true);
    screen.getByRole('button', { name: 'Show Sources' }).focus();
    await user.keyboard('{Home}');
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
    swipe(screen.getByText('Loading view…'), -70);
    expect(screen.getByRole('article', { name: 'Sources' })).not.toBeNull();
    swipe(screen.getByText('Loading view…'), 70);
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

  it('reserves phone content space above the conditional voice dock and leaves no-content voice centred', () => {
    const styles = readFileSync('src/ConversationHistory.css', 'utf8');
    const phone = styles.slice(styles.indexOf('@media (max-width: 700px)'));
    expect(phone).toContain('bottom: calc(var(--phone-dock-bottom) + var(--phone-dock-height) + 12px)');
    expect(phone).toContain('--phone-dock-height: var(--voice-bar-height, 60px);');
    expect(phone).toContain('[data-voice-has-windows="true"] .voice-bar { bottom: var(--phone-dock-bottom);');
    expect(phone).not.toContain('voice-orb');
    const workspaceStyles = readFileSync('src/styles.css', 'utf8');
    expect(workspaceStyles).toContain('.workspace-window[hidden] { display: none; transition: none; }');
    expect(workspaceStyles).toContain('.workspace[data-phone="true"] .workspace-view-content { touch-action: pan-y pinch-zoom; }');
  });

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
    expect(mobile).toContain('grid-template-columns: repeat(5, 44px); justify-content: end; gap: 4px;');
    expect(mobile).toContain('grid-template-columns: repeat(4, 44px); justify-content: end;');
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

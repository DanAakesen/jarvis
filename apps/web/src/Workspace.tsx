import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';

export type WorkspaceViewContent =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void | Promise<void> }
  | { status: 'interrupted'; message: string; content?: ReactNode; resume?: () => void | Promise<void> }
  | { status: 'ready'; content: ReactNode };

export interface WorkspaceView {
  id: string;
  title: string;
  content: WorkspaceViewContent;
}

export type WorkspaceCommand = {
  operation: 'minimise' | 'restore' | 'focus' | 'close';
  viewId: string;
};

export interface WorkspaceController {
  dispatch: (command: WorkspaceCommand) => boolean;
  minimiseAll: () => void;
  hasVisibleViews: () => boolean;
}

type Arrangement = 'tiled' | 'layered';
type Geometry = { x: number; y: number; width: number; height: number; columns: number; rows: number };
type PendingFocus = { target: 'tab' | 'window'; viewId: string } | { target: 'workspace' };
type Gesture = {
  id: string;
  kind: 'move' | 'resize';
  x: number;
  y: number;
  geometry: Geometry;
  edge: 'right' | 'bottom' | undefined;
};

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000;
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;

function WindowIcon({ name }: { name: 'minimise' | 'maximise' | 'restore' | 'close' | 'view' | 'more' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'minimise':
      return <svg {...common}><path d="M5 17h14" /></svg>;
    case 'maximise':
      return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>;
    case 'restore':
      return <svg {...common}><path d="M8 5h11v11M5 8v11h11" /></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'view':
      return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 9h16" /></svg>;
    case 'more':
      return <svg {...common}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
  }
}

function defaultGeometry(index: number): Geometry {
  return {
    x: 0.08 + (index % 3) * 0.06,
    y: 0.08 + (index % 3) * 0.06,
    width: 0.72,
    height: 0.72,
    columns: 1,
    rows: 1,
  };
}

export const Workspace = forwardRef<WorkspaceController, {
  views: readonly WorkspaceView[];
  onVisibleViewsChange?: (visible: boolean) => void;
}>(function Workspace({ views, onVisibleViewsChange }, ref) {
  const workspaceId = useId();
  const [arrangement, setArrangement] = useState<Arrangement>('tiled');
  const [order, setOrder] = useState<string[]>([]);
  const [geometry, setGeometry] = useState<Record<string, Geometry>>({});
  const [minimizedViewIdsState, setMinimizedViewIds] = useState<ReadonlySet<string>>(new Set());
  const [closedViewIdsState, setClosedViewIds] = useState<ReadonlySet<string>>(new Set());
  const [maximizedViewId, setMaximizedViewId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actionSuccess, setActionSuccess] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches
  ));
  const canvas = useRef<HTMLDivElement>(null);
  const gestures = useRef(new Map<number, Gesture>());
  const pendingActionsRef = useRef(new Set<string>());
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const windowElements = useRef(new Map<string, HTMLElement>());
  const windowHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<PendingFocus | null>(null);

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 900px)');
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const orderedViews = useMemo(() => {
    const initialOrder = new Map(views.map((view, index) => [view.id, index]));
    const currentOrder = new Map(order.map((id, index) => [id, index]));
    return [...views].sort((left, right) => (
      (currentOrder.get(left.id) ?? order.length + initialOrder.get(left.id)!) -
      (currentOrder.get(right.id) ?? order.length + initialOrder.get(right.id)!)
    ));
  }, [order, views]);
  const viewIds = useMemo(() => new Set(views.map(({ id }) => id)), [views]);
  const minimizedViewIds = useMemo(
    () => new Set([...minimizedViewIdsState].filter((id) => viewIds.has(id))),
    [minimizedViewIdsState, viewIds],
  );
  const closedViewIds = useMemo(
    () => new Set([...closedViewIdsState].filter((id) => viewIds.has(id))),
    [closedViewIdsState, viewIds],
  );
  const activeMaximizedViewId = maximizedViewId && viewIds.has(maximizedViewId) ? maximizedViewId : null;
  const openViews = useMemo(() => orderedViews.filter((view) => !closedViewIds.has(view.id)), [closedViewIds, orderedViews]);
  const minimizedViews = useMemo(() => openViews.filter((view) => minimizedViewIds.has(view.id)), [minimizedViewIds, openViews]);
  const visibleViews = useMemo(() => openViews.filter((view) => !minimizedViewIds.has(view.id)), [minimizedViewIds, openViews]);

  useEffect(() => {
    onVisibleViewsChange?.(visibleViews.length > 0);
  }, [onVisibleViewsChange, visibleViews.length]);

  useLayoutEffect(() => {
    const next = pendingFocus.current;
    if (!next) return;
    pendingFocus.current = null;
    if (next.target === 'workspace') {
      workspaceHeading.current?.focus();
    } else if (next.target === 'tab') {
      tabElements.current.get(next.viewId)?.focus();
    } else {
      windowHeadings.current.get(next.viewId)?.focus();
    }
  }, [closedViewIdsState, minimizedViewIdsState, openViews]);

  function geometryFor(id: string, index: number): Geometry {
    return geometry[id] ?? defaultGeometry(index);
  }

  const reorder = useCallback((id: string, offset: number, label: string): boolean => {
    const ids = orderedViews.map(({ id: viewId }) => viewId);
    const from = ids.indexOf(id);
    const to = clamp(from + offset, 0, ids.length - 1);
    if (from === to) return false;
    const [moved] = ids.splice(from, 1);
    if (!moved) return false;
    ids.splice(to, 0, moved);
    setGeometry((current) => Object.fromEntries(orderedViews.map((view, index) => [
      view.id, current[view.id] ?? defaultGeometry(index),
    ])));
    setOrder(ids);
    setAnnouncement(`${views.find((view) => view.id === id)?.title} ${label}.`);
    return true;
  }, [orderedViews, views]);

  const isViewOpen = useCallback((id: string) => {
    return views.some((view) => view.id === id) && !closedViewIds.has(id);
  }, [closedViewIds, views]);

  const minimiseView = useCallback((id: string): boolean => {
    if (!isViewOpen(id)) return false;
    if (minimizedViewIds.has(id)) return true;
    if (windowElements.current.get(id)?.contains(document.activeElement)) {
      pendingFocus.current = { target: 'tab', viewId: id };
    }
    setMaximizedViewId((current) => current === id ? null : current);
    setMinimizedViewIds((current) => new Set(current).add(id));
    setAnnouncement(`${views.find((view) => view.id === id)?.title} minimised.`);
    return true;
  }, [isViewOpen, minimizedViewIds, views]);

  const restoreView = useCallback((id: string): boolean => {
    if (!isViewOpen(id)) return false;
    if (document.activeElement === tabElements.current.get(id)) {
      pendingFocus.current = { target: 'window', viewId: id };
    }
    setMinimizedViewIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setAnnouncement(`${views.find((view) => view.id === id)?.title} restored.`);
    return true;
  }, [isViewOpen, views]);

  const closeView = useCallback((id: string): boolean => {
    if (!views.some((view) => view.id === id)) return false;
    if (closedViewIds.has(id)) return true;
    if (windowElements.current.get(id)?.contains(document.activeElement)) {
      const remaining = openViews.filter((view) => view.id !== id);
      const next = remaining.find((view) => !minimizedViewIds.has(view.id)) ?? remaining[0];
      pendingFocus.current = next
        ? { target: minimizedViewIds.has(next.id) ? 'tab' : 'window', viewId: next.id }
        : { target: 'workspace' };
    }
    setClosedViewIds((current) => new Set(current).add(id));
    setMinimizedViewIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setMaximizedViewId((current) => current === id ? null : current);
    setAnnouncement(`${views.find((view) => view.id === id)?.title} closed.`);
    return true;
  }, [closedViewIds, minimizedViewIds, openViews, views]);

  const focusView = useCallback((id: string): boolean => {
    if (!isViewOpen(id)) return false;
    restoreView(id);
    const index = orderedViews.findIndex((view) => view.id === id);
    if (index >= 0 && index !== orderedViews.length - 1) reorder(id, orderedViews.length - index - 1, 'brought forward');
    if (minimizedViewIds.has(id)) pendingFocus.current = { target: 'window', viewId: id };
    else windowHeadings.current.get(id)?.focus();
    return true;
  }, [isViewOpen, minimizedViewIds, orderedViews, reorder, restoreView]);

  const minimiseAll = useCallback(() => {
    const ids = visibleViews.map(({ id }) => id);
    if (ids.length === 0) return;
    const focusedId = ids.find((id) => windowElements.current.get(id)?.contains(document.activeElement));
    if (focusedId) pendingFocus.current = { target: 'tab', viewId: focusedId };
    setMaximizedViewId(null);
    setMinimizedViewIds((current) => new Set([...current, ...ids]));
    setAnnouncement(`${ids.length} ${ids.length === 1 ? 'window' : 'windows'} minimised.`);
  }, [visibleViews]);

  useImperativeHandle(ref, () => ({
    dispatch(command) {
      switch (command.operation) {
        case 'minimise':
          return minimiseView(command.viewId);
        case 'restore':
          return restoreView(command.viewId);
        case 'focus':
          return focusView(command.viewId);
        case 'close':
          return closeView(command.viewId);
      }
    },
    minimiseAll,
    hasVisibleViews: () => visibleViews.length > 0,
  }), [closeView, focusView, minimiseAll, minimiseView, restoreView, visibleViews.length]);

  function raiseView(event: { target: EventTarget }, id: string) {
    if (arrangement !== 'layered' || narrow) return;
    if (event.target instanceof Element && event.target.closest(
      '.workspace-window-actions button:not(.workspace-move-handle):not(.workspace-resize-handle), .workspace-window-actions summary',
    )) return;
    const index = orderedViews.findIndex((view) => view.id === id);
    if (index >= 0) reorder(id, orderedViews.length - index - 1, 'brought forward');
  }

  function updateGeometry(id: string, update: (current: Geometry) => Geometry, index: number) {
    setGeometry((current) => ({ ...current, [id]: update(current[id] ?? defaultGeometry(index)) }));
  }

  function moveBy(id: string, dx: number, dy: number, index: number) {
    updateGeometry(id, (current) => ({
      ...current,
      x: clamp(current.x + dx, 0, 1 - current.width),
      y: clamp(current.y + dy, 0, 1 - current.height),
    }), index);
    setAnnouncement(`${views.find((view) => view.id === id)?.title} moved.`);
  }

  function resizeBy(id: string, dw: number, dh: number, index: number) {
    updateGeometry(id, (current) => {
      const width = clamp(current.width + dw, 0.32, 0.92);
      const height = clamp(current.height + dh, 0.34, 0.92);
      return {
        ...current,
        width,
        height,
        x: clamp(current.x, 0, 1 - width),
        y: clamp(current.y, 0, 1 - height),
      };
    }, index);
    setAnnouncement(`${views.find((view) => view.id === id)?.title} resized.`);
  }

  function adjustTileSize(id: string, columns: number, rows: number, index: number) {
    updateGeometry(id, (current) => ({
      ...current,
      columns: clamp(current.columns + columns, 1, 2),
      rows: clamp(current.rows + rows, 1, 2),
    }), index);
    setAnnouncement(`${views.find((view) => view.id === id)?.title} size changed.`);
  }

  function beginGesture(event: PointerEvent<HTMLElement>, id: string, kind: Gesture['kind'], index: number, edge?: Gesture['edge']) {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    if (activeMaximizedViewId === id) return;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveGestureId(id);
    gestures.current.set(event.pointerId, {
      id,
      kind,
      x: event.clientX,
      y: event.clientY,
      geometry: geometryFor(id, index),
      edge,
    });
  }

  function updateGesture(event: PointerEvent<HTMLElement>) {
    const gesture = gestures.current.get(event.pointerId);
    const bounds = canvas.current?.getBoundingClientRect();
    if (!gesture || !bounds?.width || !bounds.height) return;
    const dx = gesture.edge === 'bottom' ? 0 : (event.clientX - gesture.x) / bounds.width;
    const dy = gesture.edge === 'right' ? 0 : (event.clientY - gesture.y) / bounds.height;
    updateGeometry(gesture.id, (current) => {
      if (arrangement === 'tiled' || (arrangement === 'layered' && narrow)) {
        if (gesture.kind === 'move') return current;
        return {
          ...current,
          columns: narrow ? gesture.geometry.columns : clamp(gesture.geometry.columns + Math.round(dx * 4), 1, 2),
          rows: clamp(gesture.geometry.rows + Math.round(dy * 2), 1, 2),
        };
      }
      if (gesture.kind === 'move') {
        const x = clamp(gesture.geometry.x + dx, 0, 1 - current.width);
        const y = clamp(gesture.geometry.y + dy, 0, 1 - current.height);
        return { ...current, x, y };
      }
      const width = clamp(gesture.geometry.width + dx, 0.32, 0.92);
      const height = clamp(gesture.geometry.height + dy, 0.34, 0.92);
      return {
        ...current,
        width,
        height,
        x: clamp(current.x, 0, 1 - width),
        y: clamp(current.y, 0, 1 - height),
      };
    }, orderedViews.findIndex((view) => view.id === gesture.id));
  }

  function endGesture(event: PointerEvent<HTMLElement>) {
    const gesture = gestures.current.get(event.pointerId);
    if (!gesture) return;
    gestures.current.delete(event.pointerId);
    setActiveGestureId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.type === 'pointercancel') {
      updateGeometry(gesture.id, () => gesture.geometry, 0);
      setAnnouncement('Arrangement cancelled.');
      return;
    }
    if ((arrangement === 'tiled' || narrow) && gesture.kind === 'move') {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) {
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (reorder(gesture.id, delta < 0 ? -1 : 1, 'reordered')) return;
      }

    }
    setAnnouncement(`${views.find((view) => view.id === gesture.id)?.title} ${gesture.kind === 'move' ? 'moved' : 'resized'}.`);
  }

  function arrangeKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector('summary')?.focus();
  }

  function moveHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) {
    const step = event.shiftKey ? 0.1 : 0.04;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    if (arrangement === 'tiled' || narrow) {
      reorder(id, event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1, 'reordered');
    } else {
      moveBy(id, direction[0], direction[1], index);
    }
  }

  function resizeHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) {
    const step = event.shiftKey ? 0.1 : 0.05;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const direction = directions[event.key];
    if (!direction || (narrow && direction[0] !== 0)) return;
    event.preventDefault();
    if (arrangement === 'tiled' || narrow) {
      adjustTileSize(id, direction[0] > 0 ? 1 : direction[0] < 0 ? -1 : 0, direction[1] > 0 ? 1 : direction[1] < 0 ? -1 : 0, index);
    } else {
      resizeBy(id, direction[0], direction[1], index);
    }
  }

  async function runAction(id: string, action: (() => void | Promise<void>) | undefined, successMessage: string) {
    if (!action || pendingActionsRef.current.has(id)) return;
    pendingActionsRef.current.add(id);
    setPendingActions((current) => new Set(current).add(id));
    setActionSuccess((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setActionErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      await action();
      setActionSuccess((current) => ({ ...current, [id]: successMessage }));
    } catch {
      setActionErrors((current) => ({ ...current, [id]: 'This view could not continue. Try again.' }));
    } finally {
      pendingActionsRef.current.delete(id);
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <section className="workspace" aria-labelledby={`${workspaceId}-heading`}>
      <header className="workspace-heading">
        <h2 ref={workspaceHeading} id={`${workspaceId}-heading`} tabIndex={-1}>Workspace</h2>
        {openViews.length > 0 && (
          <details className="workspace-arrangements" onKeyDown={arrangeKeyDown}>
            <summary>Arrange</summary>
            <div className="workspace-arrangement-options" role="group" aria-label="Workspace arrangement">
              <button
                className="workspace-control"
                type="button"
                aria-pressed={arrangement === 'tiled'}
                onClick={() => setArrangement('tiled')}
              >
                Tile views
              </button>
              <button
                className="workspace-control"
                type="button"
                aria-pressed={arrangement === 'layered'}
                onClick={() => setArrangement('layered')}
              >
                Layer views
              </button>
            </div>
          </details>
        )}
      </header>
      {openViews.length === 0 ? (
        <p className="workspace-empty">No temporary views are open. Views created during this session will appear here.</p>
      ) : openViews.length === minimizedViews.length ? (
        <p className="workspace-empty">All views are minimised. Select a tab to restore a view.</p>
      ) : (
        <p className="workspace-guidance">
          {narrow ? 'Views stack on this screen. Drag a title to reorder, or use Arrange.' : 'Drag a title to move, drag an edge to resize, or use Arrange for keyboard controls.'}
        </p>
      )}
      {minimizedViews.length > 0 && (
        <nav className="workspace-tabs" aria-label="Minimised views">
          {minimizedViews.map((view) => (
            <button
              className="workspace-tab"
              key={view.id}
              ref={(element) => {
                if (element) tabElements.current.set(view.id, element);
                else tabElements.current.delete(view.id);
              }}
              type="button"
              aria-label={`Restore ${view.title}`}
              onClick={() => restoreView(view.id)}
            >
              <WindowIcon name="view" />
              <span>{view.title}</span>
            </button>
          ))}
        </nav>
      )}
      <div
        ref={canvas}
        className={`workspace-canvas workspace-canvas-${arrangement}${activeMaximizedViewId ? ' workspace-canvas-has-maximized' : ''}`}
        role="region"
        aria-label="Temporary workspace views"
        data-arrangement={arrangement}
      >
        {openViews.map((view, index) => {
          const titleId = `${workspaceId}-view-${index}`;
          const currentGeometry = geometryFor(view.id, index);
          const minimized = minimizedViewIds.has(view.id);
          const maximized = activeMaximizedViewId === view.id;
          const style = {
            '--workspace-x': percent(currentGeometry.x),
            '--workspace-y': percent(currentGeometry.y),
            '--workspace-width': percent(currentGeometry.width),
            '--workspace-height': percent(currentGeometry.height),
            '--workspace-columns': currentGeometry.columns,
            '--workspace-rows': currentGeometry.rows,
            '--workspace-depth': index + 1,
          } as CSSProperties;
          const actionPending = pendingActions.has(view.id);
          const retry = view.content.status === 'error' ? view.content.retry : undefined;
          const resume = view.content.status === 'interrupted' ? view.content.resume : undefined;

          return (
            <article
              className={`workspace-window${minimized ? ' workspace-window-minimized' : ''}${maximized ? ' workspace-window-maximized' : ''}${activeGestureId === view.id ? ' workspace-window-dragging' : ''}`}
              key={view.id}
              style={style}
              aria-labelledby={titleId}
              aria-hidden={minimized || undefined}
              inert={minimized}
              ref={(element) => {
                if (element) windowElements.current.set(view.id, element);
                else windowElements.current.delete(view.id);
              }}
              onFocusCapture={(event) => raiseView(event, view.id)}
              onPointerDownCapture={(event) => raiseView(event, view.id)}
            >
              <header className="workspace-window-heading">
                <h3
                  ref={(element) => {
                    if (element) windowHeadings.current.set(view.id, element);
                    else windowHeadings.current.delete(view.id);
                  }}
                  id={titleId}
                  tabIndex={-1}
                  className={maximized ? undefined : 'workspace-title-drag'}
                  onPointerDown={(event) => beginGesture(event, view.id, 'move', index)}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                >
                  {view.title}
                </h3>
                <div className="workspace-window-actions">
                  {!maximized && <details className="workspace-arrange-menu" onKeyDown={arrangeKeyDown}>
                    <summary className="workspace-arrange-trigger" role="button" aria-label={`Arrange ${view.title}`} title={`Arrange ${view.title}`}>
                      <WindowIcon name="more" />
                    </summary>
                    <div className="workspace-arrange-options">
                      <p id={`${titleId}-shortcuts`} className="workspace-shortcuts">
                        Focus Move or Resize, then use arrow keys. {narrow ? 'Up/down changes order or height; width stays full-screen.' : arrangement === 'tiled' ? 'Move changes order; Resize changes tile width or height.' : 'Shift + arrow makes a larger step.'} Escape closes Arrange.
                      </p>
                      <button className="workspace-control" type="button" aria-label={`${arrangement === 'layered' && !narrow ? 'Send backward' : 'Move earlier'} ${view.title}`} disabled={index === 0} onClick={() => reorder(view.id, -1, 'reordered')}>
                        {arrangement === 'layered' && !narrow ? 'Send backward' : 'Move earlier'}
                      </button>
                      <button className="workspace-control" type="button" aria-label={`${arrangement === 'layered' && !narrow ? 'Bring forward' : 'Move later'} ${view.title}`} disabled={index === openViews.length - 1} onClick={() => reorder(view.id, 1, 'reordered')}>
                        {arrangement === 'layered' && !narrow ? 'Bring forward' : 'Move later'}
                      </button>
                      <button
                        className="workspace-control workspace-move-handle"
                        type="button"
                        aria-label={`Move ${view.title}. Use arrow keys to move or reorder.`}
                        aria-describedby={`${titleId}-shortcuts`}
                        onPointerDown={(event) => beginGesture(event, view.id, 'move', index)}
                        onPointerMove={updateGesture}
                        onPointerUp={endGesture}
                        onPointerCancel={endGesture}
                        onKeyDown={(event) => moveHandleKeyDown(event, view.id, index)}
                      >
                        Move
                      </button>
                      {arrangement === 'layered' && !narrow ? (
                        <>
                          <button className="workspace-control" type="button" aria-label={`Move ${view.title} left`} onClick={() => moveBy(view.id, -0.05, 0, index)}>Left</button>
                          <button className="workspace-control" type="button" aria-label={`Move ${view.title} right`} onClick={() => moveBy(view.id, 0.05, 0, index)}>Right</button>
                          <button className="workspace-control" type="button" aria-label={`Move ${view.title} up`} onClick={() => moveBy(view.id, 0, -0.05, index)}>Up</button>
                          <button className="workspace-control" type="button" aria-label={`Move ${view.title} down`} onClick={() => moveBy(view.id, 0, 0.05, index)}>Down</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} narrower`} onClick={() => resizeBy(view.id, -0.05, 0, index)}>Narrower</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} wider`} onClick={() => resizeBy(view.id, 0.05, 0, index)}>Wider</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} shorter`} onClick={() => resizeBy(view.id, 0, -0.05, index)}>Shorter</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} taller`} onClick={() => resizeBy(view.id, 0, 0.05, index)}>Taller</button>
                        </>
                      ) : (
                        <>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} narrower`} disabled={narrow || currentGeometry.columns === 1} aria-describedby={narrow ? `workspace-narrow-note-${view.id}` : undefined} onClick={() => adjustTileSize(view.id, -1, 0, index)}>Narrower</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} wider`} disabled={narrow || currentGeometry.columns === 2} aria-describedby={narrow ? `workspace-narrow-note-${view.id}` : undefined} onClick={() => adjustTileSize(view.id, 1, 0, index)}>Wider</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} shorter`} disabled={currentGeometry.rows === 1} onClick={() => adjustTileSize(view.id, 0, -1, index)}>Shorter</button>
                          <button className="workspace-control" type="button" aria-label={`Make ${view.title} taller`} disabled={currentGeometry.rows === 2} onClick={() => adjustTileSize(view.id, 0, 1, index)}>Taller</button>
                          {narrow && <span id={`workspace-narrow-note-${view.id}`} className="visually-hidden">Views use the full width on narrow screens.</span>}
                        </>
                      )}
                      <button
                        className="workspace-control workspace-resize-handle"
                        type="button"
                        aria-label={`Resize ${view.title}. Use arrow keys to resize.`}
                        aria-describedby={`${titleId}-shortcuts`}
                        onPointerDown={(event) => beginGesture(event, view.id, 'resize', index)}
                        onPointerMove={updateGesture}
                        onPointerUp={endGesture}
                        onPointerCancel={endGesture}
                        onKeyDown={(event) => resizeHandleKeyDown(event, view.id, index)}
                      >
                        Resize
                      </button>
                    </div>
                  </details>}
                  <button className="workspace-icon-control" type="button" aria-label={`${maximized ? 'Restore size of' : 'Maximise'} ${view.title}`} onClick={() => setMaximizedViewId(maximized ? null : view.id)}>
                    <WindowIcon name={maximized ? 'restore' : 'maximise'} />
                  </button>
                  <button className="workspace-icon-control" type="button" aria-label={`Minimise ${view.title}`} onClick={() => minimiseView(view.id)}>
                    <WindowIcon name="minimise" />
                  </button>
                  <button className="workspace-icon-control workspace-close-control" type="button" aria-label={`Close ${view.title}`} onClick={() => closeView(view.id)}>
                    <WindowIcon name="close" />
                  </button>
                </div>
              </header>
              <div className="workspace-view-content">
                {view.content.status === 'loading' && <p role="status">Loading view…</p>}
                {view.content.status === 'empty' && <p>This view has no content yet.</p>}
                {view.content.status === 'error' && (
                  <>
                    <p role="alert">{view.content.message}</p>
                    {view.content.retry && (
                      <button className="secondary-button" type="button" disabled={actionPending} onClick={() => { void runAction(view.id, retry, 'Retry requested.'); }}>
                        {actionPending ? 'Retrying…' : 'Retry view'}
                      </button>
                    )}
                  </>
                )}
                {view.content.status === 'interrupted' && (
                  <>
                    <p role="status">{view.content.message}</p>
                    {view.content.content}
                    {view.content.resume && (
                      <button className="secondary-button" type="button" disabled={actionPending} onClick={() => { void runAction(view.id, resume, 'Continue requested.'); }}>
                        {actionPending ? 'Continuing…' : 'Continue view'}
                      </button>
                    )}
                  </>
                )}
                {view.content.status === 'ready' && view.content.content}
                {actionSuccess[view.id] && <p role="status">{actionSuccess[view.id]}</p>}
                {actionErrors[view.id] && <p role="alert">{actionErrors[view.id]}</p>}
              </div>
              {!maximized && <>
                <div
                  className="workspace-resize-edge workspace-resize-edge-right"
                  aria-hidden="true"
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index, 'right')}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                />
                <div
                  className="workspace-resize-edge workspace-resize-edge-bottom"
                  aria-hidden="true"
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index, 'bottom')}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                />
                <div
                  className="workspace-resize-edge workspace-resize-edge-corner"
                  aria-hidden="true"
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index)}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                />
              </>}
            </article>
          );
        })}
      </div>
      {announcement && <p className="workspace-announcement" role="status" aria-live="polite">{announcement}</p>}
    </section>
  );
});

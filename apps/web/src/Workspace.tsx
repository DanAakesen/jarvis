import { useEffect, useId, useMemo, useRef, useState } from 'react';
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

type Arrangement = 'tiled' | 'layered';
type Geometry = { x: number; y: number; width: number; height: number; columns: number; rows: number };
type Gesture = {
  id: string;
  kind: 'move' | 'resize';
  x: number;
  y: number;
  geometry: Geometry;
};

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000;
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;

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

export function Workspace({ views }: { views: readonly WorkspaceView[] }) {
  const workspaceId = useId();
  const [arrangement, setArrangement] = useState<Arrangement>('tiled');
  const [order, setOrder] = useState<string[]>([]);
  const [geometry, setGeometry] = useState<Record<string, Geometry>>({});
  const [announcement, setAnnouncement] = useState('');
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actionSuccess, setActionSuccess] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const [narrow, setNarrow] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches
  ));
  const canvas = useRef<HTMLDivElement>(null);
  const gestures = useRef(new Map<number, Gesture>());
  const pendingActionsRef = useRef(new Set<string>());

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

  function geometryFor(id: string, index: number): Geometry {
    return geometry[id] ?? defaultGeometry(index);
  }

  function reorder(id: string, offset: number, label: string): boolean {
    const ids = orderedViews.map(({ id: viewId }) => viewId);
    const from = ids.indexOf(id);
    const to = clamp(from + offset, 0, ids.length - 1);
    if (from === to) return false;
    const [moved] = ids.splice(from, 1);
    if (!moved) return false;
    ids.splice(to, 0, moved);
    setOrder(ids);
    setAnnouncement(`${views.find((view) => view.id === id)?.title} ${label}.`);
    return true;
  }

  function raiseView(event: { target: EventTarget }, id: string) {
    if (arrangement !== 'layered' || narrow) return;
    if (event.target instanceof Element && event.target.closest('.workspace-window-order button:not(.workspace-move-handle)')) return;
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

  function beginGesture(event: PointerEvent<HTMLButtonElement>, id: string, kind: Gesture['kind'], index: number) {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestures.current.set(event.pointerId, {
      id,
      kind,
      x: event.clientX,
      y: event.clientY,
      geometry: geometryFor(id, index),
    });
  }

  function updateGesture(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestures.current.get(event.pointerId);
    const bounds = canvas.current?.getBoundingClientRect();
    if (!gesture || !bounds) return;
    const dx = (event.clientX - gesture.x) / bounds.width;
    const dy = (event.clientY - gesture.y) / bounds.height;
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

  function endGesture(event: PointerEvent<HTMLButtonElement>) {
    const gesture = gestures.current.get(event.pointerId);
    if (!gesture) return;
    gestures.current.delete(event.pointerId);
    if ((arrangement === 'tiled' || narrow) && gesture.kind === 'move') {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) {
        if (reorder(gesture.id, dx < 0 || (dx === 0 && dy < 0) ? -1 : 1, 'reordered')) return;
      }
    }
    setAnnouncement(`${views.find((view) => view.id === gesture.id)?.title} ${gesture.kind === 'move' ? 'moved' : 'resized'}.`);
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
        <h2 id={`${workspaceId}-heading`}>Workspace</h2>
        {views.length > 0 && (
          <div className="workspace-arrangements" role="group" aria-label="Workspace arrangement">
            <button
              className="secondary-button"
              type="button"
              aria-pressed={arrangement === 'tiled'}
              onClick={() => setArrangement('tiled')}
            >
              Tile views
            </button>
            <button
              className="secondary-button"
              type="button"
              aria-pressed={arrangement === 'layered'}
              onClick={() => setArrangement('layered')}
            >
              Layer views
            </button>
          </div>
        )}
      </header>
      {views.length === 0 ? (
        <p className="workspace-empty">No temporary views are open. Views created during this session will appear here.</p>
      ) : (
        <p className="workspace-guidance">
          {narrow ? 'Views stack on this screen. Use the move controls to change their order.' : 'Arrange views by moving and resizing them, or choose a tiled layout.'}
        </p>
      )}
      <div
        ref={canvas}
        className={`workspace-canvas workspace-canvas-${arrangement}`}
        role="region"
        aria-label="Temporary workspace views"
        data-arrangement={arrangement}
      >
        {orderedViews.map((view, index) => {
          const titleId = `${workspaceId}-view-${index}`;
          const currentGeometry = geometryFor(view.id, index);
          const style = {
            '--workspace-x': percent(currentGeometry.x),
            '--workspace-y': percent(currentGeometry.y),
            '--workspace-width': percent(currentGeometry.width),
            '--workspace-height': percent(currentGeometry.height),
            '--workspace-columns': currentGeometry.columns,
            '--workspace-rows': currentGeometry.rows,
            '--workspace-depth': index + 1,
          } as CSSProperties;
          const moveEarlierLabel = arrangement === 'layered' && !narrow ? 'Send backward' : 'Move earlier';
          const moveLaterLabel = arrangement === 'layered' && !narrow ? 'Bring forward' : 'Move later';
          const actionPending = pendingActions.has(view.id);
          const retry = view.content.status === 'error' ? view.content.retry : undefined;
          const resume = view.content.status === 'interrupted' ? view.content.resume : undefined;

          return (
            <article
              className="workspace-window"
              key={view.id}
              style={style}
              role="group"
              aria-labelledby={titleId}
              onFocusCapture={(event) => raiseView(event, view.id)}
              onPointerDownCapture={(event) => raiseView(event, view.id)}
            >
              <header className="workspace-window-heading">
                <h3 id={titleId}>{view.title}</h3>
                <div className="workspace-window-order">
                  <button className="workspace-control" type="button" aria-label={`${moveEarlierLabel} ${view.title}`} disabled={index === 0} onClick={() => reorder(view.id, -1, 'reordered')}>
                    {moveEarlierLabel}
                  </button>
                  <button className="workspace-control" type="button" aria-label={`${moveLaterLabel} ${view.title}`} disabled={index === orderedViews.length - 1} onClick={() => reorder(view.id, 1, 'reordered')}>
                    {moveLaterLabel}
                  </button>
                  <button
                    className="workspace-control workspace-move-handle"
                    type="button"
                    aria-label={`Move ${view.title}. Use arrow keys to move or reorder.`}
                    onPointerDown={(event) => beginGesture(event, view.id, 'move', index)}
                    onPointerMove={updateGesture}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                    onKeyDown={(event) => moveHandleKeyDown(event, view.id, index)}
                  >
                    Move
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
              <footer className="workspace-window-controls" aria-label={`Arrange ${view.title}`}>
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
                  className="workspace-resize-handle workspace-control"
                  type="button"
                  aria-label={`Resize ${view.title}. Use arrow keys to resize.`}
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index)}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  onKeyDown={(event) => resizeHandleKeyDown(event, view.id, index)}
                >
                  Resize
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {announcement && <p className="workspace-announcement" role="status" aria-live="polite">{announcement}</p>}
    </section>
  );
}

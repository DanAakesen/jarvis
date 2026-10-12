import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isWorkspaceCommand, type GeneratedView, type WorkspaceCommand, type WorkspaceSnapshot } from '@jarvis/contracts';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';
import { flyWindowAway, flyWindowToTab } from './window-fly-away';
import { layoutOrder, layoutWindows, type WindowLayout, type WindowPlacement } from './window-layout';
import { Loader } from './Loader';
import { readElement, useReadback, type WindowReadback } from './window-readback';
import type { SessionCommand, SessionCommandResult } from './session-commands';
import type { WorkspacePinsClient } from './workspace-pins';
import { awaitWithSignal } from './backend-request';
export type { WorkspaceCommand } from '@jarvis/contracts';

export type WorkspaceViewContent =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void | Promise<void> }
  | { status: 'interrupted'; message: string; content?: ReactNode; resume?: () => void | Promise<void> }
  | { status: 'generated'; view: GeneratedView; trustedBlobHost?: string }
  | { status: 'ready'; content: ReactNode };

export interface WorkspaceView {
  id: string;
  title: string;
  content: WorkspaceViewContent;
  /** `conversation` hosts the shell's conversation history: glass material and a visually hidden title. */
  presentation?: 'conversation' | 'camera-preview';
  initialGeometry?: Partial<WorkspaceGeometry>;
  /** Starts as a tab in the tab bar (for example a window pinned before a reload). */
  initiallyMinimised?: boolean;
  /** The owner removes the view itself when it closes, so reopening it later starts fresh. */
  onClose?: () => void;
}

export interface WorkspaceController {
  dispatch: (command: WorkspaceCommand, trustedBlobHost?: string) => boolean;
  minimiseAll: () => void;
  hasVisibleViews: () => boolean;
  /** True when the view is open, not minimised and, on phones, the foreground view. */
  isViewVisible?: (viewId: string) => boolean;
  /** Applies a current-session command (language, voice, camera) and resolves once the UI action has finished. */
  applySession?: (command: SessionCommand) => Promise<SessionCommandResult>;
  /** Confirms a pin change only after the owner's store accepts it. */
  applyPin?: (command: Extract<WorkspaceCommand, { operation: 'pin' | 'unpin' }>) => Promise<SessionCommandResult>;
  snapshot?: WorkspaceSnapshot;
}

export const PHONE_LAYOUT_MEDIA_QUERY = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)';
type Arrangement = 'tiled' | 'layered';
export type WorkspaceGeometry = { x: number; y: number; width: number; height: number; columns: number; rows: number };
type Geometry = WorkspaceGeometry;
type PendingFocus = { target: 'tab' | 'window'; viewId: string } | { target: 'workspace' };
type Gesture = {
  id: string;
  kind: 'move' | 'resize';
  x: number;
  y: number;
  geometry: Geometry;
  previousGeometry: Geometry | undefined;
  previousPlacement: WindowPlacement | undefined;
  edge: 'right' | 'bottom' | undefined;

};

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000;
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;

function WindowIcon({ name }: { name: 'minimise' | 'maximise' | 'restore' | 'close' | 'view' | 'more' | 'pin' }) {
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
    case 'pin':
      return <svg {...common}><path d="m14.5 3.5 6 6-3 1.5-3.5 3.5.5 4-1.5 1.5-3.5-3.5L5 21l-.5-.5L9 16l-3.5-3.5L7 11l4 .5 3.5-3.5z" /></svg>;
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
  onOpenWindowsChange?: (windows: WorkspaceSnapshot['windows']) => void;
  /** Ids of views currently shown (not minimised or closed; on phones only the foreground view). */
  onVisibleViewIdsChange?: (ids: readonly string[]) => void;
  /** The window in front (what Dan is looking at), or null when none is visible. */
  onFrontViewChange?: (viewId: string | null) => void;
  /** The shell's tab bar under the top bar; minimised windows become tabs there. */
  tabsHost?: HTMLElement | null;
  /** The shell floats windows freely (drag to move) instead of tiling them. */
  defaultArrangement?: Arrangement;
  /** The per-window Arrange menu; the shell drops it in favour of dragging and title-bar arrow keys. */
  arrangeMenu?: boolean;
  /** Leaves a window out of the tab bar (for example a progress window already shown as a job tab). */
  hideTab?: (view: WorkspaceView) => boolean;
  /** Authenticated persistence for generated windows. Omit it when persistent pins are unavailable. */
  pins?: WorkspacePinsClient;
}>(function Workspace({ views, onVisibleViewsChange, onOpenWindowsChange, onVisibleViewIdsChange, onFrontViewChange, tabsHost, defaultArrangement = 'tiled', arrangeMenu = true, hideTab, pins }, ref) {
  const workspaceId = useId();
  const [agentViews, setAgentViews] = useState<WorkspaceView[]>([]);
  const closedAgentViews = useRef(new Map<string, { view: WorkspaceView; geometry: Geometry | undefined }>());
  const workspaceViews = useMemo(() => [
    ...views,
    ...agentViews.filter((agentView) => !views.some((view) => view.id === agentView.id)),
  ], [agentViews, views]);
  const [arrangement, setArrangement] = useState<Arrangement>(defaultArrangement);

  const [order, setOrder] = useState<string[]>([]);
  const [geometry, setGeometry] = useState<Record<string, Geometry>>({});
  const [minimizedViewIdsState, setMinimizedViewIds] = useState<ReadonlySet<string>>(new Set());
  const [closedViewIdsState, setClosedViewIds] = useState<ReadonlySet<string>>(new Set());
  const [maximizedViewId, setMaximizedViewId] = useState<string | null>(null);
  const [foregroundViewId, setForegroundViewId] = useState<string | null>(null);
  const [phone, setPhone] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia(PHONE_LAYOUT_MEDIA_QUERY).matches
  ));
  const [announcement, setAnnouncement] = useState('');
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actionSuccess, setActionSuccess] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set());
  const [jarvisUpdatingIds, setJarvisUpdatingIds] = useState<ReadonlySet<string>>(new Set());
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);
  // Window management by intent (P8-42): the shell arranges its windows itself (smart fit), and Jarvis or Dan can
  // place a window in a region, pick a layout or drag a window to leave it alone (manual).
  const [placements, setPlacements] = useState<Record<string, WindowPlacement>>({});
  const [layoutKind, setLayoutKind] = useState<WindowLayout>('auto');
  const [layoutPreference, setLayoutPreference] = useState<string[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [pinnedViewIds, setPinnedViewIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingPinState, setPendingPinState] = useState<{ owner: WorkspacePinsClient | undefined; ids: ReadonlySet<string> }>({ owner: pins, ids: new Set() });
  const pendingPinIds = pendingPinState.owner === pins ? pendingPinState.ids : new Set<string>();
  const pinOwner = useRef(pins);
  const pinRevisions = useRef(new Map<string, number>());
  const persistedPinViews = useRef(new Map<string, GeneratedView>());
  const pinRequests = useRef(new Map<string, {
    request: { owner: WorkspacePinsClient; controller: AbortController; signal: AbortSignal; pinned: boolean; view: GeneratedView };
    result: Promise<SessionCommandResult>;
  }>());
  const [pinLoadAttempt, setPinLoadAttempt] = useState(0);
  const [pinLoadError, setPinLoadError] = useState('');
  const [pinFeedback, setPinFeedback] = useState<{
    tone: 'status' | 'alert'; message: string;
    retry?: { id: string; pinned: boolean; refresh: boolean };
  } | null>(null);
  const [narrowScreen, setNarrow] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches
  ));
  // The shell's floating windows keep floating on narrower desktops; only the classic workspace stacks them.
  const narrow = arrangeMenu && narrowScreen;
  const canvas = useRef<HTMLDivElement>(null);
  const gestures = useRef(new Map<number, Gesture>());
  const pendingActionsRef = useRef(new Set<string>());
  const jarvisUpdateTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const workspaceSection = useRef<HTMLElement>(null);
  const windowElements = useRef(new Map<string, HTMLElement>());
  const windowHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<PendingFocus | null>(null);
  const swipe = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 900px)');
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => () => {
    for (const timer of jarvisUpdateTimers.current.values()) clearTimeout(timer);
    jarvisUpdateTimers.current.clear();
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.(PHONE_LAYOUT_MEDIA_QUERY);
    if (!media) return;
    const update = () => {
      swipe.current = null;
      if (media.matches) {
        const focusedView = [...windowElements.current].find(([, element]) => element.contains(document.activeElement));
        if (focusedView) setForegroundViewId(focusedView[0]);
      }
      setPhone(media.matches);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const orderedViews = useMemo(() => {
    const initialOrder = new Map(workspaceViews.map((view, index) => [view.id, index]));
    const currentOrder = new Map(order.map((id, index) => [id, index]));
    return [...workspaceViews].sort((left, right) => (
      (currentOrder.get(left.id) ?? order.length + initialOrder.get(left.id)!) -
      (currentOrder.get(right.id) ?? order.length + initialOrder.get(right.id)!)
    ));
  }, [order, workspaceViews]);
  const viewIds = useMemo(() => new Set(workspaceViews.map(({ id }) => id)), [workspaceViews]);
  const currentViews = useRef(workspaceViews);
  useLayoutEffect(() => { currentViews.current = workspaceViews; }, [workspaceViews]);
  useEffect(() => {
    pinOwner.current = pins;
    const requests = pinRequests.current;
    return () => {
      pinOwner.current = undefined;
      for (const { request } of requests.values()) {
        if (request.owner === pins) request.controller.abort();
      }
    };
  }, [pins]);
  useEffect(() => {
    if (!pins) return;
    const controller = new AbortController();
    const revisions = new Map(pinRevisions.current);
    void pins.load(controller.signal).then((storedPins) => {
      if (controller.signal.aborted) return;
      setPinLoadError('');
      const confirmed = storedPins.filter((pin) =>
        pinRevisions.current.get(pin.viewId) === revisions.get(pin.viewId));
      const confirmedIds = new Set(confirmed.map((pin) => pin.viewId));
      for (const id of persistedPinViews.current.keys()) {
        if (!confirmedIds.has(id) && pinRevisions.current.get(id) === revisions.get(id)) persistedPinViews.current.delete(id);
      }
      for (const pin of confirmed) persistedPinViews.current.set(pin.viewId, pin.view);
      const existing = new Set(currentViews.current.map((view) => view.id));
      const restored = confirmed.filter((pin) => !existing.has(pin.viewId));
      setAgentViews((current) => {
        const present = new Set(current.map((view) => view.id));
        const added = restored
          .filter((pin) => !present.has(pin.viewId))
          .map((pin): WorkspaceView => ({
            id: pin.viewId,
            title: pin.view.title,
            initiallyMinimised: true,
            content: {
              status: 'generated',
              view: pin.view,
              ...((pin.trustedBlobHost ?? pins.trustedBlobHost) ? { trustedBlobHost: pin.trustedBlobHost ?? pins.trustedBlobHost } : {}),
            },
          }));
        return added.length ? [...current, ...added] : current;
      });
      const ids = confirmed.map((pin) => pin.viewId);
      setPinnedViewIds((current) => new Set([
        ...[...current].filter((id) => confirmedIds.has(id) || pinRevisions.current.get(id) !== revisions.get(id)),
        ...ids,
      ]));
      setMinimizedViewIds((current) => new Set([...current, ...restored.map((pin) => pin.viewId)]));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setPinLoadError(error instanceof Error ? error.message : 'Pinned windows could not be loaded. Try again.');
      }
    });
    return () => controller.abort();
  }, [pinLoadAttempt, pins]);
  useEffect(() => {
    if (!pinLoadError) return;
    const retry = () => {
      if (document.visibilityState !== 'hidden') {
        setPinLoadError('');
        setPinLoadAttempt((attempt) => attempt + 1);
      }
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [pinLoadError]);
  // Views that arrive already pinned start as tabs; each id is only considered once while it stays present.
  const seenViewIds = useRef(new Set<string>());
  useLayoutEffect(() => {
    const pinned = workspaceViews.filter((view) => view.initiallyMinimised && !seenViewIds.current.has(view.id)).map((view) => view.id);
    seenViewIds.current = new Set(workspaceViews.map((view) => view.id));
    if (pinned.length) setMinimizedViewIds((current) => new Set([...current, ...pinned]));
  }, [workspaceViews]);
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
  const primaryViews = useMemo(() => visibleViews.filter((view) => view.presentation !== 'camera-preview'), [visibleViews]);
  const foreground = primaryViews.find((view) => view.id === foregroundViewId) ?? primaryViews[0] ?? visibleViews[0];

  // What each window shows (P9-63), read after the content settles and sent with the snapshot.
  const reported = useMemo(() => openViews.slice(0, 32), [openViews]);
  const readback = useReadback(() => {
    const result: Record<string, WindowReadback> = {};
    for (const view of reported) {
      const element = windowElements.current.get(view.id);
      // Jarvis already holds the conversation transcript; windows only report what the backend does not own.
      const body = view.presentation === 'conversation' ? null : element?.querySelector('.workspace-view-content');
      const found = body ? readElement(body, view.content.status === 'generated' ? view.content.view : undefined) : undefined;
      if (found) result[view.id] = found;
    }
    return result;
  }, Boolean(onOpenWindowsChange), reported.map(({ id }) => id).join('\n'));
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      setCanvasSize((current) => Math.abs(current.width - box.width) < .1 && Math.abs(current.height - box.height) < .1
        ? current : { width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Only the shell's floating desktop windows are managed; the classic workspace and phones keep their own rules.
  // Layout follows the order windows opened (not stacking order), so raising a window never reshuffles the screen.
  const managed = !arrangeMenu && arrangement === 'layered' && !phone;
  const layoutIds = useMemo(() => workspaceViews
    .filter((view) => view.presentation !== 'conversation' && (view.presentation !== 'camera-preview' || placements[view.id]?.mode === 'region') && !closedViewIds.has(view.id) && !minimizedViewIds.has(view.id) &&
      view.id !== activeMaximizedViewId)
    .map((view) => view.id), [activeMaximizedViewId, closedViewIds, minimizedViewIds, placements, workspaceViews]);
  const autoRects = useMemo(() => managed && canvasSize.width > 0
    ? layoutWindows({ ids: layoutOrder(layoutIds, layoutPreference), placements, layout: layoutKind, size: canvasSize })
    : {}, [canvasSize, layoutIds, layoutKind, layoutPreference, managed, placements]);

  const frontId = (phone ? foreground?.id : activeMaximizedViewId ?? visibleViews.at(-1)?.id) ?? null;
  const snapshotWindows = useMemo<WorkspaceSnapshot['windows']>(() => openViews.slice(0, 32).map(({ id, title }) => {
    const placement = placements[id] ?? { mode: 'auto' as const };
    return {
      viewId: id,
      title,
      ...readback?.[id],
      state: minimizedViewIds.has(id) ? 'minimised' : 'open',
      placement: placement.mode,
      ...(placement.mode === 'region' ? { region: placement.region } : {}),
      pinned: pinnedViewIds.has(id),
      front: id === frontId,
    };
  }), [frontId, minimizedViewIds, openViews, pinnedViewIds, placements, readback]);
  useEffect(() => {
    onOpenWindowsChange?.(snapshotWindows);
  }, [onOpenWindowsChange, snapshotWindows]);
  useEffect(() => { onFrontViewChange?.(frontId); }, [frontId, onFrontViewChange]);

  useLayoutEffect(() => {
    onVisibleViewsChange?.(visibleViews.length > 0);
  }, [onVisibleViewsChange, visibleViews.length]);

  const shownViewIds = (phone ? visibleViews.filter((view) => view.id === foreground?.id || view.presentation === 'camera-preview')
    : visibleViews).map((view) => view.id).join('\n');
  useLayoutEffect(() => {
    onVisibleViewIdsChange?.(shownViewIds ? shownViewIds.split('\n') : []);
  }, [onVisibleViewIdsChange, shownViewIds]);

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
  }, [closedViewIdsState, minimizedViewIdsState, openViews, foreground?.id, phone]);

  const initialGeometry = useCallback((id: string, index: number): Geometry => ({
    ...defaultGeometry(index),
    ...workspaceViews.find((view) => view.id === id)?.initialGeometry,
  }), [workspaceViews]);

  function geometryFor(id: string, index: number): Geometry {
    const arranged = activeGestureId === id ? undefined : autoRects[id];
    const stored = geometry[id] ?? initialGeometry(id, index);
    return arranged ? { ...stored, ...arranged } : stored;
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
      view.id, current[view.id] ?? initialGeometry(view.id, index),
    ])));
    setOrder(ids);
    setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} ${label}.`);
    return true;
  }, [initialGeometry, orderedViews, workspaceViews]);

  const isViewOpen = useCallback((id: string) => {
    return workspaceViews.some((view) => view.id === id) && !closedViewIds.has(id);
  }, [closedViewIds, workspaceViews]);

  const minimiseView = useCallback((id: string): boolean => {
    if (!isViewOpen(id)) return false;
    if (minimizedViewIds.has(id)) return true;
    if (windowElements.current.get(id)?.contains(document.activeElement)) {
      pendingFocus.current = { target: 'tab', viewId: id };
    }
    setMaximizedViewId((current) => current === id ? null : current);
    setMinimizedViewIds((current) => new Set(current).add(id));
    // Every window except the docked conversation (which tucks into the composer) is thrown up to its tab.
    if (workspaceViews.find((view) => view.id === id)?.presentation !== 'conversation') {
      flyWindowToTab(windowElements.current.get(id), () => tabElements.current.get(id) ?? null);
    }
    setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} minimised.`);
    return true;
  }, [isViewOpen, minimizedViewIds, workspaceViews]);

  const restoreView = useCallback((id: string): boolean => {
    const retained = closedAgentViews.current.get(id);
    if (retained) {
      closedAgentViews.current.delete(id);
      setAgentViews((current) => [...current, retained.view]);
      if (retained.geometry) setGeometry((current) => ({ ...current, [id]: retained.geometry! }));
      pendingFocus.current = { target: 'window', viewId: id };
    } else if (!workspaceViews.some((view) => view.id === id)) return false;
    setClosedViewIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setForegroundViewId(id);
    setMaximizedViewId((current) => current === id ? current : null);
    setOrder((current) => {
      const existing = new Set(workspaceViews.map((view) => view.id));
      if (retained) existing.add(id);
      const ids = [...current.filter((candidate) => existing.has(candidate)),
        ...workspaceViews.filter((view) => !current.includes(view.id)).map((view) => view.id)];
      if (retained && !ids.includes(id)) ids.push(id);
      return ids.at(-1) === id ? current : [...ids.filter((candidate) => candidate !== id), id];
    });
    // On phones the restored view becomes foreground; move focus with it only from inside the workspace.
    const focusInWorkspace = !document.activeElement || document.activeElement === document.body ||
      workspaceSection.current?.contains(document.activeElement);
    if (document.activeElement === tabElements.current.get(id) || (phone && foreground?.id !== id && focusInWorkspace)) {
      pendingFocus.current = { target: 'window', viewId: id };
    }
    setMinimizedViewIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setAnnouncement(`${retained?.view.title ?? workspaceViews.find((view) => view.id === id)?.title} restored.`);
    return true;
  }, [foreground?.id, phone, workspaceViews]);

  const closeView = useCallback((id: string, reversible = false): boolean => {
    const pinRequest = pinRequests.current.get(id);
    if (pinRequest && !pinRequest.request.signal.aborted) return false;
    if (pinnedViewIds.has(id)) {
      const minimised = minimiseView(id);
      if (minimised) setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} kept as a pinned tab.`);
      return minimised;
    }
    const generated = agentViews.some((view) => view.id === id);
    if (!workspaceViews.some((view) => view.id === id)) return false;
    if (closedViewIds.has(id)) return true;
    if (!minimizedViewIds.has(id)) flyWindowAway(windowElements.current.get(id));
    if (windowElements.current.get(id)?.contains(document.activeElement)) {
      const remaining = openViews.filter((view) => view.id !== id);
      const next = remaining.find((view) => !minimizedViewIds.has(view.id)) ?? remaining[0];
      pendingFocus.current = next
        ? { target: minimizedViewIds.has(next.id) ? 'tab' : 'window', viewId: next.id }
        : { target: 'workspace' };
    }
    if (generated) {
      const view = agentViews.find((view) => view.id === id)!;
      if (reversible) {
        closedAgentViews.current.set(id, { view, geometry: geometry[id] });
        if (closedAgentViews.current.size > 8) {
          closedAgentViews.current.delete(closedAgentViews.current.keys().next().value!);
        }
      } else {
        closedAgentViews.current.delete(id);
      }
      setAgentViews((current) => current.filter((view) => view.id !== id));
      setClosedViewIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setGeometry((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setOrder((current) => current.filter((viewId) => viewId !== id));
    } else {
      const owned = workspaceViews.find((view) => view.id === id)?.onClose;
      if (owned) {
        owned();
        setGeometry((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setOrder((current) => current.filter((viewId) => viewId !== id));
      } else {
        setClosedViewIds((current) => new Set(current).add(id));
      }
    }
    setMinimizedViewIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setMaximizedViewId((current) => current === id ? null : current);
    setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} closed.`);
    return true;
  }, [agentViews, closedViewIds, geometry, minimiseView, minimizedViewIds, openViews, pinnedViewIds, workspaceViews]);

  const focusView = useCallback((id: string): boolean => {
    if (!isViewOpen(id)) return false;
    restoreView(id);
    if (minimizedViewIds.has(id) || (phone && foreground?.id !== id) || (activeMaximizedViewId && activeMaximizedViewId !== id)) pendingFocus.current = { target: 'window', viewId: id };
    else windowHeadings.current.get(id)?.focus();
    if (phone) setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} foreground.`);
    return true;
  }, [activeMaximizedViewId, foreground?.id, isViewOpen, minimizedViewIds, phone, restoreView, workspaceViews]);

  function switchView(offset: number) {
    const index = primaryViews.findIndex((view) => view.id === foreground?.id);
    const next = primaryViews[index + offset];
    if (next) focusView(next.id);
  }

  function beginSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!phone || event.pointerType !== 'touch' || !event.isPrimary || visibleViews.length < 2) return;
    if (!(event.target instanceof Element) || event.target.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')) return;
    for (let element = event.target; element !== event.currentTarget; element = element.parentElement!) {
      if (element.scrollWidth > element.clientWidth) return;
    }
    swipe.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || start.pointerId !== event.pointerId) return;
    swipe.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel') return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) switchView(dx < 0 ? 1 : -1);
  }

  const minimiseAll = useCallback(() => {
    const ids = visibleViews.map(({ id }) => id);
    if (ids.length === 0) return;
    const focusedId = ids.find((id) => windowElements.current.get(id)?.contains(document.activeElement));
    if (focusedId) pendingFocus.current = { target: 'tab', viewId: focusedId };
    setMaximizedViewId(null);
    setMinimizedViewIds((current) => new Set([...current, ...ids]));
    setAnnouncement(`${ids.length} ${ids.length === 1 ? 'window' : 'windows'} minimised.`);
  }, [visibleViews]);

  const requestPinChange = useCallback((id: string, nextPinned: boolean, updatedView?: GeneratedView): Promise<SessionCommandResult> => {
    const refuse = (reason: string) => Promise.resolve<SessionCommandResult>({ applied: false, reason });
    if (!pins || pinOwner.current !== pins) return refuse('Window pinning is unavailable.');
    if (!isViewOpen(id)) return refuse('This window is no longer open.');
    const pending = pinRequests.current.get(id);
    if (pending && !pending.request.signal.aborted) {
      if (pending.request.pinned !== nextPinned) {
        if (updatedView) pending.request.view = updatedView;
        return refuse('A pin change is already in progress. Try again when it finishes.');
      }
      if (updatedView) pending.request.view = updatedView;
      return pending.result;
    }
    if (!updatedView && pinnedViewIds.has(id) === nextPinned) return Promise.resolve({ applied: true });
    const view = workspaceViews.find((candidate) => candidate.id === id);
    if (!view) return refuse('This window is no longer available.');
    const generated = updatedView ?? (view.content.status === 'generated' ? view.content.view : persistedPinViews.current.get(id));
    if (!generated || (nextPinned && view.content.status !== 'generated')) return refuse('Only generated windows can be pinned.');
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    const request = { owner: pins, controller, signal, pinned: nextPinned, view: generated };
    pinRevisions.current.set(id, (pinRevisions.current.get(id) ?? 0) + 1);
    setPendingPinState((current) => ({
      owner: pins, ids: new Set(current.owner === pins ? current.ids : []).add(id),
    }));
    setPinFeedback(null);
    const result = Promise.resolve().then(async (): Promise<SessionCommandResult> => {
      try {
        if (nextPinned) {
          // Updates arriving during a save share its acknowledgement and finish with the latest view.
          let saved: GeneratedView;
          do {
            saved = request.view;
            await awaitWithSignal(() => pins.pin(id, saved, signal), signal);
          } while (saved !== request.view);
        } else {
          await awaitWithSignal(() => pins.unpin(id, signal), signal);
        }
        signal.throwIfAborted();
        if (pinOwner.current !== pins) return { applied: false, reason: 'This workspace is no longer active.' };
        if (nextPinned) persistedPinViews.current.set(id, request.view);
        else persistedPinViews.current.delete(id);
        setPinnedViewIds((current) => {
          const updated = new Set(current);
          if (nextPinned) updated.add(id);
          else updated.delete(id);
          return updated;
        });
        const message = `${nextPinned ? request.view.title : view.title} ${nextPinned ? 'pinned' : 'unpinned'}.`;
        setAnnouncement(message);
        setPinFeedback({ tone: 'status', message });
        return { applied: true };
      } catch (error: unknown) {
        if (controller.signal.aborted || pinOwner.current !== pins) {
          return { applied: false, reason: 'This workspace is no longer active; the pin change could not be confirmed.' };
        }
        const detail = signal.aborted ? 'The pin change timed out. Try again.'
          : error instanceof Error ? error.message : `This window could not be ${nextPinned ? 'pinned' : 'unpinned'}. Try again.`;
        const message = (updatedView || request.view !== generated) && pinnedViewIds.has(id)
          ? `The window was updated, but its saved pin update could not be confirmed. ${detail}` : detail;
        setPinFeedback({ tone: 'alert', message, retry: { id, pinned: nextPinned, refresh: Boolean(updatedView) } });
        return { applied: false, reason: message };
      } finally {
        if (pinRequests.current.get(id)?.request === request) {
          pinRevisions.current.set(id, (pinRevisions.current.get(id) ?? 0) + 1);
          pinRequests.current.delete(id);
          if (pinOwner.current === pins) setPendingPinState((current) => {
            if (current.owner !== pins) return current;
            const ids = new Set(current.ids);
            ids.delete(id);
            return { owner: pins, ids };
          });
        }
      }
    });
    pinRequests.current.set(id, { request, result });
    return result;
  }, [isViewOpen, pinnedViewIds, pins, workspaceViews]);

  const dispatchCommand = useCallback((command: WorkspaceCommand, trustedBlobHost?: string): boolean => {
    const viewIndex = 'viewId' in command
      ? orderedViews.findIndex((view) => view.id === command.viewId)
      : -1;
    const shimmerUpdatedView = (viewId: string) => {
      setJarvisUpdatingIds((current) => new Set(current).add(viewId));
      const previous = jarvisUpdateTimers.current.get(viewId);
      if (previous) clearTimeout(previous);
      jarvisUpdateTimers.current.set(viewId, setTimeout(() => {
        jarvisUpdateTimers.current.delete(viewId);
        setJarvisUpdatingIds((current) => {
          if (!current.has(viewId)) return current;
          const next = new Set(current);
          next.delete(viewId);
          return next;
        });
      }, 1_200));
    };
    const titleOf = (id: string) => workspaceViews.find((view) => view.id === id)?.title ?? 'Window';
    const bringForward = (id: string) => {
      const index = orderedViews.findIndex((view) => view.id === id);
      if (index >= 0 && index !== orderedViews.length - 1) reorder(id, orderedViews.length - index - 1, 'brought forward');
    };
    // Window intents (P8-42): Jarvis names what he wants; the layout engine works out the geometry.
    function applyIntent(intent: Extract<WorkspaceCommand, { operation: 'place' | 'arrange' | 'minimise-all' | 'restore-all' | 'close-all' }>): boolean {
      switch (intent.operation) {
        case 'place': {
          if (!isViewOpen(intent.viewId)) return false;
          if (!managed) return focusView(intent.viewId);
          if (workspaceViews.find((view) => view.id === intent.viewId)?.presentation === 'conversation') return false;
          if (minimizedViewIds.has(intent.viewId)) restoreView(intent.viewId);
          setMaximizedViewId((current) => current === intent.viewId ? null : current);
          setPlacements((current) => {
            // One window per region: whoever held it goes back to the automatic layout.
            const next: Record<string, WindowPlacement> = {};
            for (const [id, placement] of Object.entries(current)) {
              next[id] = placement.mode === 'region' && placement.region === intent.region ? { mode: 'auto' } : placement;
            }
            next[intent.viewId] = { mode: 'region', region: intent.region };
            return next;
          });
          bringForward(intent.viewId);
          setAnnouncement(`${titleOf(intent.viewId)} moved to the ${intent.region === 'full' ? 'whole screen' : intent.region}.`);
          return true;
        }
        case 'arrange': {
          const targets = intent.viewIds;
          if (targets && !targets.every((id) => isViewOpen(id))) return false;
          if (!managed) return targets?.[0] ? focusView(targets[0]) : true;
          if (targets?.some((id) => workspaceViews.find((view) => view.id === id)?.presentation === 'conversation')) return false;
          if (targets) {
            // The named windows share the screen; the others step aside as tabs, one tap away.
            for (const view of visibleViews) {
              if (view.presentation !== 'conversation' && !targets.includes(view.id)) minimiseView(view.id);
            }
            for (const id of targets) if (minimizedViewIds.has(id)) restoreView(id);
          }
          setMaximizedViewId(null);
          setLayoutKind(intent.layout);
          setLayoutPreference(targets && intent.layout === 'cascade' ? [...targets].reverse() : targets ?? []);
          if (targets && intent.layout === 'cascade') {
            setOrder([...orderedViews.filter((view) => !targets.includes(view.id)).map((view) => view.id), ...[...targets].reverse()]);
          }
          setPlacements((current) => targets
            ? Object.fromEntries(Object.entries(current).filter(([id]) => !targets.includes(id)))
            : {});
          setAnnouncement(intent.layout === 'auto' ? 'Windows tidied.' : `Windows arranged ${intent.layout === 'cascade' ? 'in a stack' : intent.layout.replaceAll('-', ' ')}.`);
          return true;
        }
        case 'minimise-all':
          minimiseAll();
          return true;
        case 'restore-all': {
          const ids = minimizedViews.map((view) => view.id);
          for (const id of ids) restoreView(id);
          setAnnouncement(`${ids.length} ${ids.length === 1 ? 'window' : 'windows'} restored.`);
          return true;
        }
        case 'close-all': {
          const ids = openViews.map((view) => view.id);
          if (ids.some((id) => {
            const pending = pinRequests.current.get(id);
            return pending && !pending.request.signal.aborted;
          })) {
            setAnnouncement('Wait for the pending pin changes before closing all windows.');
            return false;
          }
          for (const id of ids) closeView(id, true);
          setAnnouncement(`${ids.length} ${ids.length === 1 ? 'window' : 'windows'} closed.`);
          return true;
        }
      }
    }
    if (!isWorkspaceCommand(command, trustedBlobHost ? { trustedBlobHost } : undefined)) return false;
    switch (command.operation) {
      case 'create':
        if (workspaceViews.some((view) => view.id === command.viewId)) return false;
        closedAgentViews.current.delete(command.viewId);
        setAgentViews((current) => [...current, {
          id: command.viewId,
          title: command.view.title,
          content: {
            status: 'generated',
            view: command.view,
            ...(trustedBlobHost ? { trustedBlobHost } : {}),
          },
        }]);
        setGeometry((current) => ({ ...current, [command.viewId]: defaultGeometry(workspaceViews.length) }));
        setForegroundViewId(command.viewId);
        setMaximizedViewId(null);
        setAnnouncement(`${command.view.title} created.`);
        shimmerUpdatedView(command.viewId);
        return true;
      case 'update':
        if (!agentViews.some((view) => view.id === command.viewId) || closedViewIds.has(command.viewId)) return false;
        setAgentViews((current) => current.map((view) => view.id === command.viewId
          ? {
            ...view,
            title: command.view.title,
            content: {
              status: 'generated',
              view: command.view,
              ...(trustedBlobHost ? { trustedBlobHost } : {}),
            },
          }
          : view));
        setAnnouncement(`${command.view.title} updated.`);
        shimmerUpdatedView(command.viewId);
        if (pinnedViewIds.has(command.viewId) || pinRequests.current.get(command.viewId)?.request.pinned) {
          void requestPinChange(command.viewId, true, command.view);
        }
        return true;
      case 'show':
        return focusView(command.viewId);
      case 'close':
        return closeView(command.viewId, true);
      case 'minimise':
        return minimiseView(command.viewId);
      case 'restore':
        return restoreView(command.viewId);
      case 'focus':
        return focusView(command.viewId);
      case 'move': {
        if (!isViewOpen(command.viewId) || viewIndex < 0) return false;
        if (phone) return focusView(command.viewId);
        if (workspaceViews.find((view) => view.id === command.viewId)?.presentation === 'conversation') return false;
        const current = { ...(geometry[command.viewId] ?? initialGeometry(command.viewId, viewIndex)), ...autoRects[command.viewId] };
        if (command.x + current.width > 1 || command.y + current.height > 1) return false;
        setGeometry((value) => ({
          ...value,
          [command.viewId]: { ...current, x: command.x, y: command.y },
        }));
        setPlacements((value) => ({ ...value, [command.viewId]: { mode: 'manual' } }));
        setAnnouncement(`${workspaceViews.find((view) => view.id === command.viewId)?.title} moved.`);
        return true;
      }
      case 'resize': {
        if (!isViewOpen(command.viewId) || viewIndex < 0) return false;
        if (phone) return focusView(command.viewId);
        if (workspaceViews.find((view) => view.id === command.viewId)?.presentation === 'conversation') return false;
        const current = { ...(geometry[command.viewId] ?? initialGeometry(command.viewId, viewIndex)), ...autoRects[command.viewId] };
        const x = command.x ?? current.x;
        const y = command.y ?? current.y;
        if (x + command.width > 1 || y + command.height > 1) return false;
        setGeometry((value) => ({
          ...value,
          [command.viewId]: {
            ...(value[command.viewId] ?? current), x, y, width: command.width, height: command.height,
            columns: command.width > 0.72 ? 2 : 1, rows: command.height > 0.72 ? 2 : 1,
          },
        }));
        setPlacements((value) => ({ ...value, [command.viewId]: { mode: 'manual' } }));
        setAnnouncement(`${workspaceViews.find((view) => view.id === command.viewId)?.title} resized.`);
        return true;
      }
      case 'layout':
        // The shell arranges by intent: tiled means the automatic layout, layered means a stack (cascade).
        if (!arrangeMenu) return applyIntent({
          commandId: command.commandId,
          operation: 'arrange',
          layout: command.arrangement === 'tiled' ? 'auto' : 'cascade',
        });
        setArrangement(command.arrangement);
        setAnnouncement(`Workspace arranged in ${command.arrangement} layout.`);
        return true;
      case 'place':
      case 'arrange':
      case 'minimise-all':
      case 'restore-all':
      case 'close-all':
        return applyIntent(command);
      case 'pin':
      case 'unpin':
        // Persistent actions use applyPin so callers cannot acknowledge a request before storage confirms it.
        return false;
      case 'context-panel':
        return false;
      default:
        // Operations the window manager does not handle (for example `navigate`, which the shell applies) are refused
        // here, so a new contract operation never breaks the build or silently counts as applied.
        return false;
    }
  }, [agentViews, arrangeMenu, autoRects, closeView, closedViewIds, focusView, geometry, initialGeometry, isViewOpen, jarvisUpdateTimers, managed, minimiseAll,
    minimiseView, minimizedViewIds, minimizedViews, openViews, orderedViews, phone, pinnedViewIds, reorder, requestPinChange, restoreView, visibleViews, workspaceViews]);


  useImperativeHandle(ref, () => ({
    dispatch: dispatchCommand,
    applyPin: (command) => isWorkspaceCommand(command)
      && (command.operation === 'pin' || command.operation === 'unpin')
      ? requestPinChange(command.viewId, command.operation === 'pin')
      : Promise.resolve({ applied: false, reason: 'This pin command is invalid.' }),
    minimiseAll,
    hasVisibleViews: () => visibleViews.length > 0,
    isViewVisible: (viewId: string) => visibleViews.some((view) => view.id === viewId &&
      (!phone || foreground?.id === viewId || view.presentation === 'camera-preview')),
    snapshot: { windows: snapshotWindows, contextPanelOpen: false },
  }), [dispatchCommand, foreground?.id, minimiseAll, phone, requestPinChange, snapshotWindows, visibleViews]);

  function raiseView(event: { target: EventTarget }, id: string) {
    if (arrangement !== 'layered' || narrow) return;
    if (event.target instanceof Element && event.target.closest(
      '.workspace-window-actions button:not(.workspace-move-handle):not(.workspace-resize-handle), .workspace-window-actions summary',
    )) return;
    const index = orderedViews.findIndex((view) => view.id === id);
    if (index >= 0) reorder(id, orderedViews.length - index - 1, 'brought forward');
  }

  function updateGeometry(id: string, update: (current: Geometry) => Geometry, index: number) {
    // Dragging or resizing an arranged window makes it manual: it starts from where it is and is then left alone.
    if (autoRects[id]) {
      const from = geometryFor(id, index);
      setPlacements((current) => ({ ...current, [id]: { mode: 'manual' } }));
      setGeometry((current) => ({ ...current, [id]: update(from) }));
      return;
    }
    setGeometry((current) => ({ ...current, [id]: update(current[id] ?? initialGeometry(id, index)) }));
  }

  function moveBy(id: string, dx: number, dy: number, index: number) {
    updateGeometry(id, (current) => ({
      ...current,
      x: clamp(current.x + dx, 0, 1 - current.width),
      y: clamp(current.y + dy, 0, 1 - current.height),
    }), index);
    setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} moved.`);
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
    setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} resized.`);
  }

  function adjustTileSize(id: string, columns: number, rows: number, index: number) {
    updateGeometry(id, (current) => ({
      ...current,
      columns: clamp(current.columns + columns, 1, 2),
      rows: clamp(current.rows + rows, 1, 2),
    }), index);
    setAnnouncement(`${workspaceViews.find((view) => view.id === id)?.title} size changed.`);
  }

  function beginGesture(event: PointerEvent<HTMLElement>, id: string, kind: 'move' | 'resize', index: number, edge?: 'right' | 'bottom') {
    if (phone) return;
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    if (activeMaximizedViewId === id) return;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveGestureId(id);
    const stored = geometryFor(id, index);
    const visible = windowElements.current.get(id)?.getBoundingClientRect();
    const start = arrangement === 'layered' && !narrow && bounds.width && bounds.height && visible?.width && visible.height
      ? { ...stored, x: (visible.left - bounds.left) / bounds.width, y: (visible.top - bounds.top) / bounds.height,
        width: visible.width / bounds.width, height: visible.height / bounds.height }
      : stored;
    setGeometry((current) => ({ ...current, [id]: start }));
    gestures.current.set(event.pointerId, {
      id,
      kind,
      x: event.clientX,
      y: event.clientY,
      geometry: start,
      previousGeometry: geometry[id],
      previousPlacement: placements[id],
      edge,
    });
  }

  function updateGesture(event: PointerEvent<HTMLElement>) {
    const gesture = gestures.current.get(event.pointerId);
    const bounds = canvas.current?.getBoundingClientRect();
    if (!gesture || !bounds?.width || !bounds.height) return;
    // A click with a slight wobble is not a drag: only a real move (4 px) takes a window out of the automatic layout.
    if (autoRects[gesture.id] && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return;
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
        const x = clamp(gesture.geometry.x + dx, 0, 1 - gesture.geometry.width);
        const y = clamp(gesture.geometry.y + dy, 0, 1 - gesture.geometry.height);
        return { ...current, x, y, width: gesture.geometry.width, height: gesture.geometry.height };
      }
      const availableWidth = 1 - gesture.geometry.x;
      const availableHeight = 1 - gesture.geometry.y;
      const width = clamp(gesture.geometry.width + dx, Math.min(0.32, availableWidth), availableWidth);
      const height = clamp(gesture.geometry.height + dy, Math.min(0.34, availableHeight), availableHeight);
      return {
        ...current,
        width,
        height,
        x: clamp(gesture.geometry.x, 0, 1 - width),
        y: clamp(gesture.geometry.y, 0, 1 - height),
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
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      setGeometry((current) => {
        const next = { ...current };
        if (gesture.previousGeometry) next[gesture.id] = gesture.previousGeometry;
        else delete next[gesture.id];
        return next;
      });
      setPlacements((current) => {
        const next = { ...current };
        if (gesture.previousPlacement) next[gesture.id] = gesture.previousPlacement;
        else delete next[gesture.id];
        return next;
      });
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
    setAnnouncement(`${workspaceViews.find((view) => view.id === gesture.id)?.title} ${gesture.kind === 'move' ? 'moved' : 'resized'}.`);
  }

  function arrangeKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== 'Escape' || !event.currentTarget.open) return;
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

  const maybePortal = (node: ReactNode) => tabsHost ? createPortal(node, tabsHost) : node;
  // In the shell the tab bar lists every open window, the conversation included;
  // without a shell host it lists only minimised views.
  const tabViews = (tabsHost ? openViews : minimizedViews).filter((view) => !hideTab?.(view));
  const frontViewId = frontId;

  return (
    <section ref={workspaceSection} className="workspace" data-phone={phone} aria-labelledby={`${workspaceId}-heading`}>
      <header className="workspace-heading">
        <h2 ref={workspaceHeading} id={`${workspaceId}-heading`} tabIndex={-1}>Workspace</h2>
        {openViews.length > 0 && !phone && (
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
        <p className="workspace-empty">No views are open.</p>
      ) : openViews.length === minimizedViews.length ? (
        <p className="workspace-empty">All views are minimised.</p>
      ) : null}
      {pinLoadError && (
        <div className="workspace-pin-feedback" role="alert">
          <span>{pinLoadError}</span>
          <button className="secondary-button" type="button" onClick={() => {
            setPinLoadError('');
            setPinLoadAttempt((attempt) => attempt + 1);
          }}>Retry pinned windows</button>
        </div>
      )}
      {pinFeedback && <div className="workspace-pin-feedback" role={pinFeedback.tone}>
        <span>{pinFeedback.message}</span>
        {pinFeedback.retry && <button className="secondary-button" type="button" onClick={() => {
          const retry = pinFeedback.retry;
          if (!retry) return;
          const content = workspaceViews.find((view) => view.id === retry.id)?.content;
          void requestPinChange(retry.id, retry.pinned, retry.refresh && content?.status === 'generated' ? content.view : undefined);
        }}>Retry pin change</button>}
      </div>}
      {phone && primaryViews.length > 1 && (
        <nav className="workspace-view-switcher" aria-label="Switch foreground view">
          {primaryViews.map((view, index) => (
            <button className="workspace-tab" key={view.id} type="button"
              aria-label={`Show ${view.title}`} aria-current={foreground?.id === view.id ? 'true' : undefined}
              onClick={() => focusView(view.id)}
              onKeyDown={(event) => {
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? primaryViews.length - 1
                  : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'ArrowRight' ? Math.min(primaryViews.length - 1, index + 1) : null;
                if (nextIndex === null) return;
                event.preventDefault();
                focusView(primaryViews[nextIndex]!.id);
              }}>
              {view.title}
            </button>
          ))}
        </nav>
      )}
      {tabViews.length > 0 && maybePortal(
        <nav className="workspace-tabs" aria-label={tabsHost ? 'Open windows' : 'Minimised views'}>
          {tabViews.map((view) => {
            const pinned = pinnedViewIds.has(view.id);
            const canPin = Boolean(pins && (view.content.status === 'generated' || pinned));
            const pinPending = pendingPinIds.has(view.id);
            return (
              <span className="workspace-tab-item" key={view.id} data-view-id={view.id} data-pinned={pinned || undefined}
                data-state={minimizedViewIds.has(view.id) ? 'minimised' : view.id === frontViewId ? 'front' : 'open'}>
                <button
                  className="workspace-tab"
                  data-view-id={view.id}
                  ref={(element) => {
                    if (element) tabElements.current.set(view.id, element);
                    else tabElements.current.delete(view.id);
                  }}
                  type="button"
                  aria-label={minimizedViewIds.has(view.id) ? `Restore ${view.title}` : `Show ${view.title}`}
                  aria-current={view.id === frontViewId ? 'true' : undefined}
                  title={view.title}
                  onClick={() => { if (minimizedViewIds.has(view.id)) restoreView(view.id); else focusView(view.id); }}
                >
                  <WindowIcon name="view" />
                  <span>{view.title}</span>
                </button>
                {canPin && (
                  <button className="workspace-tab-pin" type="button" aria-pressed={pinned} disabled={pinPending}
                    aria-label={`${pinned ? 'Unpin' : 'Pin'} ${view.title}`} title={pinned ? 'Unpin' : 'Pin'}
                    onClick={() => requestPinChange(view.id, !pinned)}>
                    <WindowIcon name="pin" />
                  </button>
                )}
                {!pinned && (
                  <button className="workspace-tab-close" type="button" aria-label={`Close ${view.title}`}
                    title={pinPending ? 'Wait for the pin change to finish' : `Close ${view.title}`}
                    disabled={pinPending}
                    onClick={() => closeView(view.id)}>
                    <WindowIcon name="close" />
                  </button>
                )}
              </span>
            );
          })}
        </nav>,
      )}
      <div
        ref={canvas}
        className={`workspace-canvas workspace-canvas-${arrangement}${activeMaximizedViewId ? ' workspace-canvas-has-maximized' : ''}`}
        role="region"
        aria-label="Temporary workspace views"
        data-arrangement={arrangement}

        onPointerDown={beginSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
      >
        {openViews.map((view, index) => {
          const titleId = `${workspaceId}-view-${index}`;
          const currentGeometry = geometryFor(view.id, index);
          const minimized = minimizedViewIds.has(view.id);
          const background = phone && foreground?.id !== view.id && view.presentation !== 'camera-preview';
          const maximized = activeMaximizedViewId === view.id;
          const style = {
            '--workspace-x': percent(currentGeometry.x),
            '--workspace-y': percent(currentGeometry.y),
            '--workspace-width': percent(currentGeometry.width),
            '--workspace-height': percent(currentGeometry.height),
            '--workspace-columns': currentGeometry.columns,
            '--workspace-rows': currentGeometry.rows,
            '--workspace-depth': index + 1,
            '--workspace-y-n': currentGeometry.y,
            '--workspace-height-n': currentGeometry.height,
          } as CSSProperties;
          const actionPending = pendingActions.has(view.id);
          const pinned = pinnedViewIds.has(view.id);
          const pinPending = pendingPinIds.has(view.id);
          const canPin = Boolean(pins && (view.content.status === 'generated' || pinned));
          // The conversation stays docked onto the composer and has no free move/resize controls.
          const docked = view.presentation === 'conversation';
          const retry = view.content.status === 'error' ? view.content.retry : undefined;
          const resume = view.content.status === 'interrupted' ? view.content.resume : undefined;

          return (
            <article
              className={`workspace-window luminous-glass${view.presentation === 'conversation' ? ' workspace-window-conversation' : ''}${view.presentation === 'camera-preview' ? ' workspace-window-camera-preview' : ''}${minimized ? ' workspace-window-minimized' : ''}${maximized ? ' workspace-window-maximized' : ''}${activeGestureId === view.id ? ' workspace-window-dragging' : ''}${jarvisUpdatingIds.has(view.id) ? ' workspace-window-jarvis-updating' : ''}`}
              key={view.id}
              data-view-id={view.id}
              style={style}
              aria-labelledby={titleId}
              hidden={background}
              aria-hidden={minimized || background || undefined}
              inert={minimized || background}
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
                  tabIndex={!arrangeMenu && !docked && !maximized && !phone ? 0 : -1}
                  className={docked ? 'workspace-title-docked' : maximized ? undefined : 'workspace-title-drag'}
                  {...(docked ? {} : {
                    title: view.title,
                    // Without the Arrange menu, the focused title takes the keyboard: arrows move, Alt+arrows resize.
                    ...(!arrangeMenu && !maximized && !phone ? {
                      'aria-description': 'Drag or use arrow keys to move. Alt with arrow keys resizes.',
                      onKeyDown: (event: KeyboardEvent<HTMLHeadingElement>) => {
                        if (event.altKey) resizeHandleKeyDown(event as unknown as KeyboardEvent<HTMLButtonElement>, view.id, index);
                        else moveHandleKeyDown(event as unknown as KeyboardEvent<HTMLButtonElement>, view.id, index);
                      },
                    } : {}),
                    onPointerDown: (event: PointerEvent<HTMLElement>) => beginGesture(event, view.id, 'move', index),
                    onPointerMove: updateGesture,
                    onPointerUp: endGesture,
                    onPointerCancel: endGesture,
                    onLostPointerCapture: endGesture,
                  })}
                >
                  {docked ? <span className="visually-hidden">{view.title}</span> : view.title}
                </h3>
                <div className="workspace-window-actions">
                  {arrangeMenu && !maximized && !phone && !docked && <details className="workspace-arrange-menu" onKeyDown={arrangeKeyDown}>
                    <summary className="workspace-arrange-trigger" role="button" aria-label={`Arrange ${view.title}`} title={`Arrange ${view.title}`}>
                      <WindowIcon name="more" />
                    </summary>
                    <div className="workspace-arrange-options">
                      <p id={`${titleId}-shortcuts`} className="visually-hidden">
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
                        onLostPointerCapture={endGesture}
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
                        onLostPointerCapture={endGesture}
                        onKeyDown={(event) => resizeHandleKeyDown(event, view.id, index)}
                      >
                        Resize
                      </button>
                    </div>
                  </details>}
                  {canPin && <button className="workspace-icon-control workspace-pin-control" type="button" aria-pressed={pinned} disabled={pinPending}
                    aria-label={`${pinPending ? (pinned ? 'Unpinning' : 'Pinning') : pinned ? 'Unpin' : 'Pin'} ${view.title}`}
                    title={pinned ? 'Unpin' : 'Pin'} onClick={() => requestPinChange(view.id, !pinned)}>
                    <WindowIcon name="pin" />
                  </button>}
                  {!phone && <button className="workspace-icon-control" type="button" aria-label={`${maximized ? 'Restore size of' : 'Maximise'} ${view.title}`} onClick={() => setMaximizedViewId(maximized ? null : view.id)}>
                    <WindowIcon name={maximized ? 'restore' : 'maximise'} />
                  </button>}
                  <button className="workspace-icon-control" type="button" aria-label={`Minimise ${view.title}`} onClick={() => minimiseView(view.id)}>
                    <WindowIcon name="minimise" />
                  </button>
                  <button className="workspace-icon-control workspace-close-control" type="button"
                    disabled={pinPending} title={pinPending ? 'Wait for the pin change to finish' : undefined}
                    aria-label={pinned ? `Close ${view.title} to pinned tab` : `Close ${view.title}`} onClick={() => closeView(view.id)}>
                    <WindowIcon name="close" />
                  </button>
                </div>
              </header>
              <div className={view.presentation === 'conversation' ? 'workspace-conversation-content' : 'workspace-view-content'}>
                {view.content.status === 'loading' && <Loader variant="lines" label="Loading view…" />}
                {view.content.status === 'empty' && <p>No content.</p>}
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
                {view.content.status === 'generated' && (
                  <GeneratedViewRenderer
                    view={view.content.view}
                    onPinChange={(pinned) => requestPinChange(view.id, pinned)}
                    {...(view.content.trustedBlobHost ? { trustedBlobHost: view.content.trustedBlobHost } : {})}
                  />
                )}
                {actionSuccess[view.id] && <p role="status">{actionSuccess[view.id]}</p>}
                {actionErrors[view.id] && <p role="alert">{actionErrors[view.id]}</p>}
              </div>
              {!maximized && !phone && !docked && <>
                <div
                  className="workspace-resize-edge workspace-resize-edge-right"
                  aria-hidden="true"
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index, 'right')}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  onLostPointerCapture={endGesture}
                />
                <div
                  className="workspace-resize-edge workspace-resize-edge-bottom"
                  aria-hidden="true"
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index, 'bottom')}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  onLostPointerCapture={endGesture}
                />
                <div
                  className="workspace-resize-edge workspace-resize-edge-corner"
                  aria-hidden="true"
                  onPointerDown={(event) => beginGesture(event, view.id, 'resize', index)}
                  onPointerMove={updateGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  onLostPointerCapture={endGesture}
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

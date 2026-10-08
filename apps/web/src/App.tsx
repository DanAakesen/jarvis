import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { HtmlArtifactFrame, JarvisActivityEvent, WorkspaceCommand, WorkspaceSnapshot } from '@jarvis/contracts';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';
import { areas } from './areas';
import { ContextPanel, ContextPanelProvider } from './ContextPanel';
import { ConversationIntentProvider } from './ConversationIntentProvider';
import type { CameraController, ScreenShareController } from './screen-sharing';
import { useCamera, useScreenShare } from './screen-sharing';
import { useContextPanel } from './context-panel-state';
import { DatabaseWakeStatus } from './DatabaseWakeStatus';
import { JarvisPage } from './JarvisPage';
import { JarvisStage } from './JarvisStage';
import { useThemePreference } from './theme-preference-context';
import { NotFoundPage, SignInPage } from './pages';
import { NowFeedPanel } from './NowFeedPanel';
import { SettingsPage } from './SettingsPage';
import { ProjectsPage } from './factory/ProjectsPage';
import { ThemePreferenceProvider } from './theme-preference';
import { useSignIn, type SignInSession } from './useSignIn';
import { backendFetch } from './backend-request';
import { Workspace, PHONE_LAYOUT_MEDIA_QUERY, type WorkspaceController, type WorkspaceView } from './Workspace';
import { ConversationWindowContext, conversationViewId } from './conversation-window-state';
import { WorkspaceCommandContext, useWorkspaceCommands } from './workspace-command-state';
import { BackendSleepControl } from './BackendSleepControl';
import { VoiceWorkspaceContext } from './voice-workspace-state';
import { readVoiceWorkspacePreference } from './voice-workspace-preference';
import { PanelResizeHandle } from './PanelResizeHandle';
import { readPanelWidth, savePanelWidth } from './panel-width';
import { useGlassLight } from './glass-light';
import { TaskDetailPage } from './factory/TaskDetailPage';
import { InputOrbCore } from './InputOrbCore';
import { TaskWindowsContext, readTaskWindows, saveTaskWindows, taskWindowViewId, type TaskWindowEntry } from './task-windows';
import { readNavigateCommand, resolveNavigation, revealWhenReady, type NavigateRequest } from './page-navigation';
import { FolioPane } from './Folio';
import { flyChat } from './chat-flight';
import { readWorkspaceFrame } from './workspace-frame';
import { JobsChip } from './JobsChip';
import { hasRunningJob, useJobs } from './jobs-store';
import { KnowledgeBackendContext } from './knowledge/knowledge-context';
import { PresenceChip, PresenceSettings } from './Presence';
import { MemorySettings } from './MemorySettings';

const sidebarLimits = { min: 160, max: 420 };
const contextLimits = { min: 220, max: 560 };

type ShellIconName = 'home' | 'factory' | 'knowledge' | 'usage' | 'navigation' | 'screen' | 'camera' | 'context' | 'settings' | 'close' | 'folio';

function activityLabel(event: JarvisActivityEvent | null): string {
  if (!event) return 'Jarvis is working';
  if (event.type === 'tool-call-started') return `Using ${event.toolName}`;
  if (event.type === 'tool-call-finished') return `${event.toolName} · ${event.outcome}`;
  switch (event.type) {
    case 'listening': return 'Listening';
    case 'thinking': return 'Jarvis is thinking';
    case 'speaking': return 'Jarvis is speaking';
    case 'interrupted': return 'Jarvis was interrupted';
    case 'reconnecting': return 'Reconnecting voice';
    case 'failed': return 'Jarvis activity failed';
    case 'ended': return 'Jarvis activity ended';
  }
}

function ShellIcon({ name }: { name: ShellIconName }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'home':
      return <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></svg>;
    case 'factory':
      return <svg {...common}><path d="M3 21V9l6 3V8l6 4V5h6v16Z" /><path d="M7 17h1m4 0h1m4 0h1m-10-4h1m4 0h1m4-8h1" /></svg>;
    case 'knowledge':
      return <svg {...common}><circle cx="6" cy="7" r="2.2" /><circle cx="17.5" cy="5.5" r="1.8" /><circle cx="12.5" cy="13" r="2.4" /><circle cx="5.5" cy="18" r="1.7" /><circle cx="18.5" cy="18.5" r="2" /><path d="m8 8.3 2.6 3M15.9 6.6l-2.4 4.3M10.4 14.4l-3.4 2.6M14.6 14.4l2.5 2.6M7.9 6.7l7.8-1" /></svg>;
    case 'usage':
      return <svg {...common}><path d="M4 20V11m5 9V5m5 15v-7m5 7V8" /><path d="M2 21h20" /></svg>;
    case 'navigation':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m-3-11h1m-1 4h1" /></svg>;
    case 'screen':
      return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>;
    case 'camera':
      return <svg {...common}><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'context':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2A1.7 1.7 0 0 0 8 17.4l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 4.4 12H4.2a1.7 1.7 0 1 1 0-3.4h.2A1.7 1.7 0 0 0 5.6 5.7l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1A1.7 1.7 0 0 0 11 2.1v-.2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.5 3Z" /></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'folio':
      return <svg {...common}><rect x="7" y="3" width="13" height="15" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h10M11 8h5m-5 4h5" /></svg>;
  }
}

function Shell({ signedIn, config, session, camera, screenShare }: {
  signedIn: boolean;
  config: PublicConfig;
  session: SignInSession;
  camera: CameraController;
  screenShare: ScreenShareController;
}) {
  return (
    <ConversationIntentProvider>
      <ContextPanelProvider>
        <ShellLayout signedIn={signedIn} config={config} session={session} camera={camera} screenShare={screenShare} />
      </ContextPanelProvider>
    </ConversationIntentProvider>
  );
}

function ShellLayout({ signedIn, config, session, camera, screenShare }: {
  signedIn: boolean;
  config: PublicConfig;
  session: SignInSession;
  camera: CameraController;
  screenShare: ScreenShareController;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const home = pathname === '/';
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const getAccessToken = session.getAccessToken;
  const { working, latestActivity } = useJarvisActivity();
  const activityText = activityLabel(latestActivity);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const workspaceController = useRef<WorkspaceController>(null);
  const contextPanel = useContextPanel();
  const themePreference = useThemePreference();
  const [openWindows, setOpenWindows] = useState<WorkspaceSnapshot['windows']>([]);
  const onOpenWindowsChange = useCallback((windows: WorkspaceSnapshot['windows']) => {
    setOpenWindows((current) => JSON.stringify(current) === JSON.stringify(windows) ? current : windows);
  }, []);
  const [voiceActive, setVoiceActive] = useState(false);
  // The window Jarvis's generated reports and apps open in (size, theme, tokens), refreshed when any of it changes.
  const [frame, setFrame] = useState<HtmlArtifactFrame | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = readWorkspaceFrame();
        setFrame((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      }, 400);
    };
    refresh();
    window.addEventListener('resize', refresh);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(refresh) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-motion', 'data-motion-preference', 'style'] });
    return () => { window.clearTimeout(timer); window.removeEventListener('resize', refresh); observer?.disconnect(); };
  }, [signedIn, pathname]);
  const [voiceHasWindows, setVoiceHasWindows] = useState(false);
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE_LAYOUT_MEDIA_QUERY).matches ?? false);
  // Jarvis switching the page Dan is looking at (P9-40): the route changes with the usual page transition, then the
  // named Settings section or task card is scrolled into view and glows once its data has loaded.
  // The Folio pane (P9-25) shares the left sidebar slot with area navigation; only one is open at a time.
  const [folioOpen, setFolioOpen] = useState(false);
  const openTaskRef = useRef<(taskId: string) => void>(() => {});
  const cancelReveal = useRef<() => void>(() => {});
  const navigateTo = useCallback((request: NavigateRequest) => {
    const target = resolveNavigation(request);
    if (!target.ok) return false;
    if (target.pane === 'folio') { setFolioOpen(true); return true; }
    if (pathnameRef.current !== target.path) navigate(target.path);
    if (target.taskId) openTaskRef.current(target.taskId);
    const reduced = document.documentElement.dataset.motion === 'reduced' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const revealId = target.anchorId ?? (target.taskId ? `task-title-${target.taskId}` : null);
    cancelReveal.current();
    cancelReveal.current = revealId ? revealWhenReady(() => document.getElementById(revealId), reduced) : () => {};
    return true;
  }, [navigate]);
  useEffect(() => () => cancelReveal.current(), []);
  const workspaceCommands = useMemo(() => ({
    snapshot: { windows: openWindows, contextPanelOpen: contextPanel.isOpen, ...(frame ? { frame } : {}) },
    dispatch: (command: Parameters<WorkspaceController['dispatch']>[0], trustedBlobHost?: string) => {
      const navigateRequest = readNavigateCommand(command);
      if (navigateRequest) return navigateTo(navigateRequest);
      if (command.operation === 'context-panel') {
        if (command.action === 'open') {
          contextPanel.show(command.view ? {
            title: command.view.title,
            status: 'view',
            view: command.view,
            ...(trustedBlobHost ? { trustedBlobHost } : {}),
          } : contextPanel.content);
        } else if (command.action === 'close') {
          contextPanel.close();
        } else {
          contextPanel.toggle();
        }
        return true;
      }
      const applied = workspaceController.current?.dispatch(command, trustedBlobHost) ?? false;
      // While the jobs chip tracks research, its progress window starts as a tab instead of covering the page.
      if (applied && command.operation === 'create' && command.view.source.id === 'research' &&
          command.view.source.status === 'partial' && hasRunningJob('research')) {
        workspaceController.current?.dispatch({ commandId: `${command.commandId}-park`, operation: 'minimise', viewId: command.viewId });
      }
      return applied;
    },
    minimiseAll: () => workspaceController.current?.minimiseAll(),
    hasVisibleViews: () => workspaceController.current?.hasVisibleViews() ?? false,
    isViewVisible: (viewId: string) => workspaceController.current?.isViewVisible?.(viewId) ?? false,
  }), [contextPanel, frame, navigateTo, openWindows]);
  const applyWorkspaceCommand = useCallback((command: WorkspaceCommand, trustedBlobHost?: string) => {
    let applied = false;
    flushSync(() => { applied = workspaceCommands.dispatch(command, trustedBlobHost); });
    return applied;
  }, [workspaceCommands]);
  const onVoiceActiveChange = useCallback((active: boolean) => {
    if (active && readVoiceWorkspacePreference().voice.minimizeWindowsOnVoiceStart) {
      workspaceController.current?.minimiseAll();
    }
    // Voice is the full Jarvis room, so starting it from another page returns home.
    if (active && pathnameRef.current !== '/') navigate('/');
    setVoiceActive(active);
  }, [navigate]);
  // Off the home page the chat bar lives in the rail as an orb; pressing it pops the bar out over the current page.
  const [chatOut, setChatOut] = useState(false);
  const [chatOutPath, setChatOutPath] = useState(pathname);
  if (chatOutPath !== pathname) {
    setChatOutPath(pathname);
    if (chatOut) setChatOut(false);
  }
  const chatPlace: 'home' | 'out' | 'rail' = !signedIn || home ? 'home' : chatOut ? 'out' : 'rail';
  const railOrb = useRef<HTMLButtonElement>(null);
  const previousChatPlace = useRef(chatPlace);
  useLayoutEffect(() => {
    const previous = previousChatPlace.current;
    previousChatPlace.current = chatPlace;
    if (previous === chatPlace || !signedIn) return;
    const bar = document.querySelector<HTMLElement>('.jarvis-page .conversation-input');
    const sheet = document.querySelector<HTMLElement>('.workspace-window-conversation:not(.workspace-window-minimized)');
    if (chatPlace === 'rail') {
      flyChat(bar, railOrb.current, 'in');
      flyChat(sheet, railOrb.current, 'in');
    } else if (previous === 'rail') {
      flyChat(bar, railOrb.current, 'out');
      flyChat(sheet, railOrb.current, 'out');
      if (chatPlace === 'out') window.requestAnimationFrame?.(() => document.getElementById('message')?.focus({ preventScroll: true }));
    }
  }, [chatPlace, signedIn]);
  const collapseChat = useCallback(() => {
    setChatOut(false);
    railOrb.current?.focus();
  }, []);
  // Task windows: open from any page, pinned to the tab bar when minimised, and restored as tabs after a reload.
  // Entries restored from the browser start pinned as tabs; windows opened in this session start visible.
  const [taskWindows, setTaskWindows] = useState<(TaskWindowEntry & { restored?: boolean })[]>(() => readTaskWindows().map((entry) => ({ ...entry, restored: true })));
  const [focusTaskWindow, setFocusTaskWindow] = useState<{ taskId: string; seq: number } | null>(null);
  useEffect(() => { saveTaskWindows(taskWindows.map(({ taskId, title }) => ({ taskId, title }))); }, [taskWindows]);
  const taskWindowsApi = useMemo(() => ({
    open: (taskId: string, title?: string) => {
      setTaskWindows((current) => current.some((entry) => entry.taskId === taskId)
        ? current
        : [...current, { taskId, title: title?.trim() || `Task ${taskId}` }].slice(-12));
      setFocusTaskWindow((current) => ({ taskId, seq: (current?.seq ?? 0) + 1 }));
    },
    setTitle: (taskId: string, title: string) => setTaskWindows((current) =>
      current.some((entry) => entry.taskId === taskId && entry.title !== title)
        ? current.map((entry) => entry.taskId === taskId ? { ...entry, title } : entry)
        : current),
  }), []);
  useEffect(() => { openTaskRef.current = (taskId) => taskWindowsApi.open(taskId); }, [taskWindowsApi]);
  useLayoutEffect(() => {
    if (!focusTaskWindow) return;
    const viewId = taskWindowViewId(focusTaskWindow.taskId);
    const controller = workspaceController.current;
    controller?.dispatch({ commandId: `task-window-restore-${focusTaskWindow.seq}`, operation: 'restore', viewId });
    controller?.dispatch({ commandId: `task-window-focus-${focusTaskWindow.seq}`, operation: 'focus', viewId });
  }, [focusTaskWindow]);
  const [tabsHost, setTabsHost] = useState<HTMLDivElement | null>(null);
  const knowledgeBackend = useMemo(() => ({ backendUrl: config.backendUrl, getAccessToken }), [config.backendUrl, getAccessToken]);
  // A finished background job brings its result window forward, or parks it as a tab while Dan is away.
  // While a research job shows as a tab, its progress window's own tab would be a duplicate.
  const { jobs: backgroundJobs } = useJobs(config.backendUrl, getAccessToken);
  const researchRunning = backgroundJobs.some((job) => job.kind === 'research' && job.status === 'running');
  // The conversation never needs a tab: the chat bar's orb and handle bring it back.
  const hideResearchProgressTab = useCallback((view: WorkspaceView) => view.presentation === 'conversation' || researchRunning && view.content.status === 'generated' &&
    view.content.view.source.id === 'research' && view.content.view.source.status === 'partial', [researchRunning]);
  const openJobResult = useCallback((viewId: string, mode: 'open' | 'park') => {
    const controller = workspaceController.current;
    if (!controller) return false;
    if (mode === 'park') return controller.dispatch({ commandId: `job-park-${viewId}`, operation: 'minimise', viewId });
    if (!controller.dispatch({ commandId: `job-restore-${viewId}`, operation: 'restore', viewId })) return false;
    controller.dispatch({ commandId: `job-focus-${viewId}`, operation: 'focus', viewId });
    return true;
  }, []);
  // The conversation history is a workspace view: the shared controller owns its tabs, geometry, focus and commands,
  // while ConversationHistory keeps the chat session, composer and voice controls and portals the transcript in.
  const [conversationAvailable, setConversationAvailable] = useState(false);
  const [conversationHost, setConversationHost] = useState<HTMLDivElement | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const onVisibleViewIdsChange = useCallback((ids: readonly string[]) => {
    setConversationOpen(ids.includes(conversationViewId));
  }, []);
  const conversationWindow = useMemo(() => ({
    element: conversationHost,
    setAvailable: setConversationAvailable,
    open: conversationOpen,
    setOpen: (open: boolean) => workspaceController.current?.dispatch({
      commandId: `conversation-handle-${open ? 'restore' : 'minimise'}`,
      operation: open ? 'restore' : 'minimise',
      viewId: conversationViewId,
    }) ?? false,
  }), [conversationHost, conversationOpen]);
  const backendUrl = config.backendUrl;
  const taskViews = useMemo<WorkspaceView[]>(() => taskWindows.map(({ taskId, title, restored }) => ({
    id: taskWindowViewId(taskId),
    title,
    initialGeometry: { x: 0.12, y: 0.04, width: 0.76, height: 0.8, columns: 2 },
    ...(restored ? { initiallyMinimised: true } : {}),
    onClose: () => setTaskWindows((current) => current.filter((entry) => entry.taskId !== taskId)),
    content: { status: 'ready', content: (
      <TaskDetailPage backendUrl={backendUrl} getAccessToken={getAccessToken} taskId={taskId}
        onTitle={(loaded) => taskWindowsApi.setTitle(taskId, loaded)} />
    ) },
  })), [backendUrl, getAccessToken, taskWindows, taskWindowsApi]);
  const workspaceViews = useMemo<WorkspaceView[]>(() => [
    ...(conversationAvailable ? [{
      id: conversationViewId,
      title: 'Conversation',
      presentation: 'conversation' as const,
      initialGeometry: { x: 0.1, y: 0.36, width: 0.8, height: 0.64, columns: 2 },
      content: { status: 'ready' as const, content: <div ref={setConversationHost} className="conversation-window-host" /> },
    }] : []),
    ...taskViews,
  ], [conversationAvailable, taskViews]);
  const conversationLifecycle = useRef({ available: false, hiddenForVoice: false });
  useLayoutEffect(() => {
    const lifecycle = conversationLifecycle.current;
    const becameAvailable = conversationAvailable && !lifecycle.available;
    lifecycle.available = conversationAvailable;
    const controller = workspaceController.current;
    if (!conversationAvailable || !controller) {
      lifecycle.hiddenForVoice = false;
      return;
    }
    const command = (operation: 'minimise' | 'restore') => controller.dispatch({
      commandId: `conversation-${operation}`, operation, viewId: conversationViewId,
    });
    if (voiceActive) {
      // Fullscreen voice starts with history out of the way; Jarvis can still show it with window commands.
      if (!lifecycle.hiddenForVoice) lifecycle.hiddenForVoice = command('minimise');
    } else if (lifecycle.hiddenForVoice || (becameAvailable && !controller.isViewVisible?.(conversationViewId))) {
      // Returning from voice or to the Jarvis page brings history back for the replies.
      lifecycle.hiddenForVoice = false;
      command('restore');
    }
  }, [conversationAvailable, voiceActive]);
  // The navigation is a drawer over the page: it starts closed and opens from the rail.
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => readPanelWidth('sidebar', sidebarLimits.min, sidebarLimits.max));
  const [contextWidth, setContextWidth] = useState(() => readPanelWidth('context', contextLimits.min, contextLimits.max));
  const changeSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(width);
    savePanelWidth('sidebar', width);
  }, []);
  const changeContextWidth = useCallback((width: number) => {
    setContextWidth(width);
    savePanelWidth('context', width);
  }, []);
  const panelWidths = {
    ...(sidebarWidth === null ? {} : { '--sidebar-width': `${sidebarWidth}px` }),
    ...(contextWidth === null ? {} : { '--context-width': `${contextWidth}px` }),
  } as CSSProperties;
  const [presenceError, setPresenceError] = useState('');
  const activeArea = areas.find(({ path }) => pathname.startsWith(`/${path}`));
  const settingsActive = pathname.startsWith('/settings');
  const areaLabel = settingsActive ? 'Settings' : activeArea?.label ?? 'Jarvis';
  const navigationItems = activeArea?.navigation ?? [{ label: 'Conversation', path: '/' }];
  // The navigation panel only exists for an area with more than one page; otherwise there is nothing to choose.
  const navigationAvailable = navigationItems.length > 1;
  const navigationShown = navigationOpen && navigationAvailable && !folioOpen;

  useEffect(() => {
    const media = window.matchMedia?.(PHONE_LAYOUT_MEDIA_QUERY);
    if (!media) return;
    const update = () => setPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!signedIn || !config.backendUrl) return;
    let active = true;
    let sending = false;
    let lastSent: number | null = null;
    const controller = new AbortController();
    const markPresent = async () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus() ||
        sending || (lastSent !== null && Date.now() - lastSent < 60_000)) return;
      sending = true;
      try {
        const token = await getAccessToken();
        const response = await backendFetch(`${config.backendUrl!.replace(/\/+$/u, '')}/now/present`, {
          method: 'POST',
          headers: {
            Authorization: `${['Bear', 'er'].join('')} ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new Error('Browser presence could not be updated.');
        }
        lastSent = Date.now();
        if (active) setPresenceError('');
      } catch {
        if (active) setPresenceError('Jarvis could not switch to present. Try using the app again.');
      } finally {
        sending = false;
      }
    };
    const onActivity = () => { void markPresent(); };
    void markPresent();
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('focus', onActivity);
    document.addEventListener('visibilitychange', onActivity);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('focus', onActivity);
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, [config.backendUrl, getAccessToken, signedIn]);

  function closeNavigation() {
    navigationToggle.current?.focus();
    setNavigationOpen(false);
  }

  return (
    <TaskWindowsContext.Provider value={signedIn ? taskWindowsApi : null}>
    <div className={`app app-shell${signedIn ? '' : ' app-signed-out'}`} data-navigation-open={signedIn && (navigationShown || folioOpen)} data-folio-open={signedIn && folioOpen}
      data-context-open={signedIn && contextPanel.isOpen} data-voice-active={voiceActive}
      data-voice-has-windows={voiceHasWindows} data-conversation-open={signedIn && conversationOpen} style={panelWidths}
      data-home={home} data-chat={chatPlace}>
      <a className="skip-link" href="#content">Skip to content</a>
      {signedIn && (
        <nav className="area-rail" aria-label="Areas">
          {navigationAvailable && (
            <button
              ref={navigationToggle}
              className="rail-button navigation-toggle"
              type="button"
              aria-label={navigationShown ? 'Collapse area navigation' : 'Expand area navigation'}
              aria-expanded={navigationShown}
              aria-controls="area-navigation"
              onClick={() => { setFolioOpen(false); setNavigationOpen((open) => !open); }}
            >
              <ShellIcon name="navigation" />
            </button>
          )}
          <NavLink className="rail-link" to="/" end aria-label="Conversation">
            <ShellIcon name="home" /><span className="visually-hidden">Jarvis</span>
          </NavLink>
          {areas.map((area) => (
            <NavLink key={area.id} className="rail-link" to={`/${area.path}`} aria-label={area.label} onClick={() => { setNavigationOpen(area.navigation.length > 1); if (area.navigation.length > 1) setFolioOpen(false); }}>
              <ShellIcon name={area.id === 'factory' ? 'factory' : area.id === 'knowledge' ? 'knowledge' : 'usage'} /><span className="visually-hidden">{area.label}</span>
            </NavLink>
          ))}
          <button className={`rail-link rail-folio${folioOpen ? ' active' : ''}`} type="button" aria-label="Folio" aria-pressed={folioOpen}
            aria-controls="folio-pane" title="Folio" onClick={() => setFolioOpen((open) => !open)}>
            <ShellIcon name="folio" /><span className="visually-hidden">Folio</span>
          </button>
          {!home && (
            <button ref={railOrb} className="input-orb rail-chat-orb" type="button" aria-expanded={chatOut} aria-controls="conversation-composer"
              aria-label={chatOut ? 'Hide the chat bar' : 'Chat with Jarvis'} title={chatOut ? 'Hide the chat bar' : 'Chat with Jarvis'}
              onClick={() => setChatOut((open) => !open)}>
              <span aria-hidden="true"><InputOrbCore /></span>
            </button>
          )}
        </nav>
      )}
      {signedIn && (
        <aside id="area-navigation" className="area-sidebar" hidden={!navigationShown}>
          <div className="sidebar-heading">
            <span>{areaLabel}</span>
            <button className="sidebar-close" type="button" aria-label="Close area navigation" onClick={closeNavigation}>
              <ShellIcon name="close" />
            </button>
          </div>
          <nav aria-label={activeArea?.label ?? 'Jarvis'}>
            {navigationItems.map((item) => (
              <NavLink key={item.path} className="sidebar-link" to={item.path} end={item.path === '/'} onClick={() => {
                // Choosing a page closes the navigation; keyboard focus continues on the new page.
                setNavigationOpen(false);
                window.requestAnimationFrame?.(() => document.getElementById('content')?.focus({ preventScroll: true }));
              }}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          {!phone && <PanelResizeHandle edge="right" label="Resize navigation" width={sidebarWidth ?? 220}
            min={sidebarLimits.min} max={sidebarLimits.max} onChange={changeSidebarWidth} />}
        </aside>
      )}
      {signedIn && <FolioPane backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} open={folioOpen}
        onClose={() => setFolioOpen(false)} refreshKey={openWindows.length} />}
      <header className="app-topbar">
        <div className="topbar-context">
          <Link className="brand" to="/" aria-label="Jarvis home">Jarvis</Link>
        </div>
        {/* Open windows live as tabs in the top bar, between the brand and the controls (no breadcrumb). */}
        {signedIn && <div className="window-tabstrip">
        <div ref={setTabsHost} className="window-tabbar" />
        <JobsChip backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} onResult={openJobResult} />
        </div>}

        {signedIn && (
          <div className="topbar-actions">
            <PresenceChip backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
            {config.backendUrl && (
              <DatabaseWakeStatus backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
            )}
            {(working || latestActivity) && (
              <span className={`topbar-working${working ? '' : ' topbar-activity-terminal'}`} role="status" aria-label={activityText} aria-live="polite">
                <span className="topbar-working-mark" aria-hidden="true" />
                <span className="topbar-working-wide" aria-hidden="true">{activityText}</span>
                <span className="topbar-working-compact" aria-hidden="true">{working ? 'Working' : activityText}</span>
              </span>
            )}
            <button
              id="context-panel-toggle"
              className="topbar-icon-button"
              type="button"
              aria-label="Toggle contextual panel"
              aria-expanded={contextPanel.isOpen}
              aria-controls="context-panel"
              onClick={contextPanel.toggle}
            >
              <ShellIcon name="context" />
            </button>
            <NavLink className="settings-link" to="/settings" aria-label="Settings">
              <ShellIcon name="settings" /><span className="settings-label">Settings</span>
            </NavLink>
          </div>
        )}
      </header>
      <main id="content" className="shell-main" tabIndex={-1}>
        {presenceError && <p className="browser-presence-error" role="alert">{presenceError}</p>}
        {/* One room behind every page (and sign-in), so navigation never swaps or reloads the scene. */}
        <JarvisStage theme={themePreference.resolvedTheme} appearance={themePreference.appearance}>
        <KnowledgeBackendContext.Provider value={knowledgeBackend}>
        <WorkspaceCommandContext.Provider value={workspaceCommands}>
          <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange }}>
            <ConversationWindowContext.Provider value={conversationWindow}>
              <Outlet />
              {/* The chat stays mounted on every page, so a conversation or voice session survives navigation. */}
              {signedIn && session.profile && (
                <JarvisPage
                  client={session.client}
                  config={config}
                  camera={camera}
                  screenShare={screenShare}
                  docked={chatPlace === 'rail'}
                  {...(chatPlace === 'out' ? { onDismiss: collapseChat } : {})}
                />
              )}
            </ConversationWindowContext.Provider>
            {signedIn && (
              <div className="workspace-shell-area">
                <Workspace ref={workspaceController} views={workspaceViews} onVisibleViewsChange={setVoiceHasWindows} onOpenWindowsChange={onOpenWindowsChange}
                  onVisibleViewIdsChange={onVisibleViewIdsChange} tabsHost={tabsHost} defaultArrangement="layered" arrangeMenu={false}
                  hideTab={hideResearchProgressTab} />
              </div>
            )}
            {/* Settings shows the Now feed itself; everywhere else one hidden instance keeps runtime activity flowing. */}
            {signedIn && !settingsActive && (
              <div hidden>
                <NowFeedPanel
                  client={session.client}
                  config={config}
                  getAccessToken={getAccessToken}
                  applyWorkspaceCommand={applyWorkspaceCommand}
                />
              </div>
            )}
          </VoiceWorkspaceContext.Provider>
        </WorkspaceCommandContext.Provider>
        </KnowledgeBackendContext.Provider>
        </JarvisStage>
      </main>
      {signedIn && <ContextPanel closeIcon={<ShellIcon name="close" />} resizeHandle={phone ? undefined : (
        <PanelResizeHandle edge="left" label="Resize context panel" width={contextWidth ?? 280}
          min={contextLimits.min} max={contextLimits.max} onChange={changeContextWidth} />
      )} />}
    </div>
    </TaskWindowsContext.Provider>
  );
}

/** Every Jarvis page needs Dan's verified session; until then the page shows sign-in instead. */
function RequireSignIn({ session }: { session: SignInSession }) {
  return session.state === 'signed-in' && session.profile ? <Outlet /> : <SignInPage session={session} />;
}

/** Settings with its live panels and a Back action to wherever Dan came from. */
function SettingsRoute({ config, session }: { config: PublicConfig; session: SignInSession }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  const back = useCallback(() => {
    if (key !== 'default') navigate(-1);
    else navigate('/');
  }, [key, navigate]);
  return (
    <SettingsPage backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} onBack={back}
      presence={<PresenceSettings backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />}
      projects={<ProjectsPage backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />}
      memory={<MemorySettings backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />}
      activity={<SettingsActivity client={session.client} config={config} getAccessToken={session.getAccessToken} />} />
  );
}

/** The Now feed and backend sleep live on Settings; this is the only Now feed mounted while Settings is open. */
function SettingsActivity({ client, config, getAccessToken }: {
  client: SignInSession['client'];
  config: PublicConfig;
  getAccessToken: () => Promise<string>;
}) {
  const workspace = useWorkspaceCommands();
  const applyWorkspaceCommand = useCallback((command: WorkspaceCommand, trustedBlobHost?: string) => {
    let applied = false;
    flushSync(() => { applied = workspace.dispatch(command, trustedBlobHost); });
    return applied;
  }, [workspace]);
  return (
    <>
      <NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} applyWorkspaceCommand={applyWorkspaceCommand} />
      <section className="panel" aria-labelledby="backend-heading">
        <h2 id="backend-heading">Backend</h2>
        <BackendSleepControl client={client} config={config} />
      </section>
    </>
  );
}

// Vite inlines __JARVIS_CONFIG__ as an object literal. Read it once: a new object per render
// recreated the MSAL client and re-ran sign-in restore in a loop (L65).
const defaultConfig: PublicConfig = __JARVIS_CONFIG__;

export function App({ config = defaultConfig }: { config?: PublicConfig }) {
  useGlassLight();
  const session = useSignIn(config);
  const signedIn = session.state === 'signed-in' && session.profile !== null;
  const camera = useCamera(config, session.getAccessToken);
  const stopCamera = camera.stop;
  const screenShare = useScreenShare(config, session.getAccessToken);
  const stopScreenShare = screenShare.stop;

  useEffect(() => {
    if (!signedIn) {
      stopCamera();
      stopScreenShare();
    }
  }, [signedIn, stopCamera, stopScreenShare]);

  useEffect(() => {
    const root = document.documentElement;
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const syncPreferences = () => {
      root.dataset.motionPreference = motionPreference?.matches ? 'reduced' : 'full';
      root.dataset.documentVisibility = document.hidden ? 'hidden' : 'visible';
    };
    syncPreferences();
    motionPreference?.addEventListener('change', syncPreferences);
    document.addEventListener('visibilitychange', syncPreferences);
    return () => {
      motionPreference?.removeEventListener('change', syncPreferences);
      document.removeEventListener('visibilitychange', syncPreferences);
      delete root.dataset.documentVisibility;
      delete root.dataset.motionPreference;
    };
  }, []);

  return (
    <JarvisActivityProvider>
      <ThemePreferenceProvider key={signedIn ? 'signed-in' : 'signed-out'}
        enabled={signedIn} backendUrl={config.backendUrl} getAccessToken={session.getAccessToken}>
        <Routes>
          <Route element={<Shell signedIn={signedIn} config={config} session={session} camera={camera} screenShare={screenShare} />}>
            <Route element={<RequireSignIn session={session} />}>
              <Route index element={<h1 className="visually-hidden">Welcome, {session.profile?.name ?? ''}</h1>} />
              {areas.map(({ id, path, Component }) => (
                <Route key={id} path={`${path}/*`} element={
                  <Component backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
                } />
              ))}
              <Route path="settings" element={<SettingsRoute config={config} session={session} />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ThemePreferenceProvider>
    </JarvisActivityProvider>
  );
}

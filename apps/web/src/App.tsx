import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { HtmlArtifactFrame, JarvisActivityEvent, WorkspaceCommand, WorkspaceSnapshot, WorkspaceView as LookingAtView, WorkspaceViewLocation } from '@jarvis/contracts';
import type { PublicConfig } from '../config/public-config';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';
import { appAreas } from './areas';
import { NutritionTargetsSettings } from './daily/NutritionTargetsSettings';
import { DailyRefreshContext } from './daily/refresh';
import { ContextPanel, ContextPanelProvider } from './ContextPanel';
import { ConversationIntentProvider } from './ConversationIntentProvider';
import type { CameraController, ScreenShareController } from './screen-sharing';
import { useCamera, useScreenShare } from './screen-sharing';
import { CameraPreview, cameraPreviewViewId } from './CameraPreview';
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
import type { ConversationPosition } from './conversation-layout';
import { WorkspaceCommandContext } from './workspace-command-state';
import { SessionCommandRegistryContext, applySessionCommand, openCameraPreview, createSessionCommandRegistry, type SessionCommandResult } from './session-commands';
import { BackendSleepControl } from './BackendSleepControl';
import { VoiceWorkspaceContext } from './voice-workspace-state';
import { readVoiceWorkspacePreference } from './voice-workspace-preference';
import { PanelResizeHandle } from './PanelResizeHandle';
import { readPanelWidth, savePanelWidth } from './panel-width';
import { useGlassLight } from './glass-light';
import { TaskDetailPage } from './factory/TaskDetailPage';
import { InputOrbCore } from './InputOrbCore';
import { TaskWindowsContext, readTaskWindows, saveTaskWindows, taskWindowViewId, type TaskWindowEntry } from './task-windows';
import { FactoryIssueNavigationContext, NavigationGuardContext, pageForPath, readConversationCommand, readNavigateCommand, resolveNavigation, revealWhenReady, useFocusedFactoryIssue, useVisibleSettingsSection, waitForFactoryIssue, type FactoryIssueNavigator, type NavigateRequest } from './page-navigation';
import { FolioPane } from './Folio';
import { CollapsibleSection } from './CollapsibleSection';
import { MobileCaption, MobileMenu } from './MobileShell';
import { flyChat } from './chat-flight';
import { readWorkspaceFrame } from './workspace-frame';
import { readPageWindows, useReadback } from './window-readback';
import { readWorkspaceDevice } from './workspace-device';
import { JobsChip } from './JobsChip';
import { ShellIcon } from './ShellIcon';
import { hasRunningJob, useJobs } from './jobs-store';
import { KnowledgeBackendContext } from './knowledge/knowledge-context';
import { PresenceChip, PresenceSettings } from './Presence';
import { MemorySettings } from './MemorySettings';
import { createWorkspacePinsClient } from './workspace-pins';
import { usePhoneChatViewport } from './phone-chat-viewport';

const SettingsActivityHostContext = createContext<((host: HTMLDivElement | null) => void) | null>(null);

/** Interim research progress: 
unning from P9-46 (#613) on; older backends sent partial for it. */
const researchInProgress = (status: string) => status === 'running' || status === 'partial';

const sidebarLimits = { min: 160, max: 420 };
const contextLimits = { min: 220, max: 560 };

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
    default: {
      // Newer activity kinds (P9-41 work details carry their own first-person text); anything unknown stays generic.
      const detail = event as { type: string; text?: unknown };
      return detail.type === 'work-started' && typeof detail.text === 'string' && detail.text.trim() ? detail.text.trim() : 'Jarvis is working';
    }
  }
}

function Shell({ signedIn, config, session, camera, screenShare, dailyEnabled }: {
  signedIn: boolean;
  config: PublicConfig;
  session: SignInSession;
  camera: CameraController;
  screenShare: ScreenShareController;
  dailyEnabled: boolean;
}) {
  return (
    <ConversationIntentProvider>
      <ContextPanelProvider>
        <ShellLayout signedIn={signedIn} config={config} session={session} camera={camera} screenShare={screenShare} dailyEnabled={dailyEnabled} />
      </ContextPanelProvider>
    </ConversationIntentProvider>
  );
}

function ShellLayout({ signedIn, config, session, camera, screenShare, dailyEnabled }: {
  signedIn: boolean;
  config: PublicConfig;
  session: SignInSession;
  camera: CameraController;
  screenShare: ScreenShareController;
  dailyEnabled: boolean;
}) {
  const areas = appAreas(dailyEnabled);
  const [dailyRefresh, setDailyRefresh] = useState(0);
  const onDailyRefresh = useCallback(() => { if (dailyEnabled) setDailyRefresh(value => value + 1); }, [dailyEnabled]);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const home = pathname === '/';
  const pathnameRef = useRef(pathname);
  const pendingPageNavigation = useRef<{ path: string; finish: (result: SessionCommandResult) => void } | null>(null);
  useLayoutEffect(() => {
    pathnameRef.current = pathname;
    const pending = pendingPageNavigation.current;
    pending?.finish(pathname === pending.path ? { applied: true } :
      { applied: false, reason: 'Page navigation was superseded before completion.' });
  }, [pathname]);
  useEffect(() => () => pendingPageNavigation.current?.finish({
    applied: false, reason: 'Page navigation was cancelled before completion.',
  }), []);
  const getAccessToken = session.getAccessToken;
  const { working, latestActivity, workText } = useJarvisActivity();
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
  const sessionCommands = useMemo(() => createSessionCommandRegistry(), []);
  // The camera controller changes identity on every render; read it when a command arrives instead of re-publishing the workspace.
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);
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
  const shellElement = useRef<HTMLDivElement>(null);
  usePhoneChatViewport(shellElement, signedIn && phone && !voiceActive);
  // Phone shell: the open windows list and the page menu are sheets opened from the top bar.
  const [windowsSheetOpen, setWindowsSheetOpen] = useState(false);
  const windowCount = openWindows.filter((window) => window.viewId !== conversationViewId).length;
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), [setMenuOpen]);
  // Jarvis switching the page Dan is looking at (P9-40): the route changes with the usual page transition, then the
  // named Settings section or task card is scrolled into view and glows once its data has loaded.
  // The Folio pane (P9-25) shares the left sidebar slot with area navigation; only one is open at a time.
  const [folioOpen, setFolioOpen] = useState(false);
  const [folioPath, setFolioPath] = useState(pathname);
  if (folioPath !== pathname) {
    setFolioPath(pathname);
    setFolioOpen(false);
  }
  const [navigationOpen, setNavigationOpen] = useState(false);
  const closePagePanels = useCallback(() => {
    if (document.activeElement?.closest('#folio-pane')) {
      document.getElementById('content')?.focus({ preventScroll: true });
    }
    setFolioOpen(false);
    setNavigationOpen(false);
  }, [setFolioOpen, setNavigationOpen]);
  const openTaskRef = useRef<(taskId: string) => void>(() => {});
  const conversationWindowRef = useRef<{ open: boolean; setOpen: (open: boolean) => boolean } | null>(null);
  const cancelReveal = useRef<() => void>(() => {});
  const navigationGuard = useRef(false);
  const factoryIssueNavigator = useRef<FactoryIssueNavigator | null>(null);
  const issueNavigationAbort = useRef<AbortController | null>(null);
  const navigateTo = useCallback((request: NavigateRequest) => {
    const target = resolveNavigation(request, dailyEnabled);
    if (!target.ok) return false;
    if (target.issueNumber !== undefined) return false;
    if (target.pane === 'folio') { setFolioOpen(true); return true; }
    if (pathnameRef.current !== target.path && navigationGuard.current) return false;
    closePagePanels();
    if (pathnameRef.current !== target.path) navigate(target.path);
    if (target.taskId) openTaskRef.current(target.taskId);
    const reduced = document.documentElement.dataset.motion === 'reduced' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const revealId = target.anchorId ?? (target.taskId ? `task-title-${target.taskId}` : null);
    cancelReveal.current();
    cancelReveal.current = revealId ? revealWhenReady(() => document.getElementById(revealId), reduced) : () => {};
    return true;
  }, [closePagePanels, dailyEnabled, navigate, setFolioOpen]);
  useEffect(() => () => cancelReveal.current(), []);
  useEffect(() => {
    if (pathname !== '/factory/kanban') issueNavigationAbort.current?.abort();
  }, [pathname]);
  useEffect(() => () => issueNavigationAbort.current?.abort(), []);
  // What Dan is looking at (P9-43), sent with the snapshot so Jarvis can say "this page" or "that task" correctly.
  const [frontViewId, setFrontViewId] = useState<string | null>(null);
  const viewPage = pageForPath(pathname, dailyEnabled);
  const viewSection = useVisibleSettingsSection(signedIn && viewPage === 'settings');
  const viewIssueNumber = useFocusedFactoryIssue(signedIn && viewPage === 'factory');
  const viewTaskId = frontViewId?.startsWith('task-') ? frontViewId.slice(5) : undefined;
  const location: WorkspaceViewLocation = useMemo(() => ({
    page: viewPage,
    ...(viewSection ? { section: viewSection } : {}),
    ...(viewTaskId && viewIssueNumber === undefined ? { taskId: viewTaskId } : {}),
    ...(viewIssueNumber !== undefined ? { issueNumber: viewIssueNumber } : {}),
  }), [viewPage, viewSection, viewTaskId, viewIssueNumber]);
  const [viewHistory, setViewHistory] = useState<{ current: WorkspaceViewLocation; previous?: WorkspaceViewLocation }>({ current: location });
  if (JSON.stringify(viewHistory.current) !== JSON.stringify(location)) setViewHistory({ current: location, previous: viewHistory.current });
  const view: LookingAtView = useMemo(() => ({
    ...location,
    folioOpen,
    ...(frontViewId && location.issueNumber === undefined ? { focusedViewId: frontViewId } : {}),
    ...(viewHistory.previous ? { previous: viewHistory.previous } : {}),
  }), [folioOpen, frontViewId, location, viewHistory.previous]);
  // The page and Folio pane Dan is reading, reported as windows with their text (P9-63).
  const pageKey = `${viewPage}|${viewSection ?? ''}|${folioOpen}`;
  const pageReadback = useReadback(() => ({ key: pageKey, windows: readPageWindows(viewPage, viewSection, folioOpen) }), signedIn, pageKey);
  const pageWindows = pageReadback?.key === pageKey ? pageReadback.windows : undefined;
  const snapshotWindows = useMemo(
    () => pageWindows?.length ? [...openWindows, ...pageWindows].slice(0, 32) : openWindows,
    [openWindows, pageWindows],
  );
  const workspaceCommands = useMemo(() => ({
    snapshot: { windows: snapshotWindows, contextPanelOpen: contextPanel.isOpen, device: readWorkspaceDevice(), ...(frame ? { frame } : {}), ...(signedIn ? { view } : {}) },
    dispatch: (command: Parameters<WorkspaceController['dispatch']>[0], trustedBlobHost?: string) => {
      const navigateRequest = readNavigateCommand(command);
      if (navigateRequest) return navigateTo(navigateRequest);
      const conversationAction = readConversationCommand(command);
      if (conversationAction) return conversationWindowRef.current?.setOpen(conversationAction === 'show') ?? false;
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
          researchInProgress(command.view.source.status) && hasRunningJob('research')) {
        workspaceController.current?.dispatch({ commandId: `${command.commandId}-park`, operation: 'minimise', viewId: command.viewId });
      }
      return applied;
    },
    minimiseAll: () => workspaceController.current?.minimiseAll(),
    hasVisibleViews: () => workspaceController.current?.hasVisibleViews() ?? false,
    isViewVisible: (viewId: string) => workspaceController.current?.isViewVisible?.(viewId) ?? false,
    applySession: (command: Parameters<typeof applySessionCommand>[0]) => applySessionCommand(command, sessionCommands, cameraRef.current),
    applyPin: (command: Extract<WorkspaceCommand, { operation: 'pin' | 'unpin' }>) =>
      workspaceController.current?.applyPin?.(command) ?? Promise.resolve({ applied: false, reason: 'Window pinning is unavailable.' }),
  }), [contextPanel, frame, navigateTo, sessionCommands, signedIn, snapshotWindows, view]);
  const applyWorkspaceCommand = useCallback((command: WorkspaceCommand, trustedBlobHost?: string, expiresAt?: number, cancelSignal?: AbortSignal): boolean | Promise<SessionCommandResult> => {
    if (command.operation === 'navigate' && command.page === 'factory' && command.issueNumber !== undefined) {
      const { issueNumber, taskId } = command;
      const target = resolveNavigation(command, dailyEnabled);
      if (!target.ok) return Promise.resolve({ applied: false, reason: target.reason });
      if (cancelSignal?.aborted || (expiresAt !== undefined && expiresAt <= Date.now() + 250)) {
        return Promise.resolve({ applied: false, reason: 'The issue navigation command expired or was cancelled.' });
      }
      let navigated = false;
      flushSync(() => { navigated = navigateTo({ page: 'factory' }); });
      if (!navigated) return Promise.resolve({ applied: false, reason: 'Save or discard the current draft before opening this issue.' });
      issueNavigationAbort.current?.abort();
      const controller = new AbortController();
      issueNavigationAbort.current = controller;
      const signal = cancelSignal ? AbortSignal.any([controller.signal, cancelSignal]) : controller.signal;
      return waitForFactoryIssue(() => factoryIssueNavigator.current?.(issueNumber, taskId) ?? null,
        signal, expiresAt).then((result) => {
        if (result.status === 'refused') return { applied: false, reason: result.reason };
        if (signal.aborted) return { applied: false, reason: 'Issue navigation was cancelled.' };
        const title = document.getElementById(result.anchorId)?.querySelector<HTMLElement>('.task-card-title');
        if (!title) return { applied: false, reason: 'The requested issue could not be revealed on this board.' };
        const linkedTaskId = result.taskId;
        if (linkedTaskId) flushSync(() => openTaskRef.current(linkedTaskId));
        const reduced = document.documentElement.dataset.motion === 'reduced' ||
          (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
        if (!linkedTaskId) title.focus({ preventScroll: true });
        cancelReveal.current();
        cancelReveal.current = revealWhenReady(() => document.getElementById(result.anchorId), reduced);
        return { applied: true };
      });
    }
    const navigation = readNavigateCommand(command);
    if (navigation) {
      const target = resolveNavigation(navigation, dailyEnabled);
      if (!target.ok) return false;
      const deadline = Math.min(expiresAt ?? Date.now() + 6000, Date.now() + 6000) - 250;
      if (cancelSignal?.aborted || deadline <= Date.now()) {
        return Promise.resolve({ applied: false, reason: 'Page navigation expired or was cancelled before application.' });
      }
      const deadlineResult: SessionCommandResult = {
        applied: false, reason: 'The requested page did not finish opening before the command deadline.',
      };
      let applied = false;
      flushSync(() => { applied = navigateTo(navigation); });
      const path = target.path;
      if (!applied || path === undefined || pathnameRef.current === path) {
        return applied && deadline <= Date.now() ? Promise.resolve(deadlineResult) : applied;
      }
      // The data router can commit the page after the dispatch's flushSync returns.
      return new Promise<SessionCommandResult>((resolve) => {
        let settled = false;
        const finish = (result: SessionCommandResult) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          cancelSignal?.removeEventListener('abort', cancel);
          if (pendingPageNavigation.current?.finish === finish) pendingPageNavigation.current = null;
          resolve(result.applied && deadline <= Date.now() ? deadlineResult : result);
        };
        const cancel = () => finish({ applied: false, reason: 'Page navigation was cancelled before completion.' });
        const timer = window.setTimeout(() => finish(deadlineResult), Math.max(0, deadline - Date.now()));
        pendingPageNavigation.current?.finish({ applied: false, reason: 'Page navigation was superseded before completion.' });
        pendingPageNavigation.current = { path, finish };
        cancelSignal?.addEventListener('abort', cancel, { once: true });
        if (cancelSignal?.aborted) cancel();
      });
    }
    if (command.operation === 'session') return workspaceCommands.applySession(command);
    if (command.operation === 'pin' || command.operation === 'unpin') return workspaceCommands.applyPin(command);
    if ((command.operation === 'show' || command.operation === 'restore' || command.operation === 'focus') &&
        command.viewId === cameraPreviewViewId && !cameraRef.current.sharing && !cameraRef.current.starting) {
      return openCameraPreview(cameraRef.current);
    }
    let applied = false;
    flushSync(() => { applied = workspaceCommands.dispatch(command, trustedBlobHost); });
    return applied;
  }, [dailyEnabled, navigateTo, workspaceCommands]);
  const onVoiceActiveChange = useCallback((active: boolean) => {
    if (active && readVoiceWorkspacePreference().voice.minimizeWindowsOnVoiceStart) {
      workspaceController.current?.minimiseAll();
    }
    // Desktop voice uses the full room; phone voice stays docked on the current page.
    if (active && !phone && pathnameRef.current !== '/') navigate('/');
    setVoiceActive(active);
  }, [navigate, phone]);
  // Off the home page the chat bar lives in the rail as an orb; pressing it pops the bar out over the current page.
  const [chatOut, setChatOut] = useState(false);
  const [chatOutPath, setChatOutPath] = useState(pathname);
  if (chatOutPath !== pathname) {
    setChatOutPath(pathname);
    if (chatOut) setChatOut(false);
  }
  // On phones there is no rail: the chat bar is the dock at the bottom of every page (Dan, 8 October).
  const chatPlace: 'home' | 'out' | 'rail' = !signedIn || home ? 'home' : phone || chatOut ? 'out' : 'rail';
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
  useEffect(() => {
    const strip = tabsHost?.parentElement;
    if (!phone || !strip) return;
    // Window tabs are portals, so React bubbling does not follow this DOM strip.
    const closeWindowSheet = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('button') && !target.closest('.job-tabs')) setWindowsSheetOpen(false);
    };
    strip.addEventListener('click', closeWindowSheet, true);
    return () => strip.removeEventListener('click', closeWindowSheet, true);
  }, [phone, tabsHost]);
  const knowledgeBackend = useMemo(() => ({ backendUrl: config.backendUrl, getAccessToken }), [config.backendUrl, getAccessToken]);
  const workspacePins = useMemo(() => signedIn && config.backendUrl
    ? createWorkspacePinsClient(config.backendUrl, getAccessToken)
    : undefined, [config.backendUrl, getAccessToken, signedIn]);
  // A finished background job brings its result window forward, or parks it as a tab while Dan is away.
  // While a research job shows as a tab, its progress window's own tab would be a duplicate.
  const jobsAccountId = signedIn
    ? (session.client.getActiveAccount() ?? session.client.getAllAccounts()[0])?.homeAccountId ?? null
    : null;
  const { history: backgroundJobs } = useJobs(signedIn ? config.backendUrl : null, getAccessToken, jobsAccountId);
  const headerEntryCount = windowCount;
  const researchRunning = backgroundJobs.some((job) => job.kind === 'research' && job.status === 'running');
  // The conversation never needs a tab: the chat bar's orb and handle bring it back.
  const hideResearchProgressTab = useCallback((view: WorkspaceView) => view.presentation === 'conversation' || researchRunning && view.content.status === 'generated' &&
    view.content.view.source.id === 'research' && researchInProgress(view.content.view.source.status), [researchRunning]);
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
  const [conversationPosition, setConversationPosition] = useState<ConversationPosition | null>(null);
  const [conversationComposerHeight, setConversationComposerHeight] = useState(52);
  const onVisibleViewIdsChange = useCallback((ids: readonly string[]) => {
    setConversationOpen(ids.includes(conversationViewId));
  }, []);
  const conversationWindow = useMemo(() => ({
    position: voiceActive || phone ? null : conversationPosition,
    setComposerHeight: setConversationComposerHeight,
    element: conversationHost,
    setAvailable: setConversationAvailable,
    open: conversationOpen,
    setOpen: (open: boolean) => workspaceController.current?.dispatch({
      commandId: `conversation-handle-${open ? 'restore' : 'minimise'}`,
      operation: open ? 'restore' : 'minimise',
      viewId: conversationViewId,
    }) ?? false,
  }), [conversationHost, conversationOpen, conversationPosition, phone, voiceActive]);
  useEffect(() => { conversationWindowRef.current = conversationWindow; }, [conversationWindow]);
  // Phones (Dan, 8 October): moving to another page tucks the chat away so the new page is not covered.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (phone && conversationWindowRef.current?.open) conversationWindowRef.current.setOpen(false);
  }, [pathname, phone]);
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
    ...(camera.sharing || camera.starting || camera.error ? [{
      id: cameraPreviewViewId,
      title: 'Camera preview',
      presentation: 'camera-preview' as const,
      initialGeometry: { x: 0.7, y: 0.02, width: 0.29, height: 0.42, columns: 1 },
      onClose: camera.stop,
      content: { status: 'ready' as const, content: <CameraPreview camera={camera} /> },
    }] : []),
    ...taskViews,
  ], [camera, conversationAvailable, taskViews]);
  const cameraLifecycle = useRef(false);
  useLayoutEffect(() => {
    const active = Boolean(camera.sharing || camera.starting || camera.error);
    const stoppedWithError = !camera.sharing && !camera.starting && Boolean(camera.error);
    if (active && (!cameraLifecycle.current || stoppedWithError)) {
      workspaceController.current?.dispatch({ commandId: 'camera-preview-open', operation: 'restore', viewId: cameraPreviewViewId });
    }
    cameraLifecycle.current = active;
  }, [camera.error, camera.sharing, camera.starting]);
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
    if (phone) {
      // Phones are voice first: the transcript stays tucked away until Dan swipes it up or asks Jarvis for it.
      if (becameAvailable) command('minimise');
      lifecycle.hiddenForVoice = false;
    } else if (voiceActive) {
      // Fullscreen voice starts with history out of the way; Jarvis can still show it with window commands.
      if (!lifecycle.hiddenForVoice) lifecycle.hiddenForVoice = command('minimise');
    } else if (lifecycle.hiddenForVoice || (becameAvailable && !controller.isViewVisible?.(conversationViewId))) {
      // Returning from voice or to the Jarvis page brings history back for the replies.
      lifecycle.hiddenForVoice = false;
      command('restore');
    }
  }, [conversationAvailable, phone, voiceActive]);
  // The navigation is a drawer over the page: it starts closed and opens from the rail.
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
  const [settingsActivityHost, setSettingsActivityHost] = useState<HTMLElement | null>(null);
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
    <div ref={shellElement} className={`app app-shell${signedIn ? '' : ' app-signed-out'}`} data-navigation-open={signedIn && (navigationShown || folioOpen)} data-folio-open={signedIn && folioOpen}
      data-context-open={signedIn && contextPanel.isOpen} data-voice-active={voiceActive}
      data-voice-has-windows={voiceHasWindows} data-conversation-open={signedIn && conversationOpen}
      style={{ ...panelWidths, '--conversation-composer-height': `${conversationComposerHeight}px` } as CSSProperties}
      data-home={home} data-chat={chatPlace} data-phone={signedIn && phone} data-windows-open={signedIn && phone && windowsSheetOpen && headerEntryCount > 0}>
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
          <NavLink className="rail-link" to="/" end aria-label="Conversation" onClick={closePagePanels}>
            <ShellIcon name="home" /><span className="visually-hidden">Jarvis</span>
          </NavLink>
          {areas.map((area) => (
            <NavLink key={area.id} className="rail-link" to={`/${area.path}`} aria-label={area.label} onClick={() => { setFolioOpen(false); setNavigationOpen(area.navigation.length > 1); }}>
              <ShellIcon name={area.id === 'daily' ? 'daily' : area.id === 'factory' ? 'factory' : area.id === 'notes' ? 'knowledge' : area.id === 'status' ? 'status' : 'usage'} /><span className="visually-hidden">{area.label}</span>
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
          <Link className="brand" to="/" aria-label="Jarvis home" onClick={closePagePanels}>Jarvis</Link>
        </div>
        {/* Open windows live as tabs in the top bar, between the brand and the controls (no breadcrumb). */}
        {signedIn && <div className="window-tabstrip">
        <div ref={setTabsHost} className="window-tabbar" />
        </div>}
        {signedIn && <JobsChip key={jobsAccountId} accountId={jobsAccountId} backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} onResult={openJobResult} />}

        {signedIn && (
          <div className="topbar-actions">
            {phone && headerEntryCount > 0 && (
              <button className="topbar-icon-button mobile-windows-button" type="button" aria-expanded={windowsSheetOpen}
                aria-label={`Open windows: ${headerEntryCount}`} onClick={() => setWindowsSheetOpen((open) => !open)}>
                <span className="mobile-windows-count" aria-hidden="true">{headerEntryCount}</span>
              </button>
            )}
            <PresenceChip backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
            {config.backendUrl && (
              <DatabaseWakeStatus backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
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
            {phone && (
              <button className="topbar-icon-button mobile-menu-button" type="button" aria-label="Menu" aria-expanded={menuOpen}
                aria-controls="mobile-menu" onClick={() => setMenuOpen((open) => !open)}>
                <ShellIcon name="navigation" />
              </button>
            )}
            <NavLink className="settings-link" to="/settings" aria-label="Settings" title="Settings" onClick={closePagePanels}>
              <ShellIcon name="settings" />
            </NavLink>
          </div>
        )}
      </header>
      <main id="content" className="shell-main" tabIndex={-1}>
        {presenceError && <p className="browser-presence-error" role="alert">{presenceError}</p>}
        {/* One room behind every page (and sign-in), so navigation never swaps or reloads the scene. */}
        <JarvisStage theme={themePreference.resolvedTheme} appearance={themePreference.appearance}
          active={!signedIn || home || voiceActive}>
        <KnowledgeBackendContext.Provider value={knowledgeBackend}>
        <WorkspaceCommandContext.Provider value={workspaceCommands}>
          <SessionCommandRegistryContext.Provider value={sessionCommands}>
          <VoiceWorkspaceContext.Provider value={{ onVoiceActiveChange }}>
            <ConversationWindowContext.Provider value={conversationWindow}>
              <NavigationGuardContext.Provider value={navigationGuard}>
                <FactoryIssueNavigationContext.Provider value={factoryIssueNavigator}>
                  <SettingsActivityHostContext.Provider value={setSettingsActivityHost}>
                    <DailyRefreshContext.Provider value={dailyRefresh}><Outlet /></DailyRefreshContext.Provider>
                  </SettingsActivityHostContext.Provider>
                </FactoryIssueNavigationContext.Provider>
              </NavigationGuardContext.Provider>
              {/* The chat stays mounted on every page, so a conversation or voice session survives navigation. */}
              {signedIn && session.profile && (
                <JarvisPage
                  client={session.client}
                  config={config}
                  camera={camera}
                  screenShare={screenShare}
                  docked={chatPlace === 'rail'}
                  {...(chatPlace === 'out' && !phone ? { onDismiss: collapseChat } : {})}
                />
              )}
            </ConversationWindowContext.Provider>
            {signedIn && (
              <div className="workspace-shell-area">
                <Workspace ref={workspaceController} views={workspaceViews} onVisibleViewsChange={setVoiceHasWindows} onOpenWindowsChange={onOpenWindowsChange} onFrontViewChange={setFrontViewId}
                  onVisibleViewIdsChange={onVisibleViewIdsChange} tabsHost={tabsHost} defaultArrangement="layered" arrangeMenu={false}
                  onConversationPositionChange={setConversationPosition}
                  conversationComposerHeight={conversationComposerHeight}
                  hideTab={hideResearchProgressTab} {...(workspacePins ? { pins: workspacePins } : {})} />
              </div>
            )}
            {/* Keep the broker session alive across routes; only its visible panel moves into Settings. */}
            {signedIn && (
              <div hidden>
                <NowFeedPanel
                  client={session.client}
                  config={config}
                  getAccessToken={getAccessToken}
                  applyWorkspaceCommand={applyWorkspaceCommand}
                  portalHost={settingsActivityHost}
                  {...(dailyEnabled ? { onDataRefresh: onDailyRefresh } : {})}
                />
              </div>
            )}
          </VoiceWorkspaceContext.Provider>
          </SessionCommandRegistryContext.Provider>
        </WorkspaceCommandContext.Provider>
        </KnowledgeBackendContext.Provider>
        </JarvisStage>
      </main>
      {signedIn && phone && (
        <>
          <MobileCaption text={workText ?? (working ? activityText : null)} />
          <MobileMenu open={menuOpen} onClose={closeMenu} onNavigate={closePagePanels} onFolio={() => setFolioOpen(true)} onContext={contextPanel.toggle} dailyEnabled={dailyEnabled} />
        </>
      )}
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
function SettingsRoute({ config, session, nutritionKey }: {
  config: PublicConfig;
  session: SignInSession;
  /** Account key for the Daily nutrition targets; null while Daily is off, which renders nothing and asks for nothing. */
  nutritionKey: string | null;
}) {
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
      {...(nutritionKey ? { nutrition: <NutritionTargetsSettings key={nutritionKey} backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} /> } : {})}
      memory={<MemorySettings backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />}
      activity={<SettingsActivity client={session.client} config={config} />} />
  );
}

/** The persistent shell feed renders into this slot; backend sleep remains Settings-owned. */
function SettingsActivity({ client, config }: {
  client: SignInSession['client'];
  config: PublicConfig;
}) {
  const registerHost = useContext(SettingsActivityHostContext);
  return (
    <>
      <div id="settings-activity" ref={registerHost} />
      <CollapsibleSection storageKey="settings.backend" className="panel" headingId="backend-heading" title="Backend">
        <BackendSleepControl client={client} config={config} />
      </CollapsibleSection>
    </>
  );
}

// Vite inlines __JARVIS_CONFIG__ as an object literal. Read it once: a new object per render
// recreated the MSAL client and re-ran sign-in restore in a loop (L65).
const defaultConfig: PublicConfig = __JARVIS_CONFIG__;
// The deployed camera protocol accepts upload-only image handles in chat and voice.
const cameraConversationDeployed = true;

export function App({ config = defaultConfig, dailyEnabled = false }: { config?: PublicConfig; dailyEnabled?: boolean }) {
  const areas = appAreas(dailyEnabled);
  useGlassLight();
  const session = useSignIn(config);
  const signedIn = session.state === 'signed-in' && session.profile !== null;
  const dailyAccountKey = dailyEnabled && signedIn
    ? (session.client.getActiveAccount() ?? session.client.getAllAccounts()[0])?.homeAccountId ?? 'owner'
    : 'disabled';
  const camera = useCamera(config, session.getAccessToken, cameraConversationDeployed);
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
          <Route element={<Shell signedIn={signedIn} config={config} session={session} camera={camera} screenShare={screenShare} dailyEnabled={dailyEnabled} />}>
            <Route element={<RequireSignIn session={session} />}>
              <Route index element={<h1 className="visually-hidden">Welcome, {session.profile?.name ?? ''}</h1>} />
              {areas.map(({ id, path, Component }) => (
                <Route key={id} path={`${path}/*`} element={
                  <Component key={id === 'daily' ? dailyAccountKey : id} backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
                } />
              ))}
              <Route path="settings" element={<SettingsRoute config={config} session={session} nutritionKey={dailyEnabled ? dailyAccountKey : null} />} />
              <Route path="knowledge/*" element={<Navigate to="/notes" replace />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ThemePreferenceProvider>
    </JarvisActivityProvider>
  );
}

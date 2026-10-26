import { createContext, useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import type { WorkspaceNavigationPage, WorkspaceSettingsSection } from '@jarvis/contracts';
import { isTaskId } from './task-windows';

export const NavigationGuardContext = createContext<RefObject<boolean> | null>(null);

/**
 * Jarvis switching the page Dan is looking at (P9-40, #567). Keys agreed with the backend: pages, Settings sections and
 * an optional task id that opens the task's window over the board and lights its card.
 */
export interface NavigateRequest { page: string; section?: string; taskId?: string; issueNumber?: number }

export type FactoryIssueTarget =
  | { status: 'loading' }
  | { status: 'refused'; reason: string }
  | { status: 'ready'; anchorId: string; taskId?: string };
export type FactoryIssueNavigator = (issueNumber: number, taskId?: string) => FactoryIssueTarget;
export const FactoryIssueNavigationContext = createContext<RefObject<FactoryIssueNavigator | null> | null>(null);

const pages: Record<string, string> = {
  home: '/',
  factory: '/factory/kanban',
  settings: '/settings',
  usage: '/usage',
  status: '/status',
  knowledge: '/notes',
  notes: '/notes',
  daily: '/health',
  health: '/health',
};
export const settingsAnchors: Record<string, string> = {
  appearance: 'appearance-settings-heading',
  jarvis: 'jarvis-settings-heading',
  personality: 'personality-settings-heading',
  voice: 'voice-settings-heading',
  presence: 'presence',
  memory: 'memory',
  coding: 'coding-settings-heading',
  projects: 'projects-heading',
  routines: 'routines-heading',
  credentials: 'credentials-heading',
  notifications: 'notifications-heading',
};

export type NavigateTarget =
  | { ok: true; path: string; anchorId?: string; taskId?: string; issueNumber?: number; pane?: never }
  | { ok: true; pane: 'workspaces'; path?: never; anchorId?: never; taskId?: never; issueNumber?: never }
  | { ok: false; reason: string };

/** Reads a navigate command without depending on the contract version, so older contracts simply never match. */
export function readNavigateCommand(command: unknown): NavigateRequest | null {
  if (typeof command !== 'object' || command === null) return null;
  const { operation, page, section, taskId, issueNumber } = command as Record<string, unknown>;
  if (operation !== 'navigate' || typeof page !== 'string') return null;
  if (issueNumber !== undefined && (typeof issueNumber !== 'number' || !Number.isSafeInteger(issueNumber) || issueNumber <= 0)) return null;
  return {
    page,
    ...(typeof section === 'string' ? { section } : {}),
    ...(typeof taskId === 'string' ? { taskId } : {}),
    ...(issueNumber !== undefined ? { issueNumber } : {}),
  };
}

export function resolveNavigation({ page, section, taskId, issueNumber }: NavigateRequest, dailyEnabled = false): NavigateTarget {
  if ((page === 'daily' || page === 'health') && dailyEnabled !== true) return { ok: false, reason: 'Health is not enabled in this client.' };
  if (issueNumber !== undefined && (page !== 'factory' || !Number.isSafeInteger(issueNumber) || issueNumber <= 0)) {
    return { ok: false, reason: 'An issue can only be opened on the Software Factory board by its positive whole number.' };
  }
  // Workspaces is a pane over the current page rather than a page of its own.
  if (page === 'workspaces' || page === 'folio') return section === undefined && taskId === undefined ? { ok: true, pane: 'workspaces' } : { ok: false, reason: 'The Workspaces pane has no sections.' };
  const path = pages[page];
  if (!path) return { ok: false, reason: `Unknown page: ${page}.` };
  if (section !== undefined) {
    if (page !== 'settings') return { ok: false, reason: `The ${page} page has no sections.` };
    const anchorId = settingsAnchors[section];
    return anchorId ? { ok: true, path, anchorId } : { ok: false, reason: `Unknown Settings section: ${section}.` };
  }
  if (taskId !== undefined) {
    if (page !== 'factory' || !isTaskId(taskId)) return { ok: false, reason: 'A task can only be opened on the Software Factory board by its id.' };
    return { ok: true, path, taskId, ...(issueNumber !== undefined ? { issueNumber } : {}) };
  }
  return { ok: true, path, ...(issueNumber !== undefined ? { issueNumber } : {}) };
}

export async function waitForFactoryIssue(
  find: () => FactoryIssueTarget | null,
  signal: AbortSignal,
  expiresAt = Date.now() + 6000,
): Promise<Exclude<FactoryIssueTarget, { status: 'loading' }>> {
  const deadline = Math.min(expiresAt - 250, Date.now() + 6000);
  while (!signal.aborted && Date.now() < deadline) {
    const target = find();
    if (target && target.status !== 'loading') return target;
    await new Promise<void>((resolve) => {
      const settle = () => { clearTimeout(timer); signal.removeEventListener('abort', settle); resolve(); };
      const timer = setTimeout(settle, Math.min(120, deadline - Date.now()));
      signal.addEventListener('abort', settle, { once: true });
    });
  }
  return { status: 'refused', reason: signal.aborted ? 'Issue navigation was cancelled.' :
    'The Factory board is still loading. Try the issue again when the board is ready.' };
}

/**
 * Waits for an element the new page renders once its data has loaded (up to 6 s), scrolls it into view and gives its
 * section a brief glow. Returns a cancel function.
 */
export function revealWhenReady(find: () => Element | null, reducedMotion: boolean): () => void {
  let cancelled = false;
  let timer = 0;
  let highlighted: Element | null = null;
  const started = performance.now();
  const attempt = () => {
    if (cancelled) return;
    const target = find();
    if (!target) {
      if (performance.now() - started < 6000) timer = window.setTimeout(attempt, 120);
      return;
    }
    // A folded section opens first, so Jarvis never points at something hidden.
    const fold = target.closest('[data-collapsible]');
    if (fold?.getAttribute('data-open') === 'false') fold.querySelector<HTMLButtonElement>('.collapsible-toggle')?.click();
    const columnToggle = target.closest('.kanban-column')?.querySelector<HTMLButtonElement>('.kanban-column-toggle');
    if (columnToggle?.getAttribute('aria-expanded') === 'false') {
      columnToggle.click();
      timer = window.setTimeout(attempt, 120);
      return;
    }
    const host = target.closest('section, .kanban-card, li') ?? target;
    highlighted = host;
    host.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    host.setAttribute('data-navigated', '');
    timer = window.setTimeout(() => host.removeAttribute('data-navigated'), 3000);
  };
  timer = window.setTimeout(attempt, 60);
  return () => { cancelled = true; window.clearTimeout(timer); highlighted?.removeAttribute('data-navigated'); };
}

const pagePrefixes: readonly [string, WorkspaceNavigationPage][] = [
  ['/factory', 'factory'], ['/settings', 'settings'], ['/usage', 'usage'], ['/status', 'status'], ['/notes', 'notes'], ['/knowledge', 'knowledge'],
];

/** The shell page for a route, for the `view` Dan is looking at (P9-43). */
export function pageForPath(pathname: string, dailyEnabled = false): WorkspaceNavigationPage {
  if (dailyEnabled === true && (pathname === '/health' || pathname.startsWith('/health/') ||
      pathname === '/daily' || pathname.startsWith('/daily/'))) return 'health';
  return pagePrefixes.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? 'home';
}

function focusedFactoryIssueNumber(): number | undefined {
  const card = document.activeElement?.closest('.kanban-board .kanban-card');
  if (!card || card.closest('[hidden], [inert]')) return undefined;
  const titleId = card.getAttribute('aria-labelledby');
  const match = titleId?.match(/^issue-title-([1-9]\d*)$/);
  if (!match || !card.querySelector(`#${titleId}`)) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
}

function subscribeFactoryIssueFocus(notify: () => void): () => void {
  const observer = new MutationObserver(notify);
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-labelledby'],
  });
  document.addEventListener('focusin', notify);
  document.addEventListener('focusout', notify);
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', notify);
    document.removeEventListener('focusout', notify);
  };
}

export function useFocusedFactoryIssue(active: boolean): number | undefined {
  const number = useSyncExternalStore(subscribeFactoryIssueFocus, focusedFactoryIssueNumber, () => undefined);
  return active ? number : undefined;
}

/**
 * The Settings section Dan is reading: the last section whose top has passed 35% of the viewport height. It is
 * measured on scroll (throttled) and shortly after Settings opens, while its data loads.
 */
export function useVisibleSettingsSection(active: boolean): WorkspaceSettingsSection | undefined {
  const [section, setSection] = useState<WorkspaceSettingsSection | undefined>();
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const measure = () => {
      timer = 0;
      const line = window.innerHeight * 0.35;
      let current: WorkspaceSettingsSection | undefined;
      let currentTop = -Infinity;
      for (const [key, anchorId] of Object.entries(settingsAnchors)) {
        const anchor = document.getElementById(anchorId);
        const top = (anchor?.closest('section') ?? anchor)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line && top > currentTop) {
          current = key as WorkspaceSettingsSection;
          currentTop = top;
        }
      }
      setSection(current);
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(measure, 200); };
    const settle = [400, 1500, 4000].map((delay) => window.setTimeout(measure, delay));
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      settle.forEach((id) => window.clearTimeout(id));
      document.removeEventListener('scroll', schedule, { capture: true });
    };
  }, [active]);
  return active ? section : undefined;
}

/** Jarvis showing or hiding the conversation transcript (P9-45, #596); read structurally until the contract lands. */
export function readConversationCommand(command: unknown): 'show' | 'hide' | null {
  if (typeof command !== 'object' || command === null) return null;
  const { operation, action } = command as Record<string, unknown>;
  return operation === 'conversation' && (action === 'show' || action === 'hide') ? action : null;
}
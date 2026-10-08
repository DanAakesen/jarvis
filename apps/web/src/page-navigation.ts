import { isTaskId } from './task-windows';

/**
 * Jarvis switching the page Dan is looking at (P9-40, #567). Keys agreed with the backend: pages, Settings sections and
 * an optional task id that opens the task's window over the board and lights its card.
 */
export interface NavigateRequest { page: string; section?: string; taskId?: string }

const pages: Record<string, string> = {
  home: '/',
  factory: '/factory/kanban',
  settings: '/settings',
  usage: '/usage',
  knowledge: '/knowledge',
};
// Pages Jarvis may name that this build does not have yet; they are refused rather than sent to a missing route.
const notYet = new Set(['status']);
const settingsAnchors: Record<string, string> = {
  appearance: 'appearance-settings-heading',
  jarvis: 'jarvis-settings-heading',
  personality: 'personality-settings-heading',
  voice: 'voice-settings-heading',
  presence: 'presence',
  memory: 'memory',
  coding: 'coding-settings-heading',
  projects: 'projects-heading',
  routines: 'task-recipes-heading',
  credentials: 'credentials-heading',
  backend: 'backend-heading',
};

export type NavigateTarget =
  | { ok: true; path: string; anchorId?: string; taskId?: string; pane?: never }
  | { ok: true; pane: 'folio'; path?: never; anchorId?: never; taskId?: never }
  | { ok: false; reason: string };

/** Reads a navigate command without depending on the contract version, so older contracts simply never match. */
export function readNavigateCommand(command: unknown): NavigateRequest | null {
  if (typeof command !== 'object' || command === null) return null;
  const { operation, page, section, taskId } = command as Record<string, unknown>;
  if (operation !== 'navigate' || typeof page !== 'string') return null;
  return {
    page,
    ...(typeof section === 'string' ? { section } : {}),
    ...(typeof taskId === 'string' ? { taskId } : {}),
  };
}

export function resolveNavigation({ page, section, taskId }: NavigateRequest): NavigateTarget {
  if (notYet.has(page)) return { ok: false, reason: `The ${page} page is not available yet.` };
  // The Folio is a pane over the current page rather than a page of its own.
  if (page === 'folio') return section === undefined && taskId === undefined ? { ok: true, pane: 'folio' } : { ok: false, reason: 'The Folio has no sections.' };
  const path = pages[page];
  if (!path) return { ok: false, reason: `Unknown page: ${page}.` };
  if (section !== undefined) {
    if (page !== 'settings') return { ok: false, reason: `The ${page} page has no sections.` };
    const anchorId = settingsAnchors[section];
    return anchorId ? { ok: true, path, anchorId } : { ok: false, reason: `Unknown Settings section: ${section}.` };
  }
  if (taskId !== undefined) {
    if (page !== 'factory' || !isTaskId(taskId)) return { ok: false, reason: 'A task can only be opened on the Software Factory board by its id.' };
    return { ok: true, path, taskId };
  }
  return { ok: true, path };
}

/**
 * Waits for an element the new page renders once its data has loaded (up to 6 s), scrolls it into view and gives its
 * section a brief glow. Returns a cancel function.
 */
export function revealWhenReady(find: () => Element | null, reducedMotion: boolean): () => void {
  let cancelled = false;
  let timer = 0;
  const started = performance.now();
  const attempt = () => {
    if (cancelled) return;
    const target = find();
    if (!target) {
      if (performance.now() - started < 6000) timer = window.setTimeout(attempt, 120);
      return;
    }
    const host = target.closest('section, .kanban-card, li') ?? target;
    host.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    host.setAttribute('data-navigated', '');
    timer = window.setTimeout(() => host.removeAttribute('data-navigated'), 3000);
  };
  timer = window.setTimeout(attempt, 60);
  return () => { cancelled = true; window.clearTimeout(timer); };
}

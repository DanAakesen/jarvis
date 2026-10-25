import { useEffect, useRef, useState } from 'react';
import type { GeneratedView, WorkspaceNavigationPage, WorkspaceSettingsSection, WorkspaceSnapshotWindow } from '@jarvis/contracts';
import { settingsAnchors } from './page-navigation';

// What Dan sees in a window, reported with the workspace snapshot so Jarvis's `read_window` can read it (P9-63, #640).
// Bounded, text only, and never input values or secrets.
export const contentLimitBytes = 8 * 1024;
export const selectionLimitBytes = 2 * 1024;
/** Same debounce as the other snapshot inputs (the shell frame). */
export const readbackDebounceMs = 400;
export const readbackEvent = 'jarvis:readback';

export type WindowReadback = Pick<WorkspaceSnapshotWindow, 'content' | 'selection'>;

const encoder = new TextEncoder();
const skippedTags = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'CANVAS', 'OBJECT', 'EMBED']);
const editable = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const secretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /(?:\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}|\bjs\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b)/gu,
  /\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}/gu,
  /\b(password|passwd|secret|token|api[-_ ]?key|client[-_ ]?secret)(\s*[:=]\s*)\S+/giu,
];

/** Hides anything shaped like a credential before the text leaves the browser. */
export function redactSecrets(text: string): string {
  return secretPatterns.reduce((value, pattern) => value.replace(pattern, (_match, name?: string, separator?: string) =>
    name ? `${name}${separator}[redacted]` : '[redacted]'), text);
}

/** Cuts to a UTF-8 byte limit on a character boundary, marking the cut. */
export function boundText(text: string, limit: number): string {
  if (encoder.encode(text).byteLength <= limit) return text;
  const suffix = '…';
  let result = '';
  let bytes = encoder.encode(suffix).byteLength;
  for (const character of text) {
    bytes += encoder.encode(character).byteLength;
    if (bytes > limit) break;
    result += character;
  }
  return result + suffix;
}

const clean = (text: string, limit: number) => boundText(redactSecrets(
  text.replace(/[^\S\n]+/gu, ' ').replace(/ ?\n[\s]*/gu, '\n').trim()), limit);

function hidden(element: Element, exclude?: string): boolean {
  if (exclude && element.matches(exclude)) return true;
  if (skippedTags.has(element.tagName) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true' ||
      element.getAttribute('data-readback') === 'off') return true;
  const style = element instanceof HTMLElement || element instanceof SVGElement ? getComputedStyle(element) : null;
  return style?.display === 'none' || style?.visibility === 'hidden';
}

/** The readable text under `root`, skipping form controls, hidden parts, scripts and frames. */
export function readableText(root: Element, limit = contentLimitBytes, exclude?: string): string {
  const parts: string[] = [];
  let size = 0;
  const walk = (node: Node): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        parts.push(text);
        size += text.length;
      } else if (child.nodeType === Node.ELEMENT_NODE && !hidden(child as Element, exclude)) {
        if (!walk(child)) return false;
        // Block boundaries keep neighbouring cells and headings apart.
        parts.push(' ');
      }
      // Characters are at least one byte each, so this stops early without ever under-filling the limit.
      if (size > limit * 2) return false;
    }
    return true;
  };
  walk(root);
  return clean(parts.join(''), limit);
}

/** Text Dan has selected inside `root`; empty when nothing is, or when the selection is in a form control. */
export function selectedTextWithin(root: Element, limit = selectionLimitBytes, exclude?: string): string {
  const selection = document.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
  const active = document.activeElement;
  if (active instanceof Element && root.contains(active) && active.matches(editable)) return '';
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return '';
  const container = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (container?.closest(editable) || container?.closest('[data-readback="off"]') || exclude && container?.closest(exclude)) return '';
  return clean(selection.toString(), limit);
}

/** Chart series (names carry the supplied units) and timeline events, straight from the generated data. */
export function generatedViewReadback(view: GeneratedView): string | undefined {
  if (view.renderer === 'chart') {
    return [`${view.data.kind} chart`, ...view.data.series.map((series) =>
      `${series.name}: ${series.points.map((point) => `${point.x}=${point.y}`).join(', ')}`)].join('\n');
  }
  if (view.renderer === 'timeline') {
    return view.data.events.map((event) => [event.at ?? event.label, event.title, event.description]
      .filter((part) => part !== undefined && part !== '').join(' - ')).join('\n');
  }
  return undefined;
}

/** What the sandboxed report frame told us, keyed by its iframe (the validated bridge message, not DOM access). */
const frameReports = new WeakMap<Element, WindowReadback>();

export function reportFrameReadback(frame: Element, report: { content: string; selection: string } | null): void {
  if (report) {
    frameReports.set(frame, {
      content: clean(report.content, contentLimitBytes),
      ...(report.selection ? { selection: clean(report.selection, selectionLimitBytes) } : {}),
    });
  } else {
    frameReports.delete(frame);
  }
  document.dispatchEvent(new Event(readbackEvent));
}

/** Readback for one rendered window or page element. */
export function readElement(element: Element, view?: GeneratedView, exclude?: string): WindowReadback | undefined {
  const frame = element.querySelector('iframe.html-app-frame');
  const generated = view ? generatedViewReadback(view) : undefined;
  const reported = frame ? frameReports.get(frame) : undefined;
  const content = generated !== undefined ? clean(generated, contentLimitBytes) : reported?.content ?? (frame ? undefined : readableText(element, contentLimitBytes, exclude));
  const selection = reported?.selection ?? selectedTextWithin(element, selectionLimitBytes, exclude);
  if (content === undefined && !selection) return undefined;
  return { ...(content ? { content } : {}), ...(selection ? { selection } : {}) };
}

/**
 * Collects readback after the page settles: on render, text changes, selection changes and frame reports, debounced
 * like the shell frame. Returns the latest result, unchanged by identity when nothing differs.
 */
export function useReadback<T>(collect: () => T, enabled: boolean, key: string): T | undefined {
  const [value, setValue] = useState<T>();
  const collectRef = useRef(collect);
  useEffect(() => { collectRef.current = collect; });
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const run = () => {
      timer = 0;
      const next = collectRef.current();
      setValue((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(run, readbackDebounceMs); };
    schedule();
    document.addEventListener('selectionchange', schedule);
    document.addEventListener(readbackEvent, schedule);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener(readbackEvent, schedule);
      observer?.disconnect();
    };
  }, [enabled, key]);
  return enabled ? value : undefined;
}

const pageTitles: Partial<Record<WorkspaceNavigationPage, string>> = { settings: 'Settings', knowledge: 'Graph', notes: 'Notes', status: 'Status', daily: 'Health', health: 'Health' };

/**
 * The page Dan is on (Settings section, Graph, Notes, Status) and the Workspaces pane as snapshot windows, so `read_window` can
 * read them as `page-<page>` and `workspaces-pane`. Credentials are never read.
 */
export function readPageWindows(page: WorkspaceNavigationPage, section: WorkspaceSettingsSection | undefined, workspacesOpen: boolean): WorkspaceSnapshotWindow[] {
  const windows: WorkspaceSnapshotWindow[] = [];
  const add = (viewId: string, title: string, root: Element | null | undefined, exclude?: string) => {
    const found = root ? readElement(root, undefined, exclude) : undefined;
    if (found) windows.push({ viewId, title, state: 'open', ...found });
  };
  if (page === 'settings' && section !== 'credentials') {
    const anchor = section ? document.getElementById(settingsAnchors[section] ?? '') : null;
    add('page-settings', section ? `Settings: ${section}` : 'Settings', section ? anchor?.closest('section') ?? anchor : document.querySelector('.settings-page'));
  } else if (page !== 'settings' && pageTitles[page]) {
    add(`page-${page}`, pageTitles[page]!, document.querySelector('main#content'), '.workspace-shell-area, .jarvis-page');
  }
  if (workspacesOpen) add('workspaces-pane', 'Workspaces', document.getElementById('workspaces-pane'));
  return windows;
}

import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  isGeneratedView, type GeneratedView, type GeneratedViewListItem, type GeneratedViewSource, type WorkspaceCommand, type WorkspaceSnapshot,
} from '@jarvis/contracts';
import { knowledgeGraphView } from '../vault/index.js';
import { readSettings } from './settings.js';
import type { WorkspaceCommandBroker } from './workspace-commands.js';

const turns = new WeakMap<WorkspaceCommandBroker, Map<string, { at: number; views: Map<string, WorkspaceSnapshot | undefined> }>>();
const vaultTools = new Set(['vault_search', 'vault_read', 'memory_search']);
const repoTools = new Set(['repo_overview', 'repo_list', 'repo_read', 'repo_search', 'repo_issues']);
const taskTools = new Set(['create_task', 'steer_task', 'retry_task']);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function redactWorkContent(value: string): string {
  return value
    .replace(/(\b(?:proxy-)?authorization[ \t]*[:=][ \t]*)[^\r\n]*/giu, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/giu, '[REDACTED]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/gu,
      (match) => match.replace(/[^\r\n]+/gu, '[REDACTED PRIVATE KEY]'))
    .replace(/(["']?\b(?:(?:[a-z0-9]+[_-])*(?:password|passwd|pwd|token|key|secret)|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|access[_ -]?key|private[_ -]?key|client[_ -]?secret|accountkey|connectionstring|authorization)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;&]+)/giu,
      (match, prefix: string) => prefix + match.slice(prefix.length).replace(/[^\r\n]+/gu, '[REDACTED]'))
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gu, '[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/giu, '$1[REDACTED]@');
}

function safeText(value: unknown, limit = 200): string {
  return typeof value === 'string'
    ? Array.from(redactWorkContent(value), (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('').trim().slice(0, limit) : '';
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * Static, value-free notes for a Google result the tool reports as incomplete (truncated) or that the presenter cuts
 * to fit. They go inside the view and, as the source reason, into a partial source, so an incomplete answer is never
 * shown as the whole truth. They never repeat anything from the result.
 */
const incompleteNotes = {
  moreEvents: 'More events exist than are shown.',
  noEvents: 'No events were found in the part of the calendar that was searched.',
  noNextEvent: 'No upcoming event found in the part of your calendar that was searched.',
  uncertainSlots: 'Calendar results were incomplete, so some of these slots may not be free.',
  noSlots: 'No free slots were found in the part of the calendar that was searched.',
  moreSlots: 'More free slots exist than are shown.',
  moreMessages: 'More messages may exist than are shown.',
  noMessages: 'No matching messages were found in the part of the mailbox that was searched.',
  moreDrafts: 'More drafts may exist than are shown.',
  noDrafts: 'No drafts were found in the part of the mailbox that was searched.',
} as const;
const googleRowLimit = 50;
const agendaCharacterBudget = 9_000;

/** A readable agenda for calendar_list_events / calendar_next_event results, or undefined for any other shape. */
function calendarAgenda(value: Record<string, unknown>): { text: string; incomplete?: string } | undefined {
  if (!Array.isArray(value.events)) return undefined;
  const zone = typeof value.timeZone === 'string' ? value.timeZone : 'UTC';
  try {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' });
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const allDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
    const lines: string[] = [];
    let heading = '';
    let used = 0;
    let cut = false;
    for (const raw of value.events) {
      const event = object(raw);
      const subject = safeText(event.subject, 200) || 'Untitled event';
      const location = safeText(event.location, 120);
      const start = typeof event.start === 'string' ? event.start : '';
      const end = typeof event.end === 'string' ? event.end : '';
      let label: string;
      let group: string;
      if (event.allDay === true) {
        const date = new Date(`${start}T12:00:00Z`);
        if (Number.isNaN(date.getTime())) return undefined;
        group = allDay.format(date);
        label = 'All day';
      } else {
        const from = new Date(start);
        const to = new Date(end);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return undefined;
        group = day.format(from);
        label = `${time.format(from)}–${time.format(to)}`;
      }
      const line = `${label} · ${subject}${location ? ` (${location})` : ''}`;
      const added = group === heading ? [line] : [...(lines.length ? [''] : []), group, line];
      const size = added.reduce((total, entry) => total + entry.length + 1, 0);
      // The text view is capped, so stop at a whole event rather than let the cap cut the list and its note.
      if (used + size > agendaCharacterBudget) { cut = true; break; }
      used += size;
      lines.push(...added);
      heading = group;
    }
    const truncated = value.truncated === true || cut;
    if (!lines.length) {
      return truncated ? { text: incompleteNotes.noEvents, incomplete: incompleteNotes.noEvents }
        : { text: 'No events in this period.' };
    }
    if (!truncated) return { text: lines.join('\n') };
    lines.push('', incompleteNotes.moreEvents);
    return { text: lines.join('\n'), incomplete: incompleteNotes.moreEvents };
  } catch { return undefined; }
}

const mailDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const outcomeLabels: Record<string, string> = {
  completed: 'Done.',
  cancelled: 'Cancelled. Nothing was changed.',
  partial: 'Partly done. Check what was applied before retrying.',
};

function mailSender(value: unknown): string {
  if (typeof value === 'string') return safeText(value, 200);
  const from = object(value);
  return safeText(from.name, 200) || safeText(from.address, 254);
}

function mailReceived(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : undefined;
  return date !== undefined && !Number.isNaN(date.getTime()) ? mailDate.format(date) : '';
}

type GooglePresentation =
  | { title: string; text: string; incomplete?: string }
  | { title: string; items: GeneratedViewListItem[]; incomplete?: string };

/**
 * A bounded list of mail rows. When the tool reports the result as truncated, or more rows came back than the list
 * holds, the last item is a plain note (so the list never exceeds googleRowLimit items) and the presentation is
 * marked incomplete. An empty incomplete result never claims that nothing exists.
 */
function mailList(
  title: string, rows: readonly unknown[], truncated: boolean, item: (raw: unknown) => GeneratedViewListItem,
  texts: { none: string; noneIncomplete: string; more: string },
): GooglePresentation {
  const incomplete = truncated || rows.length > googleRowLimit;
  const items = rows.slice(0, incomplete ? googleRowLimit - 1 : googleRowLimit).map(item);
  if (!items.length) {
    return incomplete ? { title, text: texts.noneIncomplete, incomplete: texts.noneIncomplete } : { title, text: texts.none };
  }
  return incomplete ? { title, items: [...items, { title: texts.more }], incomplete: texts.more } : { title, items };
}

/**
 * A clean view of a Google tool result, or undefined when it has no readable shape. Raw tool JSON, message
 * bodies and confirmation codes never go on screen; mail rows show only subject, sender and date. A result the tool
 * reports as truncated, or that does not fit, carries a static note and an `incomplete` text for the partial source.
 */
function googlePresentation(tool: string, value: Record<string, unknown>): GooglePresentation | undefined {
  const title = tool.startsWith('mail_') ? 'Mail' : 'Calendar';
  const status = value.status;
  if (status === 'awaiting_confirmation') return typeof value.summary === 'string' ? { title, text: value.summary } : undefined;
  if ((status === 'completed' || status === 'cancelled' || status === 'partial') && typeof value.summary === 'string') {
    return { title, text: `${outcomeLabels[status]}\n\n${value.summary}` };
  }
  const truncated = value.truncated === true;
  const agenda = calendarAgenda(value);
  if (agenda !== undefined) return { title, ...agenda };
  if (tool === 'calendar_next_event' && 'event' in value) {
    if (value.event === null) {
      return truncated ? { title, text: incompleteNotes.noNextEvent, incomplete: incompleteNotes.noNextEvent }
        : { title, text: 'No upcoming event in the next 60 days.' };
    }
    const next = calendarAgenda({ timeZone: value.timeZone, events: [value.event], truncated: value.truncated });
    return next === undefined ? undefined : { title, ...next };
  }
  if (tool === 'mail_search' && Array.isArray(value.messages)) {
    return mailList('Mail results', value.messages, truncated, (raw) => {
      const message = object(raw);
      const description = [mailSender(message.from), mailReceived(message.receivedDateTime)].filter(Boolean).join(' · ');
      return { title: safeText(message.subject, 200) || '(no subject)', ...(description ? { description } : {}) };
    }, { none: 'No matching messages found.', noneIncomplete: incompleteNotes.noMessages, more: incompleteNotes.moreMessages });
  }
  if (tool === 'mail_list_drafts' && Array.isArray(value.drafts)) {
    return mailList('Mail drafts', value.drafts, truncated, (raw) => {
      const draft = object(raw);
      const to = safeText(draft.to, 300);
      return { title: safeText(draft.subject, 200) || '(no subject)', ...(to ? { description: `To ${to}` } : {}) };
    }, { none: 'No drafts found.', noneIncomplete: incompleteNotes.noDrafts, more: incompleteNotes.moreDrafts });
  }
  if (tool === 'calendar_find_free_slots' && Array.isArray(value.slots)) {
    const length = Number.isSafeInteger(value.durationMinutes) ? `${String(value.durationMinutes)}-minute ` : '';
    const lines = value.slots.slice(0, googleRowLimit).map((raw) => {
      const slot = object(raw);
      const from = safeText(slot.startLocal, 60);
      const to = safeText(slot.endLocal, 60);
      return from && to ? `${from} to ${to}` : '';
    }).filter(Boolean);
    const cut = value.slots.length > googleRowLimit;
    if (!lines.length) {
      return truncated || cut ? { title: 'Free time', text: incompleteNotes.noSlots, incomplete: incompleteNotes.noSlots }
        : { title: 'Free time', text: `No free ${length}slots found in that period.` };
    }
    // Free time is computed from the events the tool read, so an incomplete event list can show busy time as free.
    const note = [...(truncated ? [incompleteNotes.uncertainSlots] : []), ...(cut ? [incompleteNotes.moreSlots] : [])].join(' ');
    return {
      title: 'Free time',
      text: [`Free ${length}slots:`, ...lines, ...(note ? ['', note] : [])].join('\n'),
      ...(note ? { incomplete: note } : {}),
    };
  }
  return undefined;
}

function codeView(tool: string, input: Record<string, unknown>, result: Record<string, unknown>): GeneratedView {
  const rows = Array.isArray(result.results) ? result.results.map(object) : [];
  const match = tool === 'repo_search' ? rows[0] : undefined;
  const readme = object(result.readme);
  let content: string;
  if (tool === 'repo_read') content = typeof result.content === 'string' ? result.content : '';
  else if (tool === 'repo_search') {
    content = rows.map((row) => `${safeText(row.path, 1024)}:${row.line ?? ''} ${typeof row.snippet === 'string' ? row.snippet : ''}`).join('\n');
    if (!content) content = safeText(result.message) || 'No readable matches returned.';
  } else if (tool === 'repo_list') {
    content = (Array.isArray(result.entries) ? result.entries.map(object) : [])
      .map((entry) => `${safeText(entry.type)} ${safeText(entry.path, 1024)}`).join('\n') || 'No entries returned.';
  } else if (tool === 'repo_issues') {
    content = rows.map((row) => `#${row.number ?? ''} ${safeText(row.state)} ${safeText(row.title, 500)}`).join('\n') || 'No issues returned.';
  } else content = typeof readme.excerpt === 'string' ? readme.excerpt : JSON.stringify(result.tree ?? []);
  const bounded = escape(redactWorkContent(content)).split(/\r\n|\r|\n/u).slice(0, 400).join('\n').slice(0, 160_000);
  const startLine = tool === 'repo_read' && Number.isSafeInteger(result.startLine) && Number(result.startLine) > 0
    ? Number(result.startLine) : 1;
  return {
    version: 1,
    title: 'Code',
    renderer: 'code',
    source: { id: 'factory.projects', status: 'complete', updatedAt: new Date().toISOString() },
    data: {
      repo: escape(safeText(result.repository)),
      path: escape(safeText(result.path ?? readme.path ?? match?.path ?? input.path, 1024) || '.').slice(0, 2048),
      content: bounded,
      startLine,
      ...(typeof result.commit === 'string' ? { ref: escape(safeText(result.commit)).slice(0, 200) } : {}),
      ...(tool === 'repo_search' ? {
        query: escape(safeText(input.query)).slice(0, 500),
        highlight: rows.slice(0, 400).map((_, index) => ({ from: index + 1, to: index + 1 })),
      } : tool === 'repo_read' && bounded ? {
        highlight: [{ from: startLine, to: startLine + bounded.split('\n').length - 1 }],
      } : {}),
    },
  };
}

/** Presentation has its own bounded lifetime and never delays a tool or its confirmation. */
export type PresentationSurface = 'chat' | 'voice';

/**
 * Surface policy (10 Oct): typed chat answers inline, so nothing opens on its own there; Dan
 * asks for a window ("show me", "open", "put it on screen") and Jarvis creates one through the
 * view tools. Voice has no visible answer, so lookups open their window automatically.
 */
export function startWorkPresentation(tool: string, rawInput: unknown, request: FastifyRequest, activityId: string, turnId: string, signal: AbortSignal, surface: PresentationSurface): { finish: (result: unknown, successful: boolean) => void } {
  if (surface === 'chat') return { finish: () => {} };
  try {
    return beginWorkPresentation(tool, rawInput, request, activityId, turnId, signal);
  } catch {
    return { finish: () => {} };
  }
}

function beginWorkPresentation(tool: string, rawInput: unknown, request: FastifyRequest, activityId: string, turnId: string, signal: AbortSignal) {
  const app = request.server;
  const input = object(rawInput);
  const google = tool.startsWith('calendar_') || tool.startsWith('mail_');
  const selected = vaultTools.has(tool) || repoTools.has(tool) || taskTools.has(tool) || google || tool === 'web_search' || tool === 'web_research';
  if (!selected || !app.workspaceCommands.isConnected(app.ownerObjectId) || signal.aborted) return { finish: () => {} };
  const publish = (event: Parameters<typeof app.jarvisActivityHub.publish>[0]) => {
    try { app.jarvisActivityHub.publish(event); } catch { /* Presentation is best effort. */ }
  };
  const deliver = (command: WorkspaceCommand) => {
    if (signal.aborted) return Promise.resolve(false);
    return app.workspaceCommands.execute(app.ownerObjectId, command, AbortSignal.timeout(10_000))
      .then(() => true, () => false);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enabled = Promise.race([
    Promise.all([
      app.settingsStore ? readSettings(app.settingsStore) : Promise.resolve(undefined),
      app.awayModeStore?.read() ?? Promise.resolve(undefined),
    ]).then(([settings, presence]) => settings?.presentation.showWork !== false && presence?.mode !== 'on_the_move'),
    new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 250); }),
  ]).catch(() => false).finally(() => { clearTimeout(timer); });
  const subject = safeText(input.query ?? input.path ?? input.taskId, 45);
  const kind = vaultTools.has(tool) ? 'vault_search'
    : tool === 'repo_search' ? 'repo_search' : repoTools.has(tool) ? 'repo_read'
      : taskTools.has(tool) ? 'task' : tool.startsWith('web_') ? 'web_search' : 'other';
  const text = vaultTools.has(tool) ? `${tool === 'vault_read' ? 'Reading your vault note' : 'Searching your vault for'} ${subject}`
    : repoTools.has(tool) ? `${tool === 'repo_search' ? 'Searching your code for' : 'Reading your code'} ${subject}`
      : taskTools.has(tool) ? `Working on your task${subject ? ` ${subject}` : ''}`
        : google ? `Preparing your ${tool.startsWith('mail_') ? 'mail' : 'calendar'} view` : `Searching the web for ${subject}`;
  const started = enabled.then((show) => {
    if (!show || signal.aborted) return false;
    publish({ type: 'work-started', activityId, kind, text: text.trim().slice(0, 80), ...(subject ? { target: { label: subject } } : {}) });
    return true;
  });
  return {
    finish(result: unknown, successful: boolean) {
      void started.then((show) => {
        if (!show) return;
        try {
          if (!successful || signal.aborted) return;
          let ownerTurns = turns.get(app.workspaceCommands);
          if (!ownerTurns) { ownerTurns = new Map(); turns.set(app.workspaceCommands, ownerTurns); }
          for (const [id, state] of ownerTurns) if (Date.now() - state.at > 600_000) ownerTurns.delete(id);
          let state = ownerTurns.get(turnId);
          if (!state) {
            if (ownerTurns.size >= 128) ownerTurns.delete(ownerTurns.keys().next().value!);
            state = { at: Date.now(), views: new Map() };
            ownerTurns.set(turnId, state);
          }
          const showView = (viewId: string, view: GeneratedView) => {
            if (!isGeneratedView(view)) return;
            const cached = state.views.has(viewId) ? state : viewId === 'knowledge-graph'
              ? [...ownerTurns.values()].find((turn) => turn.views.has(viewId)) : undefined;
            const snapshot = app.workspaceCommands.snapshot(app.ownerObjectId);
            const existsInSnapshot = snapshot?.windows.some((window) => window.viewId === viewId);
            const existing = snapshot && snapshot !== cached?.views.get(viewId)
              ? existsInSnapshot : Boolean(cached) || existsInSnapshot;
            for (const turn of ownerTurns.values()) turn.views.delete(viewId);
            state.views.set(viewId, snapshot);
            void deliver({ commandId: randomUUID(), operation: existing ? 'update' : 'create', viewId, view }).then((applied) => {
              if (applied) void deliver({ commandId: randomUUID(), operation: 'focus', viewId });
              else state.views.delete(viewId);
            }).catch(() => {});
          };
          const value = object(result);
          if (vaultTools.has(tool)) {
            const paths = tool === 'vault_read' ? [safeText(value.path, 1024)]
              : (Array.isArray(value.results) ? value.results.map(object) : []).map((row) => safeText(row.path, 1024));
            showView('knowledge-graph', knowledgeGraphView(safeText(input.query ?? input.path, 500), paths.filter(Boolean)));
          } else if (repoTools.has(tool)) showView(`code-${turnId}`, codeView(tool, input, value));
          else if (taskTools.has(tool)) {
            const taskId = value.id ?? input.taskId;
            if (typeof taskId === 'string' && /^[1-9]\d{0,18}$/u.test(taskId) && BigInt(taskId) <= 9_223_372_036_854_775_807n) {
              void deliver({ commandId: randomUUID(), operation: 'navigate', page: 'factory', taskId });
            }
          } else if (google) {
            const shown = googlePresentation(tool, value);
            // An incomplete result is a partial source with the same static note as the in-view line.
            const updatedAt = new Date().toISOString();
            const incomplete = shown?.incomplete;
            const source: GeneratedViewSource = incomplete === undefined
              ? { id: 'now', status: 'complete', updatedAt }
              : { id: 'now', status: 'partial', updatedAt, reason: incomplete };
            if (shown && 'items' in shown) {
              showView(`google-${turnId}`, { version: 1, title: shown.title, renderer: 'list', source, data: { items: shown.items } });
            } else if (shown) {
              // The text renderer escapes on output, so escaping here would show entities such as &quot;.
              showView(`google-${turnId}`, {
                version: 1, title: shown.title, renderer: 'text', source,
                data: { format: 'plain', content: redactWorkContent(shown.text).slice(0, 10_000) },
              });
            }
          }
        } catch { /* Never change the tool outcome for a presentation failure. */ }
        finally { publish({ type: 'work-finished', activityId }); }
      }).catch(() => {});
    },
  };
}

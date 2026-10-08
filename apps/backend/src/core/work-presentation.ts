import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { isGeneratedView, type GeneratedView, type WorkspaceCommand } from '@jarvis/contracts';
import { knowledgeGraphView } from '../vault/index.js';
import { readSettings } from './settings.js';
import type { WorkspaceCommandBroker } from './workspace-commands.js';

const turns = new WeakMap<WorkspaceCommandBroker, Map<string, { at: number; views: Set<string> }>>();
const vaultTools = new Set(['vault_search', 'vault_read', 'memory_search']);
const repoTools = new Set(['repo_overview', 'repo_list', 'repo_read', 'repo_search', 'repo_issues']);
const taskTools = new Set(['create_task', 'steer_task', 'retry_task']);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function redactWorkContent(value: string): string {
  return value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/gu, '[REDACTED PRIVATE KEY]')
    .replace(/(["']?\b(?:(?:[a-z0-9]+[_-])*(?:password|passwd|pwd|token|key|secret)|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|access[_ -]?key|private[_ -]?key|client[_ -]?secret|accountkey|connectionstring|authorization)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;&]+)/giu, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/giu, '[REDACTED]')
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
export function startWorkPresentation(tool: string, rawInput: unknown, request: FastifyRequest, activityId: string, turnId: string, signal: AbortSignal): { finish: (result: unknown, successful: boolean) => void } {
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
            state = { at: Date.now(), views: new Set() };
            ownerTurns.set(turnId, state);
          }
          const showView = (viewId: string, view: GeneratedView) => {
            if (!isGeneratedView(view)) return;
            const existing = state.views.has(viewId) ||
              (viewId === 'knowledge-graph' && [...ownerTurns.values()].some((turn) => turn.views.has(viewId))) ||
              app.workspaceCommands.snapshot(app.ownerObjectId)?.windows.some((window) => window.viewId === viewId);
            state.views.add(viewId);
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
            const preview = value.status === 'awaiting_confirmation' ? value.summary : JSON.stringify(value);
            if (typeof preview === 'string') showView(`google-${turnId}`, {
              version: 1, title: tool.startsWith('mail_') ? 'Mail' : 'Calendar', renderer: 'text',
              source: { id: 'now', status: 'complete', updatedAt: new Date().toISOString() },
              data: { format: 'plain', content: escape(redactWorkContent(preview)).slice(0, 10_000) },
            });
          }
        } catch { /* Never change the tool outcome for a presentation failure. */ }
        finally { publish({ type: 'work-finished', activityId }); }
      }).catch(() => {});
    },
  };
}

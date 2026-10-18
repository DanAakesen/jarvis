import type { createGitHubVaultClient } from '../../vault/github-client.js';
import { MAX_VAULT_FILE_BYTES, VaultFileTooLargeError } from '../../vault/github-client.js';
import type { ProactiveSource, SourceContext, SourceResult } from '../types.js';
import { parseTodos, resolveTodoFile } from '../todo-file.js';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;
const sourceTimeoutMs = 20_000;
const todoWindowBeforeMs = 24 * 60 * 60 * 1000;
const todoWindowAfterMs = 72 * 60 * 60 * 1000;
const maxFacts = 40;

function unavailable(now: Date, reason: string): SourceResult {
  return { source: 'todos', state: 'unavailable', reason, facts: [], observedAt: now.toISOString() };
}

export function createTodosSource(vaultClient?: VaultReader): ProactiveSource {
  return {
    id: 'todos',
    label: 'Todo list',
    async read(context: SourceContext): Promise<SourceResult> {
      const { now, signal } = context;
      if (!vaultClient) return unavailable(now, 'not_connected');

      const timeout = new AbortController();
      const timeoutId = setTimeout(() => timeout.abort(), sourceTimeoutMs);
      const sourceSignal = AbortSignal.any([signal, timeout.signal]);
      try {
        const resolved = await resolveTodoFile(vaultClient, sourceSignal);
        if ('reason' in resolved) return unavailable(now, resolved.reason);
        const file = await vaultClient.read(resolved.path, sourceSignal);
        if (!file) return unavailable(now, 'read_failed');
        if (Buffer.byteLength(file.content, 'utf8') > MAX_VAULT_FILE_BYTES) {
          return unavailable(now, 'too_large');
        }

        const todos = parseTodos(file.content);
        const open = todos.flatMap((todo, index) => todo.done || !todo.highPriority ? [] : [{
          todo,
          index,
          dueTime: todo.dueAt === null ? null : Date.parse(todo.dueAt),
        }]);
        const windowStart = now.getTime() - todoWindowBeforeMs;
        const windowEnd = now.getTime() + todoWindowAfterMs;
        const dueWindow = open
          .filter(({ dueTime }) => dueTime !== null && dueTime >= windowStart && dueTime <= windowEnd)
          .sort((left, right) => left.dueTime! - right.dueTime!);
        const otherDue = open
          .filter(({ dueTime }) => dueTime !== null && (dueTime < windowStart || dueTime > windowEnd))
          .sort((left, right) => left.dueTime! - right.dueTime!);
        const noDue = open.filter(({ dueTime }) => dueTime === null);
        const selected = [...dueWindow, ...otherDue, ...noDue].slice(0, maxFacts);
        return {
          source: 'todos',
          state: 'ok',
          reason: null,
          observedAt: now.toISOString(),
          facts: selected.map(({ todo, index }) => ({
            ref: `todo:${index + 1}`,
            kind: 'todo',
            label: 'Todo list',
            text: todo.text,
            observedAt: now.toISOString(),
            dueAt: todo.dueAt,
            dueHasTime: todo.dueHasTime,
          })),
        };
      } catch (error) {
        if (error instanceof VaultFileTooLargeError) return unavailable(now, 'too_large');
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        return unavailable(now, timeout.signal.aborted || signal.aborted || timedOut ? 'timeout' : 'read_failed');
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

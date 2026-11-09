import type { createGitHubVaultClient } from '../../vault/github-client.js';
import { VaultFileTooLargeError } from '../../vault/github-client.js';
import type { ProactiveSource, SourceContext, SourceResult } from '../types.js';
import { readVaultTasks, TodoDiscoveryError } from '../todo-discovery.js';
import { normaliseFactText } from '../detect.js';
import { createHash } from 'node:crypto';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;
const sourceTimeoutMs = 20_000;
const todoWindowBeforeMs = 24 * 60 * 60 * 1000;
const todoWindowAfterMs = 72 * 60 * 60 * 1000;
const maxFacts = 40;

function unavailable(now: Date, reason: string): SourceResult {
  return { source: 'todos', state: 'unavailable', reason, facts: [], observedAt: now.toISOString() };
}

export function createTodosSource(vaultClient?: VaultReader, includeOrdinary = false): ProactiveSource {
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
        const todos = await readVaultTasks(vaultClient, sourceSignal);
        const seen = new Map<string, { dueHasTime: boolean; highPriority: boolean }>();
        const open = todos.flatMap((todo, index) => {
          if (todo.done || !includeOrdinary && !todo.highPriority) return [];
          const key = JSON.stringify([normaliseFactText(todo.text), todo.dueAt, todo.remindAtDue === true]);
          const existing = seen.get(key);
          if (existing) {
            existing.dueHasTime ||= todo.dueHasTime;
            existing.highPriority ||= todo.highPriority;
            return [];
          }
          const candidate = { ...todo };
          seen.set(key, candidate);
          return [{ todo: candidate, index, dueTime: todo.dueAt === null ? null : Date.parse(todo.dueAt) }];
        });
        const windowStart = now.getTime() - todoWindowBeforeMs;
        const windowEnd = now.getTime() + todoWindowAfterMs;
        const dueWindow = open
          .filter(({ dueTime }) => dueTime !== null && dueTime >= windowStart && dueTime <= windowEnd)
          .sort((left, right) => left.dueTime! - right.dueTime!);
        const otherDue = open
          .filter(({ dueTime }) => dueTime !== null && (dueTime < windowStart || dueTime > windowEnd))
          .sort((left, right) => left.dueTime! - right.dueTime!);
        const noDue = open.filter(({ dueTime }) => dueTime === null);
        const ordered = [...dueWindow, ...otherDue, ...noDue];
        // Ordinary commitments must not displace the existing urgent-alert source.
        const selected = [...ordered.filter(({ todo }) => todo.highPriority),
          ...ordered.filter(({ todo }) => !todo.highPriority)].slice(0, maxFacts);
        return {
          source: 'todos',
          state: 'ok',
          reason: null,
          observedAt: now.toISOString(),
          facts: selected.map(({ todo, index }) => ({
            ref: `todo:${index + 1}`,
            identity: `vault-task:${createHash('sha256').update(JSON.stringify([
              todo.path, normaliseFactText(todo.text),
            ])).digest('hex')}`,
            ...(/^(?:Personal|Work)\//u.test(todo.path) && !/(?:^|\/)projects?(?:\/|$)/iu.test(todo.path)
              ? { taskScope: todo.path.startsWith('Personal/') ? 'personal' as const : 'work' as const }
              : {}),
            ...(/(?:^|\/)projects?(?:\/|$)/iu.test(todo.path) ? { projectRelated: true } : {}),
            kind: todo.highPriority ? 'todo' as const : 'commitment' as const,
            label: 'Todo list',
            text: todo.text,
            observedAt: now.toISOString(),
            dueAt: todo.dueAt,
            dueHasTime: todo.dueHasTime,
            ...(todo.remindAtDue ? { remindAtDue: true } : {}),
            highPriority: todo.highPriority,
          })),
        };
      } catch (error) {
        if (error instanceof TodoDiscoveryError) return unavailable(now, error.reason);
        if (error instanceof VaultFileTooLargeError) return unavailable(now, 'too_large');
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        return unavailable(now, timeout.signal.aborted || signal.aborted || timedOut ? 'timeout' : 'read_failed');
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

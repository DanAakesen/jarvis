import {
  VaultAppNotInstalledError,
  VaultWriteConflictError,
  type createGitHubVaultClient,
} from '../vault/github-client.js';
import { isVaultLineSafe } from '../vault/index.js';
import type { FindingsStoredContext } from './engine.js';
import {
  appendTodos,
  buildSuggestedTodoLine,
  hasDuplicateTodo,
  hasTodoMarker,
  isTodoFileWritable,
  sanitiseTodoText,
} from './todo-lines.js';
import type { ProactiveStore } from './store.js';
import type { ProactiveTodoReceiptStore, TodoReceiptInput, TodoReceiptSummary } from './todo-store.js';
import { dayKey, isQuietHour } from './time.js';
import { MAX_VAULT_FILE_BYTES, resolveTodoFile } from './todo-file.js';

type VaultWriter = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read' | 'write'>;
type WriterLogger = {
  warn(data: { runId: string; reason: string; itemIds?: string[]; count?: number; durationMs?: number }, message: string): void;
};

const perRunLimit = 3;
const perDayLimit = 5;

interface PreparedTodo {
  itemId: string;
  dedupeKey: string;
  line: string;
}

function safeWarn(logger: WriterLogger | undefined, data: Parameters<WriterLogger['warn']>[0]): void {
  try { logger?.warn(data, 'proactive.todo_writer'); } catch { /* A logging failure cannot fail the run. */ }
}

export interface ProactiveTodoWriterOptions {
  vault: VaultWriter;
  store: Pick<ProactiveStore, 'settings' | 'items'>;
  receipts: ProactiveTodoReceiptStore;
  now?: () => Date;
  logger?: WriterLogger;
}

function sortedCandidates(context: FindingsStoredContext): FindingsStoredContext['findings'] {
  return context.findings
    .filter(({ suggestedTodo, category }) => suggestedTodo !== undefined && category !== 'todo')
    .sort((left, right) => {
      const leftDue = left.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(left.dueAt);
      const rightDue = right.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(right.dueAt);
      return (Number.isFinite(leftDue) ? leftDue : Number.POSITIVE_INFINITY) -
        (Number.isFinite(rightDue) ? rightDue : Number.POSITIVE_INFINITY) ||
        left.dedupeKey.localeCompare(right.dedupeKey);
    });
}

export function createProactiveTodoWriter(options: ProactiveTodoWriterOptions) {
  const now = options.now ?? (() => new Date());
  const log = (context: FindingsStoredContext, reason: string, itemIds?: string[], count?: number, startedAt = now()) => {
    safeWarn(options.logger, {
      runId: context.runId,
      reason,
      ...(itemIds === undefined ? {} : { itemIds }),
      ...(count === undefined ? {} : { count }),
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
    });
  };

  return async function onFindingsStored(context: FindingsStoredContext): Promise<void> {
    const startedAt = now();
    const candidates = sortedCandidates(context);
    if (candidates.length === 0) return;
    if (context.signal.aborted) {
      log(context, 'run_aborted', candidates.map(({ itemId }) => itemId), 0, startedAt);
      return;
    }
    let stage: 'settings' | 'receipts' | 'vault' = 'settings';
    try {
      const settings = await options.store.settings.read();
      if (settings.paused) {
        log(context, 'paused', candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }
      if (!settings.sources.todos) {
        log(context, 'todos_disabled', candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }
      if (context.signal.aborted) {
        log(context, 'run_aborted', candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }
      if (context.trigger !== 'manual' && isQuietHour(now())) {
        log(context, 'quiet_hours', candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }

      let currentDay = dayKey(now());
      stage = 'receipts';
      let roomToday = perDayLimit - await options.receipts.countAdded(currentDay);
      if (roomToday <= 0) {
        log(context, 'todo_daily_cap', candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }
      const summaries = await options.receipts.list(candidates.map(({ dedupeKey }) => dedupeKey));
      const settled = new Map(summaries.map((summary) => [summary.dedupeKey, summary]));
      const eligible = candidates.filter(({ dedupeKey }) => {
        const receipt = settled.get(dedupeKey);
        return !receipt?.added && !receipt?.skipped && (receipt?.failedAttempts ?? 0) < 2;
      });
      if (eligible.length === 0) return;

      const prepared: PreparedTodo[] = [];
      for (const finding of eligible) {
        const text = sanitiseTodoText(finding.suggestedTodo ?? '');
        if (Array.from(text).length < 3) {
          await insertReceipt(options.receipts, settled, {
            itemId: finding.itemId, dedupeKey: finding.dedupeKey, dayKey: currentDay,
            runId: context.runId, status: 'skipped', reason: 'invalid_text', commitSha: null,
          }, options.logger, context);
          log(context, 'invalid_text', [finding.itemId], 1, startedAt);
          continue;
        }
        if (!isVaultLineSafe(text)) {
          await insertReceipt(options.receipts, settled, {
            itemId: finding.itemId, dedupeKey: finding.dedupeKey, dayKey: currentDay,
            runId: context.runId, status: 'skipped', reason: 'unsafe_text', commitSha: null,
          }, options.logger, context);
          log(context, 'unsafe_text', [finding.itemId], 1, startedAt);
          continue;
        }
        prepared.push({
          itemId: finding.itemId,
          dedupeKey: finding.dedupeKey,
          line: buildSuggestedTodoLine(text, finding.dueAt, finding.dedupeKey),
        });
      }
      if (prepared.length === 0) return;
      if (context.signal.aborted || (context.trigger !== 'manual' && isQuietHour(now()))) {
        log(context, context.signal.aborted ? 'run_aborted' : 'quiet_hours',
          candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }

      stage = 'vault';
      const resolved = await resolveTodoFile(options.vault, context.signal);
      if ('reason' in resolved) {
        log(context, resolved.reason, undefined, 0, startedAt);
        return;
      }
      let file = await options.vault.read(resolved.path, context.signal);
      if (!file) {
        log(context, 'todo_file_missing', undefined, 0, startedAt);
        return;
      }
      if (!isTodoFileWritable(file.content)) {
        log(context, 'todo_file_unwritable', undefined, 0, startedAt);
        return;
      }

      const recovered = new Set<string>();
      let add: PreparedTodo[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (context.signal.aborted || (context.trigger !== 'manual' && isQuietHour(now()))) {
          log(context, context.signal.aborted ? 'run_aborted' : 'quiet_hours', undefined, 0, startedAt);
          return;
        }
        const nextDay = dayKey(now());
        if (nextDay !== currentDay) {
          currentDay = nextDay;
          stage = 'receipts';
          roomToday = perDayLimit - await options.receipts.countAdded(currentDay);
          stage = 'vault';
          recovered.clear();
        }
        if (roomToday <= 0) {
          log(context, 'todo_daily_cap', prepared.map(({ itemId }) => itemId), 0, startedAt);
          return;
        }
        if (!isTodoFileWritable(file.content)) {
          log(context, 'todo_file_unwritable', undefined, 0, startedAt);
          return;
        }
        let remainingDay = roomToday - recovered.size;
        let remainingRun = perRunLimit - recovered.size;
        add = [];
        let droppedForCap: PreparedTodo[] = [];
        for (let index = 0; index < prepared.length; index += 1) {
          const todo = prepared[index]!;
          const receipt = settled.get(todo.dedupeKey);
          if (receipt?.added || receipt?.skipped || (receipt?.failedAttempts ?? 0) >= 2) continue;
          if (remainingDay <= 0 || remainingRun <= 0) {
            droppedForCap = prepared.slice(index).filter(({ dedupeKey }) => {
              const summary = settled.get(dedupeKey);
              return !summary?.added && !summary?.skipped && (summary?.failedAttempts ?? 0) < 2;
            });
            break;
          }
          if (hasTodoMarker(file.content, todo.dedupeKey)) {
            await recoverReceipt(options, context, todo, currentDay, settled, startedAt);
            recovered.add(todo.dedupeKey);
            remainingDay -= 1;
            remainingRun -= 1;
            continue;
          }
          if (hasDuplicateTodo(file.content, todo.line)) {
            await insertReceipt(options.receipts, settled, {
              itemId: todo.itemId, dedupeKey: todo.dedupeKey, dayKey: currentDay,
              runId: context.runId, status: 'skipped', reason: 'duplicate', commitSha: null,
            }, options.logger, context);
            log(context, 'duplicate', [todo.itemId], 1, startedAt);
            continue;
          }
          add.push(todo);
          remainingDay -= 1;
          remainingRun -= 1;
        }
        if (droppedForCap.length) {
          log(context, remainingDay <= 0 ? 'todo_daily_cap' : 'todo_run_cap',
            droppedForCap.map(({ itemId }) => itemId), droppedForCap.length, startedAt);
        }
        if (add.length === 0) return;

        let content: string;
        try {
          content = appendTodos(file.content, add.map(({ line }) => line));
        } catch {
          log(context, 'todo_file_unwritable', add.map(({ itemId }) => itemId), add.length, startedAt);
          return;
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_VAULT_FILE_BYTES) {
          log(context, 'todo_file_too_large', add.map(({ itemId }) => itemId), add.length, startedAt);
          return;
        }
        if (context.signal.aborted || (context.trigger !== 'manual' && isQuietHour(now()))) {
          log(context, context.signal.aborted ? 'run_aborted' : 'quiet_hours', undefined, 0, startedAt);
          return;
        }

        try {
          const commitSha = await options.vault.write(
            resolved.path,
            content,
            `jarvis: add ${add.length} suggested todos from a proactive check\n\nCo-authored-by: Jarvis`,
            file.sha,
            context.signal,
          );
          await recordCommittedTodos(options, context, add, currentDay, commitSha, settled, startedAt);
          return;
        } catch (error) {
          if (!(error instanceof VaultWriteConflictError)) {
            const reason = error instanceof VaultAppNotInstalledError
              ? 'vault_app_not_installed' : 'vault_write_failed';
            await recordFailedTodos(options, context, add, currentDay, reason, settled, startedAt);
            return;
          }
          if (attempt === 2) {
            await recordFailedTodos(options, context, add, currentDay, 'vault_conflict_exhausted', settled, startedAt);
            return;
          }
          file = await options.vault.read(resolved.path, context.signal);
          if (!file) {
            log(context, 'todo_file_missing', add.map(({ itemId }) => itemId), 0, startedAt);
            return;
          }
        }
      }
    } catch (error) {
      const reason = error instanceof VaultAppNotInstalledError
        ? 'vault_app_not_installed' : context.signal.aborted ? 'run_aborted'
          : stage === 'settings' ? 'settings_unavailable'
            : stage === 'receipts' ? 'receipt_read_failed' : 'vault_unavailable';
      log(context, reason, candidates.map(({ itemId }) => itemId), 0, startedAt);
    }
  };
}

async function insertReceipt(
  receipts: ProactiveTodoReceiptStore,
  settled: Map<string, TodoReceiptSummary>,
  input: TodoReceiptInput,
  logger: WriterLogger | undefined,
  context: FindingsStoredContext,
): Promise<void> {
  try {
    await receipts.insert(input);
    const summary = settled.get(input.dedupeKey) ?? {
      dedupeKey: input.dedupeKey, added: false, skipped: false, failedAttempts: 0,
    };
    if (input.status === 'added') summary.added = true;
    else if (input.status === 'skipped') summary.skipped = true;
    else summary.failedAttempts += 1;
    settled.set(input.dedupeKey, summary);
  } catch {
    safeWarn(logger, {
      runId: context.runId,
      reason: 'receipt_write_failed',
      ...(input.itemId ? { itemIds: [input.itemId] } : {}),
    });
  }
}

async function recoverReceipt(
  options: ProactiveTodoWriterOptions,
  context: FindingsStoredContext,
  todo: PreparedTodo,
  currentDay: string,
  settled: Map<string, TodoReceiptSummary>,
  startedAt: Date,
): Promise<void> {
  await insertReceipt(options.receipts, settled, {
    itemId: todo.itemId, dedupeKey: todo.dedupeKey, dayKey: currentDay,
    runId: context.runId, status: 'added', reason: 'recovered', commitSha: null,
  }, options.logger, context);
  try {
    await options.store.items.markTodoAdded([todo.itemId]);
  } catch {
    safeWarn(options.logger, {
      runId: context.runId, reason: 'todo_item_update_failed', itemIds: [todo.itemId],
      durationMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAt.getTime()),
    });
  }
  safeWarn(options.logger, {
    runId: context.runId, reason: 'todo_recovered', itemIds: [todo.itemId], count: 1,
    durationMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAt.getTime()),
  });
}

async function recordCommittedTodos(
  options: ProactiveTodoWriterOptions,
  context: FindingsStoredContext,
  todos: readonly PreparedTodo[],
  currentDay: string,
  commitSha: string,
  settled: Map<string, TodoReceiptSummary>,
  startedAt: Date,
): Promise<void> {
  for (const todo of todos) {
    await insertReceipt(options.receipts, settled, {
      itemId: todo.itemId, dedupeKey: todo.dedupeKey, dayKey: currentDay,
      runId: context.runId, status: 'added', reason: null, commitSha,
    }, options.logger, context);
  }
  try {
    await options.store.items.markTodoAdded(todos.map(({ itemId }) => itemId));
  } catch {
    safeWarn(options.logger, {
      runId: context.runId, reason: 'todo_item_update_failed',
      itemIds: todos.map(({ itemId }) => itemId),
      durationMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAt.getTime()),
    });
  }
  safeWarn(options.logger, {
    runId: context.runId, reason: 'todo_added', itemIds: todos.map(({ itemId }) => itemId),
    count: todos.length,
    durationMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAt.getTime()),
  });
}

async function recordFailedTodos(
  options: ProactiveTodoWriterOptions,
  context: FindingsStoredContext,
  todos: readonly PreparedTodo[],
  currentDay: string,
  reason: string,
  settled: Map<string, TodoReceiptSummary>,
  startedAt: Date,
): Promise<void> {
  for (const todo of todos) {
    await insertReceipt(options.receipts, settled, {
      itemId: todo.itemId, dedupeKey: todo.dedupeKey, dayKey: currentDay,
      runId: context.runId, status: 'failed', reason, commitSha: null,
    }, options.logger, context);
  }
  safeWarn(options.logger, {
    runId: context.runId, reason, itemIds: todos.map(({ itemId }) => itemId),
    count: todos.length,
    durationMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAt.getTime()),
  });
}

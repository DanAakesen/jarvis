import { createHash } from 'node:crypto';
import {
  VaultAppNotInstalledError,
  VaultWriteConflictError,
  type createGitHubVaultClient,
} from '../vault/github-client.js';
import { isVaultLineSafe } from '../vault/index.js';
import type { FindingsStoredContext } from './engine.js';
import {
  appendTaskLines,
  buildSuggestedTodoLine,
  hasDuplicateTodo,
  hasTodoMarker,
  isTodoFileWritable,
  sanitiseTodoText,
} from './todo-lines.js';
import type { ProactiveStore } from './store.js';
import type { ProactiveTodoReceiptStore, TodoReceiptInput, TodoReceiptSummary } from './todo-store.js';
import { dayKey, isQuietHour } from './time.js';
import { MAX_VAULT_FILE_BYTES } from './todo-file.js';

type VaultWriter = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read' | 'write'>;
type WriterLogger = {
  warn(data: { runId: string; reason: string; itemIds?: string[]; count?: number; durationMs?: number }, message: string): void;
};

const perRunLimit = 3;
const perDayLimit = 5;

interface PreparedTodo {
  itemId: string;
  dedupeKey: string;
  legacyDedupeKey: string;
  targetPath: string;
  line: string;
}

interface VaultFile {
  path: string;
  sha: string;
  content: string;
}

const inboxes = {
  personal: 'Personal/Inbox.md',
  work: 'Work/Inbox.md',
} as const;
const rootTaskPath = /^(?:task|tasks)\.md$/iu;
const projectPattern = /\b(?:software|engineering|code(?:base| review|ing)?|repository|repo|pull requests?|merge requests?|pr\b|ci\/cd|pipelines?|deployment|deployments?|commits?|branches|unit tests?|test suites?|release engineering|build checks?|software factory|factory tasks?|project(?:s)?)\b/iu;
const projectBuildPattern = /\b(?:build|check|test|review|follow[- ]?up)\b.{0,36}\b(?:software|code|repo|branch|pipeline|ci|pull request|pr\b|deployment|engineering|project)\b|\b(?:software|code|repo|branch|pipeline|ci|pull request|pr\b|deployment|engineering|project)\b.{0,36}\b(?:build|check|test|review|follow[- ]?up)\b/iu;
const personalScopePattern = /\b(?:personal|home|household|family|doctor|dentist|groceries|grocery|shopping|school|kids|children|birthday|rent|utilities|medicine|cleaning|laundry)\b/iu;
const workScopePattern = /\b(?:work|office|job|manager|colleague|coworker|client|customer|supplier|business|workplace|professional|invoice|agenda)\b/iu;

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

function actionKey(
  finding: FindingsStoredContext['findings'][number],
  facts: FindingsStoredContext['facts'],
): string | undefined {
  const byRef = new Map(facts.map((fact) => [fact.ref, fact]));
  const identities = finding.evidenceRefs.map((ref) => byRef.get(ref)?.identity);
  if (identities.length === 0 || identities.some((identity) => !identity)) return undefined;
  return createHash('sha256').update(JSON.stringify([...identities].sort())).digest('hex').slice(0, 32);
}

function isProjectRelated(
  finding: FindingsStoredContext['findings'][number],
  facts: FindingsStoredContext['facts'],
  text: string,
): boolean {
  const cited = finding.evidenceRefs.flatMap((ref) => facts.filter((fact) => fact.ref === ref));
  if (cited.some(({ source, kind, projectRelated }) =>
    source === 'factory' || kind === 'factory' || projectRelated === true)) return true;
  const evidence = cited.map(({ text: factText }) => factText).join(' ');
  return projectPattern.test(`${text} ${evidence}`) || projectBuildPattern.test(`${text} ${evidence}`);
}

function taskScope(
  finding: FindingsStoredContext['findings'][number],
  facts: FindingsStoredContext['facts'],
  text: string,
): 'personal' | 'work' | undefined {
  const cited = finding.evidenceRefs.flatMap((ref) => facts.filter((fact) => fact.ref === ref));
  const explicit = new Set(cited.flatMap(({ taskScope: scope }) => scope ? [scope] : []));
  if (explicit.size > 1) return undefined;
  const context = `${text} ${cited.map(({ text: factText }) => factText).join(' ')}`;
  const personal = personalScopePattern.test(context);
  const work = workScopePattern.test(context);
  const established = [...explicit][0];
  if (personal && work) return undefined;
  if (established !== undefined) {
    return (personal && established !== 'personal') || (work && established !== 'work')
      ? undefined : established;
  }
  return personal === work ? undefined : personal ? 'personal' : 'work';
}

function safeScopeText(value: string): string {
  return value.replace(/^(?:\(proactive\)\s*)+/iu, '').trim();
}

function appendable(file: VaultFile): boolean {
  return isTodoFileWritable(file.content) &&
    !/(?:^|\r?\n)\s*#{1,6}\s+Suggested by Jarvis\s*#*\s*(?:\r?\n[\s\S]*)?$/iu.test(file.content);
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
      const actionKeys = new Map(candidates.map((finding) => [finding.itemId, actionKey(finding, context.facts)]));
      for (const finding of candidates) {
        if (!actionKeys.get(finding.itemId)) log(context, 'source_identity_unavailable', [finding.itemId], 1, startedAt);
      }
      const keys = candidates.flatMap((finding) =>
        [actionKeys.get(finding.itemId), finding.dedupeKey].filter((key): key is string => key !== undefined));
      const summaries = await options.receipts.list([...new Set(keys)]);
      const settled = new Map(summaries.map((summary) => [summary.dedupeKey, summary]));
      const eligible = candidates.filter((finding) => {
        const stableKey = actionKeys.get(finding.itemId);
        if (!stableKey) return false;
        const receipt = settled.get(stableKey);
        const legacyReceipt = settled.get(finding.dedupeKey);
        return !receipt?.added && !receipt?.skipped && !legacyReceipt?.added && !legacyReceipt?.skipped &&
          (receipt?.failedAttempts ?? 0) < 2 && (legacyReceipt?.failedAttempts ?? 0) < 2;
      });
      if (eligible.length === 0) return;

      const prepared: PreparedTodo[] = [];
      const preparedKeys = new Set<string>();
      for (const finding of eligible) {
        const rawText = finding.suggestedTodo ?? '';
        const stableKey = actionKeys.get(finding.itemId)!;
        if (isProjectRelated(finding, context.facts, rawText)) {
          await insertReceipt(options.receipts, settled, {
            itemId: finding.itemId, dedupeKey: stableKey, dayKey: currentDay,
            runId: context.runId, status: 'skipped', reason: 'project_related', commitSha: null,
          }, options.logger, context);
          log(context, 'project_related', [finding.itemId], 1, startedAt);
          continue;
        }
        const text = sanitiseTodoText(safeScopeText(rawText));
        if (Array.from(text).length < 3) {
          await insertReceipt(options.receipts, settled, {
            itemId: finding.itemId, dedupeKey: stableKey, dayKey: currentDay,
            runId: context.runId, status: 'skipped', reason: 'invalid_text', commitSha: null,
          }, options.logger, context);
          log(context, 'invalid_text', [finding.itemId], 1, startedAt);
          continue;
        }
        if (!isVaultLineSafe(text)) {
          await insertReceipt(options.receipts, settled, {
            itemId: finding.itemId, dedupeKey: stableKey, dayKey: currentDay,
            runId: context.runId, status: 'skipped', reason: 'unsafe_text', commitSha: null,
          }, options.logger, context);
          log(context, 'unsafe_text', [finding.itemId], 1, startedAt);
          continue;
        }
        const scope = taskScope(finding, context.facts, text);
        if (!scope) {
          await insertReceipt(options.receipts, settled, {
            itemId: finding.itemId, dedupeKey: stableKey, dayKey: currentDay,
            runId: context.runId, status: 'skipped', reason: 'scope_ambiguous', commitSha: null,
          }, options.logger, context);
          log(context, 'scope_ambiguous', [finding.itemId], 1, startedAt);
          continue;
        }
        if (preparedKeys.has(stableKey)) continue;
        preparedKeys.add(stableKey);
        prepared.push({
          itemId: finding.itemId,
          dedupeKey: stableKey,
          legacyDedupeKey: finding.dedupeKey,
          targetPath: inboxes[scope],
          line: buildSuggestedTodoLine(text, finding.dueAt, stableKey, {
            dueHasTime: finding.dueHasTime,
            highPriority: finding.highPriority,
          }),
        });
      }
      if (prepared.length === 0) return;
      if (context.signal.aborted || (context.trigger !== 'manual' && isQuietHour(now()))) {
        log(context, context.signal.aborted ? 'run_aborted' : 'quiet_hours',
          candidates.map(({ itemId }) => itemId), 0, startedAt);
        return;
      }

      stage = 'vault';
      const tree = await options.vault.tree(context.signal);
      const available = new Set(tree.map(({ path }) => path));
      const groups = new Map<string, PreparedTodo[]>();
      for (const todo of prepared) {
        if (!available.has(todo.targetPath)) {
          log(context, 'todo_destination_missing', [todo.itemId], 0, startedAt);
          continue;
        }
        const group = groups.get(todo.targetPath) ?? [];
        group.push(todo);
        groups.set(todo.targetPath, group);
      }
      if (groups.size === 0) return;
      const legacyPaths = tree.filter(({ path }) => !path.includes('/') && rootTaskPath.test(path)).map(({ path }) => path);
      const inboxPaths = Object.values(inboxes).filter((path) => available.has(path));
      const files = new Map<string, VaultFile>();
      for (const path of new Set([...inboxPaths, ...legacyPaths])) {
        const file = await options.vault.read(path, context.signal);
        if (!file || file.path !== path) {
          log(context, 'todo_destination_unverified', undefined, 0, startedAt);
          return;
        }
        if (Buffer.byteLength(file.content, 'utf8') > MAX_VAULT_FILE_BYTES) {
          log(context, inboxes.personal === path || inboxes.work === path
            ? 'todo_file_too_large' : 'todo_destination_unverified', undefined, 0, startedAt);
          return;
        }
        files.set(path, file);
      }

      let remainingRun = perRunLimit;
      for (const [targetPath, todos] of groups) {
        let file = files.get(targetPath);
        if (!file) {
          log(context, 'todo_destination_unverified', todos.map(({ itemId }) => itemId), 0, startedAt);
          continue;
        }
        if (!appendable(file)) {
          log(context, 'todo_destination_unwritable', todos.map(({ itemId }) => itemId), 0, startedAt);
          continue;
        }
        const add: PreparedTodo[] = [];
        for (const todo of todos) {
          if (roomToday <= 0 || remainingRun <= 0) {
            log(context, roomToday <= 0 ? 'todo_daily_cap' : 'todo_run_cap',
              [todo.itemId], 0, startedAt);
            continue;
          }
          const allFiles = [...files.values()];
          const hasMarker = allFiles.some((entry) =>
            hasTodoMarker(entry.content, todo.dedupeKey) ||
            hasTodoMarker(entry.content, todo.legacyDedupeKey));
          if (hasMarker) {
            await recoverReceipt(options, context, todo, currentDay, settled, startedAt);
            roomToday -= 1;
            remainingRun -= 1;
            continue;
          }
          if (allFiles.some((entry) => hasDuplicateTodo(entry.content, todo.line))) {
            await insertReceipt(options.receipts, settled, {
              itemId: todo.itemId, dedupeKey: todo.dedupeKey, dayKey: currentDay,
              runId: context.runId, status: 'skipped', reason: 'duplicate', commitSha: null,
            }, options.logger, context);
            log(context, 'duplicate', [todo.itemId], 1, startedAt);
            continue;
          }
          add.push(todo);
          roomToday -= 1;
          remainingRun -= 1;
        }
        if (add.length === 0) continue;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (context.signal.aborted || (context.trigger !== 'manual' && isQuietHour(now()))) {
            log(context, context.signal.aborted ? 'run_aborted' : 'quiet_hours',
              add.map(({ itemId }) => itemId), 0, startedAt);
            return;
          }
          if (dayKey(now()) !== currentDay) {
            currentDay = dayKey(now());
            stage = 'receipts';
            roomToday = perDayLimit - await options.receipts.countAdded(currentDay);
            stage = 'vault';
            if (roomToday < add.length) {
              const dropped = add.splice(Math.max(0, roomToday));
              log(context, 'todo_daily_cap', dropped.map(({ itemId }) => itemId), dropped.length, startedAt);
            }
            roomToday -= add.length;
          }
          if (add.length === 0) break;
          let content: string;
          try {
            const writable = appendable(file);
            if (!writable) throw new Error('unwritable');
            content = appendTaskLines(file.content, add.map(({ line }) => line));
          } catch {
            log(context, 'todo_destination_unwritable', add.map(({ itemId }) => itemId), add.length, startedAt);
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
              targetPath,
              content,
              `jarvis: add ${add.length} proactive todos from a proactive check\n\nCo-authored-by: Jarvis`,
              file.sha,
              context.signal,
            );
            await recordCommittedTodos(options, context, add, currentDay, commitSha, settled, startedAt);
            break;
          } catch (error) {
            if (!(error instanceof VaultWriteConflictError)) {
              const reason = error instanceof VaultAppNotInstalledError
                ? 'vault_app_not_installed' : 'vault_write_failed';
              await recordFailedTodos(options, context, add, currentDay, reason, settled, startedAt);
              break;
            }
            if (attempt === 2) {
              await recordFailedTodos(options, context, add, currentDay, 'vault_conflict_exhausted', settled, startedAt);
              break;
            }
            const fresh = await options.vault.read(targetPath, context.signal);
            if (!fresh || fresh.path !== targetPath) {
              log(context, 'todo_destination_unverified', add.map(({ itemId }) => itemId), 0, startedAt);
              break;
            }
            file = fresh;
            files.set(targetPath, file);
            for (const todo of [...add]) {
              const allFiles = [...files.values()];
              if (allFiles.some((entry) =>
                hasTodoMarker(entry.content, todo.dedupeKey) ||
                hasTodoMarker(entry.content, todo.legacyDedupeKey))) {
                await recoverReceipt(options, context, todo, currentDay, settled, startedAt);
                add.splice(add.indexOf(todo), 1);
              } else if (allFiles.some((entry) => hasDuplicateTodo(entry.content, todo.line))) {
                await insertReceipt(options.receipts, settled, {
                  itemId: todo.itemId, dedupeKey: todo.dedupeKey, dayKey: currentDay,
                  runId: context.runId, status: 'skipped', reason: 'duplicate', commitSha: null,
                }, options.logger, context);
                add.splice(add.indexOf(todo), 1);
                log(context, 'duplicate', [todo.itemId], 1, startedAt);
              }
            }
            if (add.length === 0) break;
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

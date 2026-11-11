import { createHash } from 'node:crypto';
import { ToolRefusal } from '../core/tool-registry.js';
import { parseTodosWithContext } from '../proactive/todo-file.js';
import { encodeTaskMetadata, taskLocalParts, validTaskTimeZone } from './task-metadata.js';
import {
  MAX_VAULT_FILE_BYTES,
  VaultWriteConflictError,
  type createGitHubVaultClient,
} from './github-client.js';

export interface TaskCreateInput {
  text: string;
  scope?: 'personal' | 'work';
  due?: string;
  time?: string;
  priority?: 'high' | 'medium' | 'normal';
  remindAtDue?: boolean;
  notes?: string;
  timeZone?: string;
  dueAt?: string;
}

export interface TaskCompleteInput {
  path: string;
  line: number;
  text: string;
  version: string;
  done: boolean;
}

export interface TaskEditInput extends Omit<TaskCompleteInput, 'done'> {
  newText: string;
  due?: string | null;
  time?: string | null;
  priority?: 'high' | 'medium' | 'normal';
  remindAtDue?: boolean;
  notes?: string;
  timeZone?: string;
}

const textSchema = { type: 'string', minLength: 1, maxLength: 400 };
const dateSchema = { type: 'string', format: 'date' };
const timePattern = '^([01]\\d|2[0-3]):[0-5]\\d$';
const metadataProperties = {
  notes: { type: 'string', maxLength: 2000 },
  timeZone: { type: 'string', minLength: 1, maxLength: 100 },
};
const identityProperties = {
  path: { type: 'string', minLength: 1, maxLength: 180 },
  line: { type: 'integer', minimum: 1, maximum: 1_000_000 },
  text: { type: 'string', minLength: 1, maxLength: 400 },
  version: { type: 'string', pattern: '^[0-9a-f]{64}$' },
};

export const taskCreateSchema = {
  type: 'object',
  properties: {
    text: textSchema,
    scope: { type: 'string', enum: ['personal', 'work'] },
    due: dateSchema,
    time: { type: 'string', pattern: timePattern },
    priority: { type: 'string', enum: ['high', 'medium', 'normal'] },
    remindAtDue: { type: 'boolean', description: 'Notify at the task time, not the automatic one-hour lead. Requires due, time and high priority.' },
    ...metadataProperties,
  },
  required: ['text'],
  dependencies: { time: ['due'] },
  allOf: [{
    if: { properties: { remindAtDue: { const: true } }, required: ['remindAtDue'] },
    then: { required: ['due', 'time'], properties: { priority: { const: 'high' } } },
  }],
  additionalProperties: false,
};

export const taskCompleteSchema = {
  type: 'object',
  properties: { ...identityProperties, done: { type: 'boolean' } },
  required: ['path', 'line', 'text', 'version', 'done'],
  additionalProperties: false,
};

export const taskEditSchema = {
  type: 'object',
  properties: {
    ...identityProperties,
    newText: textSchema,
    due: { type: ['string', 'null'], format: 'date' },
    time: { type: ['string', 'null'], pattern: timePattern },
    priority: { type: 'string', enum: ['high', 'medium', 'normal'] },
    remindAtDue: { type: 'boolean', description: 'Notify at the task time, not the automatic one-hour lead. Requires due, time and high priority.' },
    ...metadataProperties,
  },
  required: ['path', 'line', 'text', 'version', 'newText'],
  additionalProperties: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && Array.from(value).length >= 1 && Array.from(value).length <= maximum;
}

export function validTaskDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

export function validTaskTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function validIdentity(value: Record<string, unknown>): boolean {
  return boundedText(value.path, 180) && Number.isInteger(value.line) &&
    Number(value.line) >= 1 && Number(value.line) <= 1_000_000 &&
    boundedText(value.text, 400) && typeof value.version === 'string' && /^[0-9a-f]{64}$/u.test(value.version);
}

export function validateTaskCreateInput(value: unknown): value is TaskCreateInput {
  return record(value) && onlyKeys(value, ['text', 'scope', 'due', 'time', 'priority', 'remindAtDue', 'notes', 'timeZone', 'dueAt']) &&
    boundedText(value.text, 400) && (value.scope === undefined || value.scope === 'personal' || value.scope === 'work') &&
    (!('time' in value) || 'due' in value) &&
    (value.remindAtDue !== true || ('due' in value && 'time' in value && (!('priority' in value) || value.priority === 'high'))) &&
    (!('due' in value) || validTaskDate(value.due)) && (!('time' in value) || validTaskTime(value.time)) &&
    validMetadata(value) &&
    (!('dueAt' in value) || (typeof value.dueAt === 'string' && value.dueAt.length <= 40 &&
      Number.isFinite(Date.parse(value.dueAt)) && validTaskTimeZone(value.timeZone) && typeof value.due === 'string' && typeof value.time === 'string' &&
      taskLocalParts(new Date(value.dueAt), value.timeZone).due === value.due && taskLocalParts(new Date(value.dueAt), value.timeZone).time === value.time)) &&
    (!('remindAtDue' in value) || typeof value.remindAtDue === 'boolean') &&
    (!('priority' in value) || (typeof value.priority === 'string' && ['high', 'medium', 'normal'].includes(value.priority)));
}

export function validateTaskCompleteInput(value: unknown): value is TaskCompleteInput {
  return record(value) && onlyKeys(value, ['path', 'line', 'text', 'version', 'done']) &&
    validIdentity(value) && typeof value.done === 'boolean';
}

export function validateTaskEditInput(value: unknown): value is TaskEditInput {
  return record(value) && onlyKeys(value, ['path', 'line', 'text', 'version', 'newText', 'due', 'time', 'priority', 'remindAtDue', 'notes', 'timeZone']) &&
    validIdentity(value) && boundedText(value.newText, 400) &&
    (!('due' in value) || value.due === null || validTaskDate(value.due)) &&
    (!('time' in value) || value.time === null || validTaskTime(value.time)) &&
    validMetadata(value) &&
    (!('remindAtDue' in value) || typeof value.remindAtDue === 'boolean') &&
    (!('priority' in value) || (typeof value.priority === 'string' && ['high', 'medium', 'normal'].includes(value.priority)));
}

function validMetadata(value: Record<string, unknown>): boolean {
  return (!('notes' in value) || (typeof value.notes === 'string' && Array.from(value.notes).length <= 2000 &&
    !/[\p{Cc}\p{Cf}]/u.test(value.notes.replace(/[\n\r\t]/gu, '')))) &&
    (!('timeZone' in value) || validTaskTimeZone(value.timeZone));
}

export class TaskWriteError extends Error {
  constructor(readonly statusCode: 400 | 409 | 503, message: string, readonly outcomeUnknown = false) {
    super(message);
    this.name = 'TaskWriteError';
  }
}

type DoneChange =
  | { status: 'mismatch' }
  | { status: 'unchanged'; version: string }
  | { status: 'changed'; content: string; version: string };

type TextChange =
  | { status: 'mismatch' }
  | { status: 'refused' }
  | { status: 'unchanged'; version: string; done: boolean }
  | { status: 'changed'; content: string; version: string; done: boolean };

export interface TaskWriterOptions {
  client: Pick<ReturnType<typeof createGitHubVaultClient>, 'read' | 'write'>;
  validateWritePath: (value: string) => string;
  inTaskScope: (path: string) => boolean;
  shouldRedact: (value: string) => boolean;
  newTaskText: (value: string) => string;
  setTaskDone: (content: string, path: string, line: number, text: string, version: string, done: boolean) => DoneChange;
  setTaskText: (
    content: string, path: string, line: number, text: string, version: string,
    edit: { newText: string; due?: string | null | undefined; time?: string | null | undefined; priority?: 'high' | 'medium' | 'normal' | undefined; remindAtDue?: boolean | undefined; notes?: string | undefined; timeZone?: string | undefined },
  ) => TextChange;
  appendVaultTask: (existing: string | null, taskLine: string) => { content: string; line: number } | null;
  vaultTaskId: (path: string, line: number) => string;
  loggedFolder: (path: string) => string;
  onWrite: () => void;
  log: (event: 'vault.write', fields: { outcome: 'ok' | 'error' | 'refused'; folder: string }) => void;
}

export interface TaskWriteResult {
  id: string;
  path: string;
  line: number;
  text: string;
  done: boolean;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: string | null;
  priority: 'high' | 'medium' | 'normal';
  version: string;
  commit: string | null;
  remindAtDue: boolean;
  notes?: string;
  timeZone?: string;
}

const changedMessage = 'This task changed in the vault. Refresh the list.';
const unknownMessage = 'The task save outcome is unknown. Refresh the task list and read the note before trying again; do not blindly retry.';

export function createTaskWriter(options: TaskWriterOptions) {
  function persisted(content: string, path: string, line: number, commit: string | null): TaskWriteResult {
    const task = parseTodosWithContext(content, path).find((candidate) => candidate.line === line);
    if (!task) throw new TaskWriteError(400, 'That wording cannot be saved on this task line.');
    return {
      id: options.vaultTaskId(path, line), path, line,
      text: options.shouldRedact(task.text) ? '[redacted]' : task.text,
      done: task.done, dueDate: task.dueDate, dueTime: task.dueTime, dueAt: task.dueAt,
      priority: task.priorityLevel, version: task.version, commit, remindAtDue: task.remindAtDue === true,
      ...(task.notes === undefined ? {} : { notes: options.shouldRedact(task.notes) ? '[redacted]' : task.notes }),
      ...(task.timeZone === undefined ? {} : { timeZone: task.timeZone }),
    };
  }

  function safeLog(outcome: 'ok' | 'error' | 'refused', folder: string) {
    try { options.log('vault.write', { outcome, folder }); } catch { /* Logging cannot change a persisted write's outcome. */ }
  }

  async function run<T>(folder: () => string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      safeLog(error instanceof ToolRefusal || (error instanceof TaskWriteError && error.statusCode === 400) ? 'refused' : 'error', folder());
      if (error instanceof TaskWriteError) throw error;
      if (error instanceof ToolRefusal) throw new TaskWriteError(400, error.message);
      if (error instanceof VaultWriteConflictError) throw new TaskWriteError(409, changedMessage);
      throw new TaskWriteError(503, unknownMessage);
    }
  }

  function cleanText(value: string): string {
    const text = options.newTaskText(value);
    if (Array.from(text).length < 2) throw new TaskWriteError(400, 'Write a few words for the task.');
    if (options.shouldRedact(value) || options.shouldRedact(text)) {
      throw new TaskWriteError(400, 'Secrets and credentials can never be saved to the vault.');
    }
    return text;
  }

  function checkSize(content: string, create = false) {
    if (Buffer.byteLength(content, 'utf8') > MAX_VAULT_FILE_BYTES) {
      throw new TaskWriteError(400, create ? 'The Inbox note is full. Nothing was added.' : 'The task note is full. Nothing was saved.');
    }
  }

  function saved(folder: string) {
    try { options.onWrite(); } catch { safeLog('error', folder); }
    safeLog('ok', folder);
  }

  async function update(input: TaskCompleteInput | TaskEditInput, signal: AbortSignal, operation: 'complete' | 'edit'): Promise<TaskWriteResult> {
    let folder = 'other';
    return run(() => folder, async () => {
      if (!(operation === 'complete' ? validateTaskCompleteInput(input) : validateTaskEditInput(input))) {
        throw new TaskWriteError(400, 'Invalid task input. Read the task list and supply its path, line, text and version.');
      }
      const complete = 'done' in input;
      const path = options.validateWritePath(input.path);
      folder = options.loggedFolder(path);
      if (!options.inTaskScope(path)) throw new TaskWriteError(400, 'That note does not hold vault tasks.');
      const newText = complete ? undefined : cleanText(input.newText);
      if (!complete && input.notes && options.shouldRedact(input.notes)) throw new TaskWriteError(400, 'Secrets and credentials can never be saved to the vault.');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        signal.throwIfAborted();
        const current = await options.client.read(path, signal);
        if (!current) throw new TaskWriteError(409, 'The task note no longer exists. Refresh the list.');
        const change = complete
          ? options.setTaskDone(current.content, path, input.line, input.text, input.version, input.done)
          : options.setTaskText(current.content, path, input.line, input.text, input.version, {
            newText: newText!, due: input.due, time: input.time, priority: input.priority, remindAtDue: input.remindAtDue,
            notes: input.notes, timeZone: input.timeZone,
          });
        if (change.status === 'mismatch') throw new TaskWriteError(409, changedMessage);
        if (change.status === 'refused') throw new TaskWriteError(400, 'That wording cannot be saved on this task line.');
        if (change.status === 'unchanged') return persisted(current.content, path, input.line, null);
        checkSize(change.content);
        const result = persisted(change.content, path, input.line, null);
        try {
          signal.throwIfAborted();
          const commit = await options.client.write(path, change.content,
            `jarvis: ${complete ? input.done ? 'complete' : 'reopen' : 'edit'} a task\n\nCo-authored-by: Jarvis`,
            current.sha, signal);
          saved(folder);
          return { ...result, commit };
        } catch (error) {
          if (!(error instanceof VaultWriteConflictError) || attempt === 1) throw error;
        }
      }
      throw new TaskWriteError(409, changedMessage);
    });
  }

  return {
    complete(input: TaskCompleteInput, signal = AbortSignal.timeout(30_000)) {
      return update(input, signal, 'complete');
    },
    edit(input: TaskEditInput, signal = AbortSignal.timeout(30_000)) {
      return update(input, signal, 'edit');
    },
    async create(input: TaskCreateInput, signal = AbortSignal.timeout(30_000), sourceMessageId?: string, submissionId?: string): Promise<TaskWriteResult> {
      let folder = 'other';
      return run(() => folder, async () => {
        if (!validateTaskCreateInput(input)) throw new TaskWriteError(400, 'Invalid task input. Supply text and a valid optional date and time; scope defaults to Personal.');
        folder = input.scope === 'work' ? 'Work' : 'Personal';
        const text = cleanText(input.text);
        if (input.notes && options.shouldRedact(input.notes)) throw new TaskWriteError(400, 'Secrets and credentials can never be saved to the vault.');
        const path = options.validateWritePath(`${folder}/Inbox.md`);
        if (!options.inTaskScope(path)) throw new TaskWriteError(400, 'That note does not hold vault tasks.');
        if (input.time && !input.due) throw new TaskWriteError(400, 'Pick a day for the time.');
        const priority = input.priority === 'high' ? ' ⏫' : input.priority === 'medium' ? ' 🔼' : '';
        if (input.remindAtDue && (!input.due || !input.time || input.priority !== 'high')) {
          throw new TaskWriteError(400, 'An exact-time reminder needs due (YYYY-MM-DD), time (HH:mm in Copenhagen) and priority high.');
        }
        if (submissionId !== undefined && !/^[0-9a-f-]{36}$/u.test(submissionId)) throw new TaskWriteError(400, 'Invalid task submission identifier.');
        const identity: unknown[] = [sourceMessageId, input.scope ?? 'personal', text, input.due, input.time, input.priority, input.remindAtDue === true];
        if (input.notes !== undefined || input.timeZone !== undefined || input.dueAt !== undefined) identity.push({ notes: input.notes, timeZone: input.timeZone, dueAt: input.dueAt });
        const stableId = submissionId ?? (sourceMessageId ? createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24) : undefined);
        const metadata = encodeTaskMetadata({ notes: input.notes, timeZone: input.timeZone, dueAt: input.dueAt });
        const taskLine = `- [ ] ${text}${priority}${input.due ? ` 📅 ${input.due}${input.time ? ` ${input.time}` : ''}` : ''}${input.remindAtDue ? ' [reminder:: at_due_time]' : ''}${stableId ? ` 🆔 ${stableId}` : ''}${metadata ? ` ${metadata}` : ''}`;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          signal.throwIfAborted();
          const current = await options.client.read(path, signal);
          if (stableId && current) {
            const existing = current.content.split(/\r?\n/u).findIndex((line) => new RegExp(`🆔\\s*${stableId}(?![a-z\\d-])`, 'iu').test(line));
            if (existing >= 0) return persisted(current.content, path, existing + 1, null);
          }
          const next = options.appendVaultTask(current?.content ?? null, taskLine);
          if (!next) throw new TaskWriteError(400, 'The Inbox note ends inside a code block, so nothing was added.');
          checkSize(next.content, true);
          const result = persisted(next.content, path, next.line, null);
          if (input.due && (result.dueDate !== input.due || result.dueTime !== (input.time ?? null))) {
            throw new TaskWriteError(400, 'That local date/time does not exist. Choose a valid local time.');
          }
          try {
            signal.throwIfAborted();
            const commit = await options.client.write(path, next.content,
              'jarvis: add a task\n\nCo-authored-by: Jarvis', current?.sha, signal);
            saved(folder);
            return { ...result, commit };
          } catch (error) {
            if (!(error instanceof VaultWriteConflictError) || attempt === 1) throw error;
          }
        }
        throw new TaskWriteError(409, changedMessage);
      });
    },
  };
}

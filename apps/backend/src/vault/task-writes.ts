import { ToolRefusal } from '../core/tool-registry.js';
import { parseTodosWithContext } from '../proactive/todo-file.js';
import {
  MAX_VAULT_FILE_BYTES,
  VaultWriteConflictError,
  type createGitHubVaultClient,
} from './github-client.js';

export interface TaskCreateInput {
  text: string;
  scope: 'personal' | 'work';
  due?: string;
  time?: string;
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
}

const textSchema = { type: 'string', minLength: 1, maxLength: 400 };
const dateSchema = { type: 'string', format: 'date' };
const timePattern = '^([01]\\d|2[0-3]):[0-5]\\d$';
const identityProperties = {
  path: { type: 'string', minLength: 1, maxLength: 180 },
  line: { type: 'integer', minimum: 1, maximum: 1_000_000 },
  text: { type: 'string', minLength: 1, maxLength: 300 },
  version: { type: 'string', pattern: '^[0-9a-f]{64}$' },
};

export const taskCreateSchema = {
  type: 'object',
  properties: {
    text: textSchema,
    scope: { type: 'string', enum: ['personal', 'work'] },
    due: dateSchema,
    time: { type: 'string', pattern: timePattern },
  },
  required: ['text', 'scope'],
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

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function validIdentity(value: Record<string, unknown>): boolean {
  return boundedText(value.path, 180) && Number.isInteger(value.line) &&
    Number(value.line) >= 1 && Number(value.line) <= 1_000_000 &&
    boundedText(value.text, 300) && typeof value.version === 'string' && /^[0-9a-f]{64}$/u.test(value.version);
}

export function validateTaskCreateInput(value: unknown): value is TaskCreateInput {
  return record(value) && onlyKeys(value, ['text', 'scope', 'due', 'time']) &&
    boundedText(value.text, 400) && (value.scope === 'personal' || value.scope === 'work') &&
    (!('due' in value) || validDate(value.due)) && (!('time' in value) || validTime(value.time));
}

export function validateTaskCompleteInput(value: unknown): value is TaskCompleteInput {
  return record(value) && onlyKeys(value, ['path', 'line', 'text', 'version', 'done']) &&
    validIdentity(value) && typeof value.done === 'boolean';
}

export function validateTaskEditInput(value: unknown): value is TaskEditInput {
  return record(value) && onlyKeys(value, ['path', 'line', 'text', 'version', 'newText', 'due', 'time', 'priority']) &&
    validIdentity(value) && boundedText(value.newText, 400) &&
    (!('due' in value) || value.due === null || validDate(value.due)) &&
    (!('time' in value) || value.time === null || validTime(value.time)) &&
    (!('priority' in value) || (typeof value.priority === 'string' && ['high', 'medium', 'normal'].includes(value.priority)));
}

export class TaskWriteError extends Error {
  constructor(readonly statusCode: 400 | 409 | 503, message: string) {
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
    edit: { newText: string; due?: string | null | undefined; time?: string | null | undefined; priority?: 'high' | 'medium' | 'normal' | undefined },
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
      priority: task.priorityLevel, version: task.version, commit,
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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        signal.throwIfAborted();
        const current = await options.client.read(path, signal);
        if (!current) throw new TaskWriteError(409, 'The task note no longer exists. Refresh the list.');
        const change = complete
          ? options.setTaskDone(current.content, path, input.line, input.text, input.version, input.done)
          : options.setTaskText(current.content, path, input.line, input.text, input.version, {
            newText: newText!, due: input.due, time: input.time, priority: input.priority,
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
    async create(input: TaskCreateInput, signal = AbortSignal.timeout(30_000)): Promise<TaskWriteResult> {
      let folder = 'other';
      return run(() => folder, async () => {
        if (!validateTaskCreateInput(input)) throw new TaskWriteError(400, 'Invalid task input. Supply text, Personal or Work scope, and a valid optional date and time.');
        folder = input.scope === 'work' ? 'Work' : 'Personal';
        const text = cleanText(input.text);
        const path = options.validateWritePath(`${folder}/Inbox.md`);
        if (!options.inTaskScope(path)) throw new TaskWriteError(400, 'That note does not hold vault tasks.');
        if (input.time && !input.due) throw new TaskWriteError(400, 'Pick a day for the time.');
        const taskLine = `- [ ] ${text}${input.due ? ` 📅 ${input.due}${input.time ? ` ${input.time}` : ''}` : ''}`;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          signal.throwIfAborted();
          const current = await options.client.read(path, signal);
          const next = options.appendVaultTask(current?.content ?? null, taskLine);
          if (!next) throw new TaskWriteError(400, 'The Inbox note ends inside a code block, so nothing was added.');
          checkSize(next.content, true);
          const result = persisted(next.content, path, next.line, null);
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

import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import { readVaultTasks } from './todo-discovery.js';
import { dayKey, isQuietHour, localDateTimeInstant, localTimeLabel } from './time.js';
import type {
  NewOwnerReminder,
  OwnerReminderCadence,
  OwnerReminderSchedule,
  OwnerReminderStore,
} from './owner-reminder-store.js';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;

const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const inputSchema = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: ['create', 'read', 'update', 'snooze', 'cancel'] },
    id: { type: 'string', format: 'uuid' },
    task: { type: 'string', minLength: 1, maxLength: 300 },
    fireAt: { type: 'string', format: 'date-time' },
    cadence: { type: 'string', enum: ['daily', 'weekly', 'once'] },
    untilTaskDone: { type: 'boolean' },
  },
  required: ['operation'],
  additionalProperties: false,
} as const;

type ReminderIntent = {
  action: 'create';
  task: string;
  fireAt: Date;
  cadence: OwnerReminderCadence | null;
  untilTaskDone: boolean;
} | {
  action: 'update' | 'snooze';
  task: string;
  fireAt: Date;
  cadence: OwnerReminderCadence | 'once' | null;
  untilTaskDone: boolean;
} | {
  action: 'cancel';
  task: string;
};

type ReminderInput =
  | { operation: 'read' }
  | { operation: 'create'; task: string; fireAt: string; cadence?: OwnerReminderCadence; untilTaskDone?: boolean }
  | { operation: 'update'; id: string; task: string; fireAt: string; cadence?: OwnerReminderCadence | 'once'; untilTaskDone?: boolean }
  | { operation: 'snooze'; id: string; task: string; fireAt: string }
  | { operation: 'cancel'; id: string; task: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

function parseInput(value: unknown): ReminderInput | undefined {
  if (!isObject(value) || Object.keys(value).some((key) =>
    !['operation', 'id', 'task', 'fireAt', 'cadence', 'untilTaskDone'].includes(key))) return undefined;
  const operation = value.operation;
  if (operation === 'read') return Object.keys(value).length === 1 ? { operation } : undefined;
  if (operation !== 'create' && operation !== 'update' && operation !== 'snooze' && operation !== 'cancel') return undefined;
  if (typeof value.task !== 'string' || value.task.trim().length < 1 || value.task.length > 300) return undefined;
  const task = value.task.trim();
  if (operation !== 'create' && (typeof value.id !== 'string' || !uuidPattern.test(value.id))) return undefined;
  if (operation === 'cancel') {
    return Object.keys(value).every((key) => ['operation', 'id', 'task'].includes(key))
      ? { operation, id: value.id as string, task } : undefined;
  }
  if (typeof value.fireAt !== 'string' || !Number.isFinite(Date.parse(value.fireAt)) ||
      new Date(value.fireAt).toISOString() !== value.fireAt) return undefined;
  if (operation === 'snooze') {
    return Object.keys(value).every((key) => ['operation', 'id', 'task', 'fireAt'].includes(key))
      ? { operation, id: value.id as string, task, fireAt: value.fireAt } : undefined;
  }
  if (Object.hasOwn(value, 'cadence') &&
      value.cadence !== 'daily' && value.cadence !== 'weekly' && value.cadence !== 'once') return undefined;
  if (operation === 'create' && value.cadence === 'once') return undefined;
  if (value.cadence === 'once' && value.untilTaskDone === true) return undefined;
  if (Object.hasOwn(value, 'untilTaskDone') && typeof value.untilTaskDone !== 'boolean') return undefined;
  const result = {
    operation,
    task,
    fireAt: value.fireAt,
    ...(operation === 'update' ? { id: value.id as string } : {}),
    ...(value.cadence === undefined ? {} : { cadence: value.cadence as OwnerReminderCadence | 'once' }),
    ...(value.untilTaskDone === undefined ? {} : { untilTaskDone: value.untilTaskDone as boolean }),
  };
  if (operation === 'create' && Object.hasOwn(value, 'id')) return undefined;
  return result as ReminderInput;
}

function dateTokenToLocalDate(token: string, now: Date): string | undefined {
  const value = token.toLocaleLowerCase('en');
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const today = dayKey(now);
  if (value === 'today' || value === 'i dag') return today;
  if (value === 'tomorrow' || value === 'i morgen') {
    const [year, month, day] = today.split('-').map(Number);
    return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
  }
  return undefined;
}

function resolveLocalDateTime(dateToken: string | undefined, timeToken: string, now: Date): Date | undefined {
  if (!dateToken) return undefined;
  const date = dateTokenToLocalDate(dateToken, now);
  if (!date) return undefined;
  const time = /^\d{1,2}:\d{2}$/u.test(timeToken) && timeToken.length === 4 ? `0${timeToken}` : timeToken;
  let instant: Date;
  try {
    instant = localDateTimeInstant(date, time);
  } catch {
    return undefined;
  }
  for (const offset of [-60, 60]) {
    const alternate = new Date(instant.getTime() + offset * 60_000);
    if (dayKey(alternate) === date && localTimeLabel(alternate) === time) return undefined;
  }
  return instant;
}

function parseCreateIntent(text: string, now: Date): ReminderIntent | undefined {
  const en = /^(?:please\s+)?remind me (?:to|about) (?<task>.+?)\s+(?:(?:on\s+)?(?<date>today|tomorrow|\d{4}-\d{2}-\d{2})\s+)?at (?<time>\d{1,2}:\d{2})(?:\s+(?<cadence>daily|every day|weekly|every week)(?:\s+(?<until>until (?:it's )?done|until complete))?)?[.!?]?$/iu.exec(text.trim());
  const da = /^mind mig om (?<task>.+?)\s+(?:(?:den\s+)?(?<date>i dag|i morgen|\d{4}-\d{2}-\d{2})\s+)?kl\.? (?<time>\d{1,2}:\d{2})(?:\s+(?<cadence>dagligt|hver dag|ugentligt|hver uge)(?:\s+(?<until>indtil (?:opgaven er )?færdig))?)?[.!?]?$/iu.exec(text.trim());
  const match = en ?? da;
  if (!match?.groups?.task || !match.groups.time) return undefined;
  const fireAt = resolveLocalDateTime(match.groups.date, match.groups.time, now);
  if (!fireAt) return undefined;
  const cadenceText = match.groups.cadence?.toLocaleLowerCase('en');
  const cadence: OwnerReminderCadence | null = cadenceText === 'daily' || cadenceText === 'every day' ||
    cadenceText === 'dagligt' || cadenceText === 'hver dag' ? 'daily'
    : cadenceText ? 'weekly' : null;
  return {
    action: 'create',
    task: match.groups.task.trim(),
    fireAt,
    cadence,
    untilTaskDone: match.groups.until !== undefined,
  };
}

function parseMutationIntent(text: string, action: 'update' | 'snooze' | 'cancel', now: Date): ReminderIntent | undefined {
  if (action === 'cancel') {
    const en = /^(?:please\s+)?cancel (?:my )?reminder (?:for|about) (?<task>.+?)[.!?]?$/iu.exec(text.trim());
    const da = /^(?:annullér|aflys) (?:min )?påmindelse om (?<task>.+?)[.!?]?$/iu.exec(text.trim());
    const match = en ?? da;
    return match?.groups?.task ? { action, task: match.groups.task.trim() } : undefined;
  }
  const en = /^(?:please\s+)?(?<verb>snooze|postpone|change|reschedule|move) (?:my )?reminder (?:for|about) (?<task>.+?) (?:until|to) (?:(?:on\s+)?(?<date>today|tomorrow|\d{4}-\d{2}-\d{2})\s+)?at (?<time>\d{1,2}:\d{2})(?:\s+(?<cadence>daily|every day|weekly|every week|once|one time)(?:\s+(?<until>until (?:it's )?done|until complete))?)?[.!?]?$/iu.exec(text.trim());
  const da = /^(?<verb>udsæt|udskyd|ændr|flyt) (?:min )?påmindelse om (?<task>.+?) til (?:(?:den\s+)?(?<date>i dag|i morgen|\d{4}-\d{2}-\d{2})\s+)?kl\.? (?<time>\d{1,2}:\d{2})(?:\s+(?<cadence>dagligt|hver dag|ugentligt|hver uge|én gang|en gang)(?:\s+(?<until>indtil (?:opgaven er )?færdig))?)?[.!?]?$/iu.exec(text.trim());
  const match = en ?? da;
  if (!match?.groups?.task || !match.groups.time) return undefined;
  const verb = match.groups.verb!.toLocaleLowerCase('da');
  const isSnooze = /^(?:snooze|postpone|udsæt|udskyd)$/iu.test(verb);
  if ((action === 'snooze') !== isSnooze) return undefined;
  const cadenceText = match.groups.cadence?.toLocaleLowerCase('da');
  if (action === 'snooze' && cadenceText) return undefined;
  const cadence: OwnerReminderCadence | 'once' | null = cadenceText === 'daily' || cadenceText === 'every day' ||
    cadenceText === 'dagligt' || cadenceText === 'hver dag' ? 'daily'
    : cadenceText === 'weekly' || cadenceText === 'every week' || cadenceText === 'ugentligt' ||
      cadenceText === 'hver uge' ? 'weekly'
      : cadenceText ? 'once' : null;
  const fireAt = resolveLocalDateTime(match.groups.date, match.groups.time, now);
  return fireAt ? {
    action, task: match.groups.task.trim(), fireAt, cadence, untilTaskDone: match.groups.until !== undefined,
  } : undefined;
}

async function ownerMessage(request: FastifyRequest, ownerObjectId: string, signal: AbortSignal): Promise<{ id: string; text: string }> {
  const direct = request.jarvisConversationMessage;
  const authorized = request.principal?.objectId.toLowerCase() === ownerObjectId.toLowerCase() ||
    request.agentPrincipal !== null && request.agentPrincipal !== undefined;
  if (direct?.role === 'dan' && authorized) {
    if (!/^[1-9]\d{0,18}$/u.test(direct.id) || BigInt(direct.id) > 9_223_372_036_854_775_807n) {
      throw new ToolRefusal('A current owner message could not be verified. Nothing was changed.');
    }
    const session = await request.server.conversationStore?.getSession(direct.sessionId);
    signal.throwIfAborted();
    if (!session || session.endedAt !== null || session.channel === 'phone') {
      throw new ToolRefusal('An active chat or voice request is required. Nothing was changed.');
    }
    return { id: direct.id, text: direct.text };
  }
  const id = request.jarvisMemorySourceMessageId ?? request.headers['x-jarvis-message-id'];
  const conversations = request.server.conversationStore;
  if (!request.agentPrincipal || typeof id !== 'string' || !/^[1-9]\d{0,18}$/u.test(id) ||
      BigInt(id) > 9_223_372_036_854_775_807n || !conversations) {
    throw new ToolRefusal('A direct, current owner request is required to change reminders.');
  }
  const page = await conversations.getHistory({ limit: 1 });
  signal.throwIfAborted();
  const message = page.messages[0];
  if (!message || message.id !== id || message.role !== 'dan') {
    throw new ToolRefusal('The current owner request could not be verified. Nothing was changed.');
  }
  const session = await conversations.getSession(message.sessionId);
  signal.throwIfAborted();
  if (!session || session.endedAt !== null || session.channel === 'phone') {
    throw new ToolRefusal('An active chat or voice request is required. Nothing was changed.');
  }
  return { id: message.id, text: message.text };
}

function scheduleResult(schedule: OwnerReminderSchedule) {
  const repeat = schedule.cadence === null ? 'once'
    : `every ${schedule.cadence === 'daily' ? 'day' : 'week'}${schedule.untilTaskDone ? ' until the task is completed' : ''}`;
  return {
    id: schedule.id,
    task: schedule.taskTitle,
    fireAt: `${dayKey(schedule.fireAt)} ${localTimeLabel(schedule.fireAt)} Copenhagen time`,
    repeat,
    state: schedule.state,
    delivery: schedule.lastDelivery,
    reason: schedule.reason,
  };
}

export function createOwnerReminderTool(options: {
  ownerObjectId: string;
  store: OwnerReminderStore;
  vault: VaultReader;
  now: () => Date;
  onScheduled?: (fireAt: Date) => void;
}): JarvisTool {
  return {
    name: 'owner_reminders',
    description: 'Create, list, reschedule, snooze or cancel owner-requested task reminders. Writes require a matching direct owner message; reminder times never change task deadlines.',
    inputSchema,
    sensitive: true,
    validateInput: (input) => parseInput(input) !== undefined,
    explainInvalidInput: () => 'Use read, or create/update/snooze/cancel with the required task, reminder ID and Copenhagen time.',
    async execute(raw, request, signal) {
      const authorized = request.agentPrincipal !== null && request.agentPrincipal !== undefined ||
        request.principal?.objectId.toLowerCase() === options.ownerObjectId.toLowerCase();
      if (!authorized) throw new ToolRefusal('Owner reminders are not authorized.');
      const input = parseInput(raw);
      if (!input) throw new ToolRefusal('Choose a valid owner reminder operation.');
      if (input.operation === 'read') {
        try {
          const schedules = await options.store.list(20);
          return {
            operation: 'read',
            reminders: schedules.map(scheduleResult),
            deliveryNote: 'Provider acceptance does not confirm that a device displayed or acknowledged a notification.',
          };
        } catch {
          throw new ToolFailure('Owner reminders are temporarily unavailable.');
        }
      }

      const message = await ownerMessage(request, options.ownerObjectId, signal);
      const now = options.now();
      const intent = input.operation === 'create'
        ? parseCreateIntent(message.text, now)
        : parseMutationIntent(message.text, input.operation, now);
      if (!intent || intent.action !== input.operation || normalize(intent.task) !== normalize(input.task)) {
        throw new ToolRefusal('Please state the reminder action, exact task and Copenhagen date/time clearly. Nothing was changed.');
      }
      if ('fireAt' in input && 'fireAt' in intent && intent.fireAt.toISOString() !== input.fireAt) {
        throw new ToolRefusal('The requested time is missing or ambiguous. Use an explicit date and Copenhagen local time. Nothing was changed.');
      }
      if (input.operation === 'create') {
        if (intent.action !== 'create' || intent.cadence !== (input.cadence ?? null) ||
            intent.untilTaskDone !== (input.untilTaskDone ?? false)) {
          throw new ToolRefusal('The schedule cadence and repeat-until-complete choice must match your request. Nothing was changed.');
        }
        if (intent.untilTaskDone && !intent.cadence) {
          throw new ToolRefusal('Please choose a repeat cadence before asking to repeat until the task is completed.');
        }
        if (intent.fireAt.getTime() <= now.getTime()) {
          throw new ToolRefusal('Choose a future reminder time.');
        }
        if (intent.fireAt.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
          throw new ToolRefusal('Choose a reminder time within the next year.');
        }
        if (isQuietHour(intent.fireAt)) {
          throw new ToolRefusal('That time falls within the 22:00–07:00 Copenhagen quiet window. Choose another time; no reminder was created.');
        }
        let todos;
        try {
          todos = await readVaultTasks(options.vault, signal);
        } catch {
          throw new ToolFailure('The task list could not be verified. No reminder was created.');
        }
        const matches = todos.filter((todo) => !todo.done && normalize(todo.text) === normalize(input.task));
        if (matches.length === 0) throw new ToolRefusal('I could not find that open task. Nothing was changed.');
        if (matches.length !== 1) throw new ToolRefusal('That task is ambiguous. Identify its unique task name before scheduling.');
        const task = matches[0]!;
        const candidate: NewOwnerReminder = {
          idempotencyKey: createHash('sha256').update(message.id).digest('hex'),
          taskIdentity: task.taskIdentity,
          taskTitle: task.text,
          fireAt: intent.fireAt,
          localTime: localTimeLabel(intent.fireAt),
          anchorDate: intent.cadence === null ? null : dayKey(intent.fireAt),
          cadence: intent.cadence,
          untilTaskDone: intent.untilTaskDone,
        };
        try {
          const result = await options.store.create(candidate, now);
          options.onScheduled?.(result.schedule.fireAt);
          return {
            operation: 'create',
            created: result.created,
            reminder: scheduleResult(result.schedule),
            confirmation: `Reminder ${result.created ? 'scheduled' : 'already scheduled'} for ${dayKey(intent.fireAt)} at ${localTimeLabel(intent.fireAt)} Copenhagen time; ${result.schedule.cadence ?? 'one time'}${result.schedule.untilTaskDone ? ' until the task is completed' : ''}. The task deadline is unchanged.`,
          };
        } catch (error) {
          if (error instanceof RangeError) throw new ToolRefusal(error.message);
          throw new ToolFailure('The reminder could not be saved. Nothing was confirmed.');
        }
      }

      let schedule: OwnerReminderSchedule | null;
      try { schedule = await options.store.get(input.id); } catch {
        throw new ToolFailure('Owner reminders are temporarily unavailable.');
      }
      if (!schedule || normalize(schedule.taskTitle) !== normalize(input.task)) {
        throw new ToolRefusal('That reminder was not found for the named task. Nothing was changed.');
      }
      if (input.operation === 'cancel') {
        if (intent.action !== 'cancel') throw new ToolRefusal('A direct cancellation request is required.');
        const cancelled = await options.store.cancel(schedule.id);
        if (!cancelled) throw new ToolRefusal('That reminder is no longer scheduled.');
        return { operation: 'cancel', cancelled: true, reminder: scheduleResult({ ...schedule, state: 'cancelled' }) };
      }
      if (intent.action !== input.operation || intent.fireAt.getTime() <= now.getTime() ||
          isQuietHour(intent.fireAt) || intent.fireAt.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
        throw new ToolRefusal('Choose a future, non-quiet Copenhagen time and state the matching reminder change. Nothing was changed.');
      }
      const update = input.operation === 'snooze'
        ? { fireAt: intent.fireAt }
        : {
          fireAt: intent.fireAt,
          localTime: localTimeLabel(intent.fireAt),
          anchorDate: (input.cadence === 'once' ? null : input.cadence ?? schedule.cadence) === null
            ? null : dayKey(intent.fireAt),
          ...(input.cadence === undefined ? {} : {
            cadence: input.cadence === 'once' ? null : input.cadence,
            ...(input.cadence === 'once' ? { untilTaskDone: false } : {}),
          }),
          ...(input.untilTaskDone === undefined ? {} : { untilTaskDone: input.untilTaskDone }),
        };
      if (input.operation === 'update' && (
        (input.cadence !== undefined && intent.cadence !== input.cadence) ||
        (input.untilTaskDone !== undefined && intent.untilTaskDone !== input.untilTaskDone) ||
        (intent.cadence !== null && input.cadence === undefined) ||
        (intent.untilTaskDone && input.untilTaskDone === undefined)
      )) {
        throw new ToolRefusal('The updated cadence must match your direct request. Nothing was changed.');
      }
      try {
        const updated = await options.store.updateScheduled(schedule.id, update);
        if (!updated) throw new ToolRefusal('That reminder is no longer scheduled.');
        options.onScheduled?.(intent.fireAt);
        const saved = await options.store.get(schedule.id);
        return {
          operation: input.operation,
          updated: true,
          reminder: saved ? scheduleResult(saved) : scheduleResult({ ...schedule, ...update }),
          confirmation: `Reminder moved to ${dayKey(intent.fireAt)} at ${localTimeLabel(intent.fireAt)} Copenhagen time. The task deadline is unchanged.`,
        };
      } catch (error) {
        if (error instanceof ToolRefusal) throw error;
        throw new ToolFailure('The reminder could not be updated. Nothing was confirmed.');
      }
    },
  };
}

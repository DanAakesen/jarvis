import { isPiWake, piWakeSource } from '../core/pi-authority.js';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import { explainedArgumentsMessage } from '../core/tool-arguments.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import { readVaultTasks } from './todo-discovery.js';
import { dayKey, localTimeLabel } from './time.js';
import type {
  NewOwnerReminder,
  OwnerReminderCadence,
  OwnerReminderSchedule,
  OwnerReminderStore,
} from './owner-reminder-store.js';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;

const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const fields = {
  operation: { type: 'string', enum: ['create', 'read', 'update', 'snooze', 'cancel'] },
  id: { type: 'string', format: 'uuid', description: 'Existing reminder ID returned by read.' },
  task: { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S', description: 'Exact title of an existing open vault task, matching the owner request.' },
  fireAt: {
    type: 'string', format: 'date-time', pattern: instantPattern.source,
    description: 'ISO timestamp with seconds and Z or numeric offset (up to millisecond precision). Convert the requested Copenhagen date/time to this instant; do not treat local time as UTC.',
  },
  cadence: { type: 'string', enum: ['daily', 'weekly', 'once'], description: 'Create defaults to once; update preserves the existing cadence if omitted.' },
  untilTaskDone: { type: 'boolean', description: 'Repeat until completed only with daily or weekly cadence. Create defaults to false; update preserves the existing value if omitted.' },
} as const;
type ReminderField = keyof typeof fields;
function operationSchema(operation: string, required: ReminderField[], optional: ReminderField[] = []) {
  const allowed = ['operation', ...required, ...optional];
  return {
    type: 'object',
    properties: {
      ...Object.fromEntries([...required, ...optional].map((key) => [key, fields[key]])),
      operation: { type: 'string', const: operation },
    },
    required: ['operation', ...required],
    // Keep additionalProperties at the root: Fastify must not remove fields
    // while trying a different oneOf branch.
    not: { anyOf: [
      ...Object.keys(fields).filter((key) => !allowed.includes(key)).map((key) => ({ required: [key] })),
      { required: ['cadence', 'untilTaskDone'], properties: { cadence: { const: 'once' }, untilTaskDone: { const: true } } },
    ] },
  };
}
const inputSchema = {
  type: 'object',
  properties: fields,
  required: ['operation'],
  additionalProperties: false,
  oneOf: [
    operationSchema('read', []),
    operationSchema('create', ['task', 'fireAt'], ['cadence', 'untilTaskDone']),
    operationSchema('update', ['id', 'task', 'fireAt'], ['cadence', 'untilTaskDone']),
    operationSchema('snooze', ['id', 'task', 'fireAt']),
    operationSchema('cancel', ['id', 'task']),
  ],
} as const;

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

function normalizedInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || !instantPattern.test(value)) return undefined;
  const wallTime = value.slice(0, 19);
  const local = new Date(`${wallTime}Z`);
  const instant = new Date(value);
  // Date.parse normalizes impossible dates such as February 30; refuse those.
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== wallTime ||
      !Number.isFinite(instant.getTime())) return undefined;
  return instant.toISOString();
}

function inputHint(value: unknown): string {
  const operation = isObject(value) ? value.operation : undefined;
  if (operation === 'read') return 'read accepts only operation; omit all other fields.';
  if (operation === 'cancel') return 'cancel requires id (UUID from read) and task (exact title); omit fireAt, cadence and untilTaskDone.';
  if (operation === 'create' || operation === 'update' || operation === 'snooze') {
    return `${operation} requires ${operation === 'create' ? 'task; omit id' : 'id (UUID from read) and task'}. ` +
      'fireAt requires a valid ISO date/time with seconds and Z or an offset, matching the requested Copenhagen time. ' +
      (operation === 'snooze' ? 'Omit cadence and untilTaskDone.' : 'cadence: once, daily or weekly; untilTaskDone: boolean, never true with once.');
  }
  return 'operation must be read, create, update, snooze or cancel. Use the operation-specific required fields in the schema.';
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
  const fireAt = normalizedInstant(value.fireAt);
  if (!fireAt) return undefined;
  if (operation === 'snooze') {
    return Object.keys(value).every((key) => ['operation', 'id', 'task', 'fireAt'].includes(key))
      ? { operation, id: value.id as string, task, fireAt } : undefined;
  }
  if (Object.hasOwn(value, 'cadence') &&
      value.cadence !== 'daily' && value.cadence !== 'weekly' && value.cadence !== 'once') return undefined;
  if (value.cadence === 'once' && value.untilTaskDone === true) return undefined;
  if (Object.hasOwn(value, 'untilTaskDone') && typeof value.untilTaskDone !== 'boolean') return undefined;
  const result = {
    operation,
    task,
    fireAt,
    ...(operation === 'update' ? { id: value.id as string } : {}),
    ...(value.cadence === undefined || operation === 'create' && value.cadence === 'once'
      ? {} : { cadence: value.cadence as OwnerReminderCadence | 'once' }),
    ...(value.untilTaskDone === undefined ? {} : { untilTaskDone: value.untilTaskDone as boolean }),
  };
  if (operation === 'create' && Object.hasOwn(value, 'id')) return undefined;
  return result as ReminderInput;
}

async function ownerMessage(request: FastifyRequest, ownerObjectId: string, signal: AbortSignal): Promise<{ id: string; text: string }> {
  if (isPiWake(request)) return { id: piWakeSource(request).sessionId, text: '' };
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

const overdueGraceMs = 90_000;

function scheduleResult(schedule: OwnerReminderSchedule, now: Date) {
  const repeat = schedule.cadence === null ? 'once'
    : `every ${schedule.cadence === 'daily' ? 'day' : 'week'}${schedule.untilTaskDone ? ' until the task is completed' : ''}`;
  const active = schedule.state === 'scheduled' ||
    schedule.state === 'sending' || schedule.state === 'retrying';
  const nextActionAt = schedule.nextAttemptAt ?? (active ? schedule.fireAt : null);
  const providerOutcome = schedule.lastProviderOutcome ??
    (schedule.lastDelivery === 'provider_accepted' ? 'provider_accepted'
      : schedule.lastDelivery === 'failed' ? 'delivery_failed'
        : schedule.lastDelivery === 'retrying' ? 'provider_unavailable'
          : schedule.lastDelivery === 'suppressed' ? schedule.reason : null);
  const recovery = (() => {
    if (schedule.state === 'retrying' && schedule.nextAttemptAt) {
      if (schedule.reason === 'task_unavailable' || schedule.reason === 'verification_exhausted') {
        return `Task verification is scheduled to retry at ${dayKey(schedule.nextAttemptAt)} ${localTimeLabel(schedule.nextAttemptAt)} Copenhagen time.`;
      }
      return `A transient delivery failure is scheduled to retry at ${dayKey(schedule.nextAttemptAt)} ${localTimeLabel(schedule.nextAttemptAt)} Copenhagen time.`;
    }
    switch (schedule.reason) {
      case 'no_subscription':
        return 'No valid reminder recipient was selected. Open Jarvis on the intended iPhone or Watch and register notifications, then reschedule the reminder.';
      case 'apns_invalid_token':
        return 'APNs rejected the device token. Open Jarvis on that device so it registers a new notification token, then reschedule the reminder.';
      case 'registration_removed':
        return 'The selected notification registration was removed. Reopen Jarvis on the device, confirm notifications are enabled, and reschedule.';
      case 'registration_expired':
        return 'The selected notification registration expired. Open Jarvis on the device to refresh it, then reschedule.';
      case 'delivery_evidence_unavailable':
        return 'Delivery evidence is unavailable after the bounded APNs attempt lease. Do not treat this as accepted or failed provider delivery; check device state and then explicitly reschedule if needed.';
      case 'provider_rejected':
        return 'APNs permanently rejected the send. Check the native push configuration and device registration before rescheduling.';
      case 'provider_unavailable':
      case 'retries_exhausted':
        return 'The bounded provider retries did not succeed. Check native push status, then explicitly reschedule the reminder.';
      case 'delivery_failed':
        return 'The selected recipients ended with different terminal provider outcomes and none accepted the reminder. Check notification registration, then explicitly reschedule.';
      case 'task_missing':
        return 'The task was missing when the reminder became due. Restore the task or create a new reminder for the correct open task.';
      case 'task_ambiguous':
        return 'The task identity became ambiguous. Give the task a unique exact title, then create a new reminder.';
      case 'task_completed':
        return 'The task was already completed, so no reminder was sent.';
      case 'missed_time':
        return 'The reminder was too old to deliver. Reschedule it for a new future time.';
      case 'task_unavailable':
      case 'verification_exhausted':
        return schedule.state === 'scheduled'
          ? 'Task verification failed temporarily; Jarvis has scheduled another verification attempt.'
          : 'Task verification remained unavailable, so the reminder was not sent.';
      case 'cancelled':
        return 'The reminder is cancelled.';
    }
    if (schedule.lastProviderOutcome === 'partial_acceptance') {
      return `The ${schedule.lastProvider === 'apns' ? 'APNs' : 'push'} provider accepted the reminder for ${schedule.acceptedRecipientCount} of ${schedule.recipientCount} selected devices. Recheck or re-register the missing device before relying on that recipient.`;
    }
    if (schedule.lastDelivery === 'provider_accepted' && schedule.state === 'scheduled' &&
        schedule.cadence !== null) {
      return `The previous occurrence was accepted by ${schedule.lastProvider === 'web_push' ? 'Web Push' : schedule.lastProvider === 'apns' ? 'APNs' : 'the configured provider'}; the next occurrence is scheduled for ${dayKey(schedule.fireAt)} ${localTimeLabel(schedule.fireAt)} Copenhagen time. Device display remains unverified.`;
    }
    if (schedule.lastDelivery === 'provider_accepted' || schedule.state === 'completed') {
      return `${schedule.lastProvider === 'web_push' ? 'Web Push' : schedule.lastProvider === 'apns' ? 'APNs' : 'The configured provider'} accepted the notification. Whether the device displayed or the owner acknowledged it remains unverified until a physical-device check.`;
    }
    if (schedule.state === 'scheduled' && schedule.fireAt.getTime() + overdueGraceMs <= now.getTime()) {
      return `The reminder time ${dayKey(schedule.fireAt)} ${localTimeLabel(schedule.fireAt)} Copenhagen time has passed, but no delivery attempt is recorded for it, so delivery evidence is unavailable and no push can be assumed. Reschedule it to a future time to re-attempt.`;
    }
    if (schedule.state === 'scheduled') {
      return 'The reminder is saved; device delivery has not been attempted at this point.';
    }
    if (schedule.state === 'sending' && schedule.leaseUntil && schedule.leaseUntil.getTime() <= now.getTime()) {
      return 'A delivery attempt was started but no outcome was recorded before its lease expired, so delivery evidence is unavailable. Jarvis will reclaim it; read it again shortly.';
    }
    if (schedule.state === 'sending') {
      return 'The due reminder is leased for delivery. Read it again after the claim finishes or expires.';
    }
    return 'Durable delivery evidence is unavailable for this legacy or incomplete outcome.';
  })();
  return {
    id: schedule.id,
    task: schedule.taskTitle,
    fireAt: `${dayKey(schedule.fireAt)} ${localTimeLabel(schedule.fireAt)} Copenhagen time`,
    repeat,
    state: schedule.state,
    delivery: schedule.lastDelivery,
    reason: schedule.reason,
    attempts: schedule.sendAttempts,
    recipients: schedule.recipientCount,
    acceptedRecipients: schedule.acceptedRecipientCount,
    providerOutcome,
    provider: schedule.lastProvider,
    providerStatusCode: schedule.lastProviderStatusCode,
    nextActionAt: nextActionAt === null
      ? null
      : `${dayKey(nextActionAt)} ${localTimeLabel(nextActionAt)} Copenhagen time`,
    nextRetryAt: schedule.nextAttemptAt === null
      ? null
      : `${dayKey(schedule.nextAttemptAt)} ${localTimeLabel(schedule.nextAttemptAt)} Copenhagen time`,
    deviceAcknowledgement: 'unavailable',
    deliveryEvidence: schedule.recipientCount > 0 || schedule.lastProviderOutcome !== null
      ? 'durable'
      : schedule.sendAttempts > 0 || schedule.lastDelivery !== null
        ? 'schedule_only'
        : 'not_attempted',
    recovery,
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
    description: 'Create, list, reschedule, snooze or cancel owner-requested reminders for existing open vault tasks. Execute the owner’s request using the conversation context, including follow-up times and affirmative replies. Do not request another approval or prescribed sentence. Resolve natural dates, relative times and 17.10-style times to fireAt using Copenhagen time. A time without a date means TODAY, not tomorrow; if it has passed, report that instead of silently moving the date. Ask only for essential missing information. Use the saved task title from read/search, not a verbatim match to the owner’s wording. Choose a future time within a year. Explicitly requested reminder times are allowed during 22:00–07:00 Copenhagen quiet hours. Read first to obtain IDs for changes. Reminder times never change task deadlines.',
    inputSchema,
    sensitive: true,
    validateInput: (input) => parseInput(input) !== undefined,
    explainInvalidInput: inputHint,
    async execute(raw, request, signal) {
      const authorized = request.agentPrincipal !== null && request.agentPrincipal !== undefined ||
        request.principal?.objectId.toLowerCase() === options.ownerObjectId.toLowerCase();
      if (!authorized) throw new ToolRefusal('Owner reminders are not authorized.');
      const input = parseInput(raw);
      if (!input) throw new ToolRefusal(explainedArgumentsMessage(inputHint(raw)));
      if (input.operation === 'read') {
        try {
          const schedules = await options.store.list(20);
          return {
            operation: 'read',
            reminders: schedules.map((schedule) => scheduleResult(schedule, options.now())),
            deliveryNote: 'Scheduling is separate from device delivery. Push-provider acceptance, including APNs, does not confirm display or acknowledgement; use state, provider outcome, attempts and next action for the exact durable evidence.',
          };
        } catch {
          throw new ToolFailure('Owner reminders are temporarily unavailable.');
        }
      }

      const message = await ownerMessage(request, options.ownerObjectId, signal);
      const now = options.now();
      // The conversational agent resolves meaning; the server validates authenticated
      // provenance, structured fields, resource identity and persistence. Owner prose
      // is not a second command language and a follow-up need not repeat the request.
      const intent = input.operation === 'cancel'
        ? { action: input.operation, task: input.task }
        : { action: input.operation, task: input.task, fireAt: new Date(input.fireAt),
          cadence: 'cadence' in input ? input.cadence ?? null : null, untilTaskDone: 'untilTaskDone' in input ? input.untilTaskDone ?? false : false };
      if (input.operation === 'create') {
        if (intent.action !== 'create') throw new ToolRefusal('Invalid reminder operation.');
        if (intent.untilTaskDone && !intent.cadence) {
          throw new ToolRefusal('Please choose a repeat cadence before asking to repeat until the task is completed.');
        }
        if (intent.fireAt.getTime() <= now.getTime()) {
          throw new ToolRefusal('Choose a future reminder time.');
        }
        if (intent.fireAt.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
          throw new ToolRefusal('Choose a reminder time within the next year.');
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
          // A wake has no message to tell its reminders apart, so each task and time is its own request.
          idempotencyKey: createHash('sha256').update(isPiWake(request) ? `${message.id}:${input.task}:${input.fireAt}` : message.id).digest('hex'),
          taskIdentity: task.taskIdentity,
          taskTitle: task.text,
          fireAt: intent.fireAt,
          localTime: localTimeLabel(intent.fireAt),
          anchorDate: intent.cadence === null ? null : dayKey(intent.fireAt),
          cadence: intent.cadence === 'once' ? null : intent.cadence,
          untilTaskDone: intent.untilTaskDone,
        };
        try {
          const result = await options.store.create(candidate, now);
          options.onScheduled?.(result.schedule.fireAt);
          return {
            operation: 'create',
            created: result.created,
            reminder: scheduleResult(result.schedule, now),
            confirmation: `Reminder ${result.created ? 'saved and scheduled' : 'already saved'} for ${dayKey(intent.fireAt)} at ${localTimeLabel(intent.fireAt)} Copenhagen time; ${result.schedule.cadence ?? 'one time'}${result.schedule.untilTaskDone ? ' until the task is completed' : ''}. Device delivery has not been attempted. The task deadline is unchanged.`,
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
        return { operation: 'cancel', cancelled: true, reminder: scheduleResult({ ...schedule, state: 'cancelled' }, now) };
      }
      if (intent.action !== input.operation || intent.fireAt.getTime() <= now.getTime() ||
          intent.fireAt.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
        throw new ToolRefusal('Choose a future Copenhagen time and state the matching reminder change. Nothing was changed.');
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
      try {
        const updated = await options.store.updateScheduled(schedule.id, update);
        if (!updated) throw new ToolRefusal('That reminder is no longer scheduled.');
        options.onScheduled?.(intent.fireAt);
        const saved = await options.store.get(schedule.id);
        return {
          operation: input.operation,
          updated: true,
          reminder: saved ? scheduleResult(saved, now) : scheduleResult({ ...schedule, ...update }, now),
          confirmation: `Reminder moved to ${dayKey(intent.fireAt)} at ${localTimeLabel(intent.fireAt)} Copenhagen time. The task deadline is unchanged.`,
        };
      } catch (error) {
        if (error instanceof ToolRefusal) throw error;
        throw new ToolFailure('The reminder could not be updated. Nothing was confirmed.');
      }
    },
  };
}

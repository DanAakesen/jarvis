import type { ToolCompletionOperation } from './tool-registry.js';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeCompletionText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFC').trim().toLocaleLowerCase('en-US');
}

export function isPositiveResult(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return true;
  return isRecord(value) && Object.keys(value).length > 0;
}

const failureValues = new Set([
  'awaiting', 'awaiting_confirmation', 'cancelled', 'canceled', 'failed', 'failure', 'partial', 'pending',
  'refused', 'skipped', 'unverified', 'unknown',
]);

export function terminalFailure(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (Array.isArray(value)) return value.some(child => terminalFailure(child, depth + 1));
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (['state', 'status', 'outcome'].includes(key) && typeof child === 'string' &&
        failureValues.has(normalizeCompletionText(child))) return true;
    if (key === 'partial' && child === true) return true;
    if (terminalFailure(child, depth + 1)) return true;
  }
  return false;
}

export function semanticOperation(value: unknown): ToolCompletionOperation {
  const text = normalizeCompletionText(String(value ?? '')).replaceAll('_', ' ').replaceAll('-', ' ');
  if (/^(?:(?:please|can you|could you|would you|will you|vil du|kan du)\s+)?(?:draft|prepare a draft|create a draft)\b/iu.test(text)) return 'create';
  if (/^(?:keep|watch)\b.*\b(?:updated|watch|deploy|deployment)\b/iu.test(text)) return 'create';
  if (/^issue\b/iu.test(text)) return 'create';
  const operations: readonly [ToolCompletionOperation, RegExp][] = [
    ['delete', /\b(?:delete|cancel|close|archive|remove|forget|discard|stop|slet|aflys|luk|fjern)\b/iu],
    ['send', /\b(?:send|sende|email|forward|reply|comment|svar|besvar)\b/iu],
    ['open', /\b(?:open|launch|focus|show|activate|abn|abne|fokus)\b/iu],
    ['start', /\b(?:start|run|deploy|dispatch|trigger|retry|resume|research|implement|build|fix|genoptag|kør)\b/iu],
    ['create', /\b(?:create|add|book|schedule|reserve|bestil|reserver|capture|remember|save|write|log|record|opret|oprette|tilføj|planlæg|gem|skriv|husk)\b/iu],
    ['update', /\b(?:update|change|edit|move|push|reschedule|complete|reopen|resolve|unresolve|pause|pin|unpin|set|label|mark|merge|approve|review|star|rename|click|type|select|opdater|rediger|flyt|færdiggør|sammenføj)\b/iu],
    ['read', /\b(?:check|find|get|list|lookup|read|search|status|view|query|download|læs|læse|søg|tjek|vis)\b/iu],
  ];
  let selected: ToolCompletionOperation = 'generic';
  let firstAt = text.length;
  for (const [operation, pattern] of operations) {
    const match = pattern.exec(text);
    if (match?.index !== undefined && match.index < firstAt) {
      selected = operation;
      firstAt = match.index;
    }
  }
  return selected;
}

export function completed(result: unknown): boolean {
  if (!isRecord(result) || typeof result.status !== 'string' || normalizeCompletionText(result.status) !== 'completed') {
    return false;
  }
  return !Array.isArray(result.items) || result.items.length > 0 && result.items.every(item =>
    isRecord(item) && typeof item.status === 'string' && normalizeCompletionText(item.status) === 'completed');
}

const activeDurableStates = new Set([
  'accepted', 'done', 'in_progress', 'open', 'pause_requested', 'pauserequested', 'pending', 'queued',
  'ready', 'running', 'scheduled', 'started', 'submitted',
]);

function durableState(result: unknown): string {
  if (!isRecord(result)) return '';
  const task = isRecord(result.task) ? result.task : undefined;
  const job = isRecord(result.job) ? result.job : undefined;
  const state = result.status ?? result.state ?? task?.state ?? job?.status;
  return typeof state === 'string' ? normalizeCompletionText(state) : '';
}

function hasDurableId(result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (typeof result.jobId === 'string' && result.jobId.length > 0 ||
      typeof result.taskId === 'string' && result.taskId.length > 0 ||
      typeof result.runId === 'string' && result.runId.length > 0) return true;
  if (typeof result.id === 'string' && result.id.length > 0 &&
      typeof result.state === 'string') return true;
  return isRecord(result.task) && typeof result.task.id === 'string' && result.task.id.length > 0 ||
    isRecord(result.job) && typeof result.job.jobId === 'string' && result.job.jobId.length > 0;
}

export function durableActive(result: unknown): boolean {
  if (!hasDurableId(result)) return false;
  const state = durableState(result);
  return state === '' || activeDurableStates.has(state) ||
    state === 'completed' || state === 'succeeded' || state === 'paused';
}

export function durableCancelled(result: unknown): boolean {
  return hasDurableId(result) && ['cancelled', 'canceled'].includes(durableState(result));
}

export function durableTerminal(result: unknown): boolean {
  return durableActive(result) || durableCancelled(result);
}

function nestedValue(
  value: unknown,
  keys: readonly string[],
  depth = 0,
): unknown {
  if (depth > 5) return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = nestedValue(child, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const found = value[key];
    if (found !== undefined && (typeof found === 'string' || typeof found === 'number' ||
        typeof found === 'boolean')) return found;
  }
  for (const child of Object.values(value)) {
    const found = nestedValue(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

const remoteIdentityAliases = [
  [['id'], ['id']],
  [['number', 'issue', 'issue_number', 'issueNumber', 'pull_number', 'pullNumber'],
    ['number', 'issue', 'issue_number', 'issueNumber', 'pull_number', 'pullNumber']],
  [['taskId', 'task_id'], ['taskId', 'task_id', 'id']],
  [['jobId', 'job_id', 'runId', 'run_id'], ['jobId', 'job_id', 'runId', 'run_id', 'id']],
  [['path'], ['path']],
  [['repository', 'repo'], ['repository', 'repo']],
  [['owner'], ['owner']],
  [['branch', 'ref'], ['branch', 'ref']],
  [['workflow'], ['workflow']],
  [['name'], ['name']],
  [['resourceId', 'resource_id'], ['resourceId', 'resource_id', 'id']],
  [['resourceGroup'], ['resourceGroup']],
  [['resourceName'], ['resourceName']],
] as const;

function remoteIdentity(result: unknown): boolean {
  return nestedValue(result, [
    'id', 'number', 'issueNumber', 'issue_number', 'pullNumber', 'pull_number', 'taskId',
    'jobId', 'runId', 'sha', 'commit', 'url', 'html_url', 'path', 'branch', 'ref',
  ]) !== undefined;
}

function remoteDeleteTargetConfirmed(
  args: Record<string, unknown>,
  result: unknown,
): boolean {
  let compared = 0;
  for (const [requestKeys, resultKeys] of remoteIdentityAliases) {
    const requested = requestKeys.map(key => args[key]).find(value =>
      typeof value === 'string' || typeof value === 'number');
    if (requested === undefined) continue;
    const returned = nestedValue(result, resultKeys);
    if (returned === undefined) continue;
    compared += 1;
    const requestKey: string = requestKeys[0] ?? '';
    const canonical = (value: unknown) => {
      const text = String(value);
      if (requestKey === 'owner' || requestKey === 'repo' || requestKey === 'repository') {
        return normalizeCompletionText(text);
      }
      if (['branch', 'ref', 'head', 'base'].includes(requestKey)) {
        return text.replace(/^refs\/heads\//u, '');
      }
      return normalizeCompletionText(text);
    };
    if (canonical(requested) !== canonical(returned)) return false;
  }
  if (compared === 0) return false;
  if (!isRecord(result)) return false;
  const state = normalizeCompletionText(String(result.status ?? result.state ?? result.outcome ?? ''));
  return result.deleted === true || result.removed === true || result.closed === true ||
    result.archived === true ||
    ['deleted', 'removed', 'closed', 'archived', 'completed', 'done', 'success', 'succeeded'].includes(state);
}

export function remoteTerminalReceipt(
  operation: ToolCompletionOperation,
  args: Record<string, unknown>,
  result: unknown,
): boolean {
  if (operation === 'read') return isPositiveResult(result) && !terminalFailure(result);
  if (terminalFailure(result)) return false;
  if (operation === 'delete') return remoteDeleteTargetConfirmed(args, result);
  if (!isRecord(result) && typeof result !== 'string') return false;
  const state = normalizeCompletionText(String(isRecord(result)
    ? result.status ?? result.state ?? result.outcome ?? result.conclusion ?? ''
    : result));
  const genericTerminal = [
    'accepted', 'completed', 'done', 'ok', 'succeeded', 'success',
  ];
  const terminal = operation === 'create'
    ? [...genericTerminal, 'created', 'opened', 'written'].includes(state)
    : operation === 'update'
      ? [...genericTerminal, 'approved', 'closed', 'merged', 'ready', 'reviewed', 'updated', 'written'].includes(state)
      : operation === 'send'
        ? [...genericTerminal, 'commented', 'reviewed', 'sent'].includes(state)
        : operation === 'start'
          ? [...genericTerminal, 'dispatched', 'queued', 'running', 'scheduled', 'started'].includes(state)
          : operation === 'open'
            ? [...genericTerminal, 'opened'].includes(state)
            : genericTerminal.includes(state);
  const explicitWriteStates = [
    'accepted', 'archived', 'closed', 'commented', 'created', 'deleted', 'dispatched', 'merged',
    'opened', 'removed', 'reviewed', 'sent', 'started', 'updated', 'written',
  ];
  if (state && explicitWriteStates.includes(state) && !terminal) return false;
  if (isRecord(result) && (
    operation === 'create' && (result.updated === true || result.deleted === true ||
      result.removed === true || result.closed === true) ||
    operation === 'update' && (result.created === true || result.deleted === true ||
      result.removed === true) ||
    operation === 'start' && (result.deleted === true || result.updated === true) ||
    operation === 'send' && (result.deleted === true || result.removed === true)
  )) return false;
  if (operation === 'open') {
    return isRecord(result) && (result.opened === true || typeof result.url === 'string') ||
      terminal;
  }
  if (operation === 'start') {
    if (!isPositiveResult(result)) return false;
    return remoteIdentity(result) || terminal;
  }
  if (operation === 'send') {
    if (!isPositiveResult(result)) return false;
    if (!isRecord(result)) return terminal;
    return remoteIdentity(result) || terminal || result.sent === true || result.commented === true;
  }
  return remoteIdentity(result) || terminal;
}

function healthWriteReceipt(args: Record<string, unknown>, result: unknown): boolean {
  if (!isRecord(result) || terminalFailure(result)) return false;
  if (result.created === true || result.updated === true || result.deleted === true ||
      result.saved === true || result.persisted === true || completed(result)) return true;
  if (typeof result.status === 'string' &&
      ['committed', 'already-applied', 'already-deleted'].includes(normalizeCompletionText(result.status))) {
    return result.status === 'committed' ||
      result.operation === args.operation && isRecord(result.record);
  }
  if (result.status === 'unchanged') {
    if (args.mealKey !== undefined) {
      return result.mealKey === args.mealKey && Object.is(result.preference, args.preference);
    }
    if (isRecord(args.targets) && isRecord(result.targets)) {
      const currentTargets = result.targets;
      return Object.entries(args.targets).every(([key, value]) => Object.is(currentTargets[key], value));
    }
    return false;
  }
  return isRecord(result.entry) && typeof result.entry.id === 'string';
}

export const receipt = {
  read: (_args: Record<string, unknown>, result: unknown) => isPositiveResult(result),
  completed: (_args: Record<string, unknown>, result: unknown) => completed(result),
  durableActive: (_args: Record<string, unknown>, result: unknown) => durableActive(result),
  durableCancelled: (_args: Record<string, unknown>, result: unknown) => durableCancelled(result),
  durableTerminal: (_args: Record<string, unknown>, result: unknown) => durableTerminal(result),
  opened: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.opened === true,
  applied: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (result.applied === true ||
      result.type === 'generated-view' && isRecord(result.view)),
  workspaceManage: (args: Record<string, unknown>, result: unknown) => {
    if (!isRecord(result) || typeof result.id !== 'string') return false;
    if (args.action === 'delete') return result.deleted === true;
    if (result.action !== args.action) return false;
    if (args.action === 'pin') return result.pinned === true;
    if (args.action === 'unpin') return result.pinned === false;
    return args.action === 'rename' && typeof args.title === 'string' && result.title === args.title;
  },
  vaultCommit: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.path === args.path && typeof result.commit === 'string' &&
      /^[0-9a-f]{40}$/iu.test(result.commit),
  taskWrite: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.id === 'string' && typeof result.path === 'string' &&
      typeof result.line === 'number' && typeof result.text === 'string' &&
      (typeof result.commit === 'string' && /^[0-9a-f]{40}$/iu.test(result.commit) ||
        result.commit === null),
  issue: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && Number.isInteger(result.number) && Number(result.number) > 0 &&
      typeof result.url === 'string' && typeof result.taskCode === 'string',
  comment: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.status === 'commented' && Number.isInteger(result.number) &&
      typeof result.url === 'string',
  githubWrite: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.status === 'string' &&
      ['created', 'updated', 'commented', 'reviewed', 'merged', 'ready', 'dispatched',
        'rerun_requested', 'written'].includes(normalizeCompletionText(result.status)),
  project: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.id === 'string' && result.id === String(args.projectId),
  projectArchive: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.status === 'archived' && typeof result.projectId === 'string' &&
      (args.projectId === undefined || result.projectId === args.projectId),
  repository: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (result.alreadyAdded === true ||
      isRecord(result.project) && typeof result.project.id === 'string'),
  healthWrite: healthWriteReceipt,
  inboxCapture: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.id === 'string' && typeof result.path === 'string' &&
      typeof result.created === 'boolean',
  inboxClose: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.id === 'string' && result.closed === true,
  memoryWrite: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.id === 'string' && typeof result.key === 'string' &&
      Number.isSafeInteger(result.revision),
  memoryDelete: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.id === 'string' && typeof result.key === 'string' &&
      typeof result.category === 'string',
  jobCancel: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.cancelled === 'string',
  modelDeployment: (args: Record<string, unknown>, result: unknown) => {
    if (!isRecord(result) || result.status !== 'accepted' || typeof result.name !== 'string') return false;
    if (args.action === 'delete') return result.name === args.name;
    return args.action === 'create' && typeof args.model === 'string' &&
      typeof args.version === 'string' && result.name === `${args.model}-${args.version}`;
  },
  preferenceUpdate: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && args.operation === 'update' &&
      result.confirmation === 'Proactive preferences saved.',
  reminderWrite: (args: Record<string, unknown>, result: unknown) => {
    if (!isRecord(result) || args.operation === 'read') return false;
    if (args.operation === 'cancel') return result.cancelled === true;
    return result.created === true || result.updated === true;
  },
  feedbackWrite: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (result.saved === true || result.alreadyApplied === true ||
      result.applied === true || result.updated === true),
  watchCreate: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.created === true,
  watchChange: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (result.updated === true || result.stopped === true),
  watchStop: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (typeof result.closedAs === 'string' || result.stopped === true),
  pcClose: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.closing === true && Number.isInteger(result.windows),
  pcMedia: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.controlled === true && result.action === args.action,
  clipboardWrite: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.written === true,
  pcBrowserAct: (args: Record<string, unknown>, result: unknown) => {
    if (!isRecord(result)) return false;
    return result.acted === true && result.action === args.action;
  },
  browserTask: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.status === 'completed',
  workspaceView: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.artifactId === 'string',
  pinRestore: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.restored === true && typeof result.viewId === 'string',
  visionWatch: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.instructionsSaved === true,
  visionStop: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.stopped === 'string',
  credentialIssue: (args: Record<string, unknown>, result: unknown) => isRecord(result) &&
    (args.operation === 'issue'
      ? typeof result.credential === 'string' && typeof result.id === 'string'
      : args.operation === 'revoke'
        ? typeof result.confirmation === 'string' && result.confirmation.startsWith('Revoked')
        : false),
  nudgeStyle: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (args.operation === 'set' || args.operation === 'reset') &&
      typeof result.confirmation === 'string',
  situationCommit: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.committed === true &&
      typeof result.revision === 'number' && Number.isSafeInteger(result.revision) &&
      typeof result.hash === 'string',
  messageDan: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.sent === true && typeof result.messageId === 'string',
  piNote: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.path === 'string' && typeof result.created === 'boolean',
  inboxTrail: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.path === 'string',
  watchLook: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.recorded === true &&
      (typeof result.nextLook === 'string' || result.nextLook === null),
  settingsTheme: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.updated === true,
  settingsPresence: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && typeof result.mode === 'string' && (
      result.mode === args.mode ||
      args.mode === 'on' && result.mode === 'away' ||
      args.mode === 'off' && result.mode === 'present'),
  settings: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (isRecord(result.settings) || result.updated === true || result.saved === true),
  modelSetting: (args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (args.model === undefined || result.model === args.model) &&
      (args.reasoning === undefined || result.reasoning === args.reasoning),
  credentialRenewal: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && (result.outcome === 'renewed' || result.outcome === 'fresh'),
  systemConfirmation: (_args: Record<string, unknown>, result: unknown) =>
    isRecord(result) && result.executed === true,
} as const;

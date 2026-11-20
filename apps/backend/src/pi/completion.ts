import { createHash } from 'node:crypto';
import type { RegisteredTool } from '../core/tool-registry.js';
import type { PiTurnGrant } from './turns.js';

export type PiCompletionKind = 'conversation' | 'retrieved' | 'committed' | 'durable_job';
export type PiCompletionEvidenceKind = Exclude<PiCompletionKind, 'conversation'>;
export type PiCompletionOperation =
  | 'read' | 'create' | 'update' | 'delete' | 'send' | 'open' | 'start' | 'generic';
export type PiCompletionDomain =
  | 'calendar' | 'mail' | 'weather' | 'notes' | 'tasks' | 'health' | 'memory' | 'github' | 'azure'
  | 'web' | 'factory' | 'pc' | 'workspace' | 'jobs' | 'settings' | 'generic';

export interface PiCompletionRequirement {
  readonly kind: PiCompletionEvidenceKind;
  readonly domain: PiCompletionDomain;
  readonly operation: PiCompletionOperation;
  readonly targetHashes: readonly string[];
}

export interface PiCompletionPlan {
  readonly kind: PiCompletionKind;
  readonly requirements: readonly PiCompletionRequirement[];
  readonly contextual?: boolean;
  readonly requiresTrustedContext?: boolean;
  readonly runtimeTargetHashes?: readonly string[];
  readonly runtimeOperation?: PiCompletionOperation;
}

export interface PiCompletionEvidence {
  readonly tool: string;
  readonly kind: PiCompletionEvidenceKind;
  readonly domain: PiCompletionDomain;
  readonly operation: PiCompletionOperation;
  readonly argumentsHash: string;
  readonly targetHashes: readonly string[];
  readonly identityHashes: readonly string[];
  readonly identityTargets: readonly {
    readonly identityHash: string;
    readonly targetHashes: readonly string[];
  }[];
}

const readVerbs = new Set(['check', 'find', 'get', 'list', 'lookup', 'read', 'search', 'show', 'status', 'view', 'query', 'download']);
const actionVerbs = new Set([
  'add', 'archive', 'assign', 'cancel', 'close', 'comment', 'complete', 'create', 'delete', 'deploy', 'dispatch', 'edit',
  'capture', 'log', 'merge', 'move', 'open', 'pause', 'pin', 'publish', 'record', 'remember', 'remove', 'renew', 'reply', 'resume',
  'reopen', 'retry', 'save', 'schedule', 'send', 'set', 'start', 'stop', 'trigger', 'unassign', 'update', 'write',
]);
const terminalFailureValues = new Set([
  'awaiting', 'awaiting_confirmation', 'cancelled', 'canceled', 'failed', 'failure', 'partial', 'pending',
  'refused', 'skipped', 'unverified', 'unknown',
]);
const durableJobStates = new Set([
  'accepted', 'done', 'in_progress', 'open', 'pending', 'queued', 'ready', 'running', 'scheduled', 'started', 'submitted',
]);
const maxBindingTextCharacters = 20_000;

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function segments(name: string): string[] {
  return normalized(name).split(/[_-]+/u).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function targetTerm(value: string): string {
  const text = normalized(value);
  return /^\d{1,18}$/u.test(text) ? String(BigInt(text)) : text;
}

export function toolEffect(
  tool: Pick<RegisteredTool, 'name' | 'execution'>,
  args: Record<string, unknown>,
): 'read' | 'action' | 'unclassified' {
  if (tool.execution?.operation) {
    const operation = typeof args[tool.execution.operation.field] === 'string'
      ? String(args[tool.execution.operation.field])
      : '';
    const effect = tool.execution.operation.effects[operation];
    if (effect) return effect;
  }
  if (tool.execution?.defaultEffect && tool.execution.defaultEffect !== 'unclassified') {
    return tool.execution.defaultEffect;
  }
  const operation = typeof args.operation === 'string' ? args.operation : '';
  if (segments(operation).some(word => actionVerbs.has(word))) return 'action';
  if (readVerbs.has(normalized(operation))) return 'read';
  const words = segments(tool.name);
  if (words.some(word => actionVerbs.has(word))) return 'action';
  if (words.some(word => readVerbs.has(word))) return 'read';
  return 'unclassified';
}

function operationFamily(value: string): PiCompletionOperation {
  const text = normalized(value).replaceAll('_', ' ').replaceAll('-', ' ');
  if (/\b(?:delete|cancel|close|archive|remove|forget|discard|slet|aflys|luk|fjern)\b/iu.test(text)) return 'delete';
  if (/^(?:(?:please|can you|could you|would you|will you|vil du|kan du)\s+)?(?:draft|prepare a draft|create a draft)\b/iu.test(text)) return 'create';
  if (/\b(?:send|email|forward|reply|comment|mail|svar)\b/iu.test(text)) return 'send';
  if (/\b(?:open|launch|focus|show|activate|åbn|vis|fokus)\b/iu.test(text)) return 'open';
  if (/\b(?:start|run|deploy|dispatch|trigger|retry|resume|research|implement|build|fix|genoptag|start|kør)\b/iu.test(text)) return 'start';
  if (/\b(?:create|add|book|schedule|reserve|capture|remember|save|write|log|record|draft|opret|tilføj|planlæg|gem|skriv|husk)\b/iu.test(text)) return 'create';
  if (/\b(?:update|change|edit|move|reschedule|complete|reopen|pause|pin|unpin|set|label|mark|merge|approve|review|rename|opdater|rediger|flyt|færdiggør|sammenføj)\b/iu.test(text)) return 'update';
  return 'generic';
}

function receiptOperation(
  tool: Pick<RegisteredTool, 'name'>,
  args: Record<string, unknown>,
): PiCompletionOperation {
  const metadata = completionToolMetadata[tool.name];
  if (metadata) {
    return typeof metadata.operation === 'function'
      ? metadata.operation(args)
      : metadata.operation;
  }
  const input = Object.entries(args).flatMap(([key, value]) =>
    ['operation', 'action', 'goal'].includes(key) && typeof value === 'string'
      ? [value]
      : []).join(' ');
  const explicit = input ? operationFamily(input) : 'generic';
  return explicit === 'generic' ? operationFamily(tool.name) : explicit;
}

const fallbackTargetFields = [
  'id', 'messageId', 'draftId', 'taskId', 'jobId', 'eventId', 'itemId', 'projectId',
  'path', 'repository', 'repo', 'url', 'sha', 'query', 'q', 'name', 'title', 'subject',
  'summary', 'to', 'from', 'location', 'value', 'issue', 'issueNumber', 'operation', 'action',
] as const;

type ToolReceipt =
  | 'completed' | 'opened' | 'applied' | 'workspace-manage' | 'vault-commit' | 'task-write'
  | 'issue' | 'comment' | 'github-write' | 'project' | 'project-archive' | 'health-write'
  | 'inbox-capture' | 'inbox-close' | 'memory-write' | 'memory-delete' | 'job-cancel'
  | 'model-deployment' | 'preference-update' | 'reminder-write' | 'feedback-write'
  | 'watch-create' | 'watch-change' | 'pc-close' | 'pc-media' | 'clipboard-write' | 'pc-browser-act'
  | 'browser-task' | 'settings-write' | 'repository';

interface CompletionToolMetadata {
  readonly domain: PiCompletionDomain;
  readonly operation: PiCompletionOperation | ((args: Record<string, unknown>) => PiCompletionOperation);
  readonly acceptedRequestOperations?: readonly PiCompletionOperation[];
  readonly targetFields: readonly string[];
  readonly resultTargetFields: readonly string[];
  readonly receipt?: ToolReceipt;
}

const completionToolMetadata: Readonly<Record<string, CompletionToolMetadata>> = {
  mail_search: { domain: 'mail', operation: 'read', targetFields: ['query'], resultTargetFields: ['id', 'messageId', 'from', 'to', 'subject'] },
  mail_list_drafts: { domain: 'mail', operation: 'read', targetFields: ['query'], resultTargetFields: ['id', 'draftId', 'to', 'subject'] },
  mail_send: { domain: 'mail', operation: 'send', targetFields: ['to', 'subject'], resultTargetFields: ['id', 'messageId'], receipt: 'completed' },
  mail_update_draft: {
    domain: 'mail', operation: 'update', acceptedRequestOperations: ['create', 'update'],
    targetFields: ['draftId', 'to', 'subject'], resultTargetFields: ['draftId', 'id'], receipt: 'completed',
  },
  mail_delete_draft: { domain: 'mail', operation: 'delete', targetFields: ['draftId'], resultTargetFields: ['draftId', 'id'], receipt: 'completed' },
  mail_archive: { domain: 'mail', operation: 'update', targetFields: ['messageId'], resultTargetFields: ['messageId', 'id'], receipt: 'completed' },
  mail_label: { domain: 'mail', operation: 'update', targetFields: ['messageId', 'add', 'remove'], resultTargetFields: ['messageId', 'id'], receipt: 'completed' },
  mail_draft_reply: { domain: 'mail', operation: 'create', targetFields: ['messageId'], resultTargetFields: ['messageId', 'id'], receipt: 'completed' },

  calendar_today_agenda: { domain: 'calendar', operation: 'read', targetFields: ['date'], resultTargetFields: ['id', 'summary', 'start', 'end'] },
  calendar_list_events: { domain: 'calendar', operation: 'read', targetFields: ['timeMin', 'timeMax', 'query'], resultTargetFields: ['id', 'summary', 'start', 'end'] },
  calendar_next_event: { domain: 'calendar', operation: 'read', targetFields: ['after'], resultTargetFields: ['id', 'summary', 'start', 'end'] },
  calendar_find_free_slots: { domain: 'calendar', operation: 'read', targetFields: ['start', 'end'], resultTargetFields: ['start', 'end'] },
  calendar_create_event: { domain: 'calendar', operation: 'create', targetFields: ['summary', 'startDateTime', 'endDateTime', 'attendees'], resultTargetFields: ['id', 'summary'], receipt: 'completed' },
  calendar_create_events: { domain: 'calendar', operation: 'create', targetFields: ['events'], resultTargetFields: ['id', 'summary'], receipt: 'completed' },
  calendar_update_event: { domain: 'calendar', operation: 'update', targetFields: ['eventId', 'title'], resultTargetFields: ['id', 'eventId'], receipt: 'completed' },
  calendar_move_event: { domain: 'calendar', operation: 'update', targetFields: ['eventId', 'startDateTime', 'endDateTime'], resultTargetFields: ['id', 'eventId'], receipt: 'completed' },
  calendar_delete_event: { domain: 'calendar', operation: 'delete', targetFields: ['eventId'], resultTargetFields: ['id', 'eventId'], receipt: 'completed' },

  weather: { domain: 'weather', operation: 'read', targetFields: ['location', 'days'], resultTargetFields: ['place', 'location', 'timezone'] },
  web_research: { domain: 'web', operation: 'read', targetFields: ['query'], resultTargetFields: ['title', 'url'] },
  research: { domain: 'web', operation: 'start', targetFields: ['topic', 'title'], resultTargetFields: ['jobId', 'id', 'status'], receipt: 'completed' },

  vault_search: { domain: 'notes', operation: 'read', targetFields: ['query', 'kind'], resultTargetFields: ['id', 'path', 'title'] },
  vault_read: { domain: 'notes', operation: 'read', targetFields: ['path'], resultTargetFields: ['path', 'url', 'sha'] },
  vault_write: { domain: 'notes', operation: 'create', targetFields: ['path'], resultTargetFields: ['path', 'commit', 'url'], receipt: 'vault-commit' },
  vault_delete: { domain: 'notes', operation: 'delete', targetFields: ['path'], resultTargetFields: ['path', 'commit', 'url'], receipt: 'vault-commit' },
  vault_task_create: { domain: 'tasks', operation: 'create', targetFields: ['text', 'scope', 'due', 'time'], resultTargetFields: ['id', 'path', 'text'], receipt: 'task-write' },
  vault_task_complete: { domain: 'tasks', operation: 'update', targetFields: ['path', 'line', 'text', 'version', 'done'], resultTargetFields: ['id', 'path', 'text'], receipt: 'task-write' },
  vault_task_edit: { domain: 'tasks', operation: 'update', targetFields: ['path', 'line', 'text', 'newText', 'version'], resultTargetFields: ['id', 'path', 'text'], receipt: 'task-write' },

  pc_open: { domain: 'pc', operation: 'open', targetFields: ['target', 'value'], resultTargetFields: ['app'], receipt: 'opened' },
  pc_close: { domain: 'pc', operation: 'delete', targetFields: ['app'], resultTargetFields: ['app'], receipt: 'pc-close' },
  pc_media: { domain: 'pc', operation: 'update', targetFields: ['action'], resultTargetFields: ['action'], receipt: 'pc-media' },
  pc_clipboard_write: { domain: 'pc', operation: 'update', targetFields: [], resultTargetFields: [], receipt: 'clipboard-write' },
  pc_browser_act: { domain: 'web', operation: args => operationFamily(String(args.action ?? '')), targetFields: ['tabId', 'snapshotId'], resultTargetFields: ['tabId', 'snapshotId'], receipt: 'pc-browser-act' },
  browser_do: { domain: 'web', operation: 'generic', targetFields: ['goal', 'url', 'tabId'], resultTargetFields: ['tabId'], receipt: 'browser-task' },
  workspace_command: { domain: 'workspace', operation: args => operationFamily(String(args.operation ?? '')), targetFields: ['commandId', 'viewId', 'page', 'view'], resultTargetFields: ['commandId', 'viewId'], receipt: 'applied' },
  workspaces_open: { domain: 'workspace', operation: 'open', targetFields: ['id', 'query'], resultTargetFields: ['id', 'title'], receipt: 'opened' },
  folio_open: { domain: 'workspace', operation: 'open', targetFields: ['id', 'query'], resultTargetFields: ['id', 'title'], receipt: 'opened' },
  workspaces_manage: {
    domain: 'workspace',
    operation: args => args.action === 'delete' ? 'delete'
      : args.action === 'rename' || args.action === 'pin' || args.action === 'unpin' ? 'update' : 'generic',
    targetFields: ['id', 'query'], resultTargetFields: ['id', 'title', 'action'],
    receipt: 'workspace-manage',
  },
  folio_manage: {
    domain: 'workspace',
    operation: args => args.action === 'delete' ? 'delete'
      : args.action === 'rename' || args.action === 'pin' || args.action === 'unpin' ? 'update' : 'generic',
    targetFields: ['id', 'query'], resultTargetFields: ['id', 'title', 'action'],
    receipt: 'workspace-manage',
  },

  create_issue: { domain: 'factory', operation: 'create', targetFields: ['project', 'title'], resultTargetFields: ['number', 'url', 'taskCode'], receipt: 'issue' },
  issue_comment: { domain: 'factory', operation: 'send', targetFields: ['issueNumber', 'repository', 'project', 'text'], resultTargetFields: ['number', 'url'], receipt: 'comment' },
  start_issue: { domain: 'factory', operation: 'start', targetFields: ['issue', 'project'], resultTargetFields: ['number', 'url', 'taskId', 'id', 'state'] },
  create_task: { domain: 'factory', operation: 'create', targetFields: ['projectId', 'prompt'], resultTargetFields: ['taskId', 'id', 'issue', 'state'] },
  set_task_model: { domain: 'factory', operation: 'update', targetFields: ['taskId'], resultTargetFields: ['taskId', 'id', 'state'] },
  retry_task: { domain: 'factory', operation: 'start', targetFields: ['taskId'], resultTargetFields: ['id', 'taskId', 'state'] },
  steer_task: { domain: 'factory', operation: 'update', targetFields: ['taskId'], resultTargetFields: ['id', 'taskId', 'state'] },
  pause_task: { domain: 'factory', operation: 'update', targetFields: ['taskId'], resultTargetFields: ['id', 'taskId', 'state'] },
  resume_task: { domain: 'factory', operation: 'start', targetFields: ['taskId'], resultTargetFields: ['id', 'taskId', 'state'] },
  cancel_task: { domain: 'factory', operation: 'delete', targetFields: ['taskId'], resultTargetFields: ['id', 'taskId', 'state'] },
  update_project: { domain: 'factory', operation: 'update', targetFields: ['projectId'], resultTargetFields: ['id', 'repo'], receipt: 'project' },
  archive_project: { domain: 'factory', operation: 'delete', targetFields: ['projectId'], resultTargetFields: ['projectId', 'repo'], receipt: 'project-archive' },
  manage_repository: { domain: 'factory', operation: 'create', targetFields: ['repository'], resultTargetFields: ['repository', 'repo', 'id'], receipt: 'repository' },
  github_write: {
    domain: 'github', operation: args => receiptOperation({ name: String(args.operation ?? '') }, args),
    targetFields: ['repository', 'number', 'branch', 'path', 'workflow'], resultTargetFields: ['repository', 'number', 'branch', 'path', 'sha', 'runId', 'url'],
    receipt: 'github-write',
  },

  inbox_capture: { domain: 'notes', operation: 'create', targetFields: ['title'], resultTargetFields: ['id', 'title', 'path'], receipt: 'inbox-capture' },
  inbox_close: { domain: 'notes', operation: 'delete', targetFields: ['id', 'path'], resultTargetFields: ['id', 'title', 'path'], receipt: 'inbox-close' },
  memory_remember: { domain: 'memory', operation: 'create', targetFields: ['key', 'content'], resultTargetFields: ['id', 'key', 'revision'], receipt: 'memory-write' },
  memory_correct: { domain: 'memory', operation: 'update', targetFields: ['memoryId', 'content'], resultTargetFields: ['id', 'key', 'revision'], receipt: 'memory-write' },
  memory_forget: { domain: 'memory', operation: 'delete', targetFields: ['memoryId'], resultTargetFields: ['id', 'key'], receipt: 'memory-delete' },
  owner_reminders: {
    domain: 'tasks',
    operation: args => String(args.operation) === 'cancel' ? 'delete' : String(args.operation) === 'read' ? 'read' : 'update',
    targetFields: ['id', 'task', 'fireAt'], resultTargetFields: ['id', 'task', 'fireAt', 'state'], receipt: 'reminder-write',
  },
  proactive_preferences: { domain: 'settings', operation: args => args.operation === 'read' || args.operation === 'help' ? 'read' : 'update', targetFields: [], resultTargetFields: [], receipt: 'preference-update' },
  proactive_item_feedback: { domain: 'settings', operation: 'update', targetFields: ['itemId'], resultTargetFields: ['itemId', 'state'], receipt: 'feedback-write' },
  watch_create: { domain: 'jobs', operation: 'create', targetFields: ['title', 'text'], resultTargetFields: ['name'], receipt: 'watch-create' },
  watch_update: { domain: 'jobs', operation: 'update', targetFields: ['name'], resultTargetFields: ['name'], receipt: 'watch-change' },
  watch_stop: { domain: 'jobs', operation: 'delete', targetFields: ['name'], resultTargetFields: ['name', 'closedAs'], receipt: 'watch-change' },
  cancel_job: { domain: 'jobs', operation: 'delete', targetFields: ['jobId', 'query'], resultTargetFields: ['jobId', 'cancelled'], receipt: 'job-cancel' },
  manage_model_deployment: { domain: 'settings', operation: args => args.action === 'delete' ? 'delete' : 'create', targetFields: ['name', 'model', 'version'], resultTargetFields: ['name', 'status'], receipt: 'model-deployment' },
  set_theme: { domain: 'settings', operation: 'update', targetFields: [], resultTargetFields: [], receipt: 'settings-write' },
  set_presence_mode: { domain: 'settings', operation: 'update', targetFields: ['mode'], resultTargetFields: ['mode'], receipt: 'settings-write' },
  set_away_mode: { domain: 'settings', operation: 'update', targetFields: ['mode'], resultTargetFields: ['mode'], receipt: 'settings-write' },
  update_settings: { domain: 'settings', operation: 'update', targetFields: ['settings'], resultTargetFields: ['settings'], receipt: 'settings-write' },
  set_jarvis_model: { domain: 'settings', operation: 'update', targetFields: ['model', 'reasoning'], resultTargetFields: ['model', 'reasoning'], receipt: 'settings-write' },
  renew_credential: { domain: 'settings', operation: 'update', targetFields: ['name'], resultTargetFields: ['outcome'], receipt: 'settings-write' },
};

function collectFieldValues(
  value: unknown,
  fields: readonly string[],
  output: unknown[] = [],
  depth = 0,
): readonly unknown[] {
  if (depth > 5 || output.length >= 500) return output;
  if (Array.isArray(value)) {
    for (const child of value) collectFieldValues(child, fields, output, depth + 1);
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    if (fields.includes(key)) output.push(child);
    collectFieldValues(child, fields, output, depth + 1);
  }
  return output;
}

function toolTargetTokens(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): ReadonlySet<string> {
  const metadata = completionToolMetadata[toolName];
  const argumentFields = metadata?.targetFields ?? fallbackTargetFields;
  const resultFields = metadata?.resultTargetFields ?? fallbackTargetFields;
  const output = new Set<string>();
  for (const value of collectFieldValues(args, argumentFields)) bindingTokens(value, 0, output);
  for (const value of collectFieldValues(result, resultFields)) bindingTokens(value, 0, output);
  return output;
}

function rowTargetTokens(
  toolName: string,
  row: Record<string, unknown>,
  result: boolean,
): ReadonlySet<string> {
  const metadata = completionToolMetadata[toolName];
  const fields = result
    ? metadata?.resultTargetFields ?? fallbackTargetFields
    : metadata?.targetFields ?? fallbackTargetFields;
  const output = new Set<string>();
  for (const value of collectFieldValues(row, fields)) bindingTokens(value, 0, output);
  return output;
}

const domainPatterns: readonly [PiCompletionDomain, RegExp][] = [
  ['calendar', /\b(?:calendar|agenda|appointment|meeting|meetings|kalender|aftale|aftaler|møde|møder)\b/iu],
  ['mail', /\b(?:e-?mail|emails?|gmail|inbox|draft|drafts|indbakke|epost|kladde|kladder)\b/iu],
  ['weather', /\b(?:weather|forecast|temperature|rain|storm|vejr|prognose|temperatur|regn)\b/iu],
  ['notes', /\b(?:note|notes|vault|inbox|loose thought|idea|notat|noter|indbakke|idé)\b/iu],
  ['tasks', /\b(?:task|tasks|to-?do|reminder|reminders|opgave|opgaver|påmindelse|påmindelser)\b/iu],
  ['health', /\b(?:health|nutrition|food|meal|gym|training|workout|sundhed|ernæring|mad|træning)\b/iu],
  ['memory', /\b(?:memory|remember|conversation history|hukommelse|husk)\b/iu],
  ['github', /\b(?:github|pull request|pull requests|repository|repositories|workflow|workflows|code search|kode|lager|arbejdsgang)\b/iu],
  ['azure', /\b(?:azure|subscription|resource group|resources?|abonnement|ressourcegruppe|ressourcer)\b/iu],
  ['web', /\b(?:web|research|internet|public web|hotel|flight|restaurant|booking|reservation|table|ticket|room|stay|news|stock|price|prices|offentlige? net|nettet|fly|hotel|restaurantbord|billet|pris|priser|nyheder|forskning)\b/iu],
  ['factory', /\b(?:issue|issues|software factory|worker|workers|factory task|my code|your code|repo bug|min kode)\b/iu],
  ['pc', /\b(?:my pc|on my pc|windows|chrome|spotify|computer|clipboard|min pc|computeren)\b/iu],
  ['workspace', /\b(?:workspace|screen|window|view|panel|arbejdsområde|skærm|vindue|visning)\b/iu],
  ['jobs', /\b(?:job|jobs|background task|background work|baggrundsjob|lang opgave)\b/iu],
  ['settings', /\b(?:setting|settings|preference|preferences|mode|theme|finding|findings|suggestion|suggestions|indstilling|indstillinger|præference|tema|forslag)\b/iu],
];

interface DomainMatch { readonly domain: PiCompletionDomain; readonly at: number; readonly term: string }

function domainMatches(text: string): DomainMatch[] {
  return domainPatterns.flatMap(([domain, pattern]) => {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    return match?.index !== undefined ? [{ domain, at: match.index, term: targetTerm(match[0]) }] : [];
  }).sort((left, right) => left.at - right.at);
}

const ignoredTargetWords = new Set([
  'a', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'get', 'give', 'got', 'has', 'have', 'hello', 'her', 'him', 'how', 'i', 'in', 'is', 'it',
  'its', 'latest', 'me', 'my', 'new', 'next', 'of', 'on', 'or', 'our', 'please', 'right', 'so', 'some',
  'that', 'the', 'their', 'them', 'then', 'there', 'this', 'to', 'today', 'tomorrow', 'was', 'we', 'what',
  'when', 'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your', 'yesterday', 'current', 'now', 'pm',
  'jeg', 'mig', 'min', 'mine', 'mit', 'du', 'dit', 'din', 'kan', 'vil', 'skal', 'det', 'den', 'de', 'der',
  'og', 'eller', 'på', 'til', 'fra', 'med', 'for', 'som', 'i', 'en', 'et', 'dag', 'idag', 'morgen', 'nu',
  'ny', 'nye', 'næste', 'seneste', 'aktuel', 'aktuelle', 'venligst', 'hvad', 'hvilke', 'hvordan', 'kl',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag',
  'januar', 'februar', 'marts', 'maj', 'juni', 'juli', 'august', 'oktober', 'november', 'december',
  'add', 'archive', 'book', 'cancel', 'capture', 'close', 'comment', 'complete', 'create', 'delete', 'dispatch', 'edit',
  'implement', 'inspect', 'list', 'log', 'make', 'move', 'open', 'pause', 'publish', 'read', 'record', 'remember',
  'remove', 'reply', 'save', 'schedule', 'search', 'send', 'set', 'show', 'start', 'stop', 'update', 'write',
  'merge', 'approve', 'review', 'forward',
  'find', 'check', 'fix', 'research', 'look', 'up', 'tjek', 'læs', 'søg', 'vis', 'opret', 'slet', 'gem', 'rediger', 'start',
  'calendar', 'agenda', 'appointment', 'meeting', 'event', 'email', 'gmail', 'inbox', 'mail', 'weather', 'forecast',
  'note', 'notes', 'task', 'tasks', 'todo', 'reminder', 'reminders', 'azure', 'github', 'repository', 'repositories',
  'issue', 'issues', 'pull', 'workflow', 'workflows', 'workspace', 'screen', 'window', 'panel', 'job', 'jobs',
  'resource', 'resources', 'subscription', 'group', 'provider', 'temperature', 'rain',
  'table', 'ticket', 'room', 'stay', 'reservation', 'hotel', 'flight', 'restaurant',
  'pc', 'computer', 'app', 'application', 'item', 'report', 'saved', 'repo', 'code', 'jarvis', 'about',
  'invitation', 'request', 'change', 'thing', 'this', 'that', 'please', 'deal', 'draft', 'updated',
  'saying', 'says', 'tell', 'telling', 'called', 'named',
  'worker', 'workers', 'background', 'long-running',
  'kalender', 'aftale', 'aftaler', 'møde', 'møder', 'indbakke', 'epost', 'vejr', 'noter', 'notat', 'opgave',
  'opgaver', 'påmindelse', 'påmindelser', 'ressource', 'ressourcer', 'lager', 'arbejdsgang', 'skærm',
]);

function targetTerms(text: string): { readonly term: string; readonly at: number }[] {
  const terms: { readonly term: string; readonly at: number }[] = [];
  const quoted = /["“”'‘’]([^"“”'‘’]{1,300})["“”'‘’]/gu;
  for (const match of text.matchAll(quoted)) {
    const value = targetTerm(match[1] ?? '');
    if (value) terms.push({ term: value, at: match.index ?? 0 });
  }
  const wordPattern = /[\p{L}\p{N}]+(?:[._/@:-][\p{L}\p{N}-]+)*/gu;
  for (const match of text.matchAll(wordPattern)) {
    const value = targetTerm(match[0]);
    if (!value || ignoredTargetWords.has(value) ||
        value.length < 2 && !/^\d$/u.test(value)) continue;
    terms.push({ term: value, at: match.index ?? 0 });
  }
  const unique = new Map<string, { readonly term: string; readonly at: number }>();
  for (const term of terms) if (!unique.has(term.term)) unique.set(term.term, term);
  return [...unique.values()];
}

function bindingTokens(value: unknown, depth = 0, output = new Set<string>()): ReadonlySet<string> {
  if (depth > 5 || output.size >= 2_000) return output;
  if (Array.isArray(value)) {
    for (const child of value) bindingTokens(child, depth + 1, output);
    return output;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (['confirmation', 'detail', 'message', 'instruction', 'note'].includes(key)) continue;
      bindingTokens(child, depth + 1, output);
    }
    return output;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return output;
  const raw = String(value);
  const bounded = raw.length <= maxBindingTextCharacters
    ? raw
    : Array.from(raw).slice(0, maxBindingTextCharacters).join('');
  const text = normalized(bounded);
  if (!text) return output;
  output.add(text);
  for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[._/@:-][\p{L}\p{N}-]+)*/gu)) {
    const token = targetTerm(match[0]);
    if (token.length >= 2 || /^\d$/u.test(token)) output.add(token);
  }
  for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
    const part = targetTerm(token);
    if (part.length >= 2 || /^\d$/u.test(part)) output.add(part);
  }
  return output;
}

function isIdentityKey(key: string): boolean {
  return /(?:^|_)(?:id|number|path|repository|repo|url|sha)$/iu.test(key) ||
    /(?:Id|Number|Path|Repository|Repo|Url|Sha)$/u.test(key);
}

function directBindingIdentities(value: Record<string, unknown>): readonly string[] {
  const output = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    if (!isIdentityKey(key) || typeof child !== 'string' && typeof child !== 'number') continue;
    const identity = normalized(String(child));
    if (identity) output.add(identity);
  }
  return [...output];
}

function bindingIdentities(
  value: unknown,
  key = '',
  depth = 0,
  output = new Set<string>(),
): ReadonlySet<string> {
  if (depth > 5 || output.size >= 1_000) return output;
  if (Array.isArray(value)) {
    for (const child of value) bindingIdentities(child, key, depth + 1, output);
    return output;
  }
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      bindingIdentities(child, childKey, depth + 1, output);
    }
    return output;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return output;
  if (isIdentityKey(key)) {
    const identity = normalized(String(value));
    if (identity) output.add(identity);
  }
  return output;
}

function identityTargets(
  toolName: string,
  value: unknown,
  result: boolean,
  depth = 0,
): PiCompletionEvidence['identityTargets'] {
  const bindings: { identityHash: string; targetHashes: readonly string[] }[] = [];
  const visit = (child: unknown, level: number) => {
    if (level > 5 || bindings.length >= 500) return;
    if (Array.isArray(child)) {
      for (const entry of child) visit(entry, level + 1);
      return;
    }
    if (!isRecord(child)) return;
    const identities = directBindingIdentities(child).slice(0, 20).map(identity => hash(identity));
    if (identities.length > 0) {
      const targets = targetHashes([...rowTargetTokens(toolName, child, result)]);
      for (const identityHash of identities) bindings.push({ identityHash, targetHashes: targets });
    }
    for (const entry of Object.values(child)) visit(entry, level + 1);
  };
  visit(value, depth);
  const unique = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const targets = unique.get(binding.identityHash) ?? new Set<string>();
    for (const target of binding.targetHashes) targets.add(target);
    unique.set(binding.identityHash, targets);
  }
  return [...unique].map(([identityHash, targets]) => ({
    identityHash, targetHashes: [...targets],
  }));
}

function targetHashes(terms: readonly string[]): readonly string[] {
  return [...new Set(terms.map(term => hash(term)))];
}

function toolDomain(name: string, args: Record<string, unknown>): PiCompletionDomain {
  const metadata = completionToolMetadata[name];
  if (metadata) return metadata.domain;
  if (name.startsWith('az_')) return 'azure';
  if (name.startsWith('gh_') || name.startsWith('github_') || name.startsWith('pr_') ||
      name.startsWith('repo_') || name.startsWith('issue_') || name.startsWith('checks_')) return 'github';
  if (name.startsWith('calendar_')) return 'calendar';
  if (name.startsWith('mail_')) return 'mail';
  if (name === 'weather') return 'weather';
  if (name.startsWith('vault_task_') || name === 'owner_reminders') return 'tasks';
  if (name === 'vault_search' && args.kind === 'tasks') return 'tasks';
  if (name.startsWith('vault_') || name.startsWith('inbox_')) return 'notes';
  if (name.startsWith('health_') || name.startsWith('gym_')) return 'health';
  if (name.startsWith('memory_')) return 'memory';
  if (name === 'web_research' || name === 'research') return 'web';
  if (['create_issue', 'start_issue', 'create_task', 'list_projects', 'get_task', 'list_tasks', 'get_work_status',
    'retry_task', 'steer_task', 'set_task_model', 'pause_task', 'resume_task', 'cancel_task'].includes(name)) return 'factory';
  if (name === 'pc_open' && args.target === 'url') return 'web';
  if (name === 'browser_do' || name === 'pc_browser_tabs' || name === 'pc_browser_snapshot' ||
      name === 'pc_browser_act') return 'web';
  if (name.startsWith('pc_') || name === 'codex_prompt') return 'pc';
  if (name.startsWith('workspace') || name.startsWith('folio_') || name === 'show_in_chat' ||
      name.startsWith('create_html_view') || name.startsWith('read_html_view') || name.startsWith('update_html_view')) return 'workspace';
  if (name.endsWith('_job') || name === 'get_job' || name === 'list_jobs' || name === 'retry_job') return 'jobs';
  if (name.startsWith('update_settings') || name === 'get_settings' || name === 'set_theme' ||
      name === 'set_presence_mode' || name === 'set_away_mode' || name === 'get_usage' ||
      name.startsWith('proactive_')) return 'settings';
  return 'generic';
}

function actionDomainsFor(matches: readonly DomainMatch[], text: string): readonly PiCompletionDomain[] {
  const actionPatterns: Record<PiCompletionDomain, RegExp> = {
    calendar: /\b(?:book|cancel|change|create|move|schedule|reschedule|aflys|flyt|lav|opret|planlæg)\b[^\n.!?]{0,60}\b(?:meeting|appointment|calendar|møde|aftale|kalender)\b|\b(?:meeting|appointment|møde|aftale)\b[^\n.!?]{0,40}\b(?:book|schedule|create|move|cancel|opret|planlæg)\b/iu,
    mail: /^(?:(?:please|can you|could you|would you|will you|vil du|kan du)\s+)?(?:email|send|reply to|archive|draft|label)\b|\b(?:send|reply|archive|draft|label)\b[^\n.!?]{0,60}\b(?:email|mail|message|gmail|brev|besked)\b|\bemail\s+(?!from\b|fra\b)\S+/iu,
    weather: /$^/u,
    notes: /\b(?:write|save|append|create|delete|update|rename|gem|skriv|opret|slet|opdater|tilføj)\b[^\n.!?]{0,60}\b(?:note|vault|notat|noter)\b/iu,
    tasks: /\b(?:add|complete|create|delete|edit|finish|log|reopen|reschedule|remember|tilføj|opret|slet|færdiggør|gem|husk)\b[^\n.!?]{0,60}\b(?:task|todo|reminder|opgave|påmindelse)\b/iu,
    health: /\b(?:log|record|save|complete|slet|log|gem)\b[^\n.!?]{0,60}\b(?:meal|food|health|gym|workout|training|mad|træning|sundhed)\b/iu,
    memory: /\b(?:remember|save|forget|delete|husk|gem|slet)\b[^\n.!?]{0,60}\b(?:memory|fact|hukommelse)\b/iu,
    github: /\b(?:create|close|reopen|comment|merge|approve|label|update|dispatch|opret|luk|kommenter|sammenføj|opdater|kør)\b[^\n.!?]{0,80}\b(?:github|issue|pull request|repository|workflow|kode|arbejdsgang)\b/iu,
    azure: /\b(?:create|delete|deploy|restart|start|stop|update|scale|opret|slet|start|stop|opdater)\b[^\n.!?]{0,80}\b(?:azure|resource|subscription|ressource)\b/iu,
    web: /\b(?:book|reserve|buy|order|purchase|reserve|bestil|køb|book)\b/iu,
    factory: /\b(?:implement|fix|build|review and fix|start work|start issue|create an issue|start en opgave|implementer|ret koden)\b/iu,
    pc: /\b(?:open|close|play|pause|click|type|copy|paste|launch|launch|åbn|luk|klik|afspil)\b[^\n.!?]{0,50}\b(?:pc|computer|chrome|spotify|window|clipboard|app|musik)\b/iu,
    workspace: /\b(?:open|show|close|minimise|minimize|focus|move|resize|pin|unpin|åbn|vis|luk|flyt|fokusér)\b[^\n.!?]{0,60}\b(?:workspace|screen|window|view|panel|screen|skærm|vindue|visning)\b/iu,
    jobs: /\b(?:start|run|retry|cancel|pause|resume|research|undersøg|start|genoptag|aflys)\b[^\n.!?]{0,60}\b(?:job|background|research|baggrund)\b/iu,
    settings: /\b(?:change|set|enable|disable|turn on|turn off|update|dismiss|snooze|rate|skift|sæt|aktiver|deaktiver|afvis|udsæt)\b[^\n.!?]{0,60}\b(?:setting|preference|mode|theme|finding|suggestion|indstilling|tilstand|tema|forslag)\b/iu,
    generic: /$^/u,
  };
  return [...new Set(matches.map(({ domain }) => domain).filter(domain => actionPatterns[domain].test(text)))];
}

function ordinaryConversation(text: string): boolean {
  if (!text) return true;
  if (/^(?:hi|hello|hej|hey)(?:[,! ]+\s*(?:how are you|how's it going|how are things))?[.!?]*$/iu.test(text) ||
      /^(?:thanks|thank you|tak|good morning|godmorgen|good evening|god aften)[.! ]*$/iu.test(text)) return true;
  if (/^(?:tell|show|write|draft|compose|make|create)\b/iu.test(text) &&
      /\b(?:joke|poem|story|haiku|essay|opinion|vittighed|digt|historie|historier|mening)\b/iu.test(text)) return true;
  if (/^(?:what (?:is|are)|what's|hvad er)\s+(?:an?|the definition of|definitionen på|et|en)\b/iu.test(text)) return true;
  if (/^(?:what is|what's|hvad er)\s+(?:email|mail|github|azure|weather|a weather forecast|health|a meeting|an issue)[.!?]*$/iu.test(text)) return true;
  if (/^(?:explain|teach me|how does|how do|why does|why is|forklar|hvorfor)\b/iu.test(text) &&
      !/\b(?:today|current|latest|now|status|my|mine|i dag|seneste|aktuel|min)\b/iu.test(text)) return true;
  if (/^(?:what do you think|what would you do|do you think|hvad tænker du)\b/iu.test(text)) return true;
  return false;
}

function assignedTargetHashes(
  request: string,
  requirementDomain: PiCompletionDomain,
  domains: readonly DomainMatch[],
): readonly string[] {
  const terms = targetTerms(request);
  if (!domains.some(({ domain }) => domain === requirementDomain)) {
    return targetHashes(terms.map(({ term }) => term));
  }
  const assigned = terms.filter(({ at }) => {
    if (domains.length <= 1) return true;
    const nearest = domains.reduce((best, candidate) =>
      Math.abs(candidate.at - at) < Math.abs(best.at - at) ? candidate : best);
    return nearest.domain === requirementDomain;
  });
  return targetHashes(assigned.map(({ term }) => term));
}

function operationForDomain(
  request: string,
  domain: PiCompletionDomain,
  matches: readonly DomainMatch[],
): PiCompletionOperation {
  const match = matches.find(candidate => candidate.domain === domain);
  if (!match) return 'generic';
  let start = 0;
  let end = request.length;
  for (const separator of request.matchAll(/\b(?:and|then|og|derefter)\b|[,;]/gu)) {
    const at = separator.index ?? 0;
    if (at < match.at) start = at + separator[0].length;
    else if (at > match.at) { end = at; break; }
  }
  const operation = operationFamily(request.slice(start, end));
  return operation === 'generic' ? operationFamily(request) : operation;
}

export function completionPlan(text: string): PiCompletionPlan {
  const value = normalized(text);
  const contextual = /\b(?:it|itself|that|that one|this|this one|den|det|den der)\b/iu.test(value);
  const runtimeTargetHashes = targetHashes(targetTerms(value).map(({ term }) => term));
  const runtimeOperation = operationFamily(value);
  if (ordinaryConversation(value) ||
      /\b(?:do not reply|don't reply|stay quiet|be quiet|say nothing|ti stille|svar ikke|sig ingenting)\b/iu.test(value)) {
    return {
      kind: 'conversation', requirements: [], runtimeTargetHashes, runtimeOperation,
      ...(contextual ? { contextual: true } : {}),
    };
  }

  const matches = domainMatches(value);
  const ownCodeWork = /\b(?:implement|fix|build|code change|bug fix|review and fix|start work|start issue|implementer|ret|byg|kodeændring|problemrettelse)\b/iu.test(value) &&
    (matches.some(({ domain }) => domain === 'factory' || domain === 'github') ||
      /\b(?:issue|repo|repository|code|jarvis|kode)\b/iu.test(value));
  const rawDomains = [...new Set(matches.map(({ domain }) => domain))];
  const hasDomain = (domain: PiCompletionDomain) => rawDomains.includes(domain);
  const targetDomains = rawDomains.filter(domain =>
    !(domain === 'factory' && hasDomain('github') && !ownCodeWork) &&
    !(domain === 'notes' && hasDomain('mail') &&
      /\binbox|indbakke\b/iu.test(value) && !/\b(?:note|vault|notat|noter)\b/iu.test(value)) &&
    !(domain === 'notes' && hasDomain('memory') &&
      /\bremember\b/iu.test(value) && !/\b(?:note|vault|inbox|notat|noter)\b/iu.test(value)) &&
    !(domain === 'settings' && hasDomain('memory') && /\bremember\b/iu.test(value)));
  const selectedMatches = matches.filter(({ domain }) => targetDomains.includes(domain));
  const domains = targetDomains.length > 0 ? targetDomains : ['generic' as const];
  const durable =
    ownCodeWork ||
    /^(?:research|undersøg)\b/iu.test(value) ||
    /\b(?:in the background|keep working|long-running|research this|research a|i baggrunden|arbejd videre|langvarig opgave)\b/iu.test(value);
  if (durable) {
    const domain = ownCodeWork ? 'factory' as const : targetDomains.includes('web') ? 'web' as const : 'jobs' as const;
    return {
      kind: 'durable_job',
      requirements: [{
        kind: 'durable_job',
        domain,
        operation: 'start',
        targetHashes: assignedTargetHashes(value, domain, selectedMatches),
      }],
    };
  }

  const explicitActionDomains = actionDomainsFor(selectedMatches, value);
  const readCued = /^(?:what|what's|when|where|who|which|how is|how's|show me|list|find|search|check|read|look up|look at|look for|do i have|hvad|hvilke|vis mig|læs|søg|tjek|har jeg)\b/iu.test(value) ||
    /^(?:please|can you|could you|would you|will you|vil du|kan du)\s+(?:show|list|find|search|check|read|look up|look for|hvad|vis|læs|søg|tjek)\b/iu.test(value) ||
    /^(?:latest|current|today|tomorrow|give me|tell me|summarise|summarize|recall)\b/iu.test(value) ||
    /^(?:how many|how much|is|are|was|were|did|does|has|have|had|do (?:i|you|we|they|he|she|it)|can (?:i|we|you))\b/iu.test(value);
  const directRequest = /^(?:please|can you|could you|would you|will you|I need you to|I want you to|vil du|kan du|please)\b/iu.test(value);
  const imperative = /^(?:add|archive|book|cancel|capture|change|close|comment|complete|create|delete|deploy|dispatch|edit|email|fix|log|make|move|open|pause|publish|remember|remove|reply|resume|retry|save|schedule|send|set|start|stop|update|write)\b/iu.test(value);
  const firstDomainAt = selectedMatches[0]?.at ?? 0;
  const prefix = normalized(value.slice(0, firstDomainAt));
  const inferredAction = firstDomainAt > 0 && prefix.length > 0 &&
    !/^(?:a|an|my|the|this|that|today|tomorrow|latest|current|new)\b/iu.test(prefix);
  const actionCapable = domains.every(domain => domain !== 'weather');
  const action = !readCued && (explicitActionDomains.length > 0 ||
    ((directRequest || imperative || inferredAction) && actionCapable));
  if (targetDomains.length === 0 && !action && !readCued) {
    return {
      kind: 'conversation', requirements: [], runtimeTargetHashes, runtimeOperation,
      ...(contextual ? { contextual: true } : {}),
    };
  }
  if (targetDomains.length === 0) {
    return {
      kind: 'conversation', requirements: [], runtimeTargetHashes, runtimeOperation,
      ...(contextual ? { contextual: true } : {}),
    };
  }
  if (action) {
    const actionDomains = explicitActionDomains.length > 0 ? explicitActionDomains : domains.slice(0, 1);
    const requirements: PiCompletionRequirement[] = [];
    for (const domain of domains) {
      const requirementDomain = domain;
      const operation = actionDomains.includes(requirementDomain)
        ? operationForDomain(value, requirementDomain, selectedMatches)
        : 'read';
      const assignedTargets = assignedTargetHashes(value, requirementDomain, selectedMatches);
      const openDomainTarget = operation === 'open' && assignedTargets.length === 0
        ? selectedMatches.find(({ domain: candidate }) => candidate === requirementDomain)?.term
        : undefined;
      requirements.push({
        kind: actionDomains.includes(requirementDomain) ? 'committed' : 'retrieved',
        domain: requirementDomain,
        operation,
        targetHashes: openDomainTarget ? [hash(openDomainTarget)] : assignedTargets,
      });
    }
    return {
      kind: 'committed',
      requirements,
      ...(requirements.some(requirement => requirement.kind === 'committed' &&
        requirement.targetHashes.length === 0) ? { requiresTrustedContext: true } : {}),
    };
  }

  const requirements = domains.map<PiCompletionRequirement>(domain => ({
    kind: 'retrieved',
    domain,
    operation: 'read',
    targetHashes: assignedTargetHashes(value, domain, selectedMatches),
  }));
  return { kind: 'retrieved', requirements };
}

export function completionRequirement(text: string): PiCompletionKind {
  return completionPlan(text).kind;
}

function terminalFailure(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (Array.isArray(value)) return value.some(child => terminalFailure(child, depth + 1));
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (['state', 'status', 'outcome'].includes(key) && typeof child === 'string' &&
        terminalFailureValues.has(normalized(child))) return true;
    if (key === 'partial' && child === true) return true;
    if (terminalFailure(child, depth + 1)) return true;
  }
  return false;
}

function isPositiveResult(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return true;
  return isRecord(value) && Object.keys(value).length > 0;
}

function durableResult(result: unknown): boolean {
  if (!isRecord(result)) return false;
  const jobId = result.jobId ?? result.taskId ?? result.runId;
  if (typeof jobId === 'string' && jobId.length > 0 &&
      (typeof result.status !== 'string' && typeof result.state !== 'string' ||
        durableJobStates.has(normalized(String(result.status ?? result.state))) ||
        ['completed', 'succeeded', 'done'].includes(normalized(String(result.status ?? result.state))))) return true;
  if (isRecord(result.task)) {
    return typeof result.task.id === 'string' && result.task.id.length > 0 &&
      typeof result.task.state === 'string' &&
      (durableJobStates.has(normalized(result.task.state)) ||
        ['completed', 'succeeded', 'done'].includes(normalized(result.task.state)));
  }
  if (isRecord(result.job)) {
    return typeof result.job.jobId === 'string' && result.job.jobId.length > 0 &&
      typeof result.job.status === 'string' &&
      (durableJobStates.has(normalized(result.job.status)) ||
        ['completed', 'succeeded', 'done'].includes(normalized(result.job.status)));
  }
  if (typeof result.id === 'string' && result.id.length > 0 && typeof result.state === 'string' &&
      (durableJobStates.has(normalized(result.state)) ||
        ['paused', 'cancelled', 'completed', 'succeeded', 'done'].includes(normalized(result.state)))) return true;
  return false;
}

function statusCompleted(result: unknown): boolean {
  if (!isRecord(result)) return false;
  if (typeof result.status !== 'string' || normalized(result.status) !== 'completed') return false;
  return !Array.isArray(result.items) || result.items.length > 0 && result.items.every(item =>
    isRecord(item) && typeof item.status === 'string' && normalized(item.status) === 'completed');
}

function metadataReceiptCode(
  receipt: ToolReceipt,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): boolean {
  switch (receipt) {
    case 'completed': return statusCompleted(result);
    case 'opened': return result.opened === true;
    case 'applied':
      return result.applied === true || result.type === 'generated-view' && isRecord(result.view);
    case 'workspace-manage':
      if (typeof result.id !== 'string') return false;
      if (args.action === 'delete') return result.deleted === true;
      if (result.action !== args.action) return false;
      if (args.action === 'pin') return result.pinned === true;
      if (args.action === 'unpin') return result.pinned === false;
      return args.action === 'rename' &&
        typeof args.title === 'string' && result.title === args.title;
    case 'vault-commit':
      return result.path === args.path && typeof result.commit === 'string' &&
        /^[0-9a-f]{40}$/iu.test(result.commit);
    case 'task-write':
      return typeof result.id === 'string' && typeof result.path === 'string' &&
        typeof result.line === 'number' && typeof result.text === 'string' &&
        (typeof result.commit === 'string' && /^[0-9a-f]{40}$/iu.test(result.commit) ||
          result.commit === null);
    case 'issue':
      return Number.isInteger(result.number) && Number(result.number) > 0 &&
        typeof result.url === 'string' && typeof result.taskCode === 'string';
    case 'comment':
      return result.status === 'commented' && Number.isInteger(result.number) &&
        typeof result.url === 'string';
    case 'github-write':
      return typeof result.status === 'string' &&
        ['created', 'updated', 'commented', 'reviewed', 'merged', 'ready', 'dispatched',
          'rerun_requested', 'written'].includes(normalized(result.status));
    case 'project':
      return typeof result.id === 'string' && result.id === String(args.projectId);
    case 'project-archive':
      return result.status === 'archived' && result.projectId === args.projectId;
    case 'repository':
      return result.alreadyAdded === true ||
        isRecord(result.project) && typeof result.project.id === 'string';
    case 'health-write':
      return result.created === true || result.updated === true || result.deleted === true ||
        result.saved === true || result.persisted === true || statusCompleted(result) ||
        typeof result.status === 'string' &&
          ['committed', 'already-applied', 'already-deleted'].includes(normalized(result.status));
    case 'inbox-capture':
      return typeof result.id === 'string' && typeof result.path === 'string' &&
        typeof result.created === 'boolean';
    case 'inbox-close':
      return typeof result.id === 'string' && result.closed === true;
    case 'memory-write':
      return typeof result.id === 'string' && typeof result.key === 'string' &&
        Number.isSafeInteger(result.revision);
    case 'memory-delete':
      return typeof result.id === 'string' && typeof result.key === 'string' &&
        typeof result.category === 'string';
    case 'job-cancel':
      return typeof result.cancelled === 'string';
    case 'model-deployment':
      return result.status === 'accepted' && typeof result.name === 'string';
    case 'preference-update':
      return args.operation === 'update' && result.confirmation === 'Proactive preferences saved.';
    case 'reminder-write':
      return args.operation === 'read'
        ? false
        : args.operation === 'cancel'
          ? result.cancelled === true
          : result.created === true || result.updated === true;
    case 'feedback-write':
      return result.saved === true || result.alreadyApplied === true ||
        result.applied === true || result.updated === true;
    case 'watch-create':
      return result.created === true;
    case 'watch-change':
      return result.updated === true || result.stopped === true;
    case 'pc-close':
      return result.closing === true && Number.isInteger(result.windows);
    case 'pc-media':
      return result.controlled === true && result.action === args.action;
    case 'clipboard-write':
      return result.written === true;
    case 'pc-browser-act':
      return result.completed === true || result.clicked === true || result.typed === true;
    case 'browser-task':
      return result.status === 'completed';
    case 'settings-write':
      return result.updated === true || result.saved === true || isPositiveResult(result);
  }
}

function committedReceipt(tool: string, args: Record<string, unknown>, result: unknown): boolean {
  if (!isRecord(result) || terminalFailure(result)) return false;
  const metadataReceipt = completionToolMetadata[tool]?.receipt;
  if (metadataReceipt) return metadataReceiptCode(metadataReceipt, args, result);
  if (segments(tool).includes('open') && result.opened === true) return true;
  switch (tool) {
    case 'pc_open': return result.opened === true;
    case 'pc_close': return result.closing === true && Number.isInteger(result.windows);
    case 'pc_media': return result.controlled === true && result.action === args.action;
    case 'pc_clipboard_write': return result.written === true;
    case 'pc_browser_act':
      return result.completed === true || result.clicked === true || result.typed === true;
    case 'workspace_command':
      return result.applied === true || result.type === 'generated-view' && isRecord(result.view);
    case 'workspaces_open':
    case 'folio_open':
      return result.opened === true && typeof result.id === 'string';
    case 'workspaces_manage':
    case 'folio_manage':
      return typeof result.id === 'string' && result.action === args.action;
    case 'browser_do':
      return result.status === 'completed';
    case 'vault_write':
    case 'vault_delete':
      return result.path === args.path && typeof result.commit === 'string' &&
        /^[0-9a-f]{40}$/iu.test(result.commit);
    case 'vault_task_create':
    case 'vault_task_complete':
    case 'vault_task_edit':
      return typeof result.id === 'string' && typeof result.path === 'string' &&
        typeof result.line === 'number' && typeof result.text === 'string' &&
        (typeof result.commit === 'string' && /^[0-9a-f]{40}$/iu.test(result.commit) ||
          result.commit === null && tool !== 'vault_task_create');
    case 'create_issue':
      return Number.isInteger(result.number) && Number(result.number) > 0 &&
        typeof result.url === 'string' && typeof result.taskCode === 'string';
    case 'issue_comment':
      return result.status === 'commented' && Number.isInteger(result.number) &&
        typeof result.url === 'string';
    case 'github_write':
      return typeof result.status === 'string' &&
        ['created', 'updated', 'commented', 'reviewed', 'merged', 'ready', 'dispatched',
          'rerun_requested', 'written'].includes(normalized(result.status));
    case 'update_project':
      return typeof result.id === 'string' && result.id === String(args.projectId) &&
        typeof result.repo === 'string';
    case 'archive_project':
      return result.status === 'archived' && typeof result.projectId === 'string';
    case 'manage_repository':
      return result.alreadyAdded === true ||
        isRecord(result.project) && typeof result.project.id === 'string';
    case 'calendar_create_event':
    case 'calendar_create_events':
    case 'calendar_update_event':
    case 'calendar_move_event':
    case 'calendar_delete_event':
    case 'mail_update_draft':
    case 'mail_delete_draft':
    case 'mail_archive':
    case 'mail_label':
    case 'mail_draft_reply':
    case 'mail_send':
      return statusCompleted(result);
    case 'owner_reminders':
      return args.operation === 'read'
        ? false
        : args.operation === 'cancel'
          ? result.cancelled === true
          : result.created === true || result.updated === true;
    case 'proactive_item_feedback':
      return result.applied === true || result.updated === true || result.saved === true ||
        result.alreadyApplied === true;
    case 'proactive_preferences':
      return args.operation === 'update' && result.confirmation === 'Proactive preferences saved.';
    case 'watch_create':
      return result.created === true;
    case 'watch_update':
    case 'watch_stop':
      return result.updated === true || result.closed === true || result.stopped === true;
    case 'inbox_capture':
      return typeof result.id === 'string' && typeof result.path === 'string' &&
        typeof result.created === 'boolean';
    case 'inbox_close':
      return typeof result.id === 'string';
    case 'memory_remember':
    case 'memory_correct':
      return typeof result.id === 'string' && typeof result.key === 'string' &&
        Number.isSafeInteger(result.revision);
    case 'memory_forget':
      return typeof result.id === 'string' && typeof result.key === 'string' &&
        typeof result.category === 'string';
    case 'cancel_job':
      return typeof result.cancelled === 'string';
    case 'manage_model_deployment':
      return result.status === 'accepted' &&
        typeof result.name === 'string' && result.name.length > 0;
  }
  if (tool.startsWith('gh_')) {
    const operation = segments(tool);
    const write = operation.some(word => actionVerbs.has(word));
    if (!write) return false;
    if (typeof result.status === 'string' &&
        ['completed', 'created', 'succeeded', 'updated', 'merged', 'sent'].includes(normalized(result.status))) return true;
    if (result.created === true || result.updated === true || result.merged === true ||
        result.opened === true || result.deleted === true || result.accepted === true) return true;
    return (typeof result.number === 'number' && Number.isSafeInteger(result.number) &&
        typeof (result.url ?? result.html_url) === 'string') ||
      (typeof result.sha === 'string' && /^[0-9a-f]{40}$/iu.test(result.sha));
  }
  if (tool.startsWith('az_')) {
    const write = segments(tool).some(word => actionVerbs.has(word));
    if (!write) return false;
    const state = typeof result.status === 'string' ? result.status
      : typeof result.provisioningState === 'string' ? result.provisioningState : '';
    return ['completed', 'created', 'succeeded', 'updated', 'deleted'].includes(normalized(state)) &&
      (typeof result.id === 'string' || isPositiveResult(result));
  }
  if (tool.startsWith('health_') || tool.startsWith('gym_')) {
    return result.created === true || result.updated === true || result.deleted === true ||
      result.saved === true || result.persisted === true || statusCompleted(result) ||
      (typeof result.status === 'string' &&
        ['committed', 'already-applied', 'already-deleted'].includes(normalized(result.status)));
  }
  if (tool === 'set_theme' || tool === 'set_presence_mode' || tool === 'set_away_mode' ||
      tool === 'update_settings' || tool === 'renew_credential' || tool === 'set_jarvis_model') {
    return result.updated === true || result.saved === true || isPositiveResult(result) &&
      !terminalFailure(result);
  }
  return false;
}

function idConsistent(args: Record<string, unknown>, result: Record<string, unknown>): boolean {
  const pairs: readonly [readonly string[], readonly string[]][] = [
    [['id'], ['id']],
    [['issue', 'issueNumber', 'issue_number', 'number'], ['number', 'issueNumber', 'issue_number', 'issue']],
    [['taskId', 'task_id'], ['taskId', 'task_id', 'id']],
    [['jobId', 'job_id'], ['jobId', 'job_id', 'id']],
    [['eventId', 'event_id'], ['id', 'eventId', 'event_id']],
    [['itemId', 'item_id'], ['itemId', 'item_id', 'id']],
    [['projectId', 'project_id'], ['projectId', 'project_id']],
    [['path'], ['path']],
    [['repository', 'repo'], ['repository', 'repo']],
    [['commandId', 'command_id'], ['commandId', 'command_id']],
    [['viewId', 'view_id'], ['viewId', 'view_id']],
  ];
  const nestedValue = (value: unknown, keys: readonly string[], depth = 0): unknown => {
    if (depth > 4) return undefined;
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
      if (typeof found === 'string' || typeof found === 'number') return found;
    }
    for (const child of Object.values(value)) {
      const found = nestedValue(child, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const [argumentKeys, resultKeys] of pairs) {
    const argument = argumentKeys.map(key => args[key]).find(value => typeof value === 'string' || typeof value === 'number');
    const receipt = nestedValue(result, resultKeys);
    if (argument !== undefined && receipt !== undefined && normalized(String(argument)) !== normalized(String(receipt))) {
      return false;
    }
  }
  if (isRecord(result.task) && args.taskId !== undefined &&
      normalized(String(args.taskId)) !== normalized(String(result.task.id ?? ''))) return false;
  return true;
}

function receiptKind(
  tool: Pick<RegisteredTool, 'name' | 'execution'>,
  args: Record<string, unknown>,
  result: unknown,
): PiCompletionEvidenceKind | undefined {
  if (result === null || result === undefined) return undefined;
  const effect = toolEffect(tool, args);
  const durable = durableResult(result);
  const pendingDurable = ['research', 'retry_job'].includes(tool.name) &&
    isRecord(result) && (result.status === 'pending' || result.state === 'pending') &&
    (typeof result.jobId === 'string' || typeof result.taskId === 'string' || typeof result.runId === 'string');
  if ((effect === 'action' || ['research', 'retry_job'].includes(tool.name)) &&
      terminalFailure(result) && !pendingDurable) return undefined;
  if (durable && effect !== 'read') return 'durable_job';
  if (effect !== 'action') return isPositiveResult(result) ? 'retrieved' : undefined;
  if (committedReceipt(tool.name, args, result)) return 'committed';
  return undefined;
}

function matchesRequirement(
  requirement: PiCompletionRequirement,
  evidence: PiCompletionEvidence,
): boolean {
  const kind = requirement.kind === 'committed'
    ? evidence.kind === 'committed' || evidence.kind === 'durable_job'
    : requirement.kind === 'durable_job'
      ? evidence.kind === 'durable_job'
      : evidence.kind === 'retrieved';
  const acceptedOperations = completionToolMetadata[evidence.tool]?.acceptedRequestOperations ?? [];
  const operation = requirement.operation === 'generic' ||
    evidence.operation === requirement.operation ||
    acceptedOperations.includes(requirement.operation);
  if (!kind || !operation || evidence.domain !== requirement.domain) return false;
  return requirement.targetHashes.every(target => evidence.targetHashes.includes(target));
}

function matchesRequirementBinding(
  requirement: PiCompletionRequirement,
  evidence: PiCompletionEvidence,
): boolean {
  return evidence.domain === requirement.domain &&
    (evidence.kind === 'retrieved' || requirement.operation === 'generic' ||
      evidence.operation === requirement.operation ||
      (completionToolMetadata[evidence.tool]?.acceptedRequestOperations ?? []).includes(requirement.operation)) &&
    requirement.targetHashes.every(target => evidence.targetHashes.includes(target));
}

export function completionEvidence(
  tool: Pick<RegisteredTool, 'name' | 'execution'>,
  args: Record<string, unknown>,
  result: unknown,
): PiCompletionEvidence | undefined;
export function completionEvidence(
  plan: PiCompletionPlan,
  tool: Pick<RegisteredTool, 'name' | 'execution'>,
  args: Record<string, unknown>,
  result: unknown,
  previous?: readonly PiCompletionEvidence[],
): PiCompletionEvidence | undefined;
export function completionEvidence(
  planOrTool: PiCompletionPlan | Pick<RegisteredTool, 'name' | 'execution'>,
  toolOrArgs: Pick<RegisteredTool, 'name' | 'execution'> | Record<string, unknown>,
  argsOrResult: Record<string, unknown> | unknown,
  resultOrPrevious?: unknown,
  previousEvidence: readonly PiCompletionEvidence[] = [],
): PiCompletionEvidence | undefined {
  const hasPlan = typeof planOrTool === 'object' && planOrTool !== null && 'requirements' in planOrTool;
  const plan: PiCompletionPlan = hasPlan ? planOrTool as PiCompletionPlan : (() => {
    const tool = planOrTool as Pick<RegisteredTool, 'name' | 'execution'>;
    const args = toolOrArgs as Record<string, unknown>;
    const kind = durableResult(argsOrResult) && toolEffect(tool, args) !== 'read'
      ? 'durable_job'
      : toolEffect(tool, args) === 'action' ? 'committed' : 'retrieved';
    const domain = toolDomain(tool.name, args);
    const operation = kind === 'retrieved' ? 'read' : receiptOperation(tool, args);
    return {
      kind,
      requirements: [{ kind, domain, operation, targetHashes: [] }],
    } as PiCompletionPlan;
  })();
  const tool = hasPlan
    ? toolOrArgs as Pick<RegisteredTool, 'name' | 'execution'>
    : planOrTool as Pick<RegisteredTool, 'name' | 'execution'>;
  const args = hasPlan ? argsOrResult as Record<string, unknown> : toolOrArgs as Record<string, unknown>;
  const result = hasPlan ? resultOrPrevious : argsOrResult;
  const previous = previousEvidence;
  const kind = receiptKind(tool, args, result);
  if (!kind || isRecord(result) && !idConsistent(args, result)) return undefined;
  const domain = toolDomain(tool.name, args);
  const currentIdentities = [...bindingIdentities(args), ...bindingIdentities(result)];
  const identityHashes = targetHashes(currentIdentities);
  const linkedBindings = previous.flatMap(candidate =>
    candidate.kind !== 'retrieved' || candidate.domain !== domain
      ? []
      : candidate.identityTargets
        .filter(binding => identityHashes.includes(binding.identityHash))
        .map(binding => ({ candidate, binding })));
  const linkedTargets = linkedBindings.flatMap(({ binding }) => binding.targetHashes);
  const runtimeTargets = plan.runtimeTargetHashes ?? [];
  const trustedLinkedContext = linkedBindings.some(({ candidate, binding }) =>
    candidate.identityTargets.length === 1 ||
    runtimeTargets.length > 0 && runtimeTargets.every(target => binding.targetHashes.includes(target)));
  const directTargets = identityTargets(tool.name, args, false);
  const resultTargets = identityTargets(tool.name, result, true);
  const evidenceTargets = [...new Set([
    ...targetHashes([...toolTargetTokens(tool.name, args, result)]),
    ...linkedTargets,
  ])];
  const evidence = {
    tool: tool.name,
    kind,
    domain,
    operation: kind === 'retrieved' ? 'read' : receiptOperation(tool, args),
    argumentsHash: hash(canonical(args)),
    targetHashes: evidenceTargets,
    identityHashes,
    identityTargets: [...directTargets, ...resultTargets],
  } satisfies PiCompletionEvidence;
  if (plan.kind === 'conversation') {
    const operationMatches = plan.runtimeOperation === undefined ||
      plan.runtimeOperation === 'generic' ||
      evidence.operation === plan.runtimeOperation;
    if (kind !== 'retrieved' && !operationMatches) return undefined;
    const trustedTarget = kind === 'retrieved' ||
      trustedLinkedContext ||
      !plan.contextual &&
        (plan.runtimeTargetHashes ?? []).length > 0 &&
        (plan.runtimeTargetHashes ?? []).every(target => evidence.targetHashes.includes(target));
    return !trustedTarget ? undefined : evidence;
  }
  if (plan.requiresTrustedContext && kind !== 'retrieved' && !trustedLinkedContext) {
    return undefined;
  }
  return plan.requirements.some(requirement => matchesRequirementBinding(requirement, evidence)) ? evidence : undefined;
}

export function missingCompletionEvidence(
  plan: PiCompletionPlan,
  grant: Pick<PiTurnGrant, 'evidence'>,
): PiCompletionRequirement | undefined;
export function missingCompletionEvidence(
  kind: PiCompletionKind,
  grant: Pick<PiTurnGrant, 'evidence'>,
): PiCompletionKind | undefined;
export function missingCompletionEvidence(
  planOrKind: PiCompletionPlan | PiCompletionKind,
  grant: Pick<PiTurnGrant, 'evidence'>,
): PiCompletionRequirement | PiCompletionKind | undefined {
  if (typeof planOrKind === 'string') {
    if (planOrKind === 'conversation') return undefined;
    const satisfied = grant.evidence.some(evidence =>
      planOrKind === 'retrieved' ? evidence.kind === 'retrieved'
        : planOrKind === 'committed' ? evidence.kind === 'committed' || evidence.kind === 'durable_job'
          : evidence.kind === 'durable_job');
    return satisfied ? undefined : planOrKind;
  }
  const plan = planOrKind;
  if (plan.kind === 'conversation') return undefined;
  return plan.requirements.find(requirement =>
    !grant.evidence.some(evidence => matchesRequirement(requirement, evidence)));
}

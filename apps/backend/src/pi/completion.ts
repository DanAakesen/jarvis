import type { RegisteredTool } from '../core/tool-registry.js';
import type { PiTurnGrant } from './turns.js';

export type PiCompletionRequirement = 'conversation' | 'retrieved' | 'committed' | 'durable_job';
export type PiCompletionEvidenceKind = 'retrieved' | 'committed' | 'durable_job';

export interface PiCompletionEvidence {
  readonly tool: string;
  readonly kind: PiCompletionEvidenceKind;
}

const readVerbs = new Set(['check', 'find', 'get', 'list', 'lookup', 'read', 'search', 'show', 'status', 'view', 'query', 'download']);
const actionVerbs = new Set([
  'add', 'archive', 'assign', 'cancel', 'close', 'comment', 'complete', 'create', 'delete', 'deploy', 'dispatch', 'edit',
  'log', 'merge', 'move', 'open', 'pause', 'pin', 'publish', 'record', 'remember', 'remove', 'renew', 'reply', 'resume',
  'reopen', 'retry', 'save', 'schedule', 'send', 'set', 'start', 'stop', 'trigger', 'unassign', 'update', 'write',
]);

function segments(name: string): string[] {
  return name.toLocaleLowerCase('en-US').split(/[_-]+/u);
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
  const operation = typeof args.operation === 'string' ? args.operation.toLocaleLowerCase('en-US') : '';
  const operationWords = segments(operation);
  if (operationWords.some(word => actionVerbs.has(word))) return 'action';
  if (readVerbs.has(operation)) return 'read';
  const words = segments(tool.name);
  if (words.some(word => actionVerbs.has(word))) return 'action';
  if (words.some(word => readVerbs.has(word))) return 'read';
  return 'unclassified';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recursivelyHas(value: unknown, keys: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 4) return false;
  if (Array.isArray(value)) return value.some(item => recursivelyHas(item, keys, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    keys.has(key.toLocaleLowerCase('en-US')) && child !== undefined && child !== null ||
    recursivelyHas(child, keys, depth + 1));
}

const jobKeys = new Set(['jobid', 'taskid', 'runid']);
const receiptKeys = new Set([
  'accepted', 'cancelled', 'commit', 'completed', 'confirmation', 'created', 'deleted', 'id', 'messageid', 'number',
  'scheduled', 'sha', 'state', 'status', 'task', 'updated', 'url',
]);

function recursivelyHasDurableHandle(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (Array.isArray(value)) return value.some(item => recursivelyHasDurableHandle(item, depth + 1));
  if (!isRecord(value)) return false;
  const task = value.task;
  if (isRecord(task) && typeof task.id === 'string' && task.id.length > 0 &&
      (typeof task.state === 'string' || typeof task.status === 'string')) return true;
  return Object.values(value).some(child => recursivelyHasDurableHandle(child, depth + 1));
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return true;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return typeof value === 'string' ? value.trim().length > 0 : true;
}

export function completionEvidence(
  tool: Pick<RegisteredTool, 'name' | 'execution'>,
  args: Record<string, unknown>,
  result: unknown,
): PiCompletionEvidence | undefined {
  if (!meaningful(result)) return undefined;
  const effect = toolEffect(tool, args);
  const actionJob = effect !== 'read' &&
    (recursivelyHas(result, jobKeys) || recursivelyHasDurableHandle(result) ||
      (/(?:^|[_-])(?:task|job|run)(?:[_-]|$)/u.test(tool.name) &&
        isRecord(result) && typeof result.id === 'string' && result.id.length > 0 &&
        (typeof result.state === 'string' || typeof result.status === 'string')));
  if (actionJob) {
    return { tool: tool.name, kind: 'durable_job' };
  }
  if (effect === 'action') {
    return recursivelyHas(result, receiptKeys) || typeof result !== 'object'
      ? { tool: tool.name, kind: 'committed' }
      : undefined;
  }
  return { tool: tool.name, kind: 'retrieved' };
}

function normalized(text: string): string {
  return text.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

export function completionRequirement(text: string): PiCompletionRequirement {
  const value = normalized(text);
  if (!value) return 'conversation';
  if (/\b(?:do not reply|don't reply|stay quiet|be quiet|say nothing|ti stille|svar ikke|sig ingenting)\b/iu.test(value)) {
    return 'conversation';
  }
  if (/^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?:tell|show|write|draft|compose|make|create)\b/iu.test(value) &&
      /\b(?:joke|poem|story|haiku|essay|summary|explanation|plan|digt|historie|vittighed|forklaring|sammendrag)\b/iu.test(value) &&
      !/\b(?:calendar|mail|note|task|issue|repository|file|kalender|mail|note|opgave)\b/iu.test(value)) {
    return 'conversation';
  }
  if (/^(?:what is|what's|hvad er)\s+(?:a|an|the definition of|definitionen på|et|en)\b|^(?:explain|teach me|how do i|how to|forklar)\b/iu.test(value)) {
    return 'conversation';
  }
  if (/\b(?:implement|fix (?:the|this|a)?\s*(?:bug|code|repo)|build (?:the|this|a)?\s*(?:feature|app|site|change)|research|investigate|review and fix|keep working|in the background)\b|(?:implementer|ret koden|undersøg|undersoeg|arbejd videre|i baggrunden)/iu.test(value)) {
    return 'durable_job';
  }
  if (/^(?:(?:please|can you|could you|would you|will you|vil du|kan du)\s+)?(?:add|archive|assign|cancel|change|close|comment|complete|create|delete|deploy|dispatch|edit|log|make|merge|move|open|pause|pin|publish|record|remember|remove|renew|reply|resume|reopen|retry|save|schedule|send|set|start|stop|trigger|unassign|update|write)\b|\b(?:then|and|og|derefter)\s+(?:add|archive|assign|cancel|change|close|comment|complete|create|delete|deploy|dispatch|edit|log|make|merge|move|open|pause|pin|publish|record|remember|remove|renew|reply|resume|reopen|retry|save|schedule|send|set|start|stop|trigger|unassign|update|write)\b|\b(?:tilføj|tilfoej|arkiver|aflys|luk|log|husk|opret|slet|fjern|rediger|gem|planlæg|planlaeg|send|start|stop|pause|genoptag|opdater|flyt|publicer)\b/iu.test(value)) {
    return 'committed';
  }
  const domain = /\b(?:calendar|calendar events|mail|email|inbox|note|notes|task|tasks|todo|weather|health|gym|memory|github|repository|issue|pull request|workflow|azure|resource|resources|subscription|meeting|meetings|status)\b|(?:kalender|aftale|aftaler|møde|møder|mail|indbakke|noter|opgave|opgaver|vejr|sundhed|træning|hukommelse|github|lager|issue|arbejdsgang|azure|ressource|ressourcer|status)\b/iu;
  const readCue = /\b(?:check|current|find|inspect|latest|list|look up|look at|read|search|show me|today|tomorrow|now|what|what's|when|do i have|how is|how's)\b|(?:aktuel|seneste|i dag|i morgen|hvad|hvilke|vis mig|tjek|læs|søg|find|har jeg|hvordan er)\b/iu;
  const bareDomain = /^(?:(?:my|mine)\s+)?(?:calendar|mail|email|inbox|notes?|tasks?|todos?|weather|health|gym|memory|github|issues?|pull requests?|workflows?|azure|resources?|status|kalender|mail|noter|opgaver?|vejr|sundhed|træning|github|issues?|arbejdsgang|azure|ressourcer|status)[.!?]?$/iu;
  const directLookup = /^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?:check|find|inspect|list|look|read|search|show|tjek|læs|søg|find|vis)\b/iu;
  if (directLookup.test(value) || (domain.test(value) && readCue.test(value)) || bareDomain.test(value)) {
    return 'retrieved';
  }
  return 'conversation';
}

export function missingCompletionEvidence(
  requirement: PiCompletionRequirement,
  grant: PiTurnGrant,
): PiCompletionRequirement | undefined {
  if (requirement === 'conversation') return undefined;
  const evidence = grant.evidence;
  if (requirement === 'retrieved' &&
      evidence.some(entry => entry.kind === 'retrieved' || entry.kind === 'committed' || entry.kind === 'durable_job')) return undefined;
  if (requirement === 'committed' &&
      evidence.some(entry => entry.kind === 'committed' || entry.kind === 'durable_job')) return undefined;
  if (requirement === 'durable_job' && evidence.some(entry => entry.kind === 'durable_job')) return undefined;
  return requirement;
}

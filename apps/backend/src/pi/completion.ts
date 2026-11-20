import { createHash } from 'node:crypto';
import type {
  CompiledToolExecutionContract,
  RegisteredTool,
  ToolCompletionContract,
  ToolCompletionDomain,
  ToolCompletionOperation,
} from '../core/tool-registry.js';
import {
  durableTerminal, isPositiveResult, normalizeCompletionText as normalized, semanticOperation,
} from '../core/tool-completion.js';
import type { PiTurnGrant } from './turns.js';

export type PiCompletionKind = 'conversation' | 'retrieved' | 'committed' | 'durable_job';
export type PiCompletionEvidenceKind = Exclude<PiCompletionKind, 'conversation'>;
export type PiCompletionOperation = ToolCompletionOperation;
export type PiCompletionDomain = ToolCompletionDomain;

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
  readonly executionId: string;
  readonly tool: string;
  readonly kind: PiCompletionEvidenceKind;
  readonly domain: PiCompletionDomain;
  readonly operation: PiCompletionOperation;
  readonly acceptedRequestOperations?: readonly PiCompletionOperation[] | undefined;
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
const maxBindingTextCharacters = 20_000;

function withoutCourtesyPrefix(value: string): string {
  const prefixes = [
    /^please[,:]?\s+/u,
    /^(?:could|can|would|will)\s+you(?:\s+please)?[,:]?\s+/u,
    /^(?:kan|kunne|vil)\s+du(?:\s+venligst)?[,:]?\s+/u,
    /^venligst[,:]?\s+/u,
  ];
  let result = value;
  for (const prefix of prefixes) result = result.replace(prefix, '');
  return result.trim();
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
  tool: CompletionTool,
  args: Record<string, unknown>,
): 'read' | 'action' | 'unclassified' {
  const completion = tool.completion;
  if (completion) {
    const operation = typeof completion.operation === 'function'
      ? completion.operation(args)
      : completion.operation;
    return operation === 'read' ? 'read' : 'action';
  }
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
  return semanticOperation(value);
}

function receiptOperation(
  tool: CompletionTool,
  args: Record<string, unknown>,
): PiCompletionOperation {
  const metadata = tool.completion;
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

type CompletionTool = Pick<RegisteredTool, 'name' | 'execution'> & {
  readonly completion?: ToolCompletionContract | CompiledToolExecutionContract | undefined;
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
  tool: CompletionTool,
  args: Record<string, unknown>,
  result: unknown,
): ReadonlySet<string> {
  const metadata = tool.completion;
  const argumentFields = metadata?.requestTargetFields ?? fallbackTargetFields;
  const resultFields = metadata?.resultTargetFields ?? fallbackTargetFields;
  const output = new Set<string>();
  for (const value of collectFieldValues(args, argumentFields)) bindingTokens(value, 0, output);
  for (const value of collectFieldValues(result, resultFields)) bindingTokens(value, 0, output);
  return output;
}

function rowTargetTokens(
  tool: CompletionTool,
  row: Record<string, unknown>,
  result: boolean,
): ReadonlySet<string> {
  const metadata = tool.completion;
  const fields = result
    ? metadata?.resultTargetFields ?? fallbackTargetFields
    : metadata?.requestTargetFields ?? fallbackTargetFields;
  const output = new Set<string>();
  for (const value of collectFieldValues(row, fields)) bindingTokens(value, 0, output);
  return output;
}

const domainPatterns: readonly [PiCompletionDomain, RegExp][] = [
  ['calendar', /\b(?:calendar|agenda|appointment|meeting|meetings|kalender(?:en|e|ne)?|kalenderaftale(?:n|r|rne)?|aftale(?:n|r|rne)?|møde(?:t|r|rne)?)\b/iu],
  ['mail', /\b(?:e-?mail(?:en|s)?|emails?|gmail|inbox|draft|drafts|indbakke|epost|kladde|kladder)\b/iu],
  ['weather', /\b(?:weather|forecast|temperature|rain|storm|vejr|prognose|temperatur|regn)\b/iu],
  ['notes', /\b(?:note|notes|vault|inbox|loose thought|idea|notat|noter|indbakke|ide|idé)\b/iu],
  ['tasks', /\b(?:task|tasks|to-?do|reminder|reminders|opgave|opgaver|pamindelse|pamindelser)\b/iu],
  ['health', /\b(?:health|nutrition|food|meal|gym|training|workout|sundhed|ernæring|mad|træning)\b/iu],
  ['memory', /\b(?:memory|remember|conversation history|hukommelse|husk)\b/iu],
  ['github', /\b(?:github|pull request|pull requests|repository|repositories|workflow|workflows|code search|kode|lager|arbejdsgang)\b/iu],
  ['azure', /\b(?:azure|subscription|resource group|resources?|abonnement|ressourcegruppe|ressourcer)\b/iu],
  ['web', /\b(?:web|research|internet|public web|hotel|flight|restaurant|booking|reservation|table|ticket|room|stay|news|stock|price|prices|offentlige? net|nettet|fly|hotel|restaurantbord|billet|pris|priser|nyheder|forskning)\b/iu],
  ['factory', /\b(?:issue|issues|software factory|worker|workers|factory task|my code|your code|repo bug|min kode)\b/iu],
  ['pc', /\b(?:my pc|on my pc|windows|chrome|spotify|computer|clipboard|min pc|computeren)\b/iu],
  ['workspace', /\b(?:workspace|screen|window|view|panel|arbejdsomrade|arbejdsområde|skærm|vindue|visning)\b/iu],
  ['jobs', /\b(?:job|jobs|watch|watches|deploy|deployment|background task|background work|baggrundsjob|lang opgave|overvågning)\b/iu],
  ['settings', /\b(?:setting|settings|preference|preferences|mode|theme|credential|credentials|login|finding|findings|suggestion|suggestions|indstilling|indstillinger|præference|tema|forslag)\b/iu],
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
  'explain', 'for', 'from', 'get', 'give', 'got', 'has', 'have', 'hello', 'her', 'him', 'how', 'i', 'in', 'is', 'it',
  'its', 'latest', 'me', 'my', 'new', 'next', 'of', 'on', 'or', 'our', 'please', 'right', 'so', 'some',
  'that', 'the', 'their', 'them', 'then', 'there', 'this', 'to', 'today', 'tomorrow', 'was', 'we', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'yesterday', 'current', 'now', 'pm',
  'jeg', 'mig', 'min', 'mine', 'mit', 'du', 'dit', 'din', 'kan', 'vil', 'skal', 'det', 'den', 'de', 'der',
  'og', 'eller', 'på', 'til', 'fra', 'med', 'for', 'som', 'i', 'en', 'et', 'dag', 'idag', 'morgen', 'nu',
  'ny', 'nye', 'næste', 'seneste', 'aktuel', 'aktuelle', 'venligst', 'hvad', 'hvilke', 'hvor', 'hvornår',
  'hvem', 'hvorfor', 'hvordan', 'kl', 'har', 'er', 'var', 'blev',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag',
  'januar', 'februar', 'marts', 'maj', 'juni', 'juli', 'august', 'oktober', 'november', 'december',
  'add', 'archive', 'book', 'cancel', 'capture', 'close', 'comment', 'complete', 'create', 'delete', 'dispatch', 'edit',
  'implement', 'inspect', 'keep', 'list', 'log', 'make', 'move', 'open', 'pause', 'publish', 'read', 'record', 'remember',
  'remove', 'reply', 'save', 'schedule', 'search', 'send', 'set', 'show', 'start', 'stop', 'update', 'write',
  'merge', 'approve', 'review', 'forward',
  'click', 'type', 'select', 'pin', 'unpin', 'rename', 'dispatch', 'deploy', 'trigger', 'scale', 'restart',
  'find', 'check', 'fix', 'research', 'look', 'up', 'tjek', 'læs', 'læse', 'læst', 'søg', 'se', 'vis',
  'fortæl', 'fortælle', 'fortalt', 'sendt', 'sagt', 'opret', 'slet', 'gem', 'rediger', 'start',
  'calendar', 'agenda', 'appointment', 'meeting', 'event', 'email', 'gmail', 'inbox', 'mail', 'weather', 'forecast',
  'note', 'notes', 'task', 'tasks', 'todo', 'reminder', 'reminders', 'azure', 'github', 'repository', 'repositories',
  'issue', 'issues', 'pull', 'workflow', 'workflows', 'workspace', 'screen', 'window', 'panel', 'job', 'jobs',
  'resource', 'resources', 'subscription', 'group', 'provider', 'temperature', 'rain', 'credential',
  'credentials', 'login',
  'table', 'ticket', 'room', 'stay', 'reservation', 'hotel', 'flight', 'restaurant',
  'pc', 'computer', 'app', 'application', 'item', 'report', 'saved', 'repo', 'code', 'jarvis', 'about',
  'invitation', 'request', 'change', 'thing', 'this', 'that', 'please', 'deal', 'draft', 'updated', 'teach',
  'saying', 'says', 'tell', 'telling', 'called', 'named',
  'worker', 'workers', 'background', 'long-running', 'watch', 'watches', 'deploy', 'deployment', 'overvågning',
  'down', 'up', 'slow', 'offline', 'online', 'outage', 'unavailable', 'available', 'healthy', 'unhealthy',
  'working', 'broken', 'failed', 'failing', 'failure', 'changed', 'missing', 'stopped', 'pending', 'stale',
  'nede', 'oppe', 'nedbrud', 'utilgængelig', 'tilgængelig', 'virker', 'fejler', 'fejlet', 'fejl', 'ændret',
  'mangler', 'stoppet', 'afventer', 'forældet',
  'kalender', 'kalenderen', 'kalenderaften', 'kalenderaftalen', 'aftale', 'aftalen', 'aftaler', 'møde',
  'mødet', 'møder', 'indbakke', 'epost', 'e-mailen', 'vejr', 'noter', 'notat', 'opgave',
  'opgaver', 'pamindelse', 'pamindelser', 'ressource', 'ressourcer', 'lager', 'arbejdsgang', 'skærm',
  'pa', 'på', 'abn', 'åbn', 'abne', 'åbne',
].map(normalized));

function targetTerms(text: string): { readonly term: string; readonly at: number }[] {
  const terms: { readonly term: string; readonly at: number }[] = [];
  const readCueTerm = /^(?:(?:[\p{L}\p{N}]+-)?status(?:en|er|et|erne)?|star|stå|stået|viser|vise|viste|vist|forklar|forklare|forklarer|forklaret|fortæl|fortælle|fortæller|fortalt)$/iu;
  const quoted = /["“”'‘’]([^"“”'‘’]{1,300})["“”'‘’]/gu;
  for (const match of text.matchAll(quoted)) {
    const value = targetTerm(match[1] ?? '');
    if (value && !readCueTerm.test(value)) terms.push({ term: value, at: match.index ?? 0 });
  }
  const wordPattern = /[\p{L}\p{N}]+(?:[._/@:-][\p{L}\p{N}-]+)*/gu;
  for (const match of text.matchAll(wordPattern)) {
    const value = targetTerm(match[0]);
    if (!value || ignoredTargetWords.has(value) ||
        readCueTerm.test(value) ||
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
  tool: CompletionTool,
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
      const targets = targetHashes([...rowTargetTokens(tool, child, result)]);
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

function toolDomain(tool: CompletionTool, args: Record<string, unknown>): PiCompletionDomain {
  const name = tool.name;
  const metadata = tool.completion;
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
    tasks: /\b(?:add|complete|create|delete|edit|finish|log|reopen|reschedule|remember|tilføj|opret|slet|færdiggør|gem|husk)\b[^\n.!?]{0,60}\b(?:task|todo|reminder|opgave|pamindelse)\b/iu,
    health: /\b(?:log|record|save|complete|slet|log|gem)\b[^\n.!?]{0,60}\b(?:meal|food|health|gym|workout|training|mad|træning|sundhed)\b/iu,
    memory: /\b(?:remember|save|forget|delete|husk|gem|slet)\b[^\n.!?]{0,60}\b(?:memory|fact|hukommelse)\b/iu,
    github: /\b(?:create|close|reopen|comment|merge|approve|label|update|dispatch|opret|luk|kommenter|sammenføj|opdater|kør)\b[^\n.!?]{0,80}\b(?:github|issue|pull request|repository|workflow|kode|arbejdsgang)\b/iu,
    azure: /\b(?:create|delete|deploy|restart|start|stop|update|scale|opret|slet|start|stop|opdater)\b[^\n.!?]{0,80}\b(?:azure|resource|subscription|ressource)\b/iu,
    web: /\b(?:book|reserve|buy|order|purchase|reserve|bestil|køb|book)\b/iu,
    factory: /\b(?:implement|fix|build|review and fix|start work|start issue|create an issue|start en opgave|implementer|ret koden)\b/iu,
    pc: /\b(?:open|close|play|pause|click|type|copy|paste|launch|abn|abne|luk|klik|afspil)\b[^\n.!?]{0,50}\b(?:pc|computer|chrome|spotify|window|clipboard|app|musik)\b/iu,
    workspace: /\b(?:open|show|close|minimise|minimize|focus|move|resize|pin|unpin|abn|abne|vis|luk|flyt|fokuser)\b[^\n.!?]{0,60}\b(?:workspace|screen|window|view|panel|skærm|vindue|visning)\b/iu,
    jobs: /\b(?:start|run|retry|cancel|pause|resume|research|create|keep|watch|undersøg|start|genoptag|aflys|overvåg|opret)\b[^\n.!?]{0,60}\b(?:job|watch|deploy|deployment|background|research|baggrund|overvågning)\b/iu,
    settings: /\b(?:change|set|enable|disable|turn on|turn off|update|dismiss|snooze|rate|issue|revoke|skift|sæt|aktiver|deaktiver|afvis|udsæt)\b[^\n.!?]{0,60}\b(?:setting|preference|mode|theme|credential|login|finding|suggestion|indstilling|tilstand|tema|forslag)\b/iu,
    generic: /$^/u,
  };
  return [...new Set(matches.map(({ domain }) => domain).filter(domain => actionPatterns[domain].test(text)))];
}

function externalLiveStateQuestion(text: string): boolean {
  return domainMatches(text).length > 0 &&
    /\b(?:down|up|slow|offline|online|outage|unavailable|available|healthy|unhealthy|working|broken|failed|failing|failure|status|changed|missing|stopped|pending|stale|nede|oppe|offline|online|nedbrud|utilgængelig|tilgængelig|virker|fejler|fejlet|fejl|ændret|mangler|stoppet|afventer|forældet)\b/iu.test(text);
}

function ordinaryConversation(text: string): boolean {
  if (!text) return true;
  if (/^(?:hi|hello|hej|hey)(?:[,! ]+\s*(?:how are you|how's it going|how are things))?[.!?]*$/iu.test(text) ||
      /^(?:thanks|thank you|tak|good morning|godmorgen|good evening|god aften)[.! ]*$/iu.test(text)) return true;
  if (/^(?:tell|show|write|draft|compose|make|create)\b/iu.test(text) &&
      /\b(?:joke|poem|story|haiku|essay|opinion|vittighed|digt|historie|historier|mening)\b/iu.test(text)) return true;
  if (/^(?:what (?:is|are)|what's|hvad er)\s+(?:an?|the definition of|definitionen på|et|en)\b/iu.test(text)) return true;
  if (/^(?:what is|what's|hvad er)\s+(?:email|mail|github|azure|weather|a weather forecast|health|a meeting|an issue)[.!?]*$/iu.test(text)) return true;
  if (/^(?:explain|teach me|how does|how do|why|forklar|hvorfor)\b/iu.test(text) &&
      !externalLiveStateQuestion(text) &&
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

function readIntent(value: string): boolean {
  return /^(?:what|what's|when|where|who|which|why|how is|how's|show me|list|find|search|check|read|look up|look at|look for|do i have|hvad|hvilke|hvor|hvornår|hvem|hvorfor|vis mig|læs|læse|se|fortæl|fortælle|søg|tjek|har jeg|har du|er|var|blev)\b/iu.test(value) ||
    /^(?:latest|current|today|tomorrow|give me|tell me|summarise|summarize|recall)\b/iu.test(value) ||
    /^(?:how many|how much|is|are|was|were|did|does|has|have|had|do (?:i|you|we|they|he|she|it)|can (?:i|we|you)|kan jeg|må jeg)\b/iu.test(value);
}

export function completionPlan(text: string): PiCompletionPlan {
  const value = withoutCourtesyPrefix(normalized(text));
  const contextual = /\b(?:it|itself|that|that one|this|this one|den|det|den der)\b/iu.test(value);
  const readCued = readIntent(value) || externalLiveStateQuestion(value);
  const runtimeTargetHashes = targetHashes(targetTerms(value).map(({ term }) => term));
  const runtimeOperation = readCued ? 'read' : operationFamily(value);
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
    !(domain === 'settings' && hasDomain('memory') && /\bremember\b/iu.test(value)) &&
    !((domain === 'notes' || domain === 'mail' || domain === 'factory') &&
      hasDomain('settings') && /\bcredential|credentials|login\b/iu.test(value)));
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
  const directRequest = /^(?:please|can you|could you|would you|will you|I need you to|I want you to|vil du|kan du|please)\b/iu.test(value);
  const imperative = /^(?:add|archive|book|cancel|capture|change|close|comment|complete|create|delete|deploy|dispatch|edit|email|fix|issue|log|make|move|open|pause|publish|remember|remove|reply|resume|retry|save|schedule|send|set|start|stop|update|write)\b/iu.test(value);
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
      ...(contextual ? { contextual: true } : {}),
      ...(requirements.some(requirement => requirement.kind === 'committed' &&
        requirement.targetHashes.length === 0 && requirement.operation !== 'create') ||
        contextual ? { requiresTrustedContext: true } : {}),
    };
  }

  const requirements = domains.map<PiCompletionRequirement>(domain => ({
    kind: 'retrieved',
    domain,
    operation: 'read',
    targetHashes: assignedTargetHashes(value, domain, selectedMatches),
  }));
  return {
    kind: 'retrieved',
    requirements,
    ...(contextual ? { contextual: true, requiresTrustedContext: true } : {}),
  };
}

export function completionRequirement(text: string): PiCompletionKind {
  return completionPlan(text).kind;
}

function committedReceipt(tool: CompletionTool, args: Record<string, unknown>, result: unknown): boolean {
  return tool.completion?.evaluate(args, result) === true;
}

export function completionDispatchAllowed(
  plan: PiCompletionPlan,
  tool: CompletionTool,
  args: Record<string, unknown>,
  previous: readonly PiCompletionEvidence[],
): boolean {
  if (toolEffect(tool, args) !== 'action') return true;
  const operation = receiptOperation(tool, args);
  const domain = toolDomain(tool, args);
  const identities = targetHashes([...bindingIdentities(args)]);
  const linked = previous.flatMap(candidate =>
    candidate.kind !== 'retrieved' || candidate.domain !== domain
      ? []
      : candidate.identityTargets
        .filter(binding => identities.includes(binding.identityHash))
        .map(binding => ({ candidate, binding })));
  const runtimeTargets = plan.runtimeTargetHashes ?? [];
  const trustedLinkedContext = linked.some(({ candidate, binding }) =>
    candidate.identityTargets.length === 1 ||
    runtimeTargets.length > 0 && runtimeTargets.every(target => binding.targetHashes.includes(target)));
  const linkedTargets = linked.flatMap(({ binding }) => binding.targetHashes);
  const requestTargets = targetHashes([...toolTargetTokens(tool, args, undefined)]);
  const targetSet = [...new Set([...requestTargets, ...linkedTargets])];
  const matchesOperation = (requirement: PiCompletionRequirement) =>
    requirement.operation === 'generic' ||
    requirement.operation === operation ||
    (tool.completion?.acceptedRequestOperations ?? []).includes(requirement.operation);
  if (plan.kind === 'conversation') {
    const operationMatches = plan.runtimeOperation !== undefined &&
      (plan.runtimeOperation === 'generic' || plan.runtimeOperation === operation);
    if (!operationMatches) return false;
    if (plan.contextual || plan.requiresTrustedContext) return trustedLinkedContext;
    return runtimeTargets.every(target => targetSet.includes(target));
  }
  return plan.requirements.some(requirement =>
    (requirement.kind === 'committed' || requirement.kind === 'durable_job') &&
    requirement.domain === domain &&
    matchesOperation(requirement) &&
    requirement.targetHashes.every(target => targetSet.includes(target)) &&
    (!plan.requiresTrustedContext || trustedLinkedContext));
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
  tool: CompletionTool,
  args: Record<string, unknown>,
  result: unknown,
): PiCompletionEvidenceKind | undefined {
  if (result === null || result === undefined) return undefined;
  const effect = toolEffect(tool, args);
  if (effect !== 'action') return isPositiveResult(result) ? 'retrieved' : undefined;
  if (committedReceipt(tool, args, result)) return durableTerminal(result) ? 'durable_job' : 'committed';
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
  const acceptedOperations = evidence.acceptedRequestOperations ?? [];
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
      (evidence.acceptedRequestOperations ?? []).includes(requirement.operation)) &&
    requirement.targetHashes.every(target => evidence.targetHashes.includes(target));
}

export function completionEvidence(
  tool: CompletionTool,
  args: Record<string, unknown>,
  result: unknown,
): PiCompletionEvidence | undefined;
export function completionEvidence(
  plan: PiCompletionPlan,
  tool: CompletionTool,
  args: Record<string, unknown>,
  result: unknown,
  previous?: readonly PiCompletionEvidence[],
): PiCompletionEvidence | undefined;
export function completionEvidence(
  planOrTool: PiCompletionPlan | CompletionTool,
  toolOrArgs: CompletionTool | Record<string, unknown>,
  argsOrResult: Record<string, unknown> | unknown,
  resultOrPrevious?: unknown,
  previousEvidence: readonly PiCompletionEvidence[] = [],
): PiCompletionEvidence | undefined {
  const hasPlan = typeof planOrTool === 'object' && planOrTool !== null && 'requirements' in planOrTool;
  const plan: PiCompletionPlan = hasPlan ? planOrTool as PiCompletionPlan : (() => {
    const tool = planOrTool as CompletionTool;
    const args = toolOrArgs as Record<string, unknown>;
    const kind = durableTerminal(argsOrResult) && toolEffect(tool, args) !== 'read'
      ? 'durable_job'
      : toolEffect(tool, args) === 'action' ? 'committed' : 'retrieved';
    const domain = toolDomain(tool, args);
    const operation = kind === 'retrieved' ? 'read' : receiptOperation(tool, args);
    return {
      kind,
      requirements: [{ kind, domain, operation, targetHashes: [] }],
    } as PiCompletionPlan;
  })();
  const tool = hasPlan
    ? toolOrArgs as CompletionTool
    : planOrTool as CompletionTool;
  const args = hasPlan ? argsOrResult as Record<string, unknown> : toolOrArgs as Record<string, unknown>;
  const result = hasPlan ? resultOrPrevious : argsOrResult;
  const previous = previousEvidence;
  const kind = receiptKind(tool, args, result);
  if (!kind || isRecord(result) && !idConsistent(args, result)) return undefined;
  const domain = toolDomain(tool, args);
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
  const directTargets = identityTargets(tool, args, false);
  const resultTargets = identityTargets(tool, result, true);
  const evidenceTargets = [...new Set([
    ...targetHashes([...toolTargetTokens(tool, args, result)]),
    ...linkedTargets,
  ])];
  const evidence = {
    executionId: tool.completion && 'executionId' in tool.completion
      ? tool.completion.executionId
      : `uncompiled:${tool.name}`,
    tool: tool.name,
    kind,
    domain,
    operation: kind === 'retrieved' ? 'read' : receiptOperation(tool, args),
    ...(tool.completion?.acceptedRequestOperations
      ? { acceptedRequestOperations: tool.completion.acceptedRequestOperations }
      : {}),
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
    const trustedTarget = plan.contextual
      ? trustedLinkedContext
      : kind === 'retrieved' ||
        (plan.runtimeTargetHashes ?? []).length > 0 &&
          (plan.runtimeTargetHashes ?? []).every(target => evidence.targetHashes.includes(target));
    return !trustedTarget ? undefined : evidence;
  }
  if (plan.requiresTrustedContext &&
      (plan.contextual || kind !== 'retrieved') && !trustedLinkedContext) {
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
  if (plan.kind === 'conversation') {
    if (!plan.contextual || plan.runtimeOperation !== 'read') return undefined;
    return grant.evidence.some(evidence => evidence.kind === 'retrieved')
      ? undefined
      : { kind: 'retrieved', domain: 'generic', operation: 'read', targetHashes: [] };
  }
  return plan.requirements.find(requirement =>
    !grant.evidence.some(evidence => matchesRequirement(requirement, evidence)));
}

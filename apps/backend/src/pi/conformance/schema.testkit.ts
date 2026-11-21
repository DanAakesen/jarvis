import type { RegisteredTool } from '../../core/tool-registry.js';

type Json = Record<string, unknown>;

/** Per-turn cost estimate used by the report: characters / 4. */
export const tokensOf = (value: unknown): number => Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4);

/**
 * Names the harness manages itself (its built-in toolset, plus the two door tools). A Jarvis tool must not reuse one: the model
 * would be told two different things for the same name. Source: the Copilot harness's built-ins as of this writing; extend the
 * list when Microsoft adds more. The `microsoft_copilot_toolset_preview` entry is disabled in our agent, but the names stay
 * reserved so enabling it later cannot create a clash.
 */
export const harnessManagedNames: ReadonlySet<string> = new Set([
  'find_tools', 'call_tool',
  'bash', 'read_bash', 'write_bash', 'stop_bash', 'list_bash', 'shell', 'run_shell_command',
  'view', 'create', 'edit', 'glob', 'grep', 'str_replace_editor', 'apply_patch', 'read_file', 'write_file',
  'web_fetch', 'web_search', 'fetch', 'ask_user', 'task', 'task_complete', 'skill', 'sql', 'report_intent',
  'read_agent', 'write_agent', 'list_agents', 'store_memory', 'fetch_copilot_cli_documentation',
]);

/** Prefixes that make `call_tool` route to a remote bridge, so a local tool starting with one could never be called. */
export const remoteToolPrefixes = ['gh_', 'az_'] as const;

const allowedKeywords = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else',
  'propertyNames', 'patternProperties', 'nullable', 'contains', 'prefixItems', 'dependencies', 'dependentRequired', 'dependentSchemas',
]);
const schemaTypes = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const knownFormats = new Set(['uuid', 'date-time', 'date', 'time', 'uri', 'url', 'email', 'hostname', 'ipv4', 'ipv6', 'int32', 'int64']);

export const limits = {
  maxDepth: 12,
  maxPropertiesPerObject: 60,
  maxEnumValues: 200,
  minDescriptionCharacters: 30,
  minDescriptionWords: 6,
  maxDescriptionCharacters: 4_000,
} as const;

const record = (value: unknown): Json | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;

/** Every property name a schema can declare, including the ones declared in conditional and combined branches. */
function declaredProperties(schema: Json, into = new Set<string>()): Set<string> {
  for (const name of Object.keys(record(schema.properties) ?? {})) into.add(name);
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    for (const branch of Array.isArray(schema[key]) ? schema[key] as unknown[] : []) { const child = record(branch); if (child) declaredProperties(child, into); }
  }
  for (const key of ['if', 'then', 'else'] as const) { const child = record(schema[key]); if (child) declaredProperties(child, into); }
  return into;
}

/** The harness-facing contract of one tool schema. Returns one sentence per violation. */
export function schemaViolations(schema: unknown): string[] {
  const found: string[] = [];
  try { JSON.stringify(schema); } catch { return ['the schema cannot be serialised (cyclic or unsupported value)']; }
  const root = record(schema);
  if (!root) return ['the schema is not an object'];
  if (root.type !== 'object') found.push('the root schema must have type "object"');
  if (Object.hasOwn(root, 'strict')) found.push('the schema declares "strict"; the harness rejects strict:true');

  /** `inherited` holds the property names declared by the enclosing object schema, which conditional branches may require. */
  function visit(node: unknown, path: string, depth: number, inherited: ReadonlySet<string>): void {
    if (typeof node === 'boolean') return;
    const schemaNode = record(node);
    if (!schemaNode) { found.push(`${path}: a schema must be an object`); return; }
    if (depth > limits.maxDepth) { found.push(`${path}: nested deeper than ${limits.maxDepth} levels`); return; }
    for (const key of Object.keys(schemaNode)) {
      if (key === '$ref' || key === '$defs' || key === 'definitions') found.push(`${path}: ${key} is not supported (schemas are sent inline, so references cannot be resolved)`);
      else if (key === '$schema') found.push(`${path}: $schema is not supported (the harness takes a bare parameters object)`);
      else if (!allowedKeywords.has(key)) found.push(`${path}: unsupported keyword "${key}"`);
    }
    const type = schemaNode.type;
    for (const entry of Array.isArray(type) ? type : type === undefined ? [] : [type]) {
      if (typeof entry !== 'string' || !schemaTypes.has(entry)) found.push(`${path}: unknown type "${String(entry)}"`);
    }
    if (schemaNode.enum !== undefined && (!Array.isArray(schemaNode.enum) || schemaNode.enum.length === 0 || schemaNode.enum.length > limits.maxEnumValues)) {
      found.push(`${path}: enum must list 1-${limits.maxEnumValues} values`);
    }
    if (typeof schemaNode.pattern === 'string') {
      try { new RegExp(schemaNode.pattern, 'u'); } catch { found.push(`${path}: the pattern is not a valid regular expression`); }
    }
    if (typeof schemaNode.format === 'string' && !knownFormats.has(schemaNode.format)) found.push(`${path}: unknown format "${schemaNode.format}"`);
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'] as const) {
      if (schemaNode[key] !== undefined && !(Number.isInteger(schemaNode[key]) && (schemaNode[key] as number) >= 0)) found.push(`${path}: ${key} must be a non-negative integer`);
    }
    if (typeof schemaNode.minLength === 'number' && typeof schemaNode.maxLength === 'number' && schemaNode.minLength > schemaNode.maxLength) {
      found.push(`${path}: minLength is larger than maxLength, so no value is valid`);
    }
    if (typeof schemaNode.minimum === 'number' && typeof schemaNode.maximum === 'number' && schemaNode.minimum > schemaNode.maximum) {
      found.push(`${path}: minimum is larger than maximum, so no value is valid`);
    }
    const properties = record(schemaNode.properties);
    if (schemaNode.properties !== undefined && !properties) found.push(`${path}: properties must be an object`);
    const scope = new Set([...inherited, ...declaredProperties(schemaNode)]);
    if (properties) {
      if (Object.keys(properties).length > limits.maxPropertiesPerObject) found.push(`${path}: more than ${limits.maxPropertiesPerObject} properties`);
      for (const [name, child] of Object.entries(properties)) visit(child, `${path}.${name}`, depth + 1, new Set());
    }
    if (schemaNode.required !== undefined) {
      if (!Array.isArray(schemaNode.required) || schemaNode.required.some((name) => typeof name !== 'string')) found.push(`${path}: required must list property names`);
      else {
        const open = schemaNode.additionalProperties === true || record(schemaNode.patternProperties) !== undefined;
        for (const name of schemaNode.required as string[]) {
          if (!scope.has(name) && !open) found.push(`${path}: "${name}" is required but not declared in properties`);
        }
      }
    }
    if (schemaNode.items !== undefined) visit(schemaNode.items, `${path}[]`, depth + 1, new Set());
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      if (schemaNode[key] === undefined) continue;
      if (!Array.isArray(schemaNode[key]) || (schemaNode[key] as unknown[]).length === 0) found.push(`${path}: ${key} must be a non-empty array`);
      else (schemaNode[key] as unknown[]).forEach((branch, index) => visit(branch, `${path}.${key}[${index}]`, depth + 1, scope));
    }
    for (const key of ['if', 'then', 'else', 'not', 'propertyNames', 'contains'] as const) {
      if (schemaNode[key] !== undefined) visit(schemaNode[key], `${path}.${key}`, depth + 1, scope);
    }
    if (record(schemaNode.additionalProperties)) visit(schemaNode.additionalProperties, `${path}.additionalProperties`, depth + 1, new Set());
  }
  visit(root, '$', 0, new Set());
  return found;
}

const cueWords = /\b(use|used|using|when|whenever|if|asks?|asked|requests?|requested|requesting|wants?|wanted|needs?|needed|before|after|only|instead|never|always|call|run|should|must)\b/iu;

/** What a model needs from a description: what the tool does, and enough words to know when to pick it. */
export function descriptionViolations(tool: Pick<RegisteredTool, 'name' | 'description'>): string[] {
  const found: string[] = [];
  const text = tool.description.trim();
  if (text.length < limits.minDescriptionCharacters) found.push(`the description has ${text.length} characters (minimum ${limits.minDescriptionCharacters})`);
  if (text.length > limits.maxDescriptionCharacters) found.push(`the description has ${text.length} characters (maximum ${limits.maxDescriptionCharacters})`);
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length < limits.minDescriptionWords) found.push(`the description has ${words.length} words (minimum ${limits.minDescriptionWords})`);
  if (text.replace(/[^a-z]/giu, '').toLowerCase() === tool.name.replace(/[^a-z]/giu, '').toLowerCase()) found.push('the description only repeats the tool name');
  if (/\b(todo|tbd|lorem ipsum|placeholder)\b/iu.test(text)) found.push('the description looks unfinished');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) found.push('the description contains control characters');
  if (!cueWords.test(text)) found.push('the description does not say when to use the tool');
  return found;
}

export function nameViolations(name: string, all: readonly string[]): string[] {
  const found: string[] = [];
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(name)) found.push('the name must be 1-64 letters, digits, "_" or "-"');
  if (name.includes('___')) found.push('the name contains "___", which the harness reserves');
  if (harnessManagedNames.has(name.toLowerCase())) found.push('the name clashes with a harness-managed tool');
  if (remoteToolPrefixes.some((prefix) => name.startsWith(prefix))) found.push('the name starts with a remote-bridge prefix, so call_tool would route it to GitHub or Azure');
  if (all.filter((other) => other.toLowerCase() === name.toLowerCase()).length > 1) found.push('the name is not unique (compared case-insensitively)');
  return found;
}

// ---- Argument generation -------------------------------------------------------------------------------------------------------

const patternSamples: readonly string[] = [
  '1', '42', 'a', 'abc', 'example', 'test', 'Example', 'Test note', 'owner/repo', 'Personal/example.md', '2026-11-21', '2026-11-21T10:00:00.000Z',
  '10:00', 'dan@example.com', 'https://example.com/', '00000000-0000-4000-8000-000000000001', 'x'.repeat(40), 'a'.repeat(64),
];

function stringSample(schema: Json, name: string): string {
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : Number.POSITIVE_INFINITY;
  const pattern = typeof schema.pattern === 'string' ? new RegExp(schema.pattern, 'u') : undefined;
  const byFormat: Record<string, string> = {
    uuid: '00000000-0000-4000-8000-000000000001', 'date-time': '2026-11-21T10:00:00.000Z', date: '2026-11-21', time: '10:00:00',
    uri: 'https://example.com/', url: 'https://example.com/', email: 'dan@example.com',
  };
  const lowered = name.toLowerCase();
  const byName = /(^|_)(id|ids)$/u.test(lowered) ? '1'
    : /query|search|text|prompt|message|summary|note|content|body|question/u.test(lowered) ? 'conformance check'
      : /title|name|label/u.test(lowered) ? 'Conformance check' : 'conformance';
  const candidates = [
    ...(typeof schema.format === 'string' && byFormat[schema.format] ? [byFormat[schema.format]!] : []),
    byName, ...patternSamples,
  ];
  for (const candidate of candidates) {
    const padded = candidate.length < minLength ? candidate.padEnd(minLength, 'x') : candidate;
    if (padded.length > maxLength) continue;
    if (pattern && !pattern.test(padded)) continue;
    return padded;
  }
  return 'x'.repeat(Math.max(minLength, 1));
}

function numberSample(schema: Json): number {
  let value = typeof schema.minimum === 'number' ? schema.minimum : typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : 1;
  if (typeof schema.maximum === 'number' && value > schema.maximum) value = schema.maximum;
  if (typeof schema.multipleOf === 'number' && value % schema.multipleOf !== 0) value = Math.ceil(value / schema.multipleOf) * schema.multipleOf;
  return schema.type === 'integer' ? Math.ceil(value) : value;
}

/** Merge the root, an `allOf`, and the branches of conditionals whose `if` matches what was built so far. */
function flatten(schema: Json, built: Json): Json {
  const merged: Json = { ...schema, properties: { ...record(schema.properties) }, required: [...(Array.isArray(schema.required) ? schema.required as string[] : [])] };
  for (const part of Array.isArray(schema.allOf) ? schema.allOf as unknown[] : []) {
    const child = record(part);
    if (!child) continue;
    const condition = record(child.if);
    if (condition) {
      const props = record(condition.properties) ?? {};
      const matches = Object.entries(props).every(([key, rule]) => {
        const constant = record(rule)?.const;
        const choices = record(rule)?.enum;
        return constant !== undefined ? built[key] === constant : Array.isArray(choices) ? choices.includes(built[key]) : true;
      }) && (Array.isArray(condition.required) ? (condition.required as string[]).every((key) => built[key] !== undefined) : true);
      const branch = record(matches ? child.then : child.else);
      if (branch) {
        Object.assign(merged.properties as Json, record(branch.properties));
        (merged.required as string[]).push(...(Array.isArray(branch.required) ? branch.required as string[] : []));
      }
    } else {
      Object.assign(merged.properties as Json, record(child.properties));
      (merged.required as string[]).push(...(Array.isArray(child.required) ? child.required as string[] : []));
    }
  }
  return merged;
}

function sample(schema: unknown, name: string, pick: (path: string, count: number) => number, path: string): unknown {
  const node = record(schema);
  if (!node) return {};
  if (node.const !== undefined) return node.const;
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[pick(path, node.enum.length)];
  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.length > 0) {
      const chosen = record(branches[pick(path, branches.length)])!;
      return sample({ ...node, [key]: undefined, ...chosen, properties: { ...record(node.properties), ...record(chosen.properties) },
        required: [...(Array.isArray(node.required) ? node.required as string[] : []), ...(Array.isArray(chosen.required) ? chosen.required as string[] : [])] }, name, pick, path);
    }
  }
  const type = Array.isArray(node.type) ? (node.type as string[]).find((entry) => entry !== 'null') : node.type;
  if (type === 'string') return stringSample(node, name);
  if (type === 'integer' || type === 'number') return numberSample(node);
  if (type === 'boolean') return false;
  if (type === 'array') {
    const count = Math.max(typeof node.minItems === 'number' ? node.minItems : 0, 0);
    return Array.from({ length: count }, (_, index) => sample(node.items ?? { type: 'string' }, name, pick, `${path}[${index}]`));
  }
  const built: Json = {};
  const flat = flatten(node, built);
  const required = new Set(flat.required as string[]);
  const properties = flat.properties as Json;
  for (const key of required) built[key] = sample(properties[key] ?? { type: 'string' }, key, pick, `${path}.${key}`);
  // Conditional branches can depend on values that were just chosen: flatten again and fill what became required.
  const settled = flatten(node, built);
  for (const key of settled.required as string[]) {
    if (built[key] === undefined) built[key] = sample((settled.properties as Json)[key] ?? { type: 'string' }, key, pick, `${path}.${key}`);
  }
  return built;
}

/** Selector-like properties: one generated call per value covers every operation a tool offers. */
const selectorNames = new Set(['operation', 'action', 'mode', 'method', 'kind', 'op']);

/**
 * Minimal valid argument sets for a schema (as the model sees it): required properties only, one set per branch of a top-level
 * `oneOf`/`anyOf` and per value of an operation selector, at most `limit` sets. Deterministic.
 */
export function sampleArgumentSets(schema: Json, limit = 12): { readonly label: string; readonly arguments: Json }[] {
  const out: { label: string; arguments: Json }[] = [];
  const branches = (Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined) as unknown[] | undefined;
  const selector = Object.entries(record(schema.properties) ?? {}).find(([key, child]) => selectorNames.has(key) && Array.isArray(record(child)?.enum));
  const build = (choose: (path: string, count: number) => number, label: string) => {
    out.push({ label, arguments: sample(schema, '', choose, '$') as Json });
  };
  if (branches) {
    for (let index = 0; index < Math.min(branches.length, limit); index += 1) {
      build((path, count) => (path === '$' ? index : Math.min(0, count - 1)), `branch ${index + 1}`);
    }
  } else if (selector) {
    const values = record(selector[1])!.enum as unknown[];
    for (let index = 0; index < Math.min(values.length, limit); index += 1) {
      build((path, count) => (path === `$.${selector[0]}` ? index : Math.min(0, count - 1)), `${selector[0]}=${String(values[index])}`);
    }
  } else build(() => 0, 'minimal');
  // A selector can also sit inside the chosen branch; deduplicate identical sets.
  const unique = new Map(out.map((entry) => [JSON.stringify(entry.arguments), entry]));
  return [...unique.values()];
}

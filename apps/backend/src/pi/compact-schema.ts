type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const minimumRepeatedLength = 120;

/** Keys whose value is data, not a subschema: a repeated enum or default must not be hoisted as if it were a schema. */
const dataKeys = new Set(['enum', 'const', 'default', 'examples', 'required']);

const isObject = (value: unknown): value is { [key: string]: Json } => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every object that stands where a schema stands, with the serialized form used to recognise a repeat. */
function schemaNodes(node: Json, found: Map<string, { count: number; value: Json }>, inPropertyMap = false): void {
  if (Array.isArray(node)) { for (const item of node) schemaNodes(item, found); return; }
  if (!isObject(node)) return;
  if (!inPropertyMap) {
    const text = JSON.stringify(node);
    if (text.length >= minimumRepeatedLength) {
      const entry = found.get(text);
      if (entry) entry.count += 1; else found.set(text, { count: 1, value: node });
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (dataKeys.has(key)) continue;
    if (key === 'properties' || key === 'patternProperties' || key === '$defs' || key === 'definitions') {
      if (isObject(value)) for (const child of Object.values(value)) schemaNodes(child, found);
    } else schemaNodes(value, found);
  }
}

function replace(node: Json, hoisted: Map<string, string>, inPropertyMap = false): Json {
  if (Array.isArray(node)) return node.map((item) => replace(item, hoisted));
  if (!isObject(node)) return node;
  if (!inPropertyMap) {
    const name = hoisted.get(JSON.stringify(node));
    if (name !== undefined) return { $ref: `#/$defs/${name}` };
  }
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(node)) {
    if (dataKeys.has(key)) out[key] = value;
    else if (key === 'properties' || key === 'patternProperties' || key === '$defs' || key === 'definitions') {
      out[key] = isObject(value) ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, replace(child, hoisted)])) : value;
    } else out[key] = replace(value, hoisted);
  }
  return out;
}

/**
 * The same schema, smaller: a subschema that appears more than once is written once under `$defs` and referred to by `$ref`. The
 * meaning does not change (expanding every reference gives the original back), so the agent reads an equivalent contract. A tool's
 * own validation always uses the original schema; only the copy handed to the model is compacted.
 */
export function compactSchema<T>(schema: T): T {
  const root = schema as unknown as Json;
  if (!isObject(root)) return schema;
  const found = new Map<string, { count: number; value: Json }>();
  schemaNodes(root, found);
  // Hoist the biggest repeats first; a repeat inside a hoisted repeat is hoisted too, and written back in place if it ends up used once.
  const repeats = [...found.entries()].filter(([, { count }]) => count > 1)
    .sort(([left], [right]) => right.length - left.length);
  if (repeats.length === 0) return schema;
  const existing = isObject(root.$defs) ? root.$defs : {};
  const hoisted = new Map<string, string>();
  const definitions: { [key: string]: Json } = { ...existing };
  let next = 0;
  for (const [text, { value }] of repeats) {
    let name = `d${next += 1}`;
    while (name in definitions) name = `d${next += 1}`;
    hoisted.set(text, name);
    definitions[name] = value;
  }
  const rewritten = replace(root, hoisted) as { [key: string]: Json };
  const compactDefinitions = Object.fromEntries(Object.entries(definitions).map(([name, value]) => {
    // A definition does not refer to itself; replace the repeats inside it, but not the whole of it.
    const own = [...hoisted.entries()].find(([, candidate]) => candidate === name)?.[0];
    const withoutSelf = new Map([...hoisted].filter(([text]) => text !== own));
    return [name, own === undefined ? value : replace(value, withoutSelf)];
  }));
  const result = inlineSingleUse({ ...rewritten, $defs: compactDefinitions });
  // Only worth it when the result is really smaller.
  return JSON.stringify(result).length < JSON.stringify(root).length ? result as unknown as T : schema;
}

const definitionName = (node: Json): string | undefined =>
  isObject(node) && typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/') && Object.keys(node).length === 1
    ? node.$ref.slice('#/$defs/'.length) : undefined;

/** A definition used once is written where it is used: hoisting it saved nothing. */
function inlineSingleUse(schema: { [key: string]: Json }): { [key: string]: Json } {
  let current = schema;
  for (let round = 0; round < 10; round += 1) {
    const uses = new Map<string, number>();
    const count = (node: Json): void => {
      if (Array.isArray(node)) { for (const item of node) count(item); return; }
      if (!isObject(node)) return;
      const name = definitionName(node);
      if (name !== undefined) { uses.set(name, (uses.get(name) ?? 0) + 1); return; }
      for (const [key, value] of Object.entries(node)) if (!dataKeys.has(key)) count(value);
    };
    const { $defs, ...body } = current;
    const definitions = isObject($defs) ? $defs : {};
    count(body as Json);
    for (const value of Object.values(definitions)) count(value);
    const single = new Set([...Object.keys(definitions)].filter((name) => (uses.get(name) ?? 0) <= 1));
    if (single.size === 0) return current;
    const inline = (node: Json): Json => {
      if (Array.isArray(node)) return node.map(inline);
      if (!isObject(node)) return node;
      const name = definitionName(node);
      if (name !== undefined && single.has(name)) return inline(definitions[name] ?? node);
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, dataKeys.has(key) ? value : inline(value)]));
    };
    const remaining = Object.fromEntries(Object.entries(definitions).filter(([name]) => !single.has(name)).map(([name, value]) => [name, inline(value)]));
    current = { ...(inline(body as Json) as { [key: string]: Json }), ...(Object.keys(remaining).length > 0 ? { $defs: remaining } : {}) };
  }
  return current;
}

/**
 * A schema as `find_tools` hands it to the model, and what it costs: show_in_chat and workspace_command carry the whole
 * generated-view contract (about 13,000 tokens each, mostly the same pieces repeated per renderer). A large schema is written
 * with each repeated piece once under `$defs`, which means exactly the same thing in a quarter of the tokens; validation of a
 * call always uses the original.
 */
export function compactLargeSchema<T>(schema: T, minimumCharacters = 8_000): T {
  return JSON.stringify(schema).length >= minimumCharacters ? compactSchema(schema) : schema;
}

/** Expands every `#/$defs/...` reference again: the inverse of compactSchema, used by tests to prove nothing was lost. */
export function expandSchema<T>(schema: T): T {
  const root = schema as unknown as Json;
  if (!isObject(root) || !isObject(root.$defs)) return schema;
  const { $defs, ...rest } = root;
  const expand = (node: Json, depth = 0): Json => {
    if (depth > 50) throw new Error('Schema references nest too deeply');
    if (Array.isArray(node)) return node.map((item) => expand(item, depth));
    if (!isObject(node)) return node;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/') && Object.keys(node).length === 1) {
      const target = ($defs as { [key: string]: Json })[node.$ref.slice('#/$defs/'.length)];
      return expand(target ?? node, depth + 1);
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, dataKeys.has(key) ? value : expand(value, depth)]));
  };
  return expand(rest as Json) as unknown as T;
}

type Json = Record<string, unknown>;

const jsonValueReference = '#/definitions/__schema0';

/**
 * zod writes the recursive `z.json()` value as a `$ref` to a shared definition and starts every schema with `$schema`.
 * The agent harness takes one self-contained parameters object, so a JSON value becomes the empty schema, which accepts
 * the same values (the body is already parsed JSON). Any other `$ref` is a mistake and stops the module from loading.
 */
export function inlineJsonValueSchema(schema: Json): Json {
  const { definitions } = schema;
  if (definitions !== undefined && Object.keys(definitions as Json).join() !== '__schema0') {
    throw new TypeError('Unexpected shared definition in a tool schema');
  }
  const rest = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema' && key !== 'definitions'));
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline);
    if (node === null || typeof node !== 'object') return node;
    const entries = Object.entries(node as Json);
    if (entries.length === 1 && entries[0]![0] === '$ref') {
      if (entries[0]![1] !== jsonValueReference) throw new TypeError('Unexpected $ref in a tool schema');
      return {};
    }
    return Object.fromEntries(entries.map(([key, value]) => [key, inline(value)]));
  };
  return inline(rest) as Json;
}

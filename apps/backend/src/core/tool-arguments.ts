import type { FastifyBaseLogger, FastifySchemaValidationError } from 'fastify';
import type { JarvisTool } from './tool-registry.js';

const safeProperty = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(value) ? value : undefined;

function schemaInstancePath(error: FastifySchemaValidationError): string | undefined {
  // Only schema-declared properties and array indices; dynamic map keys can contain private input.
  const path = error.instancePath.split('/').slice(1);
  const schema = error.schemaPath.split('/');
  let index = 0;
  for (let i = 0; i < schema.length; i += 1) {
    if (schema[i] === 'properties') {
      const property = safeProperty(schema[++i]);
      if (!property || path[index++] !== property) return undefined;
    } else if (schema[i] === 'items') {
      if (!/^\d{1,10}$/u.test(path[index++] ?? '')) return undefined;
    }
  }
  return index === path.length ? error.instancePath : undefined;
}

export function unexpectedToolArgument(
  input: unknown,
  schema: JarvisTool['inputSchema'],
): FastifySchemaValidationError | undefined {
  if (schema.additionalProperties !== false || input === null ||
      typeof input !== 'object' || Array.isArray(input)) return undefined;
  const properties = schema.properties as Record<string, unknown> | undefined;
  const property = Object.keys(input).find((key) => !Object.hasOwn(properties ?? {}, key));
  return property === undefined ? undefined : {
    keyword: 'additionalProperties', instancePath: '', schemaPath: '#/additionalProperties',
    params: { additionalProperty: property },
  };
}

export function toolArgumentRefusal(
  tool: Pick<JarvisTool, 'name' | 'inputSchema'>,
  errors: FastifySchemaValidationError | FastifySchemaValidationError[] | undefined,
  log: Pick<FastifyBaseLogger, 'info'>,
): { refused: string } {
  const error = (Array.isArray(errors) ? errors : errors ? [errors] : [])
    .reduce<FastifySchemaValidationError | undefined>((specific, candidate) => {
      const depth = (path: string) => path.split('/').length;
      return !specific || depth(candidate.instancePath) > depth(specific.instancePath) ? candidate : specific;
    }, undefined);
  const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;
  const keyword = error?.keyword ?? 'schema';
  const property = keyword === 'additionalProperties'
    ? safeProperty(error?.params.additionalProperty)
    : keyword === 'required'
      ? safeProperty(error?.params.missingProperty)
      : safeProperty(error?.instancePath.split('/')[1]);
  const knownProperty = property && Object.hasOwn(properties ?? {}, property) ? property : undefined;
  const detail = keyword === 'additionalProperties'
    ? `unexpected property${property ? ` '${property}'` : ''}`
    : keyword === 'required' && knownProperty
      ? `missing property '${knownProperty}'`
      : keyword === 'type'
        ? `${knownProperty ? `property '${knownProperty}'` : 'input'} has the wrong type`
        : keyword === 'json' ? 'expected a JSON object' : `${knownProperty ? `property '${knownProperty}'` : 'input'} does not match the tool schema`;
  const allowed = Object.keys(properties ?? {}).filter((key) => safeProperty(key)).join(', ').slice(0, 180);
  const instancePath = error && schemaInstancePath(error);
  log.info({
    tool: tool.name, keyword, ...(knownProperty ? { property: knownProperty } : {}),
    ...(instancePath !== undefined ? { instancePath } : {}),
  }, 'tool.invalid_arguments');
  return { refused: `Invalid arguments: ${detail}.${allowed ? ` Allowed: ${allowed}.` : ''} Retry with arguments matching the tool schema.` };
}

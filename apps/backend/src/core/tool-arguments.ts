import type { FastifyBaseLogger, FastifySchemaValidationError } from 'fastify';
import type { JarvisTool } from './tool-registry.js';

const safeProperty = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(value) ? value : undefined;

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
  error: FastifySchemaValidationError | undefined,
  log: Pick<FastifyBaseLogger, 'info'>,
): { refused: string } {
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
  log.info({ tool: tool.name, keyword, ...(property ? { property } : {}) }, 'tool.invalid_arguments');
  return { refused: `Invalid arguments: ${detail}.${allowed ? ` Allowed: ${allowed}.` : ''} Retry with arguments matching the tool schema.` };
}

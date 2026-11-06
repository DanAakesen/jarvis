import type { FastifyBaseLogger, FastifyInstance, FastifySchemaValidationError } from 'fastify';
import type { JarvisTool } from './tool-registry.js';

const safeProperty = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(value) ? value : undefined;

/** What a tool needs to explain a validation failure: the arguments as parsed and the app that owns the tools. */
export interface ToolArgumentContext {
  readonly input: unknown;
  readonly app: FastifyInstance;
}

const MAX_EXPLANATION_CHARACTERS = 400;

/**
 * The refusal for a validation failure a tool has explained. Chat, voice and the tool's own second validation
 * stage all use it, so the model reads the same words wherever the failure was found. It stays within the 500
 * characters a ToolRefusal allows.
 */
export function explainedArgumentsMessage(explanation: string): string {
  const bounded = explanation.length > MAX_EXPLANATION_CHARACTERS
    ? `${explanation.slice(0, MAX_EXPLANATION_CHARACTERS - 1)}…`
    : explanation;
  return `Invalid arguments: ${bounded} Retry with arguments matching the tool schema.`;
}

function explainedInput(
  tool: Pick<JarvisTool, 'explainInvalidInput'>,
  context: ToolArgumentContext | undefined,
): string | undefined {
  if (!context || !tool.explainInvalidInput) return undefined;
  try {
    const explanation = tool.explainInvalidInput(context.input, context.app)?.trim();
    return explanation === '' ? undefined : explanation;
  } catch {
    return undefined;
  }
}

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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function matchesDiscriminator(schema: Record<string, unknown>, input: unknown): boolean {
  const value = record(input);
  return Object.entries(record(schema.properties) ?? {}).every(([key, property]) => {
    const rule = record(property);
    return !rule || !Object.hasOwn(rule, 'const') || !value || !Object.hasOwn(value, key) || value[key] === rule.const;
  });
}

function operationSchema(schema: Record<string, unknown>, input: unknown): Record<string, unknown> {
  const branches = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(branches)) return schema;
  const matching = branches.map(record).filter((branch) => branch && matchesDiscriminator(branch, input));
  const branch = matching.length === 1 ? matching[0] : undefined;
  if (!branch) return schema;
  return {
    ...schema, ...branch,
    properties: branch.additionalProperties === false
      ? branch.properties : { ...record(schema.properties), ...record(branch.properties) },
    required: [...new Set([
      ...(Array.isArray(schema.required) ? schema.required : []),
      ...(Array.isArray(branch.required) ? branch.required : []),
    ])],
  };
}

/** Read constraints from the registered schema, never from AJV messages or argument values. */
function errorSchema(
  schema: Record<string, unknown>, error: FastifySchemaValidationError, input: unknown,
): { rule?: Record<string, unknown> | undefined; applicable: boolean } {
  const path = error.schemaPath.split('/').slice(1, -1);
  let node: unknown = schema;
  let value: unknown = input;
  for (let index = 0; index < path.length; index += 1) {
    const key = path[index]!.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (key === 'properties') {
      const property = path[index + 1];
      if (property) value = record(value)?.[property];
    } else if (key === 'items' && Array.isArray(value)) {
      // The actual array index is immaterial to its item constraints.
      value = undefined;
    }
    node = Array.isArray(node) ? node[Number(key)] : record(node)?.[key];
    if ((path[index - 1] === 'oneOf' || path[index - 1] === 'anyOf') && record(node) &&
        !matchesDiscriminator(record(node)!, value)) return { applicable: false };
  }
  return { rule: record(node), applicable: true };
}

function constraintHint(rule: Record<string, unknown> | undefined, keyword: string): string | undefined {
  if (!rule) return undefined;
  const value = rule[keyword];
  if (keyword === 'type' && (typeof value === 'string' || Array.isArray(value))) return `expected ${JSON.stringify(value)}`;
  if (keyword === 'enum' && Array.isArray(value)) return `use one of ${JSON.stringify(value).slice(0, 160)}`;
  if (keyword === 'const' && value !== undefined) return `expected ${JSON.stringify(value).slice(0, 100)}`;
  if (keyword === 'format' && typeof value === 'string') return `expected ${value} format`;
  if (keyword === 'pattern' && typeof value === 'string') return `must match pattern ${JSON.stringify(value).slice(0, 160)}`;
  if (typeof value !== 'number') return undefined;
  switch (keyword) {
    case 'minLength': return `use at least ${value} characters`;
    case 'maxLength': return `use at most ${value} characters`;
    case 'minimum': return `must be at least ${value}`;
    case 'maximum': return `must be at most ${value}`;
    case 'exclusiveMinimum': return `must be greater than ${value}`;
    case 'exclusiveMaximum': return `must be less than ${value}`;
    case 'minItems': return `use at least ${value} items`;
    case 'maxItems': return `use at most ${value} items`;
    case 'multipleOf': return `must be a multiple of ${value}`;
    default: return undefined;
  }
}

export function unexpectedToolArgument(
  input: unknown,
  schema: JarvisTool['inputSchema'],
): FastifySchemaValidationError | undefined {
  const selected = operationSchema(schema, input);
  if (selected.additionalProperties !== false || input === null ||
      typeof input !== 'object' || Array.isArray(input)) return undefined;
  const properties = selected.properties as Record<string, unknown> | undefined;
  const property = Object.keys(input).find((key) => !Object.hasOwn(properties ?? {}, key));
  return property === undefined ? undefined : {
    keyword: 'additionalProperties', instancePath: '', schemaPath: '#/additionalProperties',
    params: { additionalProperty: property },
  };
}

export function toolArgumentRefusal(
  tool: Pick<JarvisTool, 'name' | 'inputSchema' | 'explainInvalidInput'>,
  errors: FastifySchemaValidationError | FastifySchemaValidationError[] | undefined,
  log: Pick<FastifyBaseLogger, 'info'>,
  context?: ToolArgumentContext,
): { refused: string } {
  const candidates = Array.isArray(errors) ? errors : errors ? [errors] : [];
  const applicable = candidates.filter((candidate) => errorSchema(tool.inputSchema, candidate, context?.input).applicable);
  const error = (applicable.length ? applicable : candidates)
    .reduce<FastifySchemaValidationError | undefined>((specific, candidate) => {
      const depth = (path: string) => path.split('/').length;
      return !specific || depth(candidate.instancePath) > depth(specific.instancePath) ? candidate : specific;
    }, undefined);
  const selected = operationSchema(tool.inputSchema, context?.input);
  const properties = record(selected.properties);
  const keyword = error?.keyword ?? 'schema';
  const rule = error && errorSchema(tool.inputSchema, error, context?.input).rule;
  const instancePath = error && schemaInstancePath(error);
  const property = keyword === 'additionalProperties'
    ? safeProperty(error?.params.additionalProperty)
    : keyword === 'required'
      ? safeProperty(error?.params.missingProperty)
      : safeProperty(error?.instancePath.split('/')[1]);
  const knownProperty = property && Object.hasOwn(properties ?? {}, property) ? property : undefined;
  const requiredProperty = keyword === 'required' && property && Object.hasOwn(record(rule?.properties) ?? properties ?? {}, property)
    ? property : undefined;
  const location = instancePath && rule ? instancePath.slice(1).replaceAll('/', '.') : knownProperty;
  const constraint = constraintHint(rule, keyword);
  const detail = keyword === 'additionalProperties'
    ? `unexpected property${property ? ` '${property}'` : ''}`
    : keyword === 'required' && requiredProperty
      ? `missing property '${instancePath ? `${instancePath.slice(1).replaceAll('/', '.')}.` : ''}${requiredProperty}'`
      : keyword === 'type'
        ? `${location ? `property '${location}'` : 'input'} has the wrong type${constraint ? `; ${constraint}` : ''}`
        : keyword === 'json' ? 'expected a JSON object' : `${location ? `property '${location}'` : 'input'} ${constraint ?? 'does not match the tool schema'}`;
  const allowed = Object.keys(properties ?? {}).filter((key) => safeProperty(key)).join(', ').slice(0, 180);
  const required = keyword === 'schema' && Array.isArray(selected.required)
    ? selected.required.filter((key) => safeProperty(key)).join(', ').slice(0, 120) : '';
  log.info({
    tool: tool.name, keyword, ...(knownProperty ? { property: knownProperty } : {}),
    ...(instancePath !== undefined ? { instancePath } : {}),
  }, 'tool.invalid_arguments');
  // A tool can only explain what its schema stage cannot: never a root unexpected property, which is already named.
  const rootUnexpectedProperty = keyword === 'additionalProperties' && error?.instancePath === '';
  const explanation = rootUnexpectedProperty ? undefined : explainedInput(tool, context);
  if (explanation !== undefined) return { refused: explainedArgumentsMessage(explanation) };
  return { refused: explainedArgumentsMessage(`${detail}.${required ? ` Required: ${required}.` : ''}${allowed ? ` Allowed: ${allowed}.` : ''}`) };
}

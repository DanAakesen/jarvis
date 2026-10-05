import type { FastifyRequest } from 'fastify';
import type { BackendModule } from '../modules.js';
import {
  type MemoryCategory,
  type MemoryRecord,
  type MemoryStore,
  VectorSearchUnavailableError,
} from '../database/memory-store.js';
import type { MemoryEmbedder } from './memory-embeddings.js';
import { ToolRefusal } from './tool-registry.js';

const MAX_MEMORY_RESULTS = 5;
const MAX_LIST_RESULTS = 25;
const MAX_HISTORY_RESULTS = 10;
const MAX_SQL_BIGINT = 9_223_372_036_854_775_807n;
const idPattern = /^[1-9]\d{0,18}$/u;
const categories = new Set<MemoryCategory>(['preference', 'project_fact', 'decision', 'unfinished_task']);
const sensitivePattern = /\b(?:password|passphrase|secret|api[ -]?key|access[ -]?token|credential|private[ -]?key|seed[ -]?phrase|recovery[ -]?phrase|bank(?:ing)?|bank account|credit card|debit card|account number|iban|routing number|swift code|health|medical|diagnosis|medication|symptom|patient|clinic|therapy|prescription|social security|ssn)\b/iu;

declare module 'fastify' {
  interface FastifyRequest {
    jarvisMemorySourceMessageId?: string;
  }
}

export interface MemoryModuleOptions {
  readonly store: MemoryStore;
  readonly embedder?: MemoryEmbedder;
}

interface MemorySearchResult {
  readonly memories: readonly MemoryRecord[];
  readonly method: 'vector' | 'fulltext' | 'substring';
  readonly mayHaveMore: boolean;
  readonly fallbackReason?: 'embedding_unavailable' | 'vector_search_unavailable' | 'no_vector_match';
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolRefusal('The memory request was invalid. Nothing changed.');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ToolRefusal(`The memory ${name} is invalid. Nothing changed.`);
  }
  return value.trim();
}

function memoryId(value: unknown): string {
  const id = requiredString(value, 'ID', 19);
  if (!idPattern.test(id) || BigInt(id) > MAX_SQL_BIGINT) {
    throw new ToolRefusal('The memory ID is invalid. Nothing changed.');
  }
  return id;
}

function category(value: unknown): MemoryCategory {
  if (typeof value !== 'string' || !categories.has(value as MemoryCategory)) {
    throw new ToolRefusal('Choose preference, project fact, decision or unfinished task.');
  }
  return value as MemoryCategory;
}

function memoryKey(value: unknown): string {
  const key = requiredString(value, 'key', 100).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(key)) {
    throw new ToolRefusal('Use a short, stable memory key made of letters, numbers, dots, hyphens or underscores.');
  }
  return key;
}

function sourceMessageId(request: FastifyRequest): string {
  const header = request.headers['x-jarvis-message-id'];
  const value = typeof header === 'string' ? header : request.jarvisMemorySourceMessageId;
  if (typeof value !== 'string' || !idPattern.test(value) || BigInt(value) > MAX_SQL_BIGINT) {
    throw new ToolRefusal('There is no stored Dan message to verify this memory against. Nothing changed.');
  }
  return value;
}

function searchTerms(query: string): string[] {
  return [...new Set(query.match(/[\p{L}\p{N}]{2,}/gu)?.map((term) => term.toLowerCase()) ?? [])].slice(0, 8);
}

function memorySource(record: MemoryRecord) {
  return {
    messageId: record.sourceMessageId,
    text: record.sourceText,
    truncated: record.sourceTextTruncated,
  };
}

function memoryDetails(record: MemoryRecord) {
  return {
    id: record.id,
    category: record.category,
    key: record.key,
    content: record.content,
    revision: record.revision,
    updatedAt: record.updatedAt.toISOString(),
    source: memorySource(record),
  };
}

function checkPrincipal(request: FastifyRequest): void {
  if (!request.principal && !request.agentPrincipal) {
    throw new ToolRefusal('Memory access is not authorized.');
  }
}

async function sourceForWrite(
  store: MemoryStore,
  request: FastifyRequest,
  signal: AbortSignal,
  content: string,
) {
  checkPrincipal(request);
  const id = sourceMessageId(request);
  const source = await store.getSourceMessage(id, signal);
  if (!source) throw new ToolRefusal('The source message is missing or is not from Dan. Nothing changed.');
  if (sensitivePattern.test(`${source.text}\n${content}`) && !/\bremember\b/iu.test(source.text)) {
    throw new ToolRefusal('I will not store secrets, credentials, banking or health details unless you explicitly say “remember”. Nothing changed.');
  }
  return source;
}

function confirmation(action: 'saved' | 'updated' | 'forgotten', categoryName: MemoryCategory, key: string): string {
  if (action === 'saved') return `Remembered the ${categoryName.replace('_', ' ')}: ${key}.`;
  if (action === 'updated') return `Updated the ${categoryName.replace('_', ' ')}: ${key}.`;
  return `Forgot the ${categoryName.replace('_', ' ')}: ${key}.`;
}

export function createMemoryModule(options: MemoryModuleOptions): BackendModule {
  const { store, embedder } = options;

  async function embed(content: string, signal: AbortSignal, request: FastifyRequest): Promise<{
    readonly value: readonly number[] | null;
    readonly unavailable: boolean;
  }> {
    if (!store.supportsVectorSearch() || !embedder) return { value: null, unavailable: false };
    const startedAt = performance.now();
    try {
      const value = await embedder.embed(content, signal);
      request.log.info({
        msg: 'memory.embedding',
        outcome: 'ok',
        durationMs: Math.max(0, performance.now() - startedAt),
      }, 'memory.embedding');
      return { value, unavailable: false };
    } catch (error) {
      request.log.info({
        msg: 'memory.embedding',
        outcome: signal.aborted ? 'cancelled' : 'fallback',
        durationMs: Math.max(0, performance.now() - startedAt),
      }, 'memory.embedding');
      if (signal.aborted) throw error;
      return { value: null, unavailable: true };
    }
  }

  async function search(query: string, signal: AbortSignal, request: FastifyRequest): Promise<MemorySearchResult> {
    const terms = searchTerms(query);
    if (terms.length === 0) return { memories: [], method: 'substring', mayHaveMore: false };
    let fallbackReason: MemorySearchResult['fallbackReason'];
    if (store.supportsVectorSearch() && embedder) {
      let queryVector: readonly number[] | null = null;
      try {
        const embedded = await embed(query, signal, request);
        queryVector = embedded.value;
        if (embedded.unavailable) fallbackReason = 'embedding_unavailable';
      } catch (error) {
        if (signal.aborted) throw error;
        fallbackReason = 'embedding_unavailable';
      }
      if (queryVector) {
        try {
          const memories = await store.searchByVector(queryVector, MAX_MEMORY_RESULTS + 1, signal);
          if (memories.length > 0) {
            return {
              memories: memories.slice(0, MAX_MEMORY_RESULTS),
              method: 'vector',
              mayHaveMore: memories.length > MAX_MEMORY_RESULTS,
            };
          }
          fallbackReason = 'no_vector_match';
        } catch (error) {
          if (!(error instanceof VectorSearchUnavailableError)) throw error;
          fallbackReason = 'vector_search_unavailable';
        }
      }
    }
    const fallback = await store.searchByFullText(terms, MAX_MEMORY_RESULTS + 1, signal);
    return {
      memories: fallback.memories.slice(0, MAX_MEMORY_RESULTS),
      method: fallback.method,
      mayHaveMore: fallback.memories.length > MAX_MEMORY_RESULTS,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }

  const tools = [
    {
      name: 'memory_remember',
      description: 'Save a confirmed preference, project fact, decision or unfinished task that Dan clearly stated. Do not infer facts. Never save a secret, credential, banking or health detail unless this stored Dan message explicitly says “remember”. Use a stable key; first search existing memories and preserve corrections under the same key.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['preference', 'project_fact', 'decision', 'unfinished_task'] },
          key: { type: 'string', minLength: 1, maxLength: 100 },
          content: { type: 'string', minLength: 1, maxLength: 2000 },
        },
        required: ['category', 'key', 'content'],
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        const input = asObject(value);
        const kind = category(input.category);
        const key = memoryKey(input.key);
        const content = requiredString(input.content, 'content', 2000);
        const source = await sourceForWrite(store, request, signal, content);
        const embedding = await embed(content, signal, request);
        const saved = await store.save({
          category: kind, key, content, sourceMessageId: source.messageId, embedding: embedding.value,
        }, signal);
        return {
          id: saved.memory.id,
          category: kind,
          key,
          revision: saved.memory.revision,
          changed: saved.changed,
          searchMode: embedding.value ? 'vector' : 'non_vector_fallback',
          ...(embedding.unavailable ? { embeddingUnavailable: true } : {}),
          confirmation: saved.created
            ? confirmation('saved', kind, key)
            : saved.changed
              ? confirmation('updated', kind, key)
              : `Already remembered the ${kind.replace('_', ' ')}: ${key}.`,
        };
      },
    },
    {
      name: 'memory_search',
      description: 'Search only relevant saved memories when Dan asks about a preference, past decision, project fact or unfinished task. Every result includes a source message from Dan; do not use a memory without its source.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1, maxLength: 500 } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        checkPrincipal(request);
        const query = requiredString(asObject(value).query, 'search query', 500);
        const result = await search(query, signal, request);
        return {
          memories: result.memories.map(memoryDetails),
          count: result.memories.length,
          method: result.method,
          limit: MAX_MEMORY_RESULTS,
          mayHaveMore: result.mayHaveMore,
          ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
          confirmation: result.memories.length > 0
            ? `Found ${result.memories.length} source-linked memories using ${result.method} search.`
            : 'No source-supported memories matched.',
        };
      },
    },
    {
      name: 'memory_list',
      description: 'List up to 25 current saved memories with their original source message. Use this to inspect memories; do not infer that omitted memories do not exist.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_RESULTS } },
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        checkPrincipal(request);
        const input = asObject(value);
        const limit = input.limit === undefined ? MAX_LIST_RESULTS : input.limit;
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_RESULTS) {
          throw new ToolRefusal('Memory list limit must be between 1 and 25.');
        }
        const page = await store.list(limit, signal);
        return {
          memories: page.memories.map(memoryDetails),
          count: page.memories.length,
          limit,
          hasMore: page.hasMore,
          confirmation: `Listed ${page.memories.length} current memories with their sources.`,
        };
      },
    },
    {
      name: 'memory_history',
      description: 'Inspect the current and up to nine previous source-linked versions of one memory.',
      inputSchema: {
        type: 'object',
        properties: { memoryId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        required: ['memoryId'],
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        checkPrincipal(request);
        const id = memoryId(asObject(value).memoryId);
        const versions = await store.history(id, MAX_HISTORY_RESULTS + 1, signal);
        if (versions.length === 0) throw new ToolRefusal('No saved memory with that ID exists.');
        const boundedVersions = versions.slice(0, MAX_HISTORY_RESULTS);
        return {
          versions: boundedVersions.map((version) => ({
            ...memoryDetails(version),
            changedAt: version.changedAt.toISOString(),
          })),
          mayHaveMore: versions.length > MAX_HISTORY_RESULTS,
          confirmation: `Found ${boundedVersions.length} source-linked memory versions.`,
        };
      },
    },
    {
      name: 'memory_correct',
      description: 'Correct an existing memory after Dan corrects or updates it. Keep its category and stable key, verify this message is from Dan, and preserve the previous source-linked version.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
          content: { type: 'string', minLength: 1, maxLength: 2000 },
        },
        required: ['memoryId', 'content'],
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        const input = asObject(value);
        const id = memoryId(input.memoryId);
        const content = requiredString(input.content, 'content', 2000);
        const source = await sourceForWrite(store, request, signal, content);
        const current = await store.history(id, 1, signal);
        const memory = current[0];
        if (!memory) throw new ToolRefusal('No saved memory with that ID exists. Nothing changed.');
        const embedding = await embed(content, signal, request);
        const corrected = await store.correct(id, {
          category: memory.category,
          key: memory.key,
          content,
          sourceMessageId: source.messageId,
          embedding: embedding.value,
        }, signal);
        return {
          id: corrected.memory.id,
          category: corrected.memory.category,
          key: corrected.memory.key,
          revision: corrected.memory.revision,
          changed: corrected.changed,
          ...(embedding.unavailable ? { embeddingUnavailable: true } : {}),
          confirmation: confirmation('updated', corrected.memory.category, corrected.memory.key),
        };
      },
    },
    {
      name: 'memory_forget',
      description: 'Forget one confirmed saved memory. Search or list first, ask Dan to disambiguate multiple matches, then use the matching ID. This deletes the memory and its stored revisions, not the original conversation or source message.',
      inputSchema: {
        type: 'object',
        properties: { memoryId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } },
        required: ['memoryId'],
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        checkPrincipal(request);
        const sourceId = sourceMessageId(request);
        if (!await store.getSourceMessage(sourceId, signal)) {
          throw new ToolRefusal('The current Dan message is missing. Nothing was deleted.');
        }
        const id = memoryId(asObject(value).memoryId);
        const forgotten = await store.forget(id, sourceId, signal);
        if (!forgotten) throw new ToolRefusal('No saved memory with that ID exists. Nothing was deleted.');
        return {
          id,
          category: forgotten.category,
          key: forgotten.key,
          confirmation: confirmation('forgotten', forgotten.category, forgotten.key),
        };
      },
    },
  ] as const;

  return {
    id: 'memory',
    tools,
    registerRoutes: async () => {},
  };
}

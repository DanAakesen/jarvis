import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { BackendModule } from '../modules.js';
import {
  type MemoryCategory,
  type MemoryRecord,
  type MemoryVersion,
  type MemoryStore,
  VectorSearchUnavailableError,
} from '../database/memory-store.js';
import { embeddingFailureStatus, type MemoryEmbedder } from './memory-embeddings.js';
import {
  hasCredentialMarker,
  hasSensitiveMarker,
  memoryContainsCredential,
} from './memory-policy.js';
import type { UsageStore } from './usage.js';
import { ToolRefusal } from './tool-registry.js';
import { receipt } from './tool-completion.js';

const MAX_MEMORY_RESULTS = 5;
const MAX_LIST_RESULTS = 25;
const MAX_HISTORY_RESULTS = 10;
const MAX_MEMORY_API_RESULTS = 50;
const MAX_MEMORY_API_OFFSET = 10_000;
const MAX_MEMORY_API_HISTORY = 10;
const MAX_SQL_BIGINT = 9_223_372_036_854_775_807n;
const idPattern = /^[1-9]\d{0,18}$/u;
const categories = new Set<MemoryCategory>(['preference', 'project_fact', 'decision', 'unfinished_task']);
const explicitCapturePattern = [
  /^\s*(?:please\s+)?(?:remember|memorise|memorize)\b/iu,
  /\b(?:remember|memorise|memorize)\s+(?:that|this|it|i\b|my\b|me\b|we\b)/iu,
  /\b(?:do not|don['’]?t)\s+forget\b/iu,
  /\b(?:do not|don['’]?t)\s+let\s+me\s+forget\b/iu,
  /\bkeep\s+(?:this|that|it)?\s*in\s+mind\b/iu,
  /\b(?:make|take)\s+(?:a\s+)?note\s+(?:of|that)\b/iu,
  /^\s*(?:husk|glem ikke|gør et notat|gem)\b/iu,
  /\b(?:husk|gem)\s+(?:at|det|dette|denne|jeg\b|mit\b|min\b)/iu,
  /\blad være med at glemme\b/iu,
  /\b(?:save|store)\s+(?:that|this|it)\s+(?:as|in|for)\s+(?:a\s+)?(?:personal\s+)?memory\b/iu,
  /\b(?:save|store)\s+(?:that|this|it)\s+(?:about me|for me|for later)\b/iu,
  /\bmake\s+(?:that|this|it)\s+(?:a\s+)?(?:personal\s+)?memory\b/iu,
] as const;

function safeMemoryDetails(record: MemoryRecord) {
  return memoryContainsCredential(record) ? null : memoryDetails(record);
}

export interface MemoryModuleOptions {
  readonly store: MemoryStore;
  readonly embedder?: MemoryEmbedder;
  readonly getEmbedder?: () => Promise<MemoryEmbedder | undefined>;
  readonly embeddingModel?: string;
  readonly getEmbeddingModel?: () => Promise<string>;
  readonly automaticCapture?: () => Promise<boolean>;
  readonly usageStore?: Pick<UsageStore, 'recordFoundryUsage'>;
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
  if (record.sourceMessageId) {
    return {
      type: 'conversation' as const,
      messageId: record.sourceMessageId,
      text: record.sourceText,
      truncated: record.sourceTextTruncated,
    };
  }
  if (record.settingsAction) {
    return {
      type: 'settings' as const,
      requestId: record.settingsAction.requestId,
    };
  }
  throw new Error('Memory source provenance is invalid');
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

function snippet(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function conversationUrl(messageId: string): string {
  return `/conversation/history?before=${BigInt(messageId) + 1n}&limit=100`;
}

function apiMemorySource(record: MemoryRecord) {
  if (record.sourceMessageId) {
    return {
      type: 'conversation' as const,
      messageId: record.sourceMessageId,
      url: conversationUrl(record.sourceMessageId),
    };
  }
  if (record.settingsAction) {
    return {
      type: 'settings' as const,
      requestId: record.settingsAction.requestId,
    };
  }
  throw new Error('Memory source provenance is invalid');
}

function memoryApiItem(record: MemoryRecord) {
  const redacted = memoryContainsCredential(record);
  return {
    id: record.id,
    type: 'memory' as const,
    folder: 'General',
    title: redacted ? '[redacted]' : record.key,
    snippet: redacted ? '[redacted]' : snippet(record.content),
    updatedAt: record.updatedAt.toISOString(),
    source: apiMemorySource(record),
  };
}

function memoryHistoryItem(version: MemoryVersion) {
  const redacted = memoryContainsCredential(version);
  return {
    id: version.id,
    category: version.category,
    key: redacted ? '[redacted]' : version.key,
    content: redacted ? '[redacted]' : version.content,
    revision: version.revision,
    changedAt: version.changedAt.toISOString(),
    source: apiMemorySource(version),
  };
}

export function isExplicitMemoryRequest(text: string): boolean {
  return explicitCapturePattern.some((pattern) => pattern.test(text));
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
  requiredString(content, 'content', 2_000);
  return source;
}

function validateMemoryWrite(
  categoryName: MemoryCategory,
  key: string,
  sourceText: string,
  content: string,
  automatic: boolean,
): void {
  const combined = `${categoryName}\n${key}\n${sourceText}\n${content}`;
  if (hasCredentialMarker(combined)) {
    throw new ToolRefusal('Secrets and credentials cannot be saved in memory. Nothing changed.');
  }
  if (automatic && hasSensitiveMarker(combined)) {
    throw new ToolRefusal('Sensitive details are not saved by automatic capture. Dan must explicitly ask to remember them.');
  }
}

function confirmation(action: 'saved' | 'updated' | 'forgotten', categoryName: MemoryCategory, key: string): string {
  if (action === 'saved') return `Remembered the ${categoryName.replace('_', ' ')}: ${key}.`;
  if (action === 'updated') return `Updated the ${categoryName.replace('_', ' ')}: ${key}.`;
  return `Forgot the ${categoryName.replace('_', ' ')}: ${key}.`;
}

export function createMemoryModule(options: MemoryModuleOptions): BackendModule {
  const { store, embedder } = options;

  async function activeEmbedder(): Promise<MemoryEmbedder | undefined> {
    return options.getEmbedder ? options.getEmbedder() : embedder;
  }

  async function activeEmbeddingModel(active: MemoryEmbedder | undefined): Promise<string> {
    const model = active?.model ?? (options.getEmbeddingModel
      ? await options.getEmbeddingModel()
      : options.embeddingModel ?? 'text-embedding-3-small');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(model)) {
      throw new Error('Embedding model setting is invalid');
    }
    return model;
  }

  async function automaticCaptureEnabled(): Promise<boolean> {
    return options.automaticCapture ? options.automaticCapture() : false;
  }

  async function embed(content: string, signal: AbortSignal, request: FastifyRequest): Promise<{
    readonly value: readonly number[] | null;
    readonly model: string | null;
    readonly unavailable: boolean;
  }> {
    const currentEmbedder = await activeEmbedder();
    if (!store.supportsVectorSearch() || !currentEmbedder) return { value: null, model: null, unavailable: false };
    const model = await activeEmbeddingModel(currentEmbedder);
    const startedAt = performance.now();
    try {
      const embedded = currentEmbedder.embedWithUsage
        ? await currentEmbedder.embedWithUsage(content, signal)
        : { embedding: await currentEmbedder.embed(content, signal) };
      request.log.info({
        msg: 'memory.embedding',
        outcome: 'ok',
        durationMs: Math.max(0, performance.now() - startedAt),
        ...(embedded.inputTokens !== undefined ? { inputTokens: embedded.inputTokens } : {}),
      }, 'memory.embedding');
      if (embedded.inputTokens !== undefined &&
          options.usageStore?.recordFoundryUsage) {
        try {
          await options.usageStore.recordFoundryUsage({
            role: 'embeddings',
            model,
            inputTokens: embedded.inputTokens,
            outputTokens: 0,
            eventId: randomUUID(),
          });
        } catch {
          request.log.warn('usage.embedding_tokens_unavailable');
        }
      }
      return { value: embedded.embedding, model, unavailable: false };
    } catch (error) {
      request.log.info({
        msg: 'memory.embedding',
        outcome: signal.aborted ? 'cancelled' : 'fallback',
        durationMs: Math.max(0, performance.now() - startedAt),
        ...embeddingFailureStatus(error),
      }, 'memory.embedding');
      if (signal.aborted) throw error;
      return { value: null, model: null, unavailable: true };
    }
  }

  async function search(
    query: string,
    limit: number,
    signal: AbortSignal,
    request: FastifyRequest,
  ): Promise<MemorySearchResult> {
    const terms = searchTerms(query);
    if (terms.length === 0) return { memories: [], method: 'substring', mayHaveMore: false };
    let fallbackReason: MemorySearchResult['fallbackReason'];
    if (store.supportsVectorSearch()) {
      let queryVector: readonly number[] | null = null;
      let queryModel: string | null = null;
      try {
        const embedded = await embed(query, signal, request);
        queryVector = embedded.value;
        queryModel = embedded.model;
        if (embedded.unavailable) fallbackReason = 'embedding_unavailable';
      } catch (error) {
        if (signal.aborted) throw error;
        fallbackReason = 'embedding_unavailable';
      }
      if (queryVector && queryModel) {
        try {
          const memories = await store.searchByVector(queryVector, queryModel, limit + 1, signal);
          if (memories.length > 0) {
            return {
              memories: memories.slice(0, limit),
              method: 'vector',
              mayHaveMore: memories.length > limit,
            };
          }
          fallbackReason = 'no_vector_match';
        } catch (error) {
          if (!(error instanceof VectorSearchUnavailableError)) throw error;
          fallbackReason = 'vector_search_unavailable';
        }
      }
    }
    const fallback = await store.searchByFullText(terms, limit + 1, signal);
    return {
      memories: fallback.memories.slice(0, limit),
      method: fallback.method,
      mayHaveMore: fallback.memories.length > limit,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }

  const tools = [
    {
      name: 'memory_remember',
      completion: {
        domain: 'memory', operation: 'create',
        requestTargetFields: ['key'],
        resultTargetFields: ['id', 'key', 'revision'], evaluate: receipt.memoryWrite,
      },
      description: 'Save a preference, project fact, decision or unfinished task that Dan clearly stated in this owner message or its resolved context. Explicit remember, don’t forget, remember this and equivalent English or Danish requests always use Personal Memory, never Vault. sourceIntent labels the model’s interpretation but the stored Dan message proves authority. Never save a secret or credential. Automatic capture saves only clearly stated durable facts while automatic capture is enabled, and never sensitive health or financial details. Use a stable key; search first and preserve corrections under the same key.',
      execution: { defaultEffect: 'action' },
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['preference', 'project_fact', 'decision', 'unfinished_task'] },
          key: { type: 'string', minLength: 1, maxLength: 100 },
          content: { type: 'string', minLength: 1, maxLength: 2000 },
          sourceIntent: { type: 'string', enum: ['requested', 'automatic'] },
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
        const directRequest = isExplicitMemoryRequest(source.text);
        if (!directRequest && !await automaticCaptureEnabled()) {
          throw new ToolRefusal('Automatic Personal Memory capture is off. Nothing changed.');
        }
        validateMemoryWrite(kind, key, source.text, content, !directRequest);
        const embedding = await embed(content, signal, request);
        const saved = await store.save({
          category: kind, key, content,
          source: { kind: 'conversation', messageId: source.messageId },
          embedding: embedding.value,
          embeddingModel: embedding.model,
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
      description: 'Search only Personal Memory, separately from Vault Knowledge, when a reply may depend on a saved owner preference, past decision, project fact or unfinished task. Results are bounded and source-linked; do not use a memory without its source or treat absence as proof.',
      execution: { defaultEffect: 'read' },
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1, maxLength: 500 } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        checkPrincipal(request);
        const query = requiredString(asObject(value).query, 'search query', 500);
        const result = await search(query, MAX_MEMORY_RESULTS, signal, request);
        const memories = result.memories.flatMap((memory) => {
          const safe = safeMemoryDetails(memory);
          return safe ? [safe] : [];
        });
        const withheld = result.memories.length - memories.length;
        return {
          memories,
          count: memories.length,
          method: result.method,
          limit: MAX_MEMORY_RESULTS,
          mayHaveMore: result.mayHaveMore,
          ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
          ...(withheld > 0 ? { withheldCredentialRecords: withheld } : {}),
          confirmation: memories.length > 0
            ? `Found ${memories.length} source-linked memories using ${result.method} search.`
            : 'No source-supported memories matched.',
        };
      },
    },
    {
      name: 'memory_list',
      description: 'List up to 25 current saved memories with their original source message. Use this to inspect memories; do not infer that omitted memories do not exist.',
      execution: { defaultEffect: 'read' },
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
        const memories = page.memories.flatMap((memory) => {
          const safe = safeMemoryDetails(memory);
          return safe ? [safe] : [];
        });
        const withheld = page.memories.length - memories.length;
        return {
          memories,
          count: memories.length,
          limit,
          hasMore: page.hasMore,
          ...(withheld > 0 ? { withheldCredentialRecords: withheld } : {}),
          confirmation: `Listed ${memories.length} current memories with safe sources.`,
        };
      },
    },
    {
      name: 'memory_history',
      description: 'Inspect the current and up to nine previous source-linked versions of one memory.',
      execution: { defaultEffect: 'read' },
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
        const safeVersions = boundedVersions.flatMap((version) => {
          const safe = safeMemoryDetails(version);
          return safe ? [{ ...safe, changedAt: version.changedAt.toISOString() }] : [];
        });
        const withheld = boundedVersions.length - safeVersions.length;
        return {
          versions: safeVersions,
          mayHaveMore: versions.length > MAX_HISTORY_RESULTS,
          ...(withheld > 0 ? { withheldCredentialVersions: withheld } : {}),
          confirmation: `Found ${safeVersions.length} source-linked memory versions with safe content.`,
        };
      },
    },
    {
      name: 'memory_correct',
      completion: {
        domain: 'memory', operation: 'update', requestTargetFields: ['memoryId'],
        resultTargetFields: ['id', 'key', 'revision'], evaluate: receipt.memoryWrite,
      },
      description: 'Correct an existing memory after Dan corrects or updates it. Keep its category and stable key, verify this message is from Dan, and preserve the previous source-linked version.',
      execution: { defaultEffect: 'action' },
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
        const current = await store.history(id, 1, signal);
        const memory = current[0];
        if (!memory) throw new ToolRefusal('No saved memory with that ID exists. Nothing changed.');
        const source = await sourceForWrite(store, request, signal, content);
        validateMemoryWrite(memory.category, memory.key, source.text, content, false);
        const embedding = await embed(content, signal, request);
        const corrected = await store.correct(id, {
          category: memory.category, key: memory.key, content,
          source: { kind: 'conversation', messageId: source.messageId },
          embedding: embedding.value,
          embeddingModel: embedding.model,
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
      completion: {
        domain: 'memory', operation: 'delete', requestTargetFields: ['memoryId'],
        resultTargetFields: ['id', 'category', 'key'], evaluate: receipt.memoryDelete,
      },
      description: 'Forget one confirmed saved memory. Search or list first, ask Dan to disambiguate multiple matches, then use the matching ID. This deletes the memory and its stored revisions, not the original conversation or source message.',
      execution: { defaultEffect: 'action' },
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
        const forgotten = await store.forget(id, { kind: 'conversation', messageId: sourceId }, signal);
        if (!forgotten) throw new ToolRefusal('No saved memory with that ID exists. Nothing was deleted.');
        const redacted = hasCredentialMarker(`${forgotten.category}\n${forgotten.key}`);
        const safeKey = redacted ? '[redacted]' : forgotten.key;
        return {
          id,
          category: forgotten.category,
          key: safeKey,
          confirmation: confirmation('forgotten', forgotten.category, safeKey),
        };
      },
    },
  ] as const;

  return {
    id: 'memory',
    tools,
    registerRoutes: async (app) => {
      const ownerOnly = (request: FastifyRequest, reply: FastifyReply): boolean => {
        if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
          void reply.code(403).send({ error: 'Forbidden' });
          return false;
        }
        reply.header('Cache-Control', 'no-store');
        return true;
      };
      const apiError = {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
        additionalProperties: false,
      };
      const apiQuerySchema = {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
          folder: { type: 'string', enum: ['General'] },
          limit: { type: 'integer', minimum: 1, maximum: MAX_MEMORY_API_RESULTS },
          offset: { type: 'integer', minimum: 0, maximum: MAX_MEMORY_API_OFFSET },
        },
        additionalProperties: false,
      };
      const memoryIdParams = {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 } },
        required: ['id'],
        additionalProperties: false,
      };

      app.get<{
        Querystring: { query?: string; folder?: 'General'; limit?: number; offset?: number };
      }>('/memory', {
        schema: { querystring: apiQuerySchema, response: { 400: apiError, 403: apiError } },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        const limit = request.query.limit ?? 25;
        const offset = request.query.offset ?? 0;
        const fetchLimit = Math.min(
          MAX_MEMORY_API_OFFSET + MAX_MEMORY_API_RESULTS + 1,
          offset + limit + 1,
        );
        const query = request.query.query?.trim() ?? '';
        const signal = AbortSignal.timeout(30_000);
        let memories: readonly MemoryRecord[];
        let mayHaveMore: boolean;
        let method: MemorySearchResult['method'] | undefined;
        let fallbackReason: MemorySearchResult['fallbackReason'];
        if (query) {
          const result = await search(query, fetchLimit, signal, request);
          memories = result.memories;
          method = result.method;
          mayHaveMore = result.mayHaveMore;
          fallbackReason = result.fallbackReason;
        } else {
          const page = await store.list(fetchLimit, signal);
          memories = page.memories;
          mayHaveMore = page.hasMore;
        }
        const items = memories.slice(offset, offset + limit + 1);
        return {
          items: items.slice(0, limit).map(memoryApiItem),
          count: Math.min(items.length, limit),
          limit,
          offset,
          hasMore: items.length > limit || mayHaveMore,
          ...(method ? { method } : {}),
          ...(fallbackReason ? { fallbackReason } : {}),
        };
      });

      app.get<{ Params: { id: string } }>('/memory/:id', {
        schema: {
          params: memoryIdParams,
          response: { 400: apiError, 403: apiError, 404: apiError },
        },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        if (BigInt(request.params.id) > MAX_SQL_BIGINT) {
          return reply.code(400).send({ error: 'Invalid memory ID' });
        }
        const versions = await store.history(
          request.params.id,
          MAX_MEMORY_API_HISTORY + 1,
          AbortSignal.timeout(30_000),
        );
        const current = versions[0];
        if (!current) return reply.code(404).send({ error: 'Memory not found' });
        return {
          ...memoryApiItem(current),
          category: current.category,
          key: memoryContainsCredential(current) ? '[redacted]' : current.key,
          content: memoryContainsCredential(current) ? '[redacted]' : current.content,
          history: versions.slice(0, MAX_MEMORY_API_HISTORY).map(memoryHistoryItem),
          mayHaveMore: versions.length > MAX_MEMORY_API_HISTORY,
        };
      });

      app.patch<{ Params: { id: string }; Body: { text: string } }>('/memory/:id', {
        schema: {
          params: memoryIdParams,
          body: {
            type: 'object',
            properties: { text: { type: 'string', minLength: 1, maxLength: 2_000 } },
            required: ['text'],
            additionalProperties: false,
          },
          response: { 400: apiError, 403: apiError, 404: apiError },
        },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        if (BigInt(request.params.id) > MAX_SQL_BIGINT) {
          return reply.code(400).send({ error: 'Invalid memory ID' });
        }
        const text = request.body.text.trim();
        if (!text || text.length > 2_000) {
          return reply.code(400).send({ error: 'Memory text is invalid' });
        }
        const signal = AbortSignal.timeout(30_000);
        const versions = await store.history(request.params.id, 1, signal);
        const current = versions[0];
        if (!current) return reply.code(404).send({ error: 'Memory not found' });
        try {
          validateMemoryWrite(current.category, current.key, current.sourceText, text, false);
        } catch (error) {
          if (error instanceof ToolRefusal) return reply.code(400).send({ error: error.message });
          throw error;
        }
        const embedding = await embed(text, signal, request);
        const corrected = await store.correct(request.params.id, {
          category: current.category, key: current.key, content: text,
          source: {
            kind: 'settings',
            requestId: request.id,
            ownerObjectId: request.principal!.objectId,
          },
          embedding: embedding.value,
          embeddingModel: embedding.model,
        }, signal);
        return { item: memoryApiItem(corrected.memory), commitUrl: null };
      });

      app.delete<{ Params: { id: string } }>('/memory/:id', {
        schema: {
          params: memoryIdParams,
          response: { 400: apiError, 403: apiError, 404: apiError, 204: { type: 'null' } },
        },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        if (BigInt(request.params.id) > MAX_SQL_BIGINT) {
          return reply.code(400).send({ error: 'Invalid memory ID' });
        }
        const signal = AbortSignal.timeout(30_000);
        const versions = await store.history(request.params.id, 1, signal);
        if (!versions[0]) return reply.code(404).send({ error: 'Memory not found' });
        const forgotten = await store.forget(request.params.id, {
          kind: 'settings',
          requestId: request.id,
          ownerObjectId: request.principal!.objectId,
        }, signal);
        if (!forgotten) return reply.code(404).send({ error: 'Memory not found' });
        return reply.code(204).send();
      });
    },
  };
}

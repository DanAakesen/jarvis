import {
  VectorSearchUnavailableError, rankByCosineSimilarity,
  type MemoryActionSource, type MemoryCategory, type MemoryRecord, type MemorySaveInput, type MemorySaveResult, type MemorySource,
  type MemoryStore, type MemoryVersion,
} from '../../../database/memory-store.js';
import { MEMORY_EMBEDDING_DIMENSIONS, type MemoryEmbedder } from '../../../core/memory-embeddings.js';

/**
 * The memory side of the notes group: a deterministic stand-in for the embedding service (words hashed into a 1536-number
 * vector, so texts that share words are close) and an in-memory `MemoryStore` with the rules of the SQL one: a key is unique
 * per category, a change keeps the earlier version, forgetting removes every version, and vector search needs a matching model.
 */

export const conformanceEmbeddingModel = 'conformance-embedding';

const fillerWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'his', 'her', 'has', 'have', 'dan']);

export function hashEmbedding(text: string): number[] {
  const vector = new Array<number>(MEMORY_EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
    if (fillerWords.has(word)) continue;
    let hash = 2_166_136_261;
    for (const character of word) hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619);
    vector[(hash >>> 0) % MEMORY_EMBEDDING_DIMENSIONS]! += 1;
  }
  let norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) { vector[0] = 1; norm = 1; }
  return vector.map((value) => value / norm);
}

export function createHashEmbedder(): MemoryEmbedder {
  return { model: conformanceEmbeddingModel, embed: async (text) => hashEmbedding(text) };
}

interface StoredMemory extends MemoryRecord {
  embedding: readonly number[] | null;
  embeddingModel: string | null;
  quarantined: boolean;
}

export interface MemorySeed {
  readonly category: MemoryCategory;
  readonly key: string;
  readonly content: string;
  /** What Dan said in the message the memory came from. */
  readonly sourceText: string;
  readonly sourceMessageId: string;
  /** Earlier wordings, oldest first, kept as history. */
  readonly earlier?: readonly string[];
}

export type ConformanceMemoryStore = MemoryStore & { readonly records: ReadonlyMap<string, MemoryRecord> };

const publicRecord = (record: StoredMemory): MemoryRecord => ({
  id: record.id, category: record.category, key: record.key, content: record.content, sourceMessageId: record.sourceMessageId,
  settingsAction: record.settingsAction, sourceText: record.sourceText, sourceTextTruncated: record.sourceTextTruncated,
  revision: record.revision, updatedAt: record.updatedAt,
});

export function createMemoryStoreFake(options: {
  /** The stored Dan message of the current turn, as `getSourceMessage` answers it. */
  readonly getSourceMessage: (messageId: string, signal: AbortSignal) => Promise<MemorySource | null>;
  readonly seeds?: readonly MemorySeed[];
}): ConformanceMemoryStore {
  const records = new Map<string, StoredMemory>();
  const versions = new Map<string, MemoryVersion[]>();
  let nextId = 1;
  const clip = (text: string) => ({ sourceText: text.slice(0, 500), sourceTextTruncated: text.length > 500 });

  async function provenance(source: MemoryActionSource, signal: AbortSignal) {
    if (source.kind === 'settings') {
      return { sourceMessageId: null, settingsAction: { requestId: source.requestId, ownerObjectId: source.ownerObjectId }, sourceText: '', sourceTextTruncated: false };
    }
    const found = await options.getSourceMessage(source.messageId, signal);
    if (!found) throw new Error('Memory source message is unavailable.');
    return { sourceMessageId: source.messageId, settingsAction: null, ...clip(found.text) };
  }

  async function write(input: MemorySaveInput, signal: AbortSignal, targetId?: string): Promise<MemorySaveResult> {
    signal.throwIfAborted();
    if (input.embedding !== null && (input.embedding.length !== MEMORY_EMBEDDING_DIMENSIONS || !input.embedding.every(Number.isFinite))) {
      throw new TypeError('Memory embedding is invalid');
    }
    const next = await provenance(input.source, signal);
    const existing = targetId === undefined
      ? [...records.values()].find((record) => record.category === input.category && record.key === input.key)
      : records.get(targetId);
    if (targetId !== undefined) {
      if (!existing) throw new Error('Memory not found.');
      if (existing.category !== input.category || existing.key !== input.key) throw new Error('Memory identity cannot be changed.');
    }
    if (!existing) {
      const created: StoredMemory = {
        id: String(nextId++), category: input.category, key: input.key, content: input.content, ...next, revision: 1, updatedAt: new Date(),
        embedding: input.embedding, embeddingModel: input.embedding === null ? null : input.embeddingModel, quarantined: false,
      };
      records.set(created.id, created);
      return { memory: publicRecord(created), created: true, changed: true };
    }
    const contentChanged = existing.content !== input.content;
    const provenanceChanged = existing.sourceMessageId !== next.sourceMessageId
      || JSON.stringify(existing.settingsAction) !== JSON.stringify(next.settingsAction);
    if (contentChanged || provenanceChanged) {
      versions.set(existing.id, [{ ...publicRecord(existing), changedAt: new Date() }, ...(versions.get(existing.id) ?? [])]);
      Object.assign(existing, {
        content: input.content, ...next, revision: existing.revision + 1, updatedAt: new Date(),
        embedding: input.embedding ?? (contentChanged ? null : existing.embedding),
        embeddingModel: input.embedding === null ? (contentChanged ? null : existing.embeddingModel) : input.embeddingModel,
        quarantined: false,
      });
    }
    return { memory: publicRecord(existing), created: false, changed: contentChanged || provenanceChanged };
  }

  const newestFirst = (left: StoredMemory, right: StoredMemory) =>
    right.updatedAt.getTime() - left.updatedAt.getTime() || Number(BigInt(right.id) - BigInt(left.id));

  const store: ConformanceMemoryStore = {
    records,
    async initialize() {},
    supportsVectorSearch: () => true,
    getSourceMessage: (messageId, signal) => options.getSourceMessage(messageId, signal),
    save: (input, signal) => write(input, signal),
    correct: (memoryId, input, signal) => write(input, signal, memoryId),
    async list(limit, signal) {
      signal.throwIfAborted();
      const ordered = [...records.values()].sort(newestFirst);
      return { memories: ordered.slice(0, limit).map(publicRecord), hasMore: ordered.length > limit };
    },
    async history(memoryId, limit, signal) {
      signal.throwIfAborted();
      const current = records.get(memoryId);
      if (!current) return [];
      return [{ ...publicRecord(current), changedAt: current.updatedAt }, ...(versions.get(memoryId) ?? [])].slice(0, limit);
    },
    async forget(memoryId, _source, signal) {
      signal.throwIfAborted();
      const current = records.get(memoryId);
      if (!current) return null;
      records.delete(memoryId);
      versions.delete(memoryId);
      return { category: current.category, key: current.key };
    },
    async searchByVector(embedding, model, limit, signal) {
      signal.throwIfAborted();
      if (embedding.length !== MEMORY_EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) throw new VectorSearchUnavailableError();
      const candidates = [...records.values()]
        .filter((record) => record.embedding !== null && record.embeddingModel === model && !record.quarantined)
        .sort(newestFirst)
        .map((record) => ({ embedding: record.embedding!, value: publicRecord(record) }));
      return rankByCosineSimilarity(embedding, candidates, limit);
    },
    async searchByFullText(terms, limit, signal) {
      signal.throwIfAborted();
      const lowered = terms.map((term) => term.toLowerCase());
      const matches = [...records.values()]
        .filter((record) => lowered.some((term) => record.key.toLowerCase().includes(term) || record.content.toLowerCase().includes(term)))
        .sort(newestFirst);
      return { method: 'substring', memories: matches.slice(0, limit).map(publicRecord) };
    },
    async embeddingsToBackfill(model, afterId, limit, signal) {
      signal.throwIfAborted();
      return [...records.values()]
        .filter((record) => BigInt(record.id) > BigInt(afterId) && !record.quarantined && (record.embedding === null || record.embeddingModel !== model))
        .sort((left, right) => Number(BigInt(left.id) - BigInt(right.id)))
        .slice(0, limit).map(publicRecord);
    },
    async quarantineEmbedding(memoryId, revision, _reason, signal) {
      signal.throwIfAborted();
      const record = records.get(memoryId);
      if (!record || record.revision !== revision || record.quarantined) return false;
      record.quarantined = true;
      return true;
    },
    async updateEmbedding(memoryId, revision, model, embedding, signal) {
      signal.throwIfAborted();
      const record = records.get(memoryId);
      if (!record || record.revision !== revision) return false;
      Object.assign(record, { embedding, embeddingModel: model });
      return true;
    },
  };

  const day = 86_400_000;
  for (const seed of options.seeds ?? []) {
    const id = String(nextId++);
    const base = { id, category: seed.category, key: seed.key, sourceMessageId: seed.sourceMessageId, settingsAction: null, ...clip(seed.sourceText) };
    const earlier = seed.earlier ?? [];
    versions.set(id, earlier.map((content, index): MemoryVersion => {
      const at = new Date(Date.now() - (earlier.length - index) * day);
      return { ...base, content, revision: index + 1, updatedAt: at, changedAt: at };
    }).reverse());
    records.set(id, {
      ...base, content: seed.content, revision: earlier.length + 1, updatedAt: new Date(Date.now() - 3_600_000),
      embedding: hashEmbedding(seed.content), embeddingModel: conformanceEmbeddingModel, quarantined: false,
    });
  }
  return store;
}

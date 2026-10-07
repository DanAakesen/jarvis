import { createHash } from 'node:crypto';
import sql from 'mssql';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { databaseReadRequest } from './wake-retry.js';

export type MemoryCategory = 'preference' | 'project_fact' | 'decision' | 'unfinished_task';
export type MemorySearchMethod = 'vector' | 'fulltext' | 'substring';

export interface MemorySource {
  readonly messageId: string;
  readonly text: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly category: MemoryCategory;
  readonly key: string;
  readonly content: string;
  readonly sourceMessageId: string;
  readonly sourceText: string;
  readonly sourceTextTruncated: boolean;
  readonly revision: number;
  readonly updatedAt: Date;
}

export interface MemoryVersion extends MemoryRecord {
  readonly changedAt: Date;
}

export interface MemorySaveInput {
  readonly category: MemoryCategory;
  readonly key: string;
  readonly content: string;
  readonly sourceMessageId: string;
  readonly embedding: readonly number[] | null;
  readonly embeddingModel: string | null;
}

export interface MemorySaveResult {
  readonly memory: MemoryRecord;
  readonly created: boolean;
  readonly changed: boolean;
}

export interface MemoryStore {
  initialize(): Promise<void>;
  supportsVectorSearch(): boolean;
  getSourceMessage(messageId: string, signal: AbortSignal): Promise<MemorySource | null>;
  save(input: MemorySaveInput, signal: AbortSignal): Promise<MemorySaveResult>;
  correct(memoryId: string, input: MemorySaveInput, signal: AbortSignal): Promise<MemorySaveResult>;
  list(limit: number, signal: AbortSignal): Promise<{
    readonly memories: MemoryRecord[];
    readonly hasMore: boolean;
  }>;
  history(memoryId: string, limit: number, signal: AbortSignal): Promise<MemoryVersion[]>;
  forget(memoryId: string, requestMessageId: string, signal: AbortSignal): Promise<Pick<MemoryRecord, 'category' | 'key'> | null>;
  searchByVector(
    embedding: readonly number[],
    embeddingModel: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<MemoryRecord[]>;
  embeddingsToBackfill(
    model: string,
    afterId: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly content: string; readonly revision: number }[]>;
  updateEmbedding(
    memoryId: string,
    revision: number,
    model: string,
    embedding: readonly number[],
    signal: AbortSignal,
  ): Promise<boolean>;
  searchByFullText(terms: readonly string[], limit: number, signal: AbortSignal): Promise<{
    readonly method: 'fulltext' | 'substring';
    readonly memories: MemoryRecord[];
  }>;
}

export interface VaultIndexedFile {
  readonly path: string;
  readonly blobSha: string;
  readonly embeddingMissing: boolean;
}

export interface VaultIndexedChunk {
  readonly index: number;
  readonly heading: string;
  readonly content: string;
  readonly embedding: readonly number[] | null;
  readonly embeddingModel: string | null;
}

export interface VaultSearchHit {
  readonly path: string;
  readonly heading: string;
  readonly content: string;
  readonly score?: number;
}

export interface VaultGraphFile {
  readonly path: string;
  readonly title: string;
  readonly updatedAt: Date;
}

export interface VaultGraphData {
  readonly links: readonly { readonly sourcePath: string; readonly targetPath: string }[];
  readonly similarities: readonly {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly score: number;
  }[];
  readonly embeddings: readonly { readonly path: string; readonly embedding: readonly number[] }[];
  /** Indexed chunk text per note, so links resolve without re-indexing unchanged notes. */
  readonly contents?: readonly { readonly path: string; readonly content: string }[];
}

/** Mean note embeddings of related notes typically score 0.4-0.6; 0.35 keeps real neighbours only. */
export const vaultSimilarityThreshold = 0.35;

export interface VaultIndexStore {
  initialize(): Promise<void>;
  supportsVectorSearch(): boolean;
  files(embeddingModel: string | null, signal: AbortSignal): Promise<VaultIndexedFile[]>;
  replaceFile(
    path: string,
    blobSha: string,
    chunks: readonly VaultIndexedChunk[],
    links: readonly string[],
    signal: AbortSignal,
  ): Promise<void>;
  deleteFiles(paths: readonly string[], signal: AbortSignal): Promise<void>;
  graphFiles(signal: AbortSignal): Promise<VaultGraphFile[]>;
  graphData(paths: readonly string[], embeddingModel: string, signal: AbortSignal): Promise<VaultGraphData>;
  searchByVector(embedding: readonly number[], embeddingModel: string, limit: number, signal: AbortSignal): Promise<VaultSearchHit[]>;
  searchByTerms(terms: readonly string[], limit: number, signal: AbortSignal): Promise<VaultSearchHit[]>;
}

export class VectorSearchUnavailableError extends Error {
  constructor() {
    super('SQL vector search is unavailable');
    this.name = 'VectorSearchUnavailableError';
  }
}

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const sqlId = /^[1-9]\d{0,18}$/;
const vectorDimensions = 1536;
const maxVectorCandidates = 10_000;
const fullTextSetupPath = fileURLToPath(
  new URL('../../../../db/migrations/setup/0016_long_term_memory.sql', import.meta.url),
);

function parseEmbedding(value: unknown): number[] | undefined {
  let embedding = value;
  if (typeof value === 'string') {
    try {
      embedding = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  return Array.isArray(embedding) && embedding.length === vectorDimensions &&
    embedding.every((component) => typeof component === 'number' && Number.isFinite(component))
    ? embedding
    : undefined;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length !== vectorDimensions || right.length !== vectorDimensions) return undefined;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < vectorDimensions; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return undefined;
  if (!Number.isFinite(dot) || !Number.isFinite(leftNorm) || !Number.isFinite(rightNorm)) return undefined;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

export function rankByCosineSimilarity<T>(
  query: readonly number[],
  candidates: readonly { readonly embedding: readonly number[]; readonly value: T }[],
  limit: number,
): T[] {
  return candidates.flatMap(({ embedding, value }, order) => {
    const score = cosineSimilarity(query, embedding);
    return score === undefined ? [] : [{ value, score, order }];
  }).sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit).map(({ value }) => value);
}

function toSqlId(value: string): bigint {
  if (!sqlId.test(value) || BigInt(value) > maxSqlBigInt) throw new TypeError('Invalid memory ID');
  return BigInt(value);
}

async function execute<T>(
  request: sql.Request,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await work();
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function recordFromRow(row: {
  id: string;
  category: MemoryCategory;
  memory_key: string;
  content: string;
  source_message_id: string;
  source_text: string;
  source_text_truncated: boolean;
  revision: number;
  updated_at: Date;
}): MemoryRecord {
  return {
    id: row.id,
    category: row.category,
    key: row.memory_key,
    content: row.content,
    sourceMessageId: row.source_message_id,
    sourceText: row.source_text,
    sourceTextTruncated: row.source_text_truncated,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

const memoryColumns = `CONVERT(varchar(20), m.id) AS id, m.category, m.memory_key, m.content,
  CONVERT(varchar(20), m.source_message_id) AS source_message_id,
  LEFT(source.text, 500) AS source_text,
  CONVERT(bit, CASE WHEN LEN(source.text) > 500 THEN 1 ELSE 0 END) AS source_text_truncated,
  m.revision, m.updated_at`;
const sourceJoin = `INNER JOIN dbo.messages AS source
  ON source.id = m.source_message_id AND source.role = N'dan'`;

export function createMemoryStore(pool: sql.ConnectionPool): MemoryStore {
  let vectorSearchAvailable = false;
  let jsonEmbeddingAvailable = false;
  let fullTextSearchAvailable = false;
  let initialized = false;

  async function readMemories(
    statement: string,
    bind: (request: sql.Request) => sql.Request,
    signal: AbortSignal,
  ): Promise<MemoryRecord[]> {
    const request = bind(databaseReadRequest(pool));
    const result = await execute(request, signal, () => request.query(statement));
    return result.recordset.map(recordFromRow);
  }

  async function writeMemory(
    input: MemorySaveInput,
    signal: AbortSignal,
    memoryId?: string,
  ): Promise<MemorySaveResult> {
    const sourceMessageId = toSqlId(input.sourceMessageId);
    if (input.embedding !== null && !parseEmbedding(input.embedding)) {
      throw new TypeError('Memory embedding is invalid');
    }
    if (input.embedding !== null &&
        (typeof input.embeddingModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.embeddingModel))) {
      throw new TypeError('Memory embedding model is invalid');
    }
    const targetId = memoryId === undefined ? null : toSqlId(memoryId);
    const embeddingModel = vectorSearchAvailable || jsonEmbeddingAvailable ? input.embeddingModel : null;
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    let committed = false;
    try {
      const request = new sql.Request(transaction)
        .input('category', sql.NVarChar(24), input.category)
        .input('memoryKey', sql.NVarChar(100), input.key)
        .input('content', sql.NVarChar(2000), input.content)
        .input('sourceMessageId', sql.BigInt, sourceMessageId)
        .input('targetId', sql.BigInt, targetId)
        .input('embedding', sql.NVarChar(sql.MAX), input.embedding === null ? null : JSON.stringify(input.embedding))
        .input('embeddingModel', sql.NVarChar(128), input.embedding === null ? null : embeddingModel);
      const embeddingColumn = vectorSearchAvailable ? ', embedding' : jsonEmbeddingAvailable ? ', embedding_json' : '';
      const embeddingValue = vectorSearchAvailable
        ? ', CASE WHEN @embedding IS NULL THEN NULL ELSE CAST(@embedding AS vector(1536)) END'
        : jsonEmbeddingAvailable ? ', @embedding' : '';
      const embeddingUpdate = vectorSearchAvailable
        ? `, embedding = CASE
            WHEN @contentChanged = 1 OR (@embeddingModel IS NOT NULL AND ISNULL(embedding_model, N'') <> @embeddingModel)
              THEN CAST(@embedding AS vector(1536))
            ELSE embedding
          END`
        : jsonEmbeddingAvailable
          ? `, embedding_json = CASE
              WHEN @contentChanged = 1 OR (@embeddingModel IS NOT NULL AND ISNULL(embedding_model, N'') <> @embeddingModel)
                THEN @embedding
              ELSE embedding_json
            END`
          : '';
      const statement = `DECLARE @memoryId bigint;
        DECLARE @created bit = 0;
        DECLARE @changed bit = 0;
        DECLARE @contentChanged bit = 0;
        DECLARE @oldContent nvarchar(2000);
        DECLARE @oldSourceMessageId bigint;

        IF NOT EXISTS (
          SELECT 1 FROM dbo.messages
          WHERE id = @sourceMessageId AND role = N'dan'
        )
          THROW 51000, 'Memory source message is unavailable.', 1;

        IF @targetId IS NULL
          SELECT @memoryId = id FROM dbo.memories WITH (UPDLOCK, HOLDLOCK)
          WHERE category = @category AND memory_key = @memoryKey;
        ELSE
          SELECT @memoryId = id FROM dbo.memories WITH (UPDLOCK, HOLDLOCK)
          WHERE id = @targetId;

        IF @targetId IS NOT NULL AND @memoryId IS NOT NULL
          AND EXISTS (SELECT 1 FROM dbo.memories WHERE id = @memoryId
            AND (category <> @category OR memory_key <> @memoryKey))
          THROW 51001, 'Memory identity cannot be changed.', 1;

        IF @memoryId IS NULL
        BEGIN
          IF @targetId IS NOT NULL
            THROW 51002, 'Memory not found.', 1;
          INSERT INTO dbo.memories (category, memory_key, content, source_message_id, embedding_model${embeddingColumn})
           VALUES (@category, @memoryKey, @content, @sourceMessageId, @embeddingModel${embeddingValue});
          SET @memoryId = CONVERT(bigint, SCOPE_IDENTITY());
          SET @created = 1;
          SET @changed = 1;
        END
        ELSE
        BEGIN
          SELECT @oldContent = content, @oldSourceMessageId = source_message_id
          FROM dbo.memories WHERE id = @memoryId;
          SET @contentChanged = CASE WHEN
            @oldContent COLLATE Latin1_General_100_BIN2 <> @content COLLATE Latin1_General_100_BIN2
            THEN 1 ELSE 0 END;
          IF @contentChanged = 1 OR @oldSourceMessageId <> @sourceMessageId
          BEGIN
            INSERT INTO dbo.memory_history
              (memory_id, revision, category, memory_key, content, source_message_id)
            SELECT id, revision, category, memory_key, content, source_message_id
            FROM dbo.memories WHERE id = @memoryId;
            UPDATE dbo.memories
            SET content = @content, source_message_id = @sourceMessageId,
              revision = revision + 1, updated_at = SYSUTCDATETIME()${embeddingUpdate}
              , embedding_model = CASE
                WHEN @contentChanged = 1 OR (@embeddingModel IS NOT NULL AND ISNULL(embedding_model, N'') <> @embeddingModel)
                  THEN @embeddingModel
                ELSE embedding_model
              END
            WHERE id = @memoryId;
            SET @changed = 1;
          END
          ELSE IF @embeddingModel IS NOT NULL AND EXISTS (
            SELECT 1 FROM dbo.memories WHERE id = @memoryId AND
              (embedding_model IS NULL OR embedding_model <> @embeddingModel)
          )
          BEGIN
            UPDATE dbo.memories
            SET embedding_model = @embeddingModel${embeddingUpdate}
            WHERE id = @memoryId;
          END
        END;

        SELECT CONVERT(varchar(20), @memoryId) AS id, @created AS created, @changed AS changed,
          m.category, m.memory_key, m.content, CONVERT(varchar(20), m.source_message_id) AS source_message_id,
          LEFT(source.text, 500) AS source_text,
          CONVERT(bit, CASE WHEN LEN(source.text) > 500 THEN 1 ELSE 0 END) AS source_text_truncated,
          m.revision, m.updated_at
        FROM dbo.memories AS m
        ${sourceJoin}
        WHERE m.id = @memoryId;`;
      const result = await execute(request, signal, () => request.query(statement));
      const row = result.recordset[0] as ({
        created: boolean;
        changed: boolean;
      } & Parameters<typeof recordFromRow>[0]) | undefined;
      if (!row) throw new Error('Memory save did not return the saved record');
      await transaction.commit();
      committed = true;
      return { memory: recordFromRow(row), created: row.created, changed: row.changed };
    } finally {
      if (!committed) await transaction.rollback();
    }
  }

  return {
    async initialize() {
      if (initialized) return;
      const fullTextSetup = await readFile(fullTextSetupPath, 'utf8');
      await pool.request().query(fullTextSetup);
      const result = await pool.request().query<{
        vector_search: boolean;
        json_embedding_search: boolean;
        fulltext_search: boolean;
      }>(`DECLARE @fullTextInstalled bit = 0;
        BEGIN TRY
          SET @fullTextInstalled = CASE
            WHEN FULLTEXTSERVICEPROPERTY(N'IsFullTextInstalled') = 1 THEN 1 ELSE 0 END;
        END TRY
        BEGIN CATCH
          SET @fullTextInstalled = 0;
        END CATCH;
        SELECT CONVERT(bit, CASE
          WHEN TYPE_ID(N'vector') IS NOT NULL
            AND COL_LENGTH(N'dbo.memories', N'embedding') IS NOT NULL THEN 1 ELSE 0 END) AS vector_search,
        CONVERT(bit, CASE
          WHEN TYPE_ID(N'vector') IS NULL
            AND COL_LENGTH(N'dbo.memories', N'embedding_json') IS NOT NULL THEN 1 ELSE 0 END) AS json_embedding_search,
        CONVERT(bit, CASE
          WHEN @fullTextInstalled = 1
            AND EXISTS (SELECT 1 FROM sys.fulltext_indexes
              WHERE object_id = OBJECT_ID(N'dbo.memories')) THEN 1 ELSE 0 END) AS fulltext_search;`);
      vectorSearchAvailable = result.recordset[0]?.vector_search === true;
      jsonEmbeddingAvailable = result.recordset[0]?.json_embedding_search === true;
      fullTextSearchAvailable = result.recordset[0]?.fulltext_search === true;
      initialized = true;
    },

    supportsVectorSearch() {
      return initialized && (vectorSearchAvailable || jsonEmbeddingAvailable);
    },

    async getSourceMessage(messageId, signal) {
      const id = toSqlId(messageId);
      const request = databaseReadRequest(pool).input('messageId', sql.BigInt, id);
      const result = await execute(request, signal, () => request.query<{
        id: string;
        text: string;
      }>(`SELECT CONVERT(varchar(20), id) AS id, text
        FROM dbo.messages WHERE id = @messageId AND role = N'dan';`));
      const row = result.recordset[0];
      return row ? { messageId: row.id, text: row.text } : null;
    },

    async save(input, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      return writeMemory(input, signal);
    },

    async correct(memoryId, input, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      return writeMemory(input, signal, memoryId);
    },

    async list(limit, signal) {
      const rows = await readMemories(`SELECT TOP (@take) ${memoryColumns}
        FROM dbo.memories AS m
        ${sourceJoin}
        ORDER BY m.updated_at DESC, m.id DESC;`,
      (request) => request.input('take', sql.Int, limit + 1), signal);
      return { memories: rows.slice(0, limit), hasMore: rows.length > limit };
    },

    async history(memoryId, limit, signal) {
      const id = toSqlId(memoryId);
      const request = databaseReadRequest(pool)
        .input('memoryId', sql.BigInt, id)
        .input('take', sql.Int, limit);
      const result = await execute(request, signal, () => request.query<{
        id: string;
        category: MemoryCategory;
        memory_key: string;
        content: string;
        source_message_id: string;
        source_text: string;
        source_text_truncated: boolean;
        revision: number;
        changed_at: Date;
      }>(`SELECT TOP (@take) CONVERT(varchar(20), versions.memory_id) AS id, versions.category,
          versions.memory_key, versions.content, CONVERT(varchar(20), versions.source_message_id) AS source_message_id,
          LEFT(source.text, 500) AS source_text,
          CONVERT(bit, CASE WHEN LEN(source.text) > 500 THEN 1 ELSE 0 END) AS source_text_truncated,
          versions.revision, versions.changed_at
        FROM (
          SELECT id AS memory_id, category, memory_key, content, source_message_id, revision, updated_at AS changed_at
          FROM dbo.memories WHERE id = @memoryId
          UNION ALL
          SELECT memory_id, category, memory_key, content, source_message_id, revision, changed_at
          FROM dbo.memory_history WHERE memory_id = @memoryId
        ) AS versions
        INNER JOIN dbo.messages AS source
          ON source.id = versions.source_message_id AND source.role = N'dan'
        ORDER BY versions.revision DESC;`));
      return result.recordset.map((row) => ({
        ...recordFromRow({ ...row, updated_at: row.changed_at }),
        changedAt: row.changed_at,
      }));
    },

    async forget(memoryId, requestMessageId, signal) {
      const id = toSqlId(memoryId);
      const requestId = toSqlId(requestMessageId);
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      let committed = false;
      try {
        const request = new sql.Request(transaction)
          .input('memoryId', sql.BigInt, id)
          .input('requestMessageId', sql.BigInt, requestId);
        const result = await execute(request, signal, () => request.query<{
          category: MemoryCategory;
          memory_key: string;
        }>(`DECLARE @category nvarchar(24);
          DECLARE @memoryKey nvarchar(100);
          IF NOT EXISTS (SELECT 1 FROM dbo.messages WHERE id = @requestMessageId AND role = N'dan')
            THROW 51000, 'Memory source message is unavailable.', 1;
          SELECT @category = category, @memoryKey = memory_key
          FROM dbo.memories WITH (UPDLOCK, HOLDLOCK) WHERE id = @memoryId;
          IF @category IS NOT NULL
          BEGIN
            INSERT INTO dbo.memory_deletions (memory_id, request_message_id)
            VALUES (@memoryId, @requestMessageId);
            DELETE FROM dbo.memories WHERE id = @memoryId;
          END;
          SELECT @category AS category, @memoryKey AS memory_key;`));
        await transaction.commit();
        committed = true;
        const row = result.recordset[0];
        return row?.category ? { category: row.category, key: row.memory_key } : null;
      } finally {
        if (!committed) await transaction.rollback();
      }
    },

    async searchByVector(embedding, embeddingModel, limit, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      if (embedding.length !== vectorDimensions || !embedding.every(Number.isFinite) ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(embeddingModel) ||
          (!vectorSearchAvailable && !jsonEmbeddingAvailable)) {
        throw new VectorSearchUnavailableError();
      }
      if (jsonEmbeddingAvailable) {
        const request = databaseReadRequest(pool)
          .input('take', sql.Int, maxVectorCandidates)
          .input('embeddingModel', sql.NVarChar(128), embeddingModel);
        const result = await execute(request, signal, () => request.query<{
          embedding_json: string | null;
        } & Parameters<typeof recordFromRow>[0]>(`SELECT TOP (@take) ${memoryColumns}, m.embedding_json
          FROM dbo.memories AS m
          ${sourceJoin}
          WHERE m.embedding_json IS NOT NULL AND m.embedding_model = @embeddingModel
          ORDER BY m.updated_at DESC, m.id DESC;`));
        return rankByCosineSimilarity(embedding, result.recordset.flatMap((row) => {
          const vector = parseEmbedding(row.embedding_json);
          return vector ? [{ embedding: vector, value: recordFromRow(row) }] : [];
        }), limit);
      }
      try {
        return await readMemories(`SELECT TOP (@take) ${memoryColumns}
          FROM dbo.memories AS m
          ${sourceJoin}
          WHERE m.embedding IS NOT NULL AND m.embedding_model = @embeddingModel
          ORDER BY VECTOR_DISTANCE('cosine', m.embedding, CAST(@embedding AS vector(1536))), m.id DESC;`,
        (bound) => {
          bound.input('take', sql.Int, limit);
          bound.input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding));
          bound.input('embeddingModel', sql.NVarChar(128), embeddingModel);
          return bound;
        }, signal);
      } catch (error) {
        const number = (error as { number?: unknown } | null)?.number;
        if (number === 195 || number === 206) throw new VectorSearchUnavailableError();
        throw error;
      }
    },

    async embeddingsToBackfill(embeddingModel, afterId, limit, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(embeddingModel) ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
          !/^(?:0|[1-9]\d{0,18})$/u.test(afterId)) {
        throw new TypeError('Memory embedding backfill request is invalid');
      }
      if (!vectorSearchAvailable && !jsonEmbeddingAvailable) return [];
      const request = databaseReadRequest(pool)
        .input('take', sql.Int, limit)
        .input('afterId', sql.BigInt, BigInt(afterId))
        .input('embeddingModel', sql.NVarChar(128), embeddingModel);
      const result = await execute(request, signal, () => request.query<{
        id: string;
        content: string;
        revision: number;
      }>(`SELECT TOP (@take) CONVERT(varchar(20), m.id) AS id, m.content, m.revision
        FROM dbo.memories AS m
        WHERE m.id > @afterId AND (m.embedding_model IS NULL OR m.embedding_model <> @embeddingModel
          OR ${vectorSearchAvailable ? 'm.embedding IS NULL' : 'm.embedding_json IS NULL'})
        ORDER BY m.id;`));
      return result.recordset;
    },

    async updateEmbedding(memoryId, revision, embeddingModel, embedding, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      const id = toSqlId(memoryId);
      if (!Number.isSafeInteger(revision) || revision < 1 ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(embeddingModel) || !parseEmbedding(embedding)) {
        throw new TypeError('Memory embedding update is invalid');
      }
      if (!vectorSearchAvailable && !jsonEmbeddingAvailable) return false;
      const request = databaseReadRequest(pool)
        .input('memoryId', sql.BigInt, id)
        .input('revision', sql.Int, revision)
        .input('embeddingModel', sql.NVarChar(128), embeddingModel)
        .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding));
      const embeddingUpdate = vectorSearchAvailable
        ? 'embedding = CAST(@embedding AS vector(1536))'
        : 'embedding_json = @embedding';
      const result = await execute(request, signal, () => request.query<{ id: string }>(
        `UPDATE dbo.memories SET ${embeddingUpdate}, embedding_model = @embeddingModel
          OUTPUT CONVERT(varchar(20), inserted.id) AS id
          WHERE id = @memoryId AND revision = @revision
            AND (embedding_model IS NULL OR embedding_model <> @embeddingModel
              OR ${vectorSearchAvailable ? 'embedding IS NULL' : 'embedding_json IS NULL'});`,
      ));
      return result.recordset.length > 0;
    },

    async searchByFullText(terms, limit, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      if (terms.length === 0) return { method: 'substring', memories: [] };
      if (fullTextSearchAvailable) {
        const condition = terms.map((term) => `"${term}"`).join(' OR ');
        return {
          method: 'fulltext',
          memories: await readMemories(`SELECT TOP (@take) ${memoryColumns}
            FROM CONTAINSTABLE(dbo.memories, (memory_key, content), @condition, @take) AS matches
            INNER JOIN dbo.memories AS m ON m.id = matches.[KEY]
            ${sourceJoin}
            ORDER BY matches.[RANK] DESC, m.updated_at DESC, m.id DESC;`,
          (request) => request
            .input('take', sql.Int, limit)
            .input('condition', sql.NVarChar(1000), condition), signal),
        };
      }

      return {
        method: 'substring',
        memories: await readMemories(`SELECT TOP (@take) ${memoryColumns}
          FROM dbo.memories AS m
          ${sourceJoin}
          WHERE EXISTS (
            SELECT 1 FROM OPENJSON(@terms) AS term
            WHERE m.memory_key LIKE N'%' + term.value + N'%'
              OR m.content LIKE N'%' + term.value + N'%'
          )
          ORDER BY m.updated_at DESC, m.id DESC;`,
        (request) => request
          .input('take', sql.Int, limit)
          .input('terms', sql.NVarChar(2000), JSON.stringify(terms)), signal),
      };
    },
  };
}

export function createVaultIndexStore(pool: sql.ConnectionPool): VaultIndexStore {
  let initialized = false;
  let vectorSearchAvailable = false;
  let jsonEmbeddingAvailable = false;
  let embeddingMatrix: Array<VaultSearchHit & {
    readonly chunkIndex: number;
    readonly embedding: readonly number[];
    readonly embeddingModel: string;
  }> | undefined;
  let embeddingMatrixRevision = 0;
  let embeddingMatrixLoad: Promise<Array<VaultSearchHit & {
    readonly chunkIndex: number;
    readonly embedding: readonly number[];
    readonly embeddingModel: string;
  }>> | undefined;

  function pathHash(path: string): Buffer {
    return createHash('sha256').update(path, 'utf8').digest();
  }

  function ensureInitialized(): void {
    if (!initialized) throw new Error('Vault index store is not initialized');
  }

  function invalidateEmbeddingMatrix(): void {
    embeddingMatrixRevision += 1;
    embeddingMatrix = undefined;
    embeddingMatrixLoad = undefined;
  }

  async function loadEmbeddingMatrix(signal: AbortSignal) {
    if (embeddingMatrix) return embeddingMatrix;
    if (!embeddingMatrixLoad) {
      const request = databaseReadRequest(pool).input('take', sql.Int, maxVectorCandidates);
      embeddingMatrixLoad = execute(request, signal, () => request.query<{
        path: string;
        heading: string;
        content: string;
        chunk_index: number;
        embedding_json: string;
        embedding_model: string;
      }>(`SELECT TOP (@take) path, heading, content, chunk_index, embedding_json, embedding_model
        FROM dbo.vault_chunks
        WHERE embedding_json IS NOT NULL AND embedding_model IS NOT NULL
        ORDER BY path, chunk_index;`)).then(({ recordset }) => recordset.flatMap((row) => {
        const embedding = parseEmbedding(row.embedding_json);
        return embedding
        ? [{
          path: row.path, heading: row.heading, content: row.content, chunkIndex: row.chunk_index,
          embedding, embeddingModel: row.embedding_model,
        }]
        : [];
      }));
    }
    const pending = embeddingMatrixLoad;
    const revision = embeddingMatrixRevision;
    try {
      const rows = await pending;
      if (revision === embeddingMatrixRevision) embeddingMatrix = rows;
      return rows;
    } finally {
      if (embeddingMatrixLoad === pending) embeddingMatrixLoad = undefined;
    }
  }

  return {
    async initialize() {
      if (initialized) return;
      const result = await pool.request().query<{
        vector_search: boolean;
        json_embedding_search: boolean;
      }>(`SELECT CONVERT(bit, CASE
        WHEN TYPE_ID(N'vector') IS NOT NULL
          AND COL_LENGTH(N'dbo.vault_chunks', N'embedding') IS NOT NULL THEN 1 ELSE 0 END) AS vector_search,
        CONVERT(bit, CASE
          WHEN TYPE_ID(N'vector') IS NULL
            AND COL_LENGTH(N'dbo.vault_chunks', N'embedding_json') IS NOT NULL THEN 1 ELSE 0 END) AS json_embedding_search;`);
      vectorSearchAvailable = result.recordset[0]?.vector_search === true;
      jsonEmbeddingAvailable = result.recordset[0]?.json_embedding_search === true;
      initialized = true;
    },

    supportsVectorSearch() {
      return initialized && (vectorSearchAvailable || jsonEmbeddingAvailable);
    },

    async files(embeddingModel, signal) {
      ensureInitialized();
      const request = databaseReadRequest(pool)
        .input('take', sql.Int, 10_001)
        .input('embeddingModel', sql.NVarChar(128), embeddingModel);
      const embeddingColumn = vectorSearchAvailable ? 'embedding' : jsonEmbeddingAvailable ? 'embedding_json' : undefined;
      const missingEmbeddings = embeddingColumn
        ? `CONVERT(bit, CASE WHEN @embeddingModel IS NULL OR
            COUNT(CASE WHEN ${embeddingColumn} IS NOT NULL AND embedding_model = @embeddingModel THEN 1 END) < COUNT(*)
            THEN 1 ELSE 0 END) AS embedding_missing`
        : 'CONVERT(bit, 0) AS embedding_missing';
      const result = await execute(request, signal, () => request.query<{
        path: string;
        blob_sha: string;
        embedding_missing: boolean;
      }>(
        `SELECT TOP (@take) path, MAX(blob_sha) AS blob_sha, ${missingEmbeddings}
          FROM dbo.vault_chunks GROUP BY path ORDER BY path;`,
      ));
      return result.recordset.map(({ path, blob_sha, embedding_missing }) => ({
        path, blobSha: blob_sha.trim(), embeddingMissing: embedding_missing,
      }));
    },

    async replaceFile(path, blobSha, chunks, links, signal) {
      ensureInitialized();
      if (!/^[\da-f]{40}$/u.test(blobSha) || chunks.length > 512 || links.length > 512) {
        throw new TypeError('Vault index entry is invalid');
      }
      if (chunks.some(({ embedding, embeddingModel }) =>
        (embedding !== null && (!parseEmbedding(embedding) ||
          typeof embeddingModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(embeddingModel))) ||
        (embedding === null && embeddingModel !== null))) {
        throw new TypeError('Vault index embedding is invalid');
      }
      const hash = pathHash(path);
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      let committed = false;
      try {
        const request = new sql.Request(transaction)
          .input('pathHash', sql.VarBinary(32), hash)
          .input('path', sql.NVarChar(1024), path)
          .input('blobSha', sql.Char(40), blobSha)
          .input('chunks', sql.NVarChar(sql.MAX), JSON.stringify(chunks))
          .input('links', sql.NVarChar(sql.MAX), JSON.stringify(links));
        const embeddingColumn = vectorSearchAvailable ? ', embedding' : jsonEmbeddingAvailable ? ', embedding_json' : '';
        const embeddingValue = vectorSearchAvailable
          ? ', CASE WHEN chunk.embedding IS NULL THEN NULL ELSE CAST(chunk.embedding AS vector(1536)) END'
          : jsonEmbeddingAvailable ? ', chunk.embedding' : '';
        const statement = `DELETE FROM dbo.vault_chunks WHERE path_hash = @pathHash;
          ${chunks.length === 0 ? '' : `INSERT INTO dbo.vault_chunks
            (path_hash, path, blob_sha, chunk_index, heading, content, embedding_model${embeddingColumn})
            SELECT @pathHash, @path, @blobSha, chunk.chunk_index, chunk.heading, chunk.content, chunk.embedding_model${embeddingValue}
            FROM OPENJSON(@chunks) WITH (
              chunk_index int '$.index',
              heading nvarchar(500) '$.heading',
              content nvarchar(max) '$.content',
              embedding_model nvarchar(128) '$.embeddingModel',
              embedding nvarchar(max) '$.embedding' AS JSON
            ) AS chunk;`}`;
        const linkStatement = `DELETE FROM dbo.vault_links WHERE source_path_hash = @pathHash;
          ${links.length === 0 ? '' : `INSERT INTO dbo.vault_links (source_path_hash, target_path)
            SELECT @pathHash, link.target_path
            FROM OPENJSON(@links) WITH (target_path nvarchar(180) '$') AS link;`}`;
        await execute(request, signal, () => request.query(`${statement} ${linkStatement}`));
        await transaction.commit();
        committed = true;
        invalidateEmbeddingMatrix();
      } finally {
        if (!committed) await transaction.rollback();
      }
    },

    async deleteFiles(paths, signal) {
      ensureInitialized();
      if (paths.length === 0) return;
      const hashes = [...new Set(paths)].map((path) => pathHash(path).toString('hex'));
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      let committed = false;
      try {
        const request = new sql.Request(transaction).input('hashes', sql.NVarChar(sql.MAX), JSON.stringify(hashes));
        await execute(request, signal, () => request.query(`DELETE FROM dbo.vault_chunks
          WHERE path_hash IN (SELECT CONVERT(binary(32), value, 2) FROM OPENJSON(@hashes));
          DELETE FROM dbo.vault_links
          WHERE source_path_hash IN (SELECT CONVERT(binary(32), value, 2) FROM OPENJSON(@hashes));`));
        await transaction.commit();
        committed = true;
        invalidateEmbeddingMatrix();
      } finally {
        if (!committed) await transaction.rollback();
      }
    },

    async graphFiles(signal) {
      ensureInitialized();
      const request = databaseReadRequest(pool).input('take', sql.Int, 10_000);
      const result = await execute(request, signal, () => request.query<{
        path: string;
        title: string | null;
        updated_at: Date;
      }>(`SELECT TOP (@take) notes.path, title.heading AS title, notes.updated_at
        FROM (
          SELECT path, MAX(indexed_at) AS updated_at
          FROM dbo.vault_chunks
          WHERE path LIKE N'People/%' OR path LIKE N'Work/%'
            OR path LIKE N'Personal/%' OR path LIKE N'General/%'
          GROUP BY path
        ) AS notes
        OUTER APPLY (
          SELECT TOP (1) heading
          FROM dbo.vault_chunks AS chunk
          WHERE chunk.path = notes.path AND chunk.heading <> N'Introduction'
          ORDER BY chunk.chunk_index
        ) AS title
        ORDER BY notes.path;`));
      return result.recordset.map(({ path, title, updated_at }) => ({
        path,
        title: title ?? '',
        updatedAt: updated_at,
      }));
    },

    async graphData(paths, embeddingModel, signal) {
      ensureInitialized();
      if (paths.length === 0) return { links: [], similarities: [], embeddings: [] };
      const pathsByHash = new Map(paths.map((path) => [pathHash(path).toString('hex'), path]));
      const pathSet = new Set(paths);
      const hashes = [...pathsByHash.keys()];
      const request = databaseReadRequest(pool)
        .input('hashes', sql.NVarChar(sql.MAX), JSON.stringify(hashes))
        .input('linkTake', sql.Int, 8_001)
        .input('paths', sql.NVarChar(sql.MAX), JSON.stringify(paths))
        .input('embeddingModel', sql.NVarChar(128), embeddingModel)
        .input('similarityThreshold', sql.Float, vaultSimilarityThreshold);
      const similarityQuery = vectorSearchAvailable
        ? `CREATE TABLE #vault_note_vectors (path nvarchar(1024) NOT NULL, embedding vector(1536) NOT NULL);
          ;WITH mean_components AS (
            SELECT chunk.path, CONVERT(int, component.[key]) AS dimension,
              AVG(TRY_CONVERT(float, component.value)) AS mean_value
            FROM dbo.vault_chunks AS chunk
            INNER JOIN OPENJSON(@paths) AS selected ON selected.value = chunk.path
            CROSS APPLY OPENJSON(CAST(chunk.embedding AS nvarchar(max))) AS component
            WHERE chunk.embedding IS NOT NULL AND chunk.embedding_model = @embeddingModel
            GROUP BY chunk.path, component.[key]
          ), mean_vectors AS (
            SELECT path,
              N'[' + STRING_AGG(CONVERT(nvarchar(max), mean_value), N',')
                WITHIN GROUP (ORDER BY dimension) + N']' AS embedding_json
            FROM mean_components GROUP BY path
          )
          INSERT INTO #vault_note_vectors (path, embedding)
          SELECT path, CAST(embedding_json AS vector(1536)) FROM mean_vectors;
          SELECT source.path AS source_path, neighbour.path AS target_path, neighbour.score
          FROM #vault_note_vectors AS source
          CROSS APPLY (
            SELECT TOP (3) candidate.path,
              CAST(1.0 - VECTOR_DISTANCE('cosine', source.embedding, candidate.embedding) AS float) AS score
            FROM #vault_note_vectors AS candidate
            WHERE candidate.path <> source.path
              AND VECTOR_DISTANCE('cosine', source.embedding, candidate.embedding) < 1.0 - @similarityThreshold
            ORDER BY VECTOR_DISTANCE('cosine', source.embedding, candidate.embedding), candidate.path
          ) AS neighbour
          ORDER BY source.path, neighbour.score DESC, neighbour.path;`
        : `SELECT CAST(NULL AS nvarchar(1024)) AS source_path,
            CAST(NULL AS nvarchar(1024)) AS target_path, CAST(NULL AS float) AS score WHERE 1 = 0;`;
      const result = await execute(request, signal, () => request.query<{
        source_path_hash: string;
        target_path: string;
      }>(`SELECT TOP (@linkTake) CONVERT(varchar(64), source_path_hash, 2) AS source_path_hash, target_path
          FROM dbo.vault_links
          WHERE source_path_hash IN (SELECT CONVERT(binary(32), value, 2) FROM OPENJSON(@hashes))
          ORDER BY source_path_hash, target_path;
        ${similarityQuery}
        SELECT TOP (20000) chunk.path, chunk.content
          FROM dbo.vault_chunks AS chunk
          INNER JOIN OPENJSON(@paths) AS selected ON selected.value = chunk.path
          ORDER BY chunk.path, chunk.chunk_index;`));
      const links = result.recordsets[0] as Array<{ source_path_hash: string; target_path: string }> | undefined;
      const contents = result.recordsets[2] as Array<{ path: string; content: string }> | undefined;
      const similarities = result.recordsets[1] as Array<{
        source_path: string;
        target_path: string;
        score: number;
      }> | undefined;
      const embeddings = jsonEmbeddingAvailable
        ? (await loadEmbeddingMatrix(signal)).flatMap(({ path, embedding, embeddingModel: model }) =>
          pathSet.has(path) && model === embeddingModel ? [{ path, embedding }] : [])
        : [];
      return {
        links: (links ?? []).flatMap(({ source_path_hash, target_path }) => {
          const sourcePath = pathsByHash.get(source_path_hash.toLowerCase());
          return sourcePath ? [{ sourcePath, targetPath: target_path }] : [];
        }),
        similarities: (similarities ?? []).flatMap(({ source_path, target_path, score }) => {
          // Similarity rows carry paths, not hashes.
          return pathSet.has(source_path) && pathSet.has(target_path) && Number.isFinite(score)
            ? [{ sourcePath: source_path, targetPath: target_path, score: Number(score) }]
            : [];
        }),
        embeddings,
        contents: (contents ?? []).filter(({ path }) => pathSet.has(path)),
      };
    },

    async searchByVector(embedding, embeddingModel, limit, signal) {
      ensureInitialized();
      if ((!vectorSearchAvailable && !jsonEmbeddingAvailable) ||
          embedding.length !== vectorDimensions || !embedding.every(Number.isFinite) ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(embeddingModel)) {
        throw new VectorSearchUnavailableError();
      }
      if (jsonEmbeddingAvailable) {
        const matrix = await loadEmbeddingMatrix(signal);
        const ranking = matrix.flatMap((hit) => {
          if (hit.embeddingModel !== embeddingModel) return [];
          const score = cosineSimilarity(embedding, hit.embedding);
          return score === undefined ? [] : [{ hit, score }];
        }).sort((left, right) => right.score - left.score || left.hit.path.localeCompare(right.hit.path) ||
          left.hit.chunkIndex - right.hit.chunkIndex).slice(0, limit);
        return ranking.map(({ hit, score }) => ({
          path: hit.path, heading: hit.heading, content: hit.content, score,
        }));
      }
      const request = databaseReadRequest(pool)
        .input('take', sql.Int, limit)
        .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding))
        .input('embeddingModel', sql.NVarChar(128), embeddingModel);
      try {
        const result = await execute(request, signal, () => request.query<{
          path: string;
          heading: string;
          content: string;
          score: number;
        }>(`SELECT TOP (@take) path, heading, content,
            1.0 - VECTOR_DISTANCE('cosine', embedding, CAST(@embedding AS vector(1536))) AS score
          FROM dbo.vault_chunks
          WHERE embedding IS NOT NULL AND embedding_model = @embeddingModel
          ORDER BY VECTOR_DISTANCE('cosine', embedding, CAST(@embedding AS vector(1536))), path, chunk_index;`));
        return result.recordset.map((hit) => ({ ...hit, score: Number(hit.score) }));
      } catch (error) {
        const number = (error as { number?: unknown } | null)?.number;
        if (number === 195 || number === 206) throw new VectorSearchUnavailableError();
        throw error;
      }
    },

    async searchByTerms(terms, limit, signal) {
      ensureInitialized();
      if (terms.length === 0) return [];
      const request = databaseReadRequest(pool)
        .input('take', sql.Int, limit)
        .input('termCount', sql.Int, terms.length)
        .input('terms', sql.NVarChar(2000), JSON.stringify(terms));
      const result = await execute(request, signal, () => request.query<{
        path: string;
        heading: string;
        content: string;
        score: number;
      }>(`SELECT TOP (@take) chunk.path, chunk.heading, chunk.content,
          CAST(ranked.matches AS float) / @termCount AS score
        FROM dbo.vault_chunks AS chunk
        CROSS APPLY (
          SELECT COUNT(*) AS matches FROM OPENJSON(@terms) AS term
          WHERE chunk.content LIKE N'%' + term.value + N'%'
            OR chunk.heading LIKE N'%' + term.value + N'%'
            OR chunk.path LIKE N'%' + term.value + N'%'
        ) AS ranked
        WHERE ranked.matches > 0
        ORDER BY ranked.matches DESC, chunk.path, chunk.chunk_index;`));
      return result.recordset.map((hit) => ({ ...hit, score: Number(hit.score) }));
    },
  };
}

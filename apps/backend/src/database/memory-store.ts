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
  searchByVector(embedding: readonly number[], limit: number, signal: AbortSignal): Promise<MemoryRecord[]>;
  searchByFullText(terms: readonly string[], limit: number, signal: AbortSignal): Promise<{
    readonly method: 'fulltext' | 'substring';
    readonly memories: MemoryRecord[];
  }>;
}

export interface VaultIndexedFile {
  readonly path: string;
  readonly blobSha: string;
}

export interface VaultIndexedChunk {
  readonly index: number;
  readonly heading: string;
  readonly content: string;
  readonly embedding: readonly number[] | null;
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
  readonly embeddings: readonly { readonly path: string; readonly embedding: readonly number[] }[];
}

export interface VaultIndexStore {
  initialize(): Promise<void>;
  supportsVectorSearch(): boolean;
  files(signal: AbortSignal): Promise<VaultIndexedFile[]>;
  replaceFile(
    path: string,
    blobSha: string,
    chunks: readonly VaultIndexedChunk[],
    links: readonly string[],
    signal: AbortSignal,
  ): Promise<void>;
  deleteFiles(paths: readonly string[], signal: AbortSignal): Promise<void>;
  graphFiles(signal: AbortSignal): Promise<VaultGraphFile[]>;
  graphData(paths: readonly string[], signal: AbortSignal): Promise<VaultGraphData>;
  searchByVector(embedding: readonly number[], limit: number, signal: AbortSignal): Promise<VaultSearchHit[]>;
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
const fullTextSetupPath = fileURLToPath(
  new URL('../../../../db/migrations/setup/0016_long_term_memory.sql', import.meta.url),
);

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
    const targetId = memoryId === undefined ? null : toSqlId(memoryId);
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
        .input('embedding', sql.NVarChar(sql.MAX), input.embedding === null ? null : JSON.stringify(input.embedding));
      const embeddingColumn = vectorSearchAvailable ? ', embedding' : '';
      const embeddingValue = vectorSearchAvailable
        ? ', CASE WHEN @embedding IS NULL THEN NULL ELSE CAST(@embedding AS vector(1536)) END'
        : '';
      const embeddingUpdate = vectorSearchAvailable
        ? `, embedding = CASE
            WHEN @contentChanged = 1 THEN CAST(@embedding AS vector(1536))
            ELSE COALESCE(CAST(@embedding AS vector(1536)), embedding)
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
          INSERT INTO dbo.memories (category, memory_key, content, source_message_id${embeddingColumn})
            VALUES (@category, @memoryKey, @content, @sourceMessageId${embeddingValue});
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
            WHERE id = @memoryId;
            SET @changed = 1;
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
          WHEN @fullTextInstalled = 1
            AND EXISTS (SELECT 1 FROM sys.fulltext_indexes
              WHERE object_id = OBJECT_ID(N'dbo.memories')) THEN 1 ELSE 0 END) AS fulltext_search;`);
      vectorSearchAvailable = result.recordset[0]?.vector_search === true;
      fullTextSearchAvailable = result.recordset[0]?.fulltext_search === true;
      initialized = true;
    },

    supportsVectorSearch() {
      return initialized && vectorSearchAvailable;
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

    async searchByVector(embedding, limit, signal) {
      if (!initialized) throw new Error('Memory store is not initialized');
      if (!vectorSearchAvailable || embedding.length !== vectorDimensions) throw new VectorSearchUnavailableError();
      try {
        return await readMemories(`SELECT TOP (@take) ${memoryColumns}
          FROM dbo.memories AS m
          ${sourceJoin}
          WHERE m.embedding IS NOT NULL
          ORDER BY VECTOR_DISTANCE('cosine', m.embedding, CAST(@embedding AS vector(1536))), m.id DESC;`,
        (bound) => {
          bound.input('take', sql.Int, limit);
          bound.input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding));
          return bound;
        }, signal);
      } catch (error) {
        const number = (error as { number?: unknown } | null)?.number;
        if (number === 195 || number === 206) throw new VectorSearchUnavailableError();
        throw error;
      }
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

  function pathHash(path: string): Buffer {
    return createHash('sha256').update(path, 'utf8').digest();
  }

  function ensureInitialized(): void {
    if (!initialized) throw new Error('Vault index store is not initialized');
  }

  return {
    async initialize() {
      if (initialized) return;
      const result = await pool.request().query<{ vector_search: boolean }>(`SELECT CONVERT(bit, CASE
        WHEN TYPE_ID(N'vector') IS NOT NULL
          AND COL_LENGTH(N'dbo.vault_chunks', N'embedding') IS NOT NULL THEN 1 ELSE 0 END) AS vector_search;`);
      vectorSearchAvailable = result.recordset[0]?.vector_search === true;
      initialized = true;
    },

    supportsVectorSearch() {
      return initialized && vectorSearchAvailable;
    },

    async files(signal) {
      ensureInitialized();
      const request = databaseReadRequest(pool).input('take', sql.Int, 10_001);
      const result = await execute(request, signal, () => request.query<{ path: string; blob_sha: string }>(
        `SELECT TOP (@take) path, MAX(blob_sha) AS blob_sha
          FROM dbo.vault_chunks GROUP BY path ORDER BY path;`,
      ));
      return result.recordset.map(({ path, blob_sha }) => ({ path, blobSha: blob_sha.trim() }));
    },

    async replaceFile(path, blobSha, chunks, links, signal) {
      ensureInitialized();
      if (!/^[\da-f]{40}$/u.test(blobSha) || chunks.length > 512 || links.length > 512) {
        throw new TypeError('Vault index entry is invalid');
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
        const embeddingColumn = vectorSearchAvailable ? ', embedding' : '';
        const embeddingValue = vectorSearchAvailable
          ? ', CASE WHEN chunk.embedding IS NULL THEN NULL ELSE CAST(chunk.embedding AS vector(1536)) END'
          : '';
        const statement = `DELETE FROM dbo.vault_chunks WHERE path_hash = @pathHash;
          ${chunks.length === 0 ? '' : `INSERT INTO dbo.vault_chunks
            (path_hash, path, blob_sha, chunk_index, heading, content${embeddingColumn})
            SELECT @pathHash, @path, @blobSha, chunk.chunk_index, chunk.heading, chunk.content${embeddingValue}
            FROM OPENJSON(@chunks) WITH (
              chunk_index int '$.index',
              heading nvarchar(500) '$.heading',
              content nvarchar(max) '$.content',
              embedding nvarchar(max) '$.embedding' AS JSON
            ) AS chunk;`}`;
        const linkStatement = `DELETE FROM dbo.vault_links WHERE source_path_hash = @pathHash;
          ${links.length === 0 ? '' : `INSERT INTO dbo.vault_links (source_path_hash, source_path, target_path)
            SELECT @pathHash, @path, link.target_path
            FROM OPENJSON(@links) WITH (target_path nvarchar(1024) '$') AS link;`}`;
        await execute(request, signal, () => request.query(`${statement} ${linkStatement}`));
        await transaction.commit();
        committed = true;
      } finally {
        if (!committed) await transaction.rollback();
      }
    },

    async deleteFiles(paths, signal) {
      ensureInitialized();
      if (paths.length === 0) return;
      const hashes = [...new Set(paths)].map((path) => pathHash(path).toString('hex'));
      const request = databaseReadRequest(pool).input('hashes', sql.NVarChar(sql.MAX), JSON.stringify(hashes));
      await execute(request, signal, () => request.query(`DELETE FROM dbo.vault_chunks
        WHERE path_hash IN (SELECT CONVERT(binary(32), value, 2) FROM OPENJSON(@hashes));
        DELETE FROM dbo.vault_links
        WHERE source_path_hash IN (SELECT CONVERT(binary(32), value, 2) FROM OPENJSON(@hashes));`));
    },

    async graphFiles(signal) {
      ensureInitialized();
      const request = databaseReadRequest(pool).input('take', sql.Int, 10_000);
      const result = await execute(request, signal, () => request.query<{
        path: string;
        title: string | null;
        updated_at: Date;
      }>(`SELECT TOP (@take) path,
          MAX(CASE WHEN chunk_index = 0 THEN heading END) AS title,
          MAX(indexed_at) AS updated_at
        FROM dbo.vault_chunks
        WHERE path LIKE N'People/%' OR path LIKE N'Work/%'
          OR path LIKE N'Personal/%' OR path LIKE N'General/%'
        GROUP BY path ORDER BY path;`));
      return result.recordset.map(({ path, title, updated_at }) => ({
        path,
        title: title ?? '',
        updatedAt: updated_at,
      }));
    },

    async graphData(paths, signal) {
      ensureInitialized();
      if (paths.length === 0) return { links: [], embeddings: [] };
      const request = databaseReadRequest(pool)
        .input('paths', sql.NVarChar(sql.MAX), JSON.stringify(paths))
        .input('linkTake', sql.Int, 8_001);
      const embeddingQuery = vectorSearchAvailable
        ? `SELECT chunk.path, CAST(chunk.embedding AS nvarchar(max)) AS embedding
            FROM dbo.vault_chunks AS chunk
            INNER JOIN OPENJSON(@paths) AS selected ON selected.value = chunk.path
            WHERE chunk.embedding IS NOT NULL ORDER BY chunk.path, chunk.chunk_index;`
        : `SELECT CAST(NULL AS nvarchar(1024)) AS path, CAST(NULL AS nvarchar(max)) AS embedding WHERE 1 = 0;`;
      const result = await execute(request, signal, () => request.query<{
        source_path: string;
        target_path: string;
      }>(`SELECT TOP (@linkTake) source_path, target_path
          FROM dbo.vault_links
          WHERE source_path IN (SELECT value FROM OPENJSON(@paths))
          ORDER BY source_path, target_path;
        ${embeddingQuery}`));
      const links = result.recordsets[0] as Array<{ source_path: string; target_path: string }> | undefined;
      const embeddings = result.recordsets[1] as Array<{ path: string; embedding: string }> | undefined;
      return {
        links: (links ?? []).map(({ source_path, target_path }) => ({
          sourcePath: source_path,
          targetPath: target_path,
        })),
        embeddings: (embeddings ?? []).flatMap(({ path, embedding }) => {
          try {
            const vector: unknown = JSON.parse(embedding);
            return Array.isArray(vector) && vector.length === vectorDimensions &&
              vector.every((value) => typeof value === 'number' && Number.isFinite(value))
              ? [{ path, embedding: vector as number[] }]
              : [];
          } catch {
            return [];
          }
        }),
      };
    },

    async searchByVector(embedding, limit, signal) {
      ensureInitialized();
      if (!vectorSearchAvailable || embedding.length !== vectorDimensions) {
        throw new VectorSearchUnavailableError();
      }
      const request = databaseReadRequest(pool)
        .input('take', sql.Int, limit)
        .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding));
      try {
        const result = await execute(request, signal, () => request.query<{
          path: string;
          heading: string;
          content: string;
          score: number;
        }>(`SELECT TOP (@take) path, heading, content,
            1.0 - VECTOR_DISTANCE('cosine', embedding, CAST(@embedding AS vector(1536))) AS score
          FROM dbo.vault_chunks
          WHERE embedding IS NOT NULL
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
      }>(`SELECT TOP (@take) chunk.path, chunk.heading, chunk.content
        , CAST(ranked.matches AS float) / @termCount AS score
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

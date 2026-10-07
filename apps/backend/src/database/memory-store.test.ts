import { describe, expect, it } from 'vitest';
import sql from 'mssql';
import { createMemoryStore, createVaultIndexStore, rankByCosineSimilarity } from './memory-store.js';

describe('JSON embedding ranking', () => {
  it('ranks valid vectors by cosine similarity and skips malformed dimensions and zero vectors', () => {
    const vector = (first: number, second: number) => [
      first, second, ...Array.from({ length: 1534 }, () => 0),
    ];

    expect(rankByCosineSimilarity(vector(1, 0), [
      { embedding: vector(0, 1), value: 'orthogonal' },
      { embedding: vector(0.8, 0.6), value: 'close' },
      { embedding: vector(1, 0), value: 'exact' },
      { embedding: [1, 0], value: 'wrong dimensions' },
      { embedding: vector(0, 0), value: 'zero' },
    ], 3)).toEqual(['exact', 'close', 'orthogonal']);
  });

  it('searches and caches the JSON vault matrix when SQL vector search is unavailable', async () => {
    const vector = (first: number, second: number) => [
      first, second, ...Array.from({ length: 1534 }, () => 0),
    ];
    const queries: string[] = [];
    const rows = [
      {
        path: 'People/Alex.md', heading: 'Orthogonal', content: 'Different topic.',
        chunk_index: 0, embedding_json: JSON.stringify(vector(0, 1)),
      },
      {
        path: 'Work/Project.md', heading: 'Project', content: 'Matching topic.',
        chunk_index: 0, embedding_json: JSON.stringify(vector(1, 0)),
      },
    ];
    const pool = {
      request: () => ({
        input() { return this; },
        async query(statement: string) {
          queries.push(statement);
          return statement.includes('json_embedding_search')
            ? { recordset: [{ vector_search: false, json_embedding_search: true }] }
            : { recordset: rows };
        },
      }),
    } as unknown as sql.ConnectionPool;
    const store = createVaultIndexStore(pool);
    await store.initialize();
    expect(store.supportsVectorSearch()).toBe(true);

    await expect(store.searchByVector(vector(1, 0), 1, new AbortController().signal)).resolves.toMatchObject([
      { path: 'Work/Project.md', heading: 'Project', score: 1 },
    ]);
    await store.searchByVector(vector(1, 0), 2, new AbortController().signal);
    expect(queries.filter((statement) => statement.includes('FROM dbo.vault_chunks') &&
      statement.includes('embedding_json'))).toHaveLength(1);
  });

  it('persists memory-search JSON embeddings in the application ranking path', async () => {
    const vector = (first: number, second: number) => [
      first, second, ...Array.from({ length: 1534 }, () => 0),
    ];
    const queries: string[] = [];
    const memories = [
      {
        id: '1', category: 'preference', memory_key: 'far', content: 'Orthogonal.',
        source_message_id: '3', source_text: 'Source.', source_text_truncated: false,
        revision: 1, updated_at: new Date('2026-01-01T00:00:00Z'),
        embedding_json: JSON.stringify(vector(0, 1)),
      },
      {
        id: '2', category: 'preference', memory_key: 'near', content: 'Similar.',
        source_message_id: '4', source_text: 'Source.', source_text_truncated: false,
        revision: 1, updated_at: new Date('2026-01-02T00:00:00Z'),
        embedding_json: JSON.stringify(vector(1, 0)),
      },
    ];
    const pool = {
      request: () => ({
        input() { return this; },
        async query(statement: string) {
          queries.push(statement);
          if (statement.includes('json_embedding_search')) {
            return { recordset: [{ vector_search: false, json_embedding_search: true, fulltext_search: false }] };
          }
          return { recordset: memories };
        },
      }),
    } as unknown as sql.ConnectionPool;
    const store = createMemoryStore(pool);
    await store.initialize();
    await expect(store.searchByVector(vector(1, 0), 1, new AbortController().signal))
      .resolves.toMatchObject([{ id: '2', key: 'near' }]);
    expect(queries.some((statement) => statement.includes('m.embedding_json IS NOT NULL'))).toBe(true);
  });
});

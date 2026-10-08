import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { FolioItemNotFound, FolioStore } from './folio-store.js';

const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const sourceId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const itemId = `research:${sourceId}`;
const createdAt = new Date('2026-10-06T10:00:00.000Z');

function fixture(recordset: unknown[] = [], rowsAffected: number[] = [1]) {
  const query = vi.fn(async () => ({ recordset, rowsAffected }));
  const input = vi.fn();
  const request = { input, query, cancel: vi.fn() };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { store: new FolioStore(pool), query, input, request };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId,
    kind: 'research',
    source_id: sourceId,
    title: 'Ignite report',
    prompt_summary: 'Research Ignite battery storage',
    created_at: createdAt,
    pinned: false,
    payload_json: null,
    ...overrides,
  };
}

describe('Folio store', () => {
  it('records source-backed items with bounded metadata and parameterized values', async () => {
    const data = fixture([row()]);
    const item = await data.store.record(ownerId, {
      id: itemId,
      kind: 'research',
      sourceId,
      title: '  Ignite\nreport ',
      promptSummary: 'Research\tIgnite battery storage',
      createdAt: createdAt.toISOString(),
    }, new AbortController().signal);

    expect(item).toMatchObject({ id: itemId, kind: 'research', pinned: false });
    expect(data.input).toHaveBeenCalledWith('title', sql.NVarChar(200), 'Ignite report');
    expect(data.input).toHaveBeenCalledWith('summary', sql.NVarChar(500), 'Research Ignite battery storage');
    expect(data.query.mock.calls[0]?.[0]).toContain('INSERT dbo.folio_items');
    await expect(data.store.record(ownerId, {
      id: itemId,
      kind: 'research',
      sourceId,
      title: 'Invalid',
      promptSummary: 'x'.repeat(501),
      createdAt: createdAt.toISOString(),
    }, new AbortController().signal)).rejects.toThrow('Invalid Folio record');
  });

  it('searches within the owner, filters by kind and date, and orders pinned items first', async () => {
    const data = fixture([row()]);
    const items = await data.store.search(ownerId, {
      q: 'Ignite 50%',
      kind: 'research',
      before: '2026-10-07T00:00:00.000Z',
    }, new AbortController().signal);

    expect(items).toHaveLength(1);
    expect(data.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, ownerId);
    expect(data.input).toHaveBeenCalledWith('kind', sql.NVarChar(20), 'research');
    expect(data.input).toHaveBeenCalledWith('before', sql.DateTime2(7), new Date('2026-10-07T00:00:00.000Z'));
    expect(data.input).toHaveBeenCalledWith('term0', sql.NVarChar(250), '%Ignite%');
    expect(data.input).toHaveBeenCalledWith('term1', sql.NVarChar(250), '%50\\%%');
    expect(data.query.mock.calls[0]?.[0]).toContain('ORDER BY pinned DESC, created_at DESC');
  });

  it('loads validated graph snapshots and keeps updates/deletes owner-scoped', async () => {
    const graphId = '02f02e9e-912a-4bd4-8c18-018f7c12bc19';
    const data = fixture([row({
      item_id: `knowledge_graph:${graphId}`,
      kind: 'knowledge_graph',
      source_id: graphId,
      payload_json: JSON.stringify({ query: 'Ignite', highlight: ['a'.repeat(64)] }),
    })]);
    const graph = await data.store.get(ownerId, `knowledge_graph:${graphId}`, new AbortController().signal);
    expect(graph.payload).toEqual({ query: 'Ignite', highlight: ['a'.repeat(64)] });

    await data.store.update(ownerId, itemId, { pinned: true }, new AbortController().signal);
    expect(data.query.mock.calls[1]?.[0]).toContain('WHERE item_id = @id AND owner_object_id = @owner');
    await data.store.delete(ownerId, itemId, new AbortController().signal);
    expect(data.query.mock.calls[2]?.[0]).toContain('DELETE dbo.folio_items');

    const missing = fixture([], [0]);
    await expect(missing.store.delete(ownerId, itemId, new AbortController().signal))
      .rejects.toBeInstanceOf(FolioItemNotFound);
  });
});

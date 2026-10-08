import sql from 'mssql';
import { isFolioItem, type FolioItem, type FolioKind, type FolioPatch, type FolioSearch } from '@jarvis/contracts';
import { databaseReadRequest } from './wake-retry.js';

const itemIdPattern = /^(research|html_app|image|knowledge_graph):([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/u;
const ownerIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const searchStopWords = new Set(['a', 'again', 'an', 'and', 'find', 'for', 'get', 'jarvis', 'open', 'pull', 'report', 'research', 'the', 'up']);

export interface FolioGraphPayload {
  readonly query: string;
  readonly highlight: readonly string[];
}

export interface FolioRecord {
  readonly id: string;
  readonly kind: FolioKind;
  readonly sourceId: string;
  readonly title: string;
  readonly promptSummary: string;
  readonly createdAt: string;
  readonly pinned?: boolean;
  readonly payload?: FolioGraphPayload;
}

interface FolioRow {
  item_id: string;
  kind: FolioKind;
  source_id: string;
  title: string;
  prompt_summary: string;
  created_at: Date | string;
  pinned: boolean;
  payload_json: string | null;
}

export class FolioItemNotFound extends Error {
  constructor() {
    super('Folio item was not found');
    this.name = 'FolioItemNotFound';
  }
}

function mapItem(row: FolioRow): FolioItem {
  const item: FolioItem = {
    id: row.item_id as FolioItem['id'],
    kind: row.kind,
    title: row.title,
    promptSummary: row.prompt_summary,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    pinned: row.pinned,
  };
  if (!isFolioItem(item)) throw new Error('Stored Folio item is invalid');
  return item;
}

function itemParts(id: string): { kind: FolioKind; sourceId: string } {
  const match = itemIdPattern.exec(id);
  if (!match) throw new FolioItemNotFound();
  return { kind: match[1] as FolioKind, sourceId: match[2]! };
}

function escapedLike(value: string): string {
  return value.replace(/[\\%_[\]]/gu, (character) => `\\${character}`);
}

async function query<T>(request: sql.Request, statement: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await request.query<T>(statement);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export class FolioStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async record(ownerObjectId: string, record: FolioRecord, signal: AbortSignal): Promise<FolioItem> {
    const parts = itemParts(record.id);
    if (!ownerIdPattern.test(ownerObjectId) || parts.kind !== record.kind ||
        parts.sourceId !== record.sourceId || !ownerIdPattern.test(record.sourceId) || typeof record.title !== 'string' ||
        !record.title.trim() || record.title.trim().length > 200 ||
        typeof record.promptSummary !== 'string' || !record.promptSummary.trim() ||
        record.promptSummary.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().length > 500 ||
        !Number.isFinite(Date.parse(record.createdAt)) || new Date(record.createdAt).toISOString() !== record.createdAt ||
        (record.kind === 'knowledge_graph') !== (record.payload !== undefined) ||
        (record.payload && (typeof record.payload.query !== 'string' ||
          !Array.isArray(record.payload.highlight) || record.payload.query.length > 500 ||
          record.payload.highlight.length > 50 ||
          record.payload.highlight.some((id) => !/^[0-9a-f]{64}$/u.test(id))))) {
      throw new TypeError('Invalid Folio record');
    }
    const promptSummary = record.promptSummary.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    const request = this.pool.request()
      .input('id', sql.NVarChar(80), record.id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('kind', sql.NVarChar(20), record.kind)
      .input('source', sql.UniqueIdentifier, record.sourceId)
      .input('title', sql.NVarChar(200), record.title.trim())
      .input('summary', sql.NVarChar(500), promptSummary)
      .input('createdAt', sql.DateTime2(7), new Date(record.createdAt))
      .input('pinned', sql.Bit, record.pinned ?? false)
      .input('payload', sql.NVarChar(sql.MAX), record.payload ? JSON.stringify(record.payload) : null);
    const { recordset } = await query<FolioRow>(request, `IF EXISTS (
        SELECT 1 FROM dbo.folio_items WHERE item_id = @id AND owner_object_id = @owner
      )
      BEGIN
        UPDATE dbo.folio_items
          SET title = @title, prompt_summary = @summary, payload_json = @payload
          OUTPUT inserted.item_id, inserted.kind, inserted.source_id, inserted.title,
            inserted.prompt_summary, inserted.created_at, inserted.pinned, inserted.payload_json
          WHERE item_id = @id AND owner_object_id = @owner;
      END
      ELSE
      BEGIN
        INSERT dbo.folio_items
          (item_id, owner_object_id, kind, source_id, title, prompt_summary, created_at, pinned, payload_json)
        OUTPUT inserted.item_id, inserted.kind, inserted.source_id, inserted.title,
          inserted.prompt_summary, inserted.created_at, inserted.pinned, inserted.payload_json
        VALUES (@id, @owner, @kind, @source, @title, @summary, @createdAt, @pinned, @payload);
      END;`, signal);
    if (!recordset[0]) throw new Error('Folio item was not saved');
    return mapItem(recordset[0]);
  }

  async search(ownerObjectId: string, filters: FolioSearch, signal: AbortSignal): Promise<FolioItem[]> {
    if (!ownerIdPattern.test(ownerObjectId)) throw new TypeError('Invalid Folio owner');
    const terms = filters.q?.trim().split(/\s+/u)
      .filter((term) => term.length > 1 && !searchStopWords.has(term.toLowerCase())).slice(0, 8) ?? [];
    const request = databaseReadRequest(this.pool)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('kind', sql.NVarChar(20), filters.kind ?? null)
      .input('before', sql.DateTime2(7), filters.before ? new Date(filters.before) : null);
    const termFilters = terms.map((term, index) => {
      request.input(`term${index}`, sql.NVarChar(250), `%${escapedLike(term)}%`);
      return `(title LIKE @term${index} ESCAPE N'\\' OR prompt_summary LIKE @term${index} ESCAPE N'\\'
        OR (kind IN (N'research', N'html_app') AND EXISTS (
          SELECT 1 FROM dbo.workspace_html_artifact_versions AS version
          WHERE version.artifact_id = item.source_id AND version.title LIKE @term${index} ESCAPE N'\\'
        )))`;
    });
    const matchTerms = termFilters.length ? termFilters.join(' AND ') : '1 = 1';
    const { recordset } = await query<FolioRow>(request, `SELECT TOP (100) item_id, kind, source_id, title,
        prompt_summary, created_at, pinned, payload_json
      FROM dbo.folio_items AS item
      WHERE owner_object_id = @owner
        AND (@kind IS NULL OR kind = @kind)
        AND (@before IS NULL OR created_at < @before)
        AND ${matchTerms}
      ORDER BY pinned DESC, created_at DESC, item_id;`, signal);
    return recordset.map(mapItem);
  }

  async get(ownerObjectId: string, id: string, signal: AbortSignal): Promise<{ item: FolioItem; sourceId: string; payload?: FolioGraphPayload }> {
    const { kind, sourceId } = itemParts(id);
    if (!ownerIdPattern.test(ownerObjectId)) throw new FolioItemNotFound();
    const request = databaseReadRequest(this.pool)
      .input('id', sql.NVarChar(80), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
    const { recordset } = await query<FolioRow>(request, `SELECT item_id, kind, source_id, title,
        prompt_summary, created_at, pinned, payload_json
      FROM dbo.folio_items WHERE item_id = @id AND owner_object_id = @owner;`, signal);
    const row = recordset[0];
    if (!row || row.kind !== kind) throw new FolioItemNotFound();
    const item = mapItem(row);
    if (kind !== 'knowledge_graph') return { item, sourceId };
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json ?? '');
    } catch {
      throw new Error('Stored Folio graph view is invalid');
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
        typeof (payload as FolioGraphPayload).query !== 'string' ||
        !(payload as FolioGraphPayload).query.trim() || (payload as FolioGraphPayload).query.length > 500 ||
        !Array.isArray((payload as FolioGraphPayload).highlight) ||
        (payload as FolioGraphPayload).highlight.length > 50 ||
        (payload as FolioGraphPayload).highlight.some((nodeId) =>
          typeof nodeId !== 'string' || !/^[0-9a-f]{64}$/u.test(nodeId))) {
      throw new Error('Stored Folio graph view is invalid');
    }
    return { item, sourceId, payload: payload as FolioGraphPayload };
  }

  async update(ownerObjectId: string, id: string, patch: FolioPatch, signal: AbortSignal): Promise<FolioItem> {
    itemParts(id);
    if (!ownerIdPattern.test(ownerObjectId) || Object.keys(patch).length === 0 ||
        (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 200))) {
      throw new TypeError('Invalid Folio update');
    }
    const request = this.pool.request()
      .input('id', sql.NVarChar(80), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('title', sql.NVarChar(200), patch.title?.trim() ?? null)
      .input('pinned', sql.Bit, patch.pinned ?? null);
    const { recordset } = await query<FolioRow>(request, `UPDATE dbo.folio_items
      SET title = COALESCE(@title, title), pinned = COALESCE(@pinned, pinned)
      OUTPUT inserted.item_id, inserted.kind, inserted.source_id, inserted.title,
        inserted.prompt_summary, inserted.created_at, inserted.pinned, inserted.payload_json
      WHERE item_id = @id AND owner_object_id = @owner;`, signal);
    if (!recordset[0]) throw new FolioItemNotFound();
    return mapItem(recordset[0]);
  }

  async delete(ownerObjectId: string, id: string, signal: AbortSignal): Promise<void> {
    itemParts(id);
    if (!ownerIdPattern.test(ownerObjectId)) throw new FolioItemNotFound();
    const request = this.pool.request()
      .input('id', sql.NVarChar(80), id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
    const { rowsAffected } = await query<{ item_id: string }>(request, `DELETE dbo.folio_items
      OUTPUT deleted.item_id WHERE item_id = @id AND owner_object_id = @owner;`, signal);
    if (rowsAffected[0] !== 1) throw new FolioItemNotFound();
  }
}

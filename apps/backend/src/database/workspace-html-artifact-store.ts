import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';

export const workspaceHtmlSizeLimit = 512 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export interface WorkspaceHtmlSource {
  readonly title: string;
  readonly url: string;
}

export interface WorkspaceHtmlArtifact {
  readonly id: string;
  readonly kind: 'html';
  readonly title: string;
  readonly html: string;
  readonly sources: readonly WorkspaceHtmlSource[];
  readonly createdAt: string;
  readonly pinned: boolean;
}

export class WorkspaceHtmlArtifactNotFound extends Error {
  constructor() {
    super('Workspace HTML artifact was not found');
    this.name = 'WorkspaceHtmlArtifactNotFound';
  }
}

interface WorkspaceHtmlArtifactRow {
  id: string;
  title: string;
  html: string;
  sources_json: string;
  created_at: Date | string;
  pinned: boolean;
}

function isHtmlSource(value: unknown): value is WorkspaceHtmlSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== 'title' && key !== 'url') ||
      typeof source.title !== 'string' || !source.title.trim() || source.title !== source.title.trim() ||
      source.title.length > 200 || typeof source.url !== 'string' || source.url !== source.url.trim() ||
      source.url.length > 2_048) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function mapArtifact(row: WorkspaceHtmlArtifactRow): WorkspaceHtmlArtifact {
  let sources: unknown;
  try {
    sources = JSON.parse(row.sources_json);
  } catch {
    throw new Error('Stored workspace HTML sources are invalid');
  }
  if (!Array.isArray(sources) || sources.length > 50 || !sources.every(isHtmlSource)) {
    throw new Error('Stored workspace HTML sources are invalid');
  }
  return {
    id: row.id,
    kind: 'html',
    title: row.title,
    html: row.html,
    sources,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    pinned: row.pinned,
  };
}

export class WorkspaceHtmlArtifactStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async create(
    ownerObjectId: string,
    title: string,
    html: string,
    sources: readonly WorkspaceHtmlSource[],
    signal: AbortSignal,
  ): Promise<WorkspaceHtmlArtifact> {
    const size = typeof html === 'string' ? Buffer.byteLength(html, 'utf8') : 0;
    if (!ownerUuid.test(ownerObjectId) || typeof title !== 'string' || !title.trim() || title.length > 200 ||
        typeof html !== 'string' || !html.trim() || !isWellFormedUtf16(html) ||
        size < 1 || size > workspaceHtmlSizeLimit ||
        !Array.isArray(sources) || sources.length > 50 || !sources.every(isHtmlSource)) {
      throw new TypeError('Invalid workspace HTML artifact');
    }
    const id = randomUUID();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .input('title', sql.NVarChar(200), title.trim())
      .input('html', sql.NVarChar(sql.MAX), html)
      .input('size', sql.Int, size)
      .input('sources', sql.NVarChar(sql.MAX), JSON.stringify(sources))
      .input('pinned', sql.Bit, false);
    const cancel = () => { request.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      const { recordset } = await request.query<WorkspaceHtmlArtifactRow>(`INSERT dbo.workspace_html_artifacts
        (id, owner_object_id, title, html, size_bytes, sources_json, pinned)
        OUTPUT inserted.id, inserted.title, inserted.html, inserted.sources_json, inserted.created_at, inserted.pinned
        VALUES (@id, @owner, @title, @html, @size, @sources, @pinned);`);
      signal.throwIfAborted();
      if (!recordset[0]) throw new Error('Workspace HTML artifact was not saved');
      return mapArtifact(recordset[0]);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  async read(id: string, ownerObjectId: string, signal: AbortSignal): Promise<WorkspaceHtmlArtifact> {
    if (!uuid.test(id) || !ownerUuid.test(ownerObjectId)) throw new WorkspaceHtmlArtifactNotFound();
    const request = databaseReadRequest(this.pool)
      .input('id', sql.UniqueIdentifier, id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId);
    const cancel = () => { request.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const { recordset } = await request.query<WorkspaceHtmlArtifactRow>(`SELECT id, title, html, sources_json, created_at, pinned
        FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner;`);
      signal.throwIfAborted();
      const row = recordset[0];
      if (!row) throw new WorkspaceHtmlArtifactNotFound();
      return mapArtifact(row);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  async setPinned(
    id: string,
    ownerObjectId: string,
    pinned: boolean,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!uuid.test(id) || !ownerUuid.test(ownerObjectId)) throw new WorkspaceHtmlArtifactNotFound();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .input('pinned', sql.Bit, pinned);
    const cancel = () => { request.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      const { recordset } = await request.query<{ pinned: boolean }>(`UPDATE dbo.workspace_html_artifacts SET pinned = @pinned
        OUTPUT inserted.pinned WHERE id = @id AND owner_object_id = @owner;`);
      signal.throwIfAborted();
      if (!recordset[0]) throw new WorkspaceHtmlArtifactNotFound();
      return recordset[0].pinned;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
}

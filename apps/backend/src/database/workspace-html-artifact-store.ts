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

export interface WorkspaceHtmlArtifactVersion extends WorkspaceHtmlArtifact {
  readonly version: number;
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
  version_number: number;
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
    id: row.id.toLowerCase(),
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
    const artifact = await this.readVersion(id, ownerObjectId, signal);
    return { id: artifact.id, kind: artifact.kind, title: artifact.title, html: artifact.html,
      sources: artifact.sources, createdAt: artifact.createdAt, pinned: artifact.pinned };
  }

  async readVersion(
    id: string, ownerObjectId: string, signal: AbortSignal, version?: number,
  ): Promise<WorkspaceHtmlArtifactVersion> {
    if (!uuid.test(id) || !ownerUuid.test(ownerObjectId)) throw new WorkspaceHtmlArtifactNotFound();
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647)) {
      throw new WorkspaceHtmlArtifactNotFound();
    }
    const request = databaseReadRequest(this.pool)
      .input('id', sql.UniqueIdentifier, id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId)
      .input('version', sql.Int, version ?? null);
    const cancel = () => { request.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const { recordset } = await request.query<WorkspaceHtmlArtifactRow>(`SELECT id, title, html, sources_json, created_at, pinned, version_number
        FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner
          AND (@version IS NULL OR version_number = @version)
        UNION ALL
        SELECT artifact.id, history.title, history.html, history.sources_json, artifact.created_at,
          artifact.pinned, history.version_number
        FROM dbo.workspace_html_artifact_versions AS history
        JOIN dbo.workspace_html_artifacts AS artifact ON artifact.id = history.artifact_id
        WHERE artifact.id = @id AND artifact.owner_object_id = @owner AND history.version_number = @version;`);
      signal.throwIfAborted();
      const row = recordset?.[0];
      if (!row) throw new WorkspaceHtmlArtifactNotFound();
      if (Buffer.byteLength(row.html, 'utf8') > workspaceHtmlSizeLimit) {
        throw new TypeError('Stored workspace HTML exceeds 512 KB');
      }
      return { ...mapArtifact(row), version: row.version_number };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  async update(
    id: string,
    ownerObjectId: string,
    html: string,
    signal: AbortSignal,
    title?: string,
    sources?: readonly WorkspaceHtmlSource[],
  ): Promise<WorkspaceHtmlArtifactVersion> {
    if (!uuid.test(id) || !ownerUuid.test(ownerObjectId)) throw new WorkspaceHtmlArtifactNotFound();
    const size = typeof html === 'string' ? Buffer.byteLength(html, 'utf8') : 0;
    if (typeof html !== 'string' || !html.trim() || !isWellFormedUtf16(html) ||
        size < 1 || size > workspaceHtmlSizeLimit ||
        title !== undefined && (typeof title !== 'string' || !title.trim() || title !== title.trim() || title.length > 200) ||
        sources !== undefined && (!Array.isArray(sources) || sources.length > 50 || !sources.every(isHtmlSource))) {
      throw new TypeError('Invalid workspace HTML artifact');
    }
    const transaction = new sql.Transaction(this.pool);
    try {
      signal.throwIfAborted();
      await transaction.begin();
      const request = transaction.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('html', sql.NVarChar(sql.MAX), html)
        .input('size', sql.Int, size)
        .input('title', sql.NVarChar(200), title ?? null)
        .input('sources', sql.NVarChar(sql.MAX), sources === undefined ? null : JSON.stringify(sources));
      const cancel = () => { request.cancel(); };
      signal.addEventListener('abort', cancel, { once: true });
      let artifact: WorkspaceHtmlArtifactVersion;
      try {
        signal.throwIfAborted();
        const { recordset } = await request.query<WorkspaceHtmlArtifactRow>(`DECLARE @version int;
          SELECT @version = version_number FROM dbo.workspace_html_artifacts WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @id AND owner_object_id = @owner;
          IF @version IS NOT NULL
          BEGIN
            INSERT dbo.workspace_html_artifact_versions
              (artifact_id, version_number, title, html, size_bytes, sources_json)
            SELECT id, version_number, title, html, size_bytes, sources_json
              FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner;
            UPDATE dbo.workspace_html_artifacts
              SET title = COALESCE(@title, title), html = @html, size_bytes = @size,
                sources_json = COALESCE(@sources, sources_json),
                version_number = version_number + 1, repair_attempted = 0
              OUTPUT inserted.id, inserted.title, inserted.html, inserted.sources_json,
                inserted.created_at, inserted.pinned, inserted.version_number
              WHERE id = @id AND owner_object_id = @owner;
          END;`);
        signal.throwIfAborted();
        const row = recordset?.[0];
        if (!row) throw new WorkspaceHtmlArtifactNotFound();
        artifact = { ...mapArtifact(row), version: row.version_number };
      } finally {
        signal.removeEventListener('abort', cancel);
      }
      await transaction.commit();
      return artifact;
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
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

import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import {
  htmlArtifactByteLimit,
  isHtmlArtifact,
  isValidHtmlArtifactHtml,
  type HtmlArtifact,
  type HtmlArtifactSource,
} from '@jarvis/contracts';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

export class HtmlArtifactNotFound extends Error {
  constructor() {
    super('HTML artifact was not found');
    this.name = 'HtmlArtifactNotFound';
  }
}

interface HtmlArtifactRow {
  id: string;
  title: string;
  html: string;
  size_bytes: number;
  sources_json: string;
  created_at: Date | string;
  pinned: boolean;
}

function artifactFromRow(row: HtmlArtifactRow | undefined): HtmlArtifact | undefined {
  if (!row) return undefined;
  let sources: unknown;
  try {
    sources = JSON.parse(row.sources_json);
  } catch {
    throw new Error('Stored HTML artifact metadata is invalid');
  }
  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString();
  const artifact = {
    id: row.id,
    kind: 'html' as const,
    title: row.title,
    html: row.html,
    sources,
    createdAt,
    pinned: row.pinned,
  };
  if (!isHtmlArtifact(artifact) || row.size_bytes !== Buffer.byteLength(row.html, 'utf8')) {
    throw new Error('Stored HTML artifact failed validation');
  }
  return artifact;
}

function validate(ownerObjectId: string, title: string, html: string, sources: HtmlArtifactSource[]): void {
  if (!uuid.test(ownerObjectId)) throw new TypeError('Invalid HTML artifact owner');
  if (typeof title !== 'string' || !title.trim() || title.length > 200 ||
      !isValidHtmlArtifactHtml(html) || Buffer.byteLength(html, 'utf8') > htmlArtifactByteLimit ||
      !Array.isArray(sources) || sources.length > 50) {
    throw new TypeError('HTML artifact is invalid or exceeds its size limit');
  }
  if (!isHtmlArtifact({
    id: randomUUID(),
    kind: 'html',
    title: title.trim(),
    html,
    sources,
    createdAt: new Date().toISOString(),
    pinned: false,
  })) throw new TypeError('HTML artifact metadata is invalid');
}

async function query<T>(
  request: sql.Request,
  statement: string,
  signal: AbortSignal,
): Promise<sql.IResult<T>> {
  signal.throwIfAborted();
  const cancel = () => { request.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await request.query<T>(statement);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export class HtmlArtifactStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async create(
    ownerObjectId: string,
    title: string,
    html: string,
    sources: HtmlArtifactSource[],
    signal: AbortSignal,
  ): Promise<HtmlArtifact> {
    validate(ownerObjectId, title, html, sources);
    const id = randomUUID();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('title', sql.NVarChar(200), title.trim())
      .input('html', sql.NVarChar(sql.MAX), html)
      .input('size', sql.Int, Buffer.byteLength(html, 'utf8'))
      .input('sources', sql.NVarChar(sql.MAX), JSON.stringify(sources));
    const { recordset } = await query<HtmlArtifactRow>(request, `INSERT dbo.workspace_html_artifacts
      (id, owner_object_id, title, html, size_bytes, sources_json)
      OUTPUT inserted.id, inserted.title, inserted.html, inserted.size_bytes, inserted.sources_json,
        inserted.created_at, inserted.pinned
      VALUES (@id, @owner, @title, @html, @size, @sources);`, signal);
    const artifact = artifactFromRow(recordset[0]);
    if (!artifact) throw new Error('HTML artifact insert returned no row');
    return artifact;
  }

  async get(artifactId: string, ownerObjectId: string, signal: AbortSignal): Promise<HtmlArtifact> {
    if (!uuid.test(artifactId) || !uuid.test(ownerObjectId)) throw new HtmlArtifactNotFound();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
    const { recordset } = await query<HtmlArtifactRow>(request, `SELECT id, title, html, size_bytes, sources_json,
        created_at, pinned FROM dbo.workspace_html_artifacts
      WHERE id = @id AND owner_object_id = @owner;`, signal);
    const artifact = artifactFromRow(recordset[0]);
    if (!artifact) throw new HtmlArtifactNotFound();
    return artifact;
  }

  async update(
    artifactId: string,
    ownerObjectId: string,
    title: string,
    html: string,
    sources: HtmlArtifactSource[],
    signal: AbortSignal,
  ): Promise<HtmlArtifact> {
    validate(ownerObjectId, title, html, sources);
    if (!uuid.test(artifactId)) throw new HtmlArtifactNotFound();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('title', sql.NVarChar(200), title.trim())
      .input('html', sql.NVarChar(sql.MAX), html)
      .input('size', sql.Int, Buffer.byteLength(html, 'utf8'))
      .input('sources', sql.NVarChar(sql.MAX), JSON.stringify(sources));
    const { recordset } = await query<HtmlArtifactRow>(request, `SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @version int;
      SELECT @version = version_number FROM dbo.workspace_html_artifacts WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id AND owner_object_id = @owner;
      IF @version IS NOT NULL
      BEGIN
        INSERT dbo.workspace_html_artifact_versions
          (artifact_id, version_number, title, html, size_bytes, sources_json)
        SELECT id, version_number, title, html, size_bytes, sources_json
          FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner;
        UPDATE dbo.workspace_html_artifacts
          SET title = @title, html = @html, size_bytes = @size, sources_json = @sources,
            version_number = version_number + 1, repair_attempted = 0
          WHERE id = @id AND owner_object_id = @owner;
        DELETE FROM dbo.workspace_html_artifact_versions
          WHERE artifact_id = @id AND version_number < @version - 18;
      END;
      COMMIT TRANSACTION;
      SELECT id, title, html, size_bytes, sources_json, created_at, pinned
        FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner;`, signal);
    const artifact = artifactFromRow(recordset[0]);
    if (!artifact) throw new HtmlArtifactNotFound();
    return artifact;
  }

  async undo(artifactId: string, ownerObjectId: string, signal: AbortSignal): Promise<HtmlArtifact> {
    if (!uuid.test(artifactId)) throw new HtmlArtifactNotFound();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
    const { recordset } = await query<HtmlArtifactRow>(request, `SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @version int;
      SELECT @version = MAX(version_number) FROM dbo.workspace_html_artifact_versions WITH (UPDLOCK, HOLDLOCK)
        WHERE artifact_id = @id AND EXISTS (
          SELECT 1 FROM dbo.workspace_html_artifacts
            WHERE id = @id AND owner_object_id = @owner);
      IF @version IS NOT NULL
      BEGIN
        UPDATE currentArtifact
          SET title = prior.title, html = prior.html, size_bytes = prior.size_bytes,
            sources_json = prior.sources_json, version_number = currentArtifact.version_number + 1,
            repair_attempted = 0
          FROM dbo.workspace_html_artifacts AS currentArtifact
          JOIN dbo.workspace_html_artifact_versions AS prior
            ON prior.artifact_id = currentArtifact.id AND prior.version_number = @version
          WHERE currentArtifact.id = @id AND currentArtifact.owner_object_id = @owner;
        DELETE FROM dbo.workspace_html_artifact_versions
          WHERE artifact_id = @id AND version_number = @version;
      END;
      COMMIT TRANSACTION;
      SELECT id, title, html, size_bytes, sources_json, created_at, pinned
        FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner;`, signal);
    const artifact = artifactFromRow(recordset[0]);
    if (!artifact) throw new HtmlArtifactNotFound();
    return artifact;
  }

  async setPinned(
    artifactId: string,
    ownerObjectId: string,
    pinned: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    if (!uuid.test(artifactId) || !uuid.test(ownerObjectId)) throw new HtmlArtifactNotFound();
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
      .input('pinned', sql.Bit, pinned);
    const { rowsAffected } = await query<{ id: string }>(request, `UPDATE dbo.workspace_html_artifacts
      SET pinned = @pinned OUTPUT inserted.id
      WHERE id = @id AND owner_object_id = @owner;`, signal);
    if (rowsAffected[0] !== 1) throw new HtmlArtifactNotFound();
  }

  async claimRepair(artifactId: string, ownerObjectId: string, signal: AbortSignal): Promise<boolean> {
    if (!uuid.test(artifactId) || !uuid.test(ownerObjectId)) return false;
    const request = this.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase());
    const { rowsAffected } = await query<{ id: string }>(request, `UPDATE dbo.workspace_html_artifacts
      SET repair_attempted = 1 OUTPUT inserted.id
      WHERE id = @id AND owner_object_id = @owner AND repair_attempted = 0;`, signal);
    return rowsAffected[0] === 1;
  }
}

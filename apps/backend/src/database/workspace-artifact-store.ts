import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
  type BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';
import sql from 'mssql';
import { isWorkspaceCommand, type HtmlArtifactSource } from '@jarvis/contracts';
import { databaseReadRequest } from './wake-retry.js';

export const workspaceImageSizeLimit = 5 * 1024 * 1024;
const uploadKeyLifetimeMs = 5 * 60 * 1000;
const maxPendingUploads = 32;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const workspaceHtmlSizeLimit = 512 * 1024;
const maxTransientHtmlArtifacts = 64;
const htmlCommandId = /^[A-Za-z0-9_-]{1,128}$/u;

export interface WorkspaceHtmlArtifact {
  readonly id: string;
  readonly kind: 'html';
  readonly title: string;
  readonly html: string;
  readonly sources: readonly HtmlArtifactSource[];
  readonly createdAt: string;
  readonly pinned: boolean;
}

export type WorkspaceHtmlArtifactSummary = Omit<WorkspaceHtmlArtifact, 'html'>;

interface TransientHtmlArtifact {
  readonly ownerObjectId: string;
  readonly artifact: WorkspaceHtmlArtifact;
  readonly fingerprint: string;
}

export class WorkspaceArtifactNotFound extends Error {
  constructor() {
    super('Workspace artifact was not found');
    this.name = 'WorkspaceArtifactNotFound';
  }
}

interface PendingUpload {
  readonly artifactId: string;
  readonly ownerObjectId: string;
  readonly expiresAt: number;
  uploading: boolean;
  digest?: string;
}

export interface WorkspaceArtifactUpload {
  readonly artifactId: string;
  readonly uploadKey: string;
}

export interface WorkspaceArtifactStoreOptions {
  readonly pool: sql.ConnectionPool;
  readonly serviceClient: BlobServiceClient;
  readonly container: ContainerClient;
  readonly storageAccount: string;
  readonly createReadUrl?: (blobName: string, signal: AbortSignal) => Promise<string>;
}

function imageExtension(contentType: string): 'png' | 'jpg' | undefined {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return undefined;
}

function validateImage(contentType: string, image: Buffer): boolean {
  if (image.length < 4 || image.length > workspaceImageSizeLimit) return false;
  if (contentType === 'image/png') {
    return image.length >= 33 &&
      image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      image.readUInt32BE(8) === 13 &&
      image.toString('ascii', 12, 16) === 'IHDR' &&
      image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0 &&
      image.readUInt32BE(16) <= 4096 && image.readUInt32BE(20) <= 4096 &&
      image.readUInt32BE(16) * image.readUInt32BE(20) <= 16 * 1024 * 1024;
  }
  return contentType === 'image/jpeg' &&
    image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff &&
    image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9;
}

export class WorkspaceArtifactStore {
  private readonly pending = new Map<string, PendingUpload>();
  private readonly transientHtml = new Map<string, TransientHtmlArtifact>();
  private readonly transientHtmlCommands = new Map<string, string>();
  private readonly createReadUrl: (blobName: string, signal: AbortSignal) => Promise<string>;

  constructor(private readonly options: WorkspaceArtifactStoreOptions) {
    if (!/^[a-z0-9]{3,24}$/u.test(options.storageAccount)) {
      throw new TypeError('Invalid workspace artifact storage account');
    }
    this.createReadUrl = options.createReadUrl ?? ((blobName, signal) =>
      this.signedReadUrl(blobName, signal));
  }

  registerUpload(ownerObjectId: string): WorkspaceArtifactUpload {
    if (!uuid.test(ownerObjectId)) throw new TypeError('Invalid workspace artifact owner');
    const now = Date.now();
    for (const [key, upload] of this.pending) {
      if (upload.expiresAt <= now) this.pending.delete(key);
    }
    if (this.pending.size >= maxPendingUploads) throw new Error('Workspace artifact upload queue is full');
    const artifactId = randomUUID();
    const uploadKey = randomBytes(32).toString('base64url');
    this.pending.set(uploadKey, {
      artifactId,
      ownerObjectId: ownerObjectId.toLowerCase(),
      expiresAt: now + uploadKeyLifetimeMs,
      uploading: false,
    });
    return { artifactId, uploadKey };
  }

  releaseUpload(uploadKey: string): void {
    this.pending.delete(uploadKey);
  }

  createTransientHtml(
    ownerObjectId: string,
    commandId: string,
    title: string,
    html: string,
    sources: readonly HtmlArtifactSource[],
  ): WorkspaceHtmlArtifact {
    const owner = ownerObjectId.toLowerCase();
    const command = {
      commandId,
      operation: 'create-html',
      viewId: 'html',
      title,
      html,
      sources,
    };
    if (!uuid.test(owner) || !htmlCommandId.test(commandId) ||
        Buffer.byteLength(html, 'utf8') > workspaceHtmlSizeLimit || !isWorkspaceCommand(command)) {
      throw new TypeError('Invalid generated HTML artifact');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ title, html, sources })).digest('hex');
    const commandKey = `${owner}:${commandId}`;
    const priorId = this.transientHtmlCommands.get(commandKey);
    if (priorId) {
      const prior = this.transientHtml.get(priorId);
      if (prior?.fingerprint !== fingerprint) throw new Error('Workspace command ID was already used for different HTML');
      return prior.artifact;
    }
    if (this.transientHtml.size >= maxTransientHtmlArtifacts) {
      throw new Error('The temporary HTML artifact limit has been reached');
    }
    const id = randomUUID();
    if (!uuid.test(id) || this.transientHtml.has(id)) throw new TypeError('Invalid generated HTML artifact ID');
    const artifact: WorkspaceHtmlArtifact = {
      id,
      kind: 'html',
      title,
      html,
      sources,
      createdAt: new Date().toISOString(),
      pinned: false,
    };
    this.transientHtml.set(id, { ownerObjectId: owner, artifact, fingerprint });
    this.transientHtmlCommands.set(commandKey, id);
    return artifact;
  }

  async getHtml(
    artifactId: string,
    ownerObjectId: string,
    signal: AbortSignal,
  ): Promise<WorkspaceHtmlArtifact> {
    if (!uuid.test(artifactId) || !uuid.test(ownerObjectId)) {
      throw new Error('Workspace HTML artifact reference is invalid');
    }
    const request = databaseReadRequest(this.options.pool)
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId);
    const { recordset } = await this.query(request, signal)<{
      id: string; title: string; html: string; sources_json: string; created_at: Date | string; pinned: boolean;
    }>(`SELECT id, title, html, sources_json, created_at, pinned
        FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner AND pinned = 1;`);
    signal.throwIfAborted();
    const row = recordset[0];
    if (row) return this.mapHtmlRow(row);
    const transient = this.transientHtml.get(artifactId);
    if (transient?.ownerObjectId === ownerObjectId.toLowerCase()) return transient.artifact;
    throw new WorkspaceArtifactNotFound();
  }

  async listPinnedHtml(
    ownerObjectId: string,
    signal: AbortSignal,
  ): Promise<WorkspaceHtmlArtifactSummary[]> {
    if (!uuid.test(ownerObjectId)) throw new Error('Workspace artifact owner is invalid');
    const request = databaseReadRequest(this.options.pool)
      .input('owner', sql.UniqueIdentifier, ownerObjectId);
    const { recordset } = await this.query(request, signal)<{
      id: string; title: string; sources_json: string; created_at: Date | string; pinned: boolean;
    }>(`SELECT TOP (64) id, title, sources_json, created_at, pinned
        FROM dbo.workspace_html_artifacts WHERE owner_object_id = @owner AND pinned = 1
        ORDER BY created_at DESC, id DESC;`);
    signal.throwIfAborted();
    return recordset.map((row) => {
      const artifact = this.mapHtmlRow({ ...row, html: ' ' });
      const { html: _html, ...summary } = artifact;
      return summary;
    });
  }

  async pinHtml(artifactId: string, ownerObjectId: string, signal: AbortSignal): Promise<WorkspaceHtmlArtifact> {
    const owner = ownerObjectId.toLowerCase();
    if (!uuid.test(artifactId) || !uuid.test(owner)) throw new Error('Workspace HTML artifact reference is invalid');
    const existing = await this.findPinnedHtml(artifactId, owner, signal);
    if (existing) return existing;
    const transient = this.transientHtml.get(artifactId);
    if (!transient || transient.ownerObjectId !== owner) throw new WorkspaceArtifactNotFound();
    signal.throwIfAborted();
    const request = this.options.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, owner)
      .input('title', sql.NVarChar(200), transient.artifact.title)
      .input('html', sql.NVarChar(sql.MAX), transient.artifact.html)
      .input('sources', sql.NVarChar(sql.MAX), JSON.stringify(transient.artifact.sources))
      .input('size', sql.Int, Buffer.byteLength(transient.artifact.html, 'utf8'));
    const { recordset } = await this.query(request, signal)<{ created_at: Date | string }>(`INSERT dbo.workspace_html_artifacts
      (id, owner_object_id, title, html, sources_json, size_bytes)
      OUTPUT inserted.created_at
      VALUES (@id, @owner, @title, @html, @sources, @size);`);
    const pinned: WorkspaceHtmlArtifact = {
      ...transient.artifact,
      createdAt: recordset[0]?.created_at instanceof Date
        ? recordset[0].created_at.toISOString()
        : new Date(recordset[0]?.created_at ?? Date.now()).toISOString(),
      pinned: true,
    };
    this.transientHtml.set(artifactId, { ...transient, artifact: pinned });
    return pinned;
  }

  async unpinHtml(artifactId: string, ownerObjectId: string, signal: AbortSignal): Promise<void> {
    const owner = ownerObjectId.toLowerCase();
    if (!uuid.test(artifactId) || !uuid.test(owner)) throw new Error('Workspace HTML artifact reference is invalid');
    const existing = await this.findPinnedHtml(artifactId, owner, signal);
    if (!existing) {
      const transient = this.transientHtml.get(artifactId);
      if (transient?.ownerObjectId === owner) return;
      throw new WorkspaceArtifactNotFound();
    }
    if (this.transientHtml.size >= maxTransientHtmlArtifacts) {
      throw new Error('The temporary HTML artifact limit has been reached');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      title: existing.title, html: existing.html, sources: existing.sources,
    })).digest('hex');
    this.transientHtml.set(artifactId, {
      ownerObjectId: owner,
      artifact: { ...existing, pinned: false },
      fingerprint,
    });
    const request = this.options.pool.request()
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, owner);
    try {
      await this.query(request, signal)(`DELETE dbo.workspace_html_artifacts
        WHERE id = @id AND owner_object_id = @owner AND pinned = 1;`);
    } catch (error) {
      this.transientHtml.delete(artifactId);
      throw error;
    }
  }

  dispose(): void {
    this.transientHtml.clear();
    this.transientHtmlCommands.clear();
    this.pending.clear();
  }

  async upload(
    uploadKey: string,
    contentType: string,
    image: Buffer,
    signal: AbortSignal,
  ): Promise<string> {
    const registration = this.pending.get(uploadKey);
    if (!registration || registration.expiresAt <= Date.now() ||
        !imageExtension(contentType) || !validateImage(contentType, image)) {
      throw new Error('Workspace image upload is invalid or expired');
    }
    const digest = createHash('sha256').update(image).digest('hex');
    if (registration.digest !== undefined) {
      if (registration.digest !== digest) throw new Error('Workspace image upload key was already used');
      return registration.artifactId;
    }
    if (registration.uploading) throw new Error('Workspace image upload is already in progress');
    registration.uploading = true;
    const blobName = `workspace-images/${registration.artifactId}.${imageExtension(contentType)}`;
    const blob = this.options.container.getBlockBlobClient(blobName);
    let blobUploaded = false;
    try {
      signal.throwIfAborted();
      await blob.uploadData(image, {
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        blobHTTPHeaders: {
          blobContentType: contentType,
          blobContentDisposition: 'inline',
          blobCacheControl: 'private, no-store',
        },
      });
      blobUploaded = true;
      signal.throwIfAborted();
      const request = this.options.pool.request()
        .input('id', sql.UniqueIdentifier, registration.artifactId)
        .input('owner', sql.UniqueIdentifier, registration.ownerObjectId)
        .input('contentType', sql.NVarChar(16), contentType)
        .input('size', sql.Int, image.length);
      const cancel = () => { request.cancel(); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await request.query(`INSERT dbo.workspace_artifacts (id, owner_object_id, content_type, size_bytes)
          VALUES (@id, @owner, @contentType, @size);`);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
      registration.digest = digest;
      return registration.artifactId;
    } catch (error) {
      if (blobUploaded) {
        await blob.deleteIfExists({ abortSignal: AbortSignal.timeout(15_000) }).catch(() => undefined);
      }
      throw error;
    } finally {
      registration.uploading = false;
    }
  }

  async readUrl(artifactId: string, ownerObjectId: string, signal: AbortSignal): Promise<string> {
    if (!uuid.test(artifactId) || !uuid.test(ownerObjectId)) {
      throw new Error('Workspace artifact reference is invalid');
    }
    const request = databaseReadRequest(this.options.pool)
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId);
    const cancel = () => { request.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const { recordset } = await request.query<{ content_type: string }>(`SELECT content_type
        FROM dbo.workspace_artifacts WHERE id = @id AND owner_object_id = @owner;`);
      signal.throwIfAborted();
      const contentType = recordset[0]?.content_type;
      const extension = typeof contentType === 'string' ? imageExtension(contentType) : undefined;
      if (!extension) throw new WorkspaceArtifactNotFound();
      return await this.createReadUrl(`workspace-images/${artifactId}.${extension}`, signal);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  private async signedReadUrl(blobName: string, signal: AbortSignal): Promise<string> {
    const startsOn = new Date(Date.now() - 2 * 60 * 1000);
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000);
    const key = await this.options.serviceClient.getUserDelegationKey(startsOn, expiresOn, {
      abortSignal: signal,
    });
    const permissions = BlobSASPermissions.parse('r');
    const query = generateBlobSASQueryParameters({
      containerName: this.options.container.containerName,
      blobName,
      permissions,
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    }, key, this.options.storageAccount).toString();
    return `${this.options.container.getBlockBlobClient(blobName).url}?${query}`;
  }

  private async findPinnedHtml(
    artifactId: string,
    ownerObjectId: string,
    signal: AbortSignal,
  ): Promise<WorkspaceHtmlArtifact | undefined> {
    const request = databaseReadRequest(this.options.pool)
      .input('id', sql.UniqueIdentifier, artifactId)
      .input('owner', sql.UniqueIdentifier, ownerObjectId);
    const { recordset } = await this.query(request, signal)<{
      id: string; title: string; html: string; sources_json: string; created_at: Date | string; pinned: boolean;
    }>(`SELECT id, title, html, sources_json, created_at, pinned
        FROM dbo.workspace_html_artifacts WHERE id = @id AND owner_object_id = @owner AND pinned = 1;`);
    return recordset[0] ? this.mapHtmlRow(recordset[0]) : undefined;
  }

  private mapHtmlRow(row: {
    id: string; title: string; html: string; sources_json: string; created_at: Date | string; pinned: boolean;
  }): WorkspaceHtmlArtifact {
    let sources: unknown;
    try {
      sources = JSON.parse(row.sources_json);
    } catch {
      throw new Error('Stored workspace HTML sources are invalid');
    }
    if (!Array.isArray(sources) || sources.length > 50 ||
        !isWorkspaceCommand({
          commandId: 'validate-html',
          operation: 'create-html',
          viewId: 'html',
          title: row.title,
          html: row.html,
          sources,
          artifactId: row.id,
        })) {
      throw new Error('Stored workspace HTML artifact is invalid');
    }
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString();
    return { id: row.id, kind: 'html', title: row.title, html: row.html, sources, createdAt, pinned: row.pinned };
  }

  private query(request: sql.Request, signal?: AbortSignal) {
    const cancel = () => { request.cancel(); };
    if (signal?.aborted) throw signal.reason ?? new Error('Operation cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    return <T = unknown>(query: string) => request.query<T>(query).finally(() => {
      signal?.removeEventListener('abort', cancel);
    });
  }
}

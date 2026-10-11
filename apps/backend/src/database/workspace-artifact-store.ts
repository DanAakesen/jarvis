import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
  type BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';

export const workspaceImageSizeLimit = 5 * 1024 * 1024;
const uploadKeyLifetimeMs = 5 * 60 * 1000;
const maxPendingUploads = 32;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

  async privateReadUrl(blobName: string, signal: AbortSignal): Promise<string> {
    if (!/^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(blobName)) {
      throw new Error('Private attachment reference is invalid');
    }
    return this.signedReadUrl(blobName, signal, 5 * 60 * 1_000);
  }

  private async signedReadUrl(
    blobName: string,
    signal: AbortSignal,
    lifetimeMs = 60 * 60 * 1_000,
  ): Promise<string> {
    const startsOn = new Date(Date.now() - 2 * 60 * 1000);
    const expiresOn = new Date(Date.now() + lifetimeMs);
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
}

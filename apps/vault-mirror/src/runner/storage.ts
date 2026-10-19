import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import type { BlobClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/core-auth';
import { vaultMirrorStatusSchema, type VaultMirrorStatus } from '@jarvis/contracts';
import type { Readable } from 'node:stream';
import { checksum } from './state.js';
import type { LeaseResult, MirrorStorage, StateLease } from './types.js';
import { MAX_ARCHIVE_BYTES } from './types.js';

const stateContainerName = 'vault-mirror-state';
const statusContainerName = 'vault-mirror-status';
const stateBlobName = 'state.zip';
const maxStatusBytes = 32 * 1024;
const statusReadTimeoutMs = 5_000;

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { statusCode?: unknown; status?: unknown }).statusCode ??
    (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export class StateCorruptError extends Error {
  constructor() { super('Vault mirror state is corrupt'); }
}

export async function readMirrorStatusBlob(
  blob: Pick<BlobClient, 'download'>,
): Promise<VaultMirrorStatus | null> {
  const controller = new AbortController();
  let body: Readable | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => {
      controller.abort();
      body?.destroy();
      resolve(null);
    }, statusReadTimeoutMs);
    timeout.unref();
  });
  const read = async (): Promise<VaultMirrorStatus | null> => {
    try {
      const response = await blob.download(0, undefined, {
        abortSignal: controller.signal,
        maxRetryRequests: 0,
      });
      body = response.readableStreamBody as Readable | undefined;
      if (!body || controller.signal.aborted || (response.contentLength ?? 0) > maxStatusBytes) {
        body?.destroy();
        return null;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.byteLength;
        if (size > maxStatusBytes) {
          controller.abort();
          body.destroy();
          return null;
        }
        chunks.push(buffer);
      }
      const parsed = vaultMirrorStatusSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class AzureMirrorStorage implements MirrorStorage {
  private readonly state: ContainerClient;
  private readonly status: ContainerClient;

  constructor(storageUrl: string, credential: TokenCredential) {
    const service = new BlobServiceClient(storageUrl, credential, {
      retryOptions: { maxTries: 2, tryTimeoutInMs: 10_000 },
    });
    this.state = service.getContainerClient(stateContainerName);
    this.status = service.getContainerClient(statusContainerName);
  }

  async readStatus(): Promise<VaultMirrorStatus | null> {
    try {
      const blob = this.status.getBlockBlobClient('status.json');
      return await readMirrorStatusBlob(blob);
    } catch {
      return null;
    }
  }

  async acquireLease(signal: AbortSignal): Promise<LeaseResult> {
    const blob = this.state.getBlockBlobClient(stateBlobName);
    try {
      await blob.uploadData(Buffer.alloc(0), {
        abortSignal: signal,
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/zip' },
      });
    } catch (error) {
      if (![409, 412].includes(statusCode(error) ?? 0)) throw error;
    }
    const lease = blob.getBlobLeaseClient();
    try {
      await lease.acquireLease(60, { abortSignal: signal });
    } catch (error) {
      if (statusCode(error) === 409) return { busy: true };
      throw error;
    }
    try {
      const properties = await blob.getProperties({
        abortSignal: signal,
        conditions: { leaseId: lease.leaseId },
      });
      if (!properties.etag || !Number.isSafeInteger(properties.contentLength) ||
        (properties.contentLength ?? 0) > MAX_ARCHIVE_BYTES) throw new StateCorruptError();
      const archive = properties.contentLength === 0
        ? null
        : await blob.downloadToBuffer(0, properties.contentLength, {
          abortSignal: signal,
          conditions: { leaseId: lease.leaseId, ifMatch: properties.etag },
        });
      const expectedChecksum = properties.metadata?.sha256;
      if (archive && (!expectedChecksum || !/^[a-f0-9]{64}$/u.test(expectedChecksum) ||
        checksum(archive) !== expectedChecksum)) throw new StateCorruptError();
      if (!archive && expectedChecksum) throw new StateCorruptError();
      const stateLease: StateLease = {
        archive,
        etag: properties.etag,
        checksum: expectedChecksum ?? null,
        async renew(renewSignal) {
          await lease.renewLease({ abortSignal: renewSignal });
        },
        async upload(bytes, digest, uploadSignal) {
          await blob.uploadData(bytes, {
            abortSignal: uploadSignal,
            conditions: { leaseId: lease.leaseId, ifMatch: properties.etag! },
            metadata: { sha256: digest },
            blobHTTPHeaders: { blobContentType: 'application/zip' },
          });
        },
        async release(releaseSignal) {
          await lease.releaseLease({ abortSignal: releaseSignal });
        },
      };
      return { busy: false, lease: stateLease };
    } catch (error) {
      await lease.releaseLease({ abortSignal: AbortSignal.timeout(3_000) }).catch(() => undefined);
      throw error;
    }
  }

  async writeStatus(status: import('@jarvis/contracts').VaultMirrorStatus, signal: AbortSignal): Promise<void> {
    const blob = this.status.getBlockBlobClient('status.json');
    await blob.uploadData(Buffer.from(JSON.stringify(status)), {
      abortSignal: signal,
      blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
    });
  }
}

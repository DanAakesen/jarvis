import { randomUUID } from 'node:crypto';
import { BlobServiceClient,type ContainerClient } from '@azure/storage-blob';
import { QueueServiceClient,type QueueClient } from '@azure/storage-queue';
import type { TokenCredential } from '@azure/core-auth';
import { authorizeHealth,healthUploadLimit,metadataLimit,opaqueId,ownerId,sha256,validateManifest,HealthConflict,HealthUnavailable,
  type HealthCapability,type HealthCredentialVerifier,type HealthKind,type HealthManifest,type HealthReceipt } from './contracts.js';

export interface UploadIdentity { automationId: string; sessionId: string }
export interface HealthBufferFaults {
  afterRaw?: () => Promise<void>; afterManifest?: () => Promise<void>; afterQueue?: () => Promise<void>;
}
function status(error: unknown): number | undefined { return (error as { statusCode?: number })?.statusCode; }
async function privateContainer(container: ContainerClient,signal: AbortSignal) {
  const properties = await container.getProperties({ abortSignal: signal });
  if (properties.blobPublicAccess !== undefined) throw new HealthUnavailable();
}
async function jsonBlob(container: ContainerClient,name: string,signal: AbortSignal) {
  const blob = container.getBlobClient(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const properties = await blob.getProperties({ abortSignal: signal });
    const length = properties.contentLength;
    if (!length || length > metadataLimit || !properties.etag) throw new HealthUnavailable();
    try {
      const bytes = await blob.downloadToBuffer(0,length,{ abortSignal: signal,conditions: { ifMatch: properties.etag } });
      if (bytes.length !== length) throw new HealthUnavailable();
      return JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes)) as unknown;
    } catch (error) { if (status(error) !== 412 || attempt === 2) throw error; }
  }
  throw new HealthUnavailable();
}
/** Read-only, per-request revocation lookup. No minting/rotation/provisioning or SQL dependency. */
export function createBlobHealthVerifier(container: ContainerClient): HealthCredentialVerifier {
  return async (token,signal) => {
    try {
      await privateContainer(container,signal);
      const value = await jsonBlob(container,`health-devices/${sha256(token)}.json`,signal);
      return value as HealthCapability; // Strict owner/scope/expiry validation happens at the HTTP boundary.
    } catch (error) {
      if (status(error) === 404) return null;
      if (signal.aborted) throw signal.reason;
      throw new HealthUnavailable();
    }
  };
}
/** Actual SDK durability adapter. Private raw + acceptance/outbox manifest precede acknowledgement.
 * Queue is pointer-only and at least once; no SQL/agent/processor or payload deletion. */
export class AzureHealthBuffer {
  readonly owner: string;
  constructor(private readonly container: ContainerClient,private readonly queue: QueueClient,owner: string,
    private readonly now: () => string = () => new Date().toISOString(),private readonly faults: HealthBufferFaults = {}) { this.owner = ownerId(owner); }
  async accept(kind: HealthKind,capability: HealthCapability,identity: UploadIdentity,body: Buffer,signal: AbortSignal): Promise<HealthReceipt> {
    authorizeHealth(capability,this.owner,kind === 'upload' ? 'health-ingest' : 'health-heartbeat');
    if (!body.length || body.length > healthUploadLimit) throw new TypeError('Invalid body size');
    opaqueId(identity.automationId); opaqueId(identity.sessionId);
    identity = { ...identity }; body = Buffer.from(body);
    signal.throwIfAborted();
    try {
      await privateContainer(this.container,signal);
      const checksum = sha256(body);
      const sessionHash = sha256(JSON.stringify([this.owner,kind,identity.automationId,identity.sessionId]));
      const rawKey = `raw/${sha256(JSON.stringify([sessionHash,checksum]))}.json`;
      const raw = this.container.getBlockBlobClient(rawKey);
      try {
        await raw.uploadData(body,{ abortSignal: signal,conditions: { ifNoneMatch: '*' },concurrency: 1,
          metadata: { sha256: checksum },blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
      } catch (error) {
        if (![409,412].includes(status(error) ?? 0)) throw error;
        const properties = await raw.getProperties({ abortSignal: signal });
        if (properties.contentLength !== body.length || properties.metadata?.sha256 !== checksum) throw new HealthUnavailable();
      }
      await this.faults.afterRaw?.(); signal.throwIfAborted();
      const manifestKey = `accepted/${sessionHash}.json`;
      const proposed: HealthManifest = { version: 1,acceptanceId: randomUUID(),ownerObjectId: this.owner,deviceId: capability.deviceId,kind,
        ...identity,checksum,rawKey,bytes: body.length,acceptedAt: this.now(),delivery: 'pending' };
      validateManifest(proposed);
      let manifest = proposed; let duplicate = false;
      try {
        await this.container.getBlockBlobClient(manifestKey).uploadData(Buffer.from(JSON.stringify(proposed)),{
          abortSignal: signal,conditions: { ifNoneMatch: '*' },blobHTTPHeaders: { blobContentType: 'application/json' } });
      } catch (error) {
        if (![409,412].includes(status(error) ?? 0)) throw error;
        manifest = validateManifest(await jsonBlob(this.container,manifestKey,signal)); duplicate = true;
        if (manifest.ownerObjectId !== this.owner || manifest.kind !== kind || manifest.automationId !== identity.automationId || manifest.sessionId !== identity.sessionId ||
            manifest.checksum !== checksum || manifest.rawKey !== rawKey || manifest.bytes !== body.length) throw new HealthConflict();
      }
      await this.faults.afterManifest?.(); signal.throwIfAborted();
      if (manifest.delivery === 'pending') {
        try { await this.deliver(manifestKey,manifest,signal); manifest = { ...manifest,delivery: 'queued' }; }
        catch { if (signal.aborted) throw signal.reason; /* Accepted pending outbox remains recoverable in private Blob. */ }
      }
      return { acceptanceId: manifest.acceptanceId,acceptedAt: manifest.acceptedAt,status: 'accepted',queue: manifest.delivery,processing: 'not-confirmed',duplicate };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof HealthConflict) throw error;
      throw new HealthUnavailable();
    }
  }
  private async deliver(key: string,manifest: HealthManifest,signal: AbortSignal) {
    const blob = this.container.getBlockBlobClient(key);
    const before = await blob.getProperties({ abortSignal: signal });
    if (!before.etag) throw new HealthUnavailable();
    // Non-expiring pointer: SQL/agent outage must not silently expire accepted work.
    await this.queue.sendMessage(JSON.stringify({ version: 1,manifest: key }),{ abortSignal: signal,messageTimeToLive: -1 });
    await this.faults.afterQueue?.(); signal.throwIfAborted();
    try {
      await blob.uploadData(Buffer.from(JSON.stringify({ ...manifest,delivery: 'queued' })),{
        abortSignal: signal,conditions: { ifMatch: before.etag },blobHTTPHeaders: { blobContentType: 'application/json' } });
    } catch (error) {
      if (status(error) !== 412) throw error;
      const current = validateManifest(await jsonBlob(this.container,key,signal));
      if (current.acceptanceId !== manifest.acceptanceId || current.checksum !== manifest.checksum || current.delivery !== 'queued') throw new HealthUnavailable();
    }
  }
  /** Trusted bounded recovery, no HTTP exposure/scheduler. Cursor includes queued entries;
   * replayQueued is explicit operator recovery after delivery/response ambiguity, not processing. */
  async recover(options: { limit: number; cursor?: string; replayQueued?: boolean },signal: AbortSignal): Promise<{ inspected: number; queued: number; failed: number; next: string | null }> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100 || options.cursor && options.cursor.length > 4096) throw new TypeError('Invalid recovery page');
    await privateContainer(this.container,signal);
    let inspected = 0; let queued = 0; let failed = 0; let next: string | null = null;
    const pages = this.container.listBlobsFlat({ prefix: 'accepted/',abortSignal: signal }).byPage({ maxPageSize: options.limit,...(options.cursor ? { continuationToken: options.cursor } : {}) });
    for await (const page of pages) {
      signal.throwIfAborted(); next = page.continuationToken || null;
      for (const blob of page.segment.blobItems) {
        signal.throwIfAborted(); if (++inspected > options.limit) throw new HealthUnavailable();
        try {
          const manifest = validateManifest(await jsonBlob(this.container,blob.name,signal));
          const sessionHash = sha256(JSON.stringify([this.owner,manifest.kind,manifest.automationId,manifest.sessionId]));
          if (manifest.ownerObjectId !== this.owner || blob.name !== `accepted/${sessionHash}.json` ||
              manifest.rawKey !== `raw/${sha256(JSON.stringify([sessionHash,manifest.checksum]))}.json`) throw new HealthUnavailable();
          if (manifest.delivery === 'pending' || options.replayQueued === true) { await this.deliver(blob.name,manifest,signal); queued++; }
        } catch { if (signal.aborted) throw signal.reason; failed++; }
      }
      break; // One bounded page; never claim full coverage while next is present.
    }
    return { inspected,queued,failed,next };
  }
}
/** Configured account URLs only; managed identity TokenCredential is injected, never granted here.
 * Constructs clients without provisioning or contacting Azure. Not called by production index. */
export function createAzureHealthDependencies(config: { ownerObjectId: string; blobUrl: string; queueUrl: string; rawContainer: string; deviceContainer: string; queueName: string },credential: TokenCredential) {
  const blob = new URL(config.blobUrl); const queue = new URL(config.queueUrl);
  if (blob.protocol !== 'https:' || queue.protocol !== 'https:' || blob.username || blob.password || queue.username || queue.password || blob.search || queue.search || blob.hash || queue.hash ||
      blob.pathname !== '/' || queue.pathname !== '/' || !/^[a-z0-9]+\.blob\.core\.windows\.net$/u.test(blob.hostname) || queue.hostname !== blob.hostname.replace('.blob.','.queue.')) throw new TypeError('Invalid configured storage endpoints');
  const blobs = new BlobServiceClient(blob.href,credential,{ retryOptions: { maxTries: 3,tryTimeoutInMs: 10000 } });
  const queues = new QueueServiceClient(queue.href,credential,{ retryOptions: { maxTries: 3,tryTimeoutInMs: 10000 } });
  return { buffer: new AzureHealthBuffer(blobs.getContainerClient(config.rawContainer),queues.getQueueClient(config.queueName),config.ownerObjectId),
    verifier: createBlobHealthVerifier(blobs.getContainerClient(config.deviceContainer)) };
}

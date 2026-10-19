import type { BlobClient } from '@azure/storage-blob';
import type { Readable } from 'node:stream';
import { vaultMirrorStatusSchema, type VaultMirrorStatus, type VaultMirrorStatusView } from '@jarvis/contracts';

const MAX_BYTES = 32 * 1024;
const DEADLINE_MS = 5_000;
const CACHE_MS = 30_000;

export interface VaultMirrorStatusReader {
  read(): Promise<VaultMirrorStatusView>;
  readForStatus(): Promise<VaultMirrorStatusView>;
}

function project(status: VaultMirrorStatus, now: number, paths: boolean): VaultMirrorStatusView {
  const { lastSuccessAt, writeBack, reason, conflictPaths,
    approved, pushed, writtenBack, deleted, conflicts, skipped,
    credentialMatches, pendingWriteBack, consecutiveFailures } = status;
  const state = status.outcome === 'needs-attention' || status.outcome === 'failed'
    ? status.outcome
    : lastSuccessAt === null || now - Date.parse(lastSuccessAt) > 30 * 60_000 ? 'stale' : 'healthy';
  return {
    state, lastSuccessAt, writeBack,
    ...(reason ? { reason } : {}),
    counts: { approved, pushed, writtenBack, deleted, conflicts, skipped,
      credentialMatches, pendingWriteBack, consecutiveFailures },
    ...(paths ? { conflictPaths: [...conflictPaths] } : {}),
  };
}

export function createVaultMirrorStatusReader(
  blob?: Pick<BlobClient, 'download'>,
  now: () => number = Date.now,
): VaultMirrorStatusReader {
  type Result = VaultMirrorStatus | 'not-set-up' | 'read-error';
  let cached: { value: Result; expiresAt: number } | undefined;
  let pending: Promise<Result> | undefined;
  async function load(): Promise<Result> {
    if (!blob) return 'not-set-up';
    const controller = new AbortController();
    let body: Readable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        body?.destroy?.();
        reject(new Error('deadline'));
      }, DEADLINE_MS);
      timer.unref();
    });
    const work = async (): Promise<Result> => {
      const response = await blob.download(0, undefined, {
        abortSignal: controller.signal,
        maxRetryRequests: 0,
      });
      body = response.readableStreamBody as Readable | undefined;
      if (!body) return 'read-error';
      if (controller.signal.aborted || (response.contentLength ?? 0) > MAX_BYTES) {
        body.destroy?.();
        return 'read-error';
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        bytes += buffer.length;
        if (bytes > MAX_BYTES) {
          controller.abort();
          body.destroy?.();
          return 'read-error';
        }
        chunks.push(buffer);
      }
      return vaultMirrorStatusSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    };
    try {
      return await Promise.race([work(), deadline]);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      return code === 'ContainerNotFound' || code === 'BlobNotFound' ? 'not-set-up' : 'read-error';
    } finally {
      clearTimeout(timer);
    }
  }
  async function read(paths: boolean): Promise<VaultMirrorStatusView> {
    if (!cached || now() >= cached.expiresAt) {
      pending ??= load().then((value) => {
        cached = { value, expiresAt: now() + CACHE_MS };
        return value;
      }).finally(() => { pending = undefined; });
      await pending;
    }
    const value = cached!.value;
    return typeof value === 'string' ? { state: value, lastSuccessAt: null } : project(value, now(), paths);
  }
  return { read: () => read(false), readForStatus: () => read(true) };
}

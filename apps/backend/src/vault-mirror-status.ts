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
  const { finishedAt, outcome, guardReasons, changedOnGitHub, changedOnObsidian,
    deletedOnGitHub, deletedOnObsidian, deferredOnGitHub, deferredOnObsidian,
    lastSuccessAt, writeBack, reason, conflictPaths,
    approved, pushed, writtenBack, deleted, conflicts, skipped,
    credentialMatches, pendingWriteBack, consecutiveFailures } = status;
  const lastSuccessTime = lastSuccessAt === null ? Number.NaN : Date.parse(lastSuccessAt);
  const state = outcome === 'needs-attention' || outcome === 'failed'
    ? outcome
    : !Number.isFinite(lastSuccessTime) || lastSuccessTime > now + 30_000 ||
        now - lastSuccessTime > 30 * 60_000 ? 'stale' : 'healthy';
  return {
    state, lastSuccessAt, lastRunAt: finishedAt, outcome,
    ...(guardReasons ? { guardReasons: [...guardReasons] } : {}),
    ...(changedOnGitHub !== undefined ? { changedOnGitHub } : {}),
    ...(changedOnObsidian !== undefined ? { changedOnObsidian } : {}),
    ...(deletedOnGitHub !== undefined ? { deletedOnGitHub } : {}),
    ...(deletedOnObsidian !== undefined ? { deletedOnObsidian } : {}),
    ...(deferredOnGitHub !== undefined ? { deferredOnGitHub } : {}),
    ...(deferredOnObsidian !== undefined ? { deferredOnObsidian } : {}),
    writeBack,
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
  type Result =
    | { readonly status: VaultMirrorStatus }
    | {
      readonly state: 'not-set-up' | 'read-error';
      readonly readReason: NonNullable<VaultMirrorStatusView['readReason']>;
    };
  let cached: { value: Result; expiresAt: number } | undefined;
  let pending: Promise<Result> | undefined;
  async function load(): Promise<Result> {
    if (!blob) return { state: 'not-set-up', readReason: 'backend-not-configured' };
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
      if (!body) return { state: 'read-error', readReason: 'unavailable' };
      if (controller.signal.aborted || (response.contentLength ?? 0) > MAX_BYTES) {
        body.destroy?.();
        return { state: 'read-error', readReason: controller.signal.aborted ? 'timed-out' : 'invalid' };
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        bytes += buffer.length;
        if (bytes > MAX_BYTES) {
          controller.abort();
          body.destroy?.();
          return { state: 'read-error', readReason: 'invalid' };
        }
        chunks.push(buffer);
      }
      let document: unknown;
      try {
        document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return { state: 'read-error', readReason: 'invalid' };
      }
      const parsed = vaultMirrorStatusSchema.safeParse(document);
      return parsed.success
        ? { status: parsed.data }
        : { state: 'read-error', readReason: 'invalid' };
    };
    try {
      return await Promise.race([work(), deadline]);
    } catch (error) {
      const failure = error as { code?: unknown; name?: unknown; message?: unknown } | null;
      const code = typeof failure?.code === 'string' ? failure.code : '';
      if (code === 'ContainerNotFound' || code === 'BlobNotFound') {
        return { state: 'not-set-up', readReason: 'status-missing' };
      }
      if (['AuthorizationFailure', 'AuthorizationPermissionMismatch', 'AuthenticationFailed', 'Forbidden'].includes(code)) {
        return { state: 'read-error', readReason: 'access-denied' };
      }
      if (failure?.message === 'deadline' || failure?.name === 'AbortError' || controller.signal.aborted) {
        return { state: 'read-error', readReason: 'timed-out' };
      }
      return { state: 'read-error', readReason: 'unavailable' };
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
    return 'status' in value
      ? project(value.status, now(), paths)
      : { state: value.state, lastSuccessAt: null, readReason: value.readReason };
  }
  return { read: () => read(false), readForStatus: () => read(true) };
}

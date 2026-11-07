import { randomUUID } from 'node:crypto';
import type { ContainerClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/core-auth';
import { FoundryClientError, type RunnerTransport } from '../foundry/client.js';
import type { TaskStore } from './task-store.js';

const prefix = 'vm128-';
const idPattern = /^vm128-[a-f0-9-]{36}$/u;
const terminal = new Set(['completed', 'failed', 'cancelled', 'paused', 'interrupted', 'needs_attention']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const taskId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;

/** Server-only storage authenticated by managed identity, shared with the disk-backed worker.
 * It transports the existing Invocations contract; it cannot authorize a task itself.
 */
export class FactoryWorkerMailbox {
  private timer: NodeJS.Timeout | undefined;
  private polling: Promise<void> | undefined;
  private wakePending: Promise<void> | undefined;
  private lastWake = 0;
  private nextPollAt = 0;
  private activeUntil = 0;

  constructor(private readonly options: {
    container: ContainerClient;
    credential: TokenCredential;
    resourceId: string;
    enabled: boolean;
    tasks: TaskStore;
    issueToken: (repository: string) => Promise<string>;
    ownsInvocation: (taskId: string, sessionId: string, invocationId: string) => Promise<boolean>;
    onError: (error: unknown) => void;
    fetch?: typeof fetch;
  }) {
    if (!/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[A-Za-z0-9_.-]+\/providers\/Microsoft.Compute\/virtualMachines\/[A-Za-z0-9_-]+$/u.test(options.resourceId)) {
      throw new TypeError('Invalid Factory worker resource ID');
    }
  }

  private async read(key: string): Promise<unknown | undefined> {
    const blob = this.options.container.getBlobClient(key);
    try {
      const response = await blob.download(0, undefined, {abortSignal: AbortSignal.timeout(20_000)});
      if ((response.contentLength ?? 0) > 1_048_576 || !response.readableStreamBody) throw new Error('Worker payload too large');
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const value of response.readableStreamBody) {
        const chunk = Buffer.from(value as Uint8Array);
        bytes += chunk.length;
        if (bytes > 1_048_576) { response.readableStreamBody.destroy(); throw new Error('Worker payload too large'); }
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (object(error) && error['statusCode'] === 404) return undefined;
      throw new FoundryClientError('transport', 'worker-read');
    }
  }

  private async write(key: string, value: unknown, create = false): Promise<void> {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 1_048_576) throw new FoundryClientError('protocol', 'worker-write');
    await this.options.container.getBlockBlobClient(key).upload(body, Buffer.byteLength(body), {
      abortSignal: AbortSignal.timeout(20_000),
      blobHTTPHeaders: { blobContentType: 'application/json' },
      ...(create ? { conditions: { ifNoneMatch: '*' } } : {}),
    });
  }

  private async wake(): Promise<void> {
    if (this.wakePending) return this.wakePending;
    if (Date.now() - this.lastWake < 15_000) return;
    this.wakePending = (async () => {
      const signal = AbortSignal.timeout(20_000);
      const token = await this.options.credential.getToken('https://management.azure.com/.default', { abortSignal: signal });
      if (!token) throw new FoundryClientError('auth', 'worker-wake');
      const response = await (this.options.fetch ?? fetch)(`https://management.azure.com${this.options.resourceId}/start?api-version=2024-07-01`, {
        method: 'POST', headers: { Authorization: `Bearer ${token.token}` }, signal,
      });
      await response.body?.cancel();
      // A deallocation already in flight settles first. Status polling wakes the queued work again.
      if (!response.ok && response.status !== 409) throw new FoundryClientError('http', 'worker-wake', response.status);
      this.lastWake = Date.now();
    })();
    try { await this.wakePending; } finally { this.wakePending = undefined; }
  }

  readonly transport: RunnerTransport = async (request) => {
    const invocationFromPath = decodeURIComponent(request.path.split('/')[2] ?? '');
    const sessionFromPath = decodeURIComponent(request.path.split('/')[1] ?? '');
    const workerSession = request.sessionId?.startsWith(prefix) || sessionFromPath.startsWith(prefix);
    const workerInvocation = invocationFromPath.startsWith(prefix);
    if (!(request.operation === 'start' && this.options.enabled) && !workerSession && !workerInvocation) return undefined;
    if (request.options.signal?.aborted) throw new FoundryClientError('aborted', request.operation);
    if (request.operation === 'status') {
      if (!idPattern.test(invocationFromPath)) throw new FoundryClientError('protocol', 'worker-status');
      const snapshot = await this.read(`invocations/${invocationFromPath}.json`);
      if (!object(snapshot)) throw new FoundryClientError('http', 'worker-status', 404);
      if (!terminal.has(String(snapshot['status']))) {
        this.activeUntil = Date.now() + 60_000;
        this.nextPollAt = 0;
        await this.wake();
        const health = await this.read('health.json');
        if (snapshot['status'] === 'queued' && typeof snapshot['started_at'] === 'number' &&
            Date.now() / 1000 - snapshot['started_at'] > 600 &&
            (!object(health) || typeof health['at'] !== 'number' || Date.now() / 1000 - health['at'] > 180)) {
          return {...snapshot, status: 'interrupted', finished_at: Date.now() / 1000,
            error: 'Worker did not start; recover the existing task.'};
        }
        if (snapshot['status'] !== 'queued' && object(health) && typeof health['at'] === 'number' &&
            (Date.now() / 1000 - health['at'] > 180 ||
             (typeof snapshot['workerInstance'] === 'string' && snapshot['workerInstance'] !== health['instance']))) {
          return { ...snapshot, status: 'interrupted', finished_at: Date.now() / 1000,
            error: 'Worker stopped responding; recover the existing task.' };
        }
      }
      return snapshot;
    }
    if (!['start', 'resume', 'steer', 'pause', 'cancel', 'delete-session'].includes(request.operation)) {
      throw new FoundryClientError('protocol', 'worker-operation');
    }
    const sessionId = request.sessionId ?? (request.operation === 'delete-session' ? sessionFromPath : prefix + randomUUID());
    const invocationId = request.operation === 'cancel' ? invocationFromPath : prefix + randomUUID();
    if (!idPattern.test(sessionId) || !idPattern.test(invocationId)) throw new FoundryClientError('protocol', 'worker-identity');
    await this.wake();
    if (request.options.signal?.aborted) throw new FoundryClientError('aborted', request.operation);
    this.activeUntil = Date.now() + 60_000;
    this.nextPollAt = 0;
    const commandId = `${Date.now()}-${randomUUID()}`;
    if (['start', 'resume', 'steer'].includes(request.operation)) {
      await this.write(`invocations/${invocationId}.json`, {
        invocation_id: invocationId, session_id: sessionId, agent: request.body?.['agent'], status: 'queued',
        started_at: Date.now() / 1000, finished_at: null, events: [], result: null, error: null,
      }, true);
    }
    await this.write(`commands/${commandId}.json`, {
      operation: request.operation, invocationId, sessionId, body: request.body ?? {},
    }, true);
    if (['start', 'resume', 'steer'].includes(request.operation)) return {
      invocation_id: invocationId, session_id: sessionId, agent: request.body?.['agent'], status: 'queued',
    };
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (request.options.signal?.aborted) throw new FoundryClientError('aborted', request.operation);
      const response = await this.read(`responses/${commandId}.json`);
      if (response !== undefined) {
        if (!object(response) || ['failed', 'interrupted'].includes(String(response['status']))) throw new FoundryClientError('protocol', request.operation);
        return response;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    throw new FoundryClientError('timeout', request.operation);
  };

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.polling || Date.now() < this.nextPollAt) return;
      this.polling = this.poll().catch(this.options.onError).finally(() => { this.polling = undefined; });
    }, 1_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.polling;
  }

  async poll(): Promise<void> {
    let observed = false;
    for (const prefix of ['rpc-requests/', 'events/']) {
      let count = 0;
      for await (const blob of this.options.container.listBlobsFlat({ prefix, abortSignal: AbortSignal.timeout(20_000) })) {
        if (++count > 100) break;
        observed = true;
        const value = await this.read(blob.name);
        if (!object(value) || !taskId(value['taskId']) || typeof value['sessionId'] !== 'string' || !idPattern.test(value['sessionId'])) {
          await this.options.container.getBlobClient(blob.name).deleteIfExists({abortSignal: AbortSignal.timeout(20_000)});
          continue;
        }
        if (prefix === 'rpc-requests/') {
          if (value['kind'] !== 'github-token' || typeof value['expiresAt'] !== 'number' ||
              value['expiresAt'] < Date.now() / 1000 || value['expiresAt'] > Date.now() / 1000 + 60) {
            await this.options.container.getBlobClient(blob.name).deleteIfExists({abortSignal: AbortSignal.timeout(20_000)});
            continue;
          }
          const repository = await this.options.tasks.getActiveRepository(value['taskId'], value['sessionId']);
          if (!repository && value['expiresAt'] > Date.now() / 1000 + 5) continue;
          const result = repository ? { token: await this.options.issueToken(repository), repository } : { error: 'Task is not active' };
          await this.write(blob.name.replace('rpc-requests/', 'rpc-responses/'), result);
        } else {
          const payload = value['payload'];
          if (object(payload) && typeof payload['invocationId'] === 'string' && idPattern.test(payload['invocationId']) &&
              typeof value['type'] === 'string' && /^[a-z][a-z_]{0,63}$/u.test(value['type']) &&
              typeof value['summary'] === 'string' && value['summary'].length <= 2000 &&
              await this.options.ownsInvocation(value['taskId'], value['sessionId'], payload['invocationId'])) {
            await this.options.tasks.recordEvent({ taskId: value['taskId'], type: value['type'],
              summary: value['summary'], payload, source: 'runner' });
          } else {
            // A just-accepted turn can precede recordStarted by a few milliseconds.
            if (Date.now() - (blob.properties.createdOn?.getTime() ?? 0) < 30_000) continue;
          }
        }
        await this.options.container.getBlobClient(blob.name).deleteIfExists({abortSignal: AbortSignal.timeout(20_000)});
      }
    }
    if (observed) this.activeUntil = Date.now() + 60_000;
    this.nextPollAt = Date.now() + (this.activeUntil > Date.now() ? 1_000 : 20_000);
    // Expired scoped GitHub tokens are never kept as a long-lived mailbox history.
    for await (const blob of this.options.container.listBlobsFlat({ prefix: 'rpc-responses/', abortSignal: AbortSignal.timeout(20_000) })) {
      if (Date.now() - (blob.properties.createdOn?.getTime() ?? 0) > 60_000) {
        await this.options.container.getBlobClient(blob.name).deleteIfExists({abortSignal: AbortSignal.timeout(20_000)});
      }
    }
  }
}

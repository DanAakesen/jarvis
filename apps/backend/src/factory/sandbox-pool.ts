import { randomUUID } from 'node:crypto';
import { SandboxGroupClient, endpointForRegion, type Sandbox } from '@azure/containerapps-sandbox';
import { ContainerSASPermissions, SASProtocol, generateBlobSASQueryParameters,
  type BlobServiceClient, type ContainerClient, type BlobLeaseClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/core-auth';
import { FoundryClientError, type RunnerTransport } from '../foundry/client.js';
import { FactoryWorkerMailbox } from './worker-mailbox.js';
import type { TaskStore } from './task-store.js';

const idPattern = /^sbx128-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const status = (error: unknown, code: number): boolean => object(error) && error['statusCode'] === code;
const io = (): {abortSignal: AbortSignal} => ({abortSignal: AbortSignal.timeout(20_000)});
export const sandboxMailboxName = (session: string): string => {
  if (!idPattern.test(session)) throw new FoundryClientError('protocol', 'sandbox-session');
  return 'factory-sbx-' + session.slice(7).replaceAll('-', '');
};
interface Binding {
  session: string;
  createdAt: number;
  taskId?: string;
  createAttempted?: boolean;
  sandboxId?: string;
  sasRenewedAt?: number;
  booted?: boolean;
  bootedAt?: number;
  deleted?: boolean;
  suspended?: boolean;
}
interface Options {
  storage: BlobServiceClient;
  credential: TokenCredential;
  subscriptionId: string;
  region: string;
  resourceGroup: string;
  group: string;
  diskImageId: string;
  identityClientId: string;
  vaultUri: string;
  backendUrl: string;
  apiScope: string;
  enabled: boolean;
  tasks: TaskStore;
  issueToken: (repository: string) => Promise<string>;
  ownsInvocation: (taskId: string, sessionId: string, invocationId: string) => Promise<boolean>;
  onError: (error: unknown) => void;
  client?: SandboxGroupClient;
}

/** Durable session-to-sandbox allocation. SQL admission still owns task concurrency.
 * Group management is backend-only; each worker gets a SAS for its own mailbox.
 */
export class FactorySandboxPool {
  private readonly index: ContainerClient;
  private readonly group: SandboxGroupClient;
  private readonly mailboxes = new Map<string, FactoryWorkerMailbox>();
  private readonly running = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | undefined;
  private polling: Promise<void> | undefined;
  private stopped = false;
  constructor(private readonly options: Options) {
    this.index = options.storage.getContainerClient('factory-sandbox-pool');
    this.group = options.client ?? new SandboxGroupClient(options.credential, endpointForRegion(options.region),
      options.subscriptionId, options.resourceGroup, options.group, {retryOptions: {maxRetries: 0}});
    if (!options.diskImageId || !options.identityClientId || !/^https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net\/$/u.test(options.vaultUri)) {
      throw new TypeError('Factory sandbox configuration is incomplete');
    }
  }
  private async read(container: ContainerClient, key: string): Promise<Record<string, unknown> | undefined> {
    try {
      const response = await container.getBlobClient(key).download(0, undefined, io());
      if ((response.contentLength ?? 0) > 1_048_576 || !response.readableStreamBody) throw new Error('Invalid pool state');
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const item of response.readableStreamBody) {
        const chunk = Buffer.from(item as Uint8Array);
        size += chunk.length;
        if (size > 1_048_576) { response.readableStreamBody.destroy(); throw new Error('Pool state too large'); }
        chunks.push(chunk);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!object(value)) throw new Error('Invalid pool state');
      return value;
    } catch (error) { if (status(error, 404)) return undefined; throw error; }
  }
  private async write(key: string, value: unknown, lease?: BlobLeaseClient, create = false): Promise<void> {
    const body = JSON.stringify(value);
    await this.index.getBlockBlobClient(key).upload(body, Buffer.byteLength(body), {...io(),
      conditions: {...(lease ? {leaseId: lease.leaseId} : {}), ...(create ? {ifNoneMatch: '*'} : {})},
      blobHTTPHeaders: {blobContentType: 'application/json'}});
  }
  private async binding(session: string): Promise<Binding> {
    sandboxMailboxName(session);
    const value = await this.read(this.index, `sessions/${session}.json`);
    if (!value || value['session'] !== session || typeof value['createdAt'] !== 'number') {
      throw new FoundryClientError('http', 'sandbox-session', 404);
    }
    return value as unknown as Binding;
  }
  private mailbox(session: string): FactoryWorkerMailbox {
    let mailbox = this.mailboxes.get(session);
    if (!mailbox) {
      mailbox = new FactoryWorkerMailbox({container: this.options.storage.getContainerClient(sandboxMailboxName(session)),
        credential: this.options.credential, enabled: this.options.enabled, sessionId: session,
        wake: async () => { this.schedule(session); }, tasks: this.options.tasks, issueToken: this.options.issueToken,
        ownsInvocation: this.options.ownsInvocation, onError: this.options.onError});
      this.mailboxes.set(session, mailbox);
    }
    return mailbox;
  }
  readonly transport: RunnerTransport = async (request) => {
    const invocation = decodeURIComponent(request.path.split('/')[2] ?? '');
    const pathSession = decodeURIComponent(request.path.split('/')[1] ?? '');
    const managed = request.sessionId?.startsWith('sbx128-') || invocation.startsWith('sbx128-') || pathSession.startsWith('sbx128-');
    if (!managed && !(request.operation === 'start' && this.options.enabled)) return undefined;
    if (request.options.signal?.aborted) throw new FoundryClientError('aborted', request.operation);
    await this.index.createIfNotExists(io());
    let session = request.sessionId ?? (idPattern.test(pathSession) ? pathSession : undefined);
    if (request.operation === 'start') {
      session = 'sbx128-' + randomUUID();
      await this.options.storage.getContainerClient(sandboxMailboxName(session)).createIfNotExists(io());
      await this.write(`sessions/${session}.json`, {session, createdAt: Date.now(), ...(typeof request.body?.['task_id'] === 'string' ? {taskId: request.body['task_id']} : {})} satisfies Binding, undefined, true);
    } else if (!session && idPattern.test(invocation)) {
      const mapping = await this.read(this.index, `invocations/${invocation}.json`);
      if (typeof mapping?.['session'] === 'string') session = mapping['session'];
    }
    if (!session || !idPattern.test(session)) throw new FoundryClientError('protocol', 'sandbox-session');
    const binding = await this.binding(session);
    if (binding.deleted && request.operation !== 'status') throw new FoundryClientError('http', 'sandbox-session', 410);
    const result = await this.mailbox(session).transport({...request, sessionId: session});
    if (object(result) && typeof result['invocation_id'] === 'string' && idPattern.test(result['invocation_id'])) {
      await this.write(`invocations/${result['invocation_id']}.json`, {session});
    }
    if (request.operation === 'delete-session') {
      // Separate marker avoids overwriting a concurrent allocator's binding update.
      await this.write(`delete/${session}.json`, {session});
      this.schedule(session);
    }
    return result;
  };
  private schedule(session: string): void {
    if (this.stopped || this.running.has(session)) return;
    const work = this.reconcile(session).catch(this.options.onError).finally(() => {this.running.delete(session);});
    this.running.set(session, work);
  }
  private async reconcile(session: string): Promise<void> {
    const lease = this.index.getBlobClient(`sessions/${session}.json`).getBlobLeaseClient();
    try { await lease.acquireLease(60, io()); } catch (error) { if (status(error, 409)) return; throw error; }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
    const renew = setInterval(() => { void lease.renewLease(io()).catch(() => {controller.abort();}); }, 20_000);
    renew.unref();
    try {
      const binding = await this.binding(session);
      if (binding.deleted) return;
      const container = this.options.storage.getContainerClient(sandboxMailboxName(session));
      await this.mailbox(session).poll();
      let deleting = await this.read(this.index, `delete/${session}.json`);
      let queued = false;
      for await (const blob of container.listBlobsFlat({prefix: 'commands/', ...io()})) { queued = Boolean(blob.name); break; }
      const health = await this.read(container, 'health.json');
      if (!queued && health?.['idle'] === true && binding.taskId) {
        const task = await this.options.tasks.get(binding.taskId, 1, 0);
        if (task && (task.state === 'Done' || task.state === 'Cancelled')) deleting = {session};
      }
      if (!binding.sandboxId && !queued && !binding.createAttempted) return;
      if (binding.suspended && !queued && !deleting) return;
      const labels = {'jarvis-purpose': 'factory', 'jarvis-session': session};
      let box: Sandbox | undefined;
      if (binding.sandboxId) {
        try { box = await this.group.sandboxes.get(binding.sandboxId, {abortSignal: signal}); }
        catch (error) { if (!deleting || !status(error, 404)) throw error; }
      }
      else {
        const matches: Sandbox[] = [];
        for await (const candidate of this.group.sandboxes.list({labels, abortSignal: signal})) {
          if (candidate.labels['jarvis-session'] === session && candidate.labels['jarvis-purpose'] === 'factory') matches.push(candidate);
        }
        if (matches.length > 1) throw new Error('Ambiguous Factory sandbox allocation');
        box = matches[0];
        if (!box && binding.createAttempted) {
          // The create may have succeeded with a lost response. Never create a duplicate.
          throw new Error('Factory sandbox allocation uncertain; reconciliation required');
        }
        if (!box && !deleting) {
          const volume = sandboxMailboxName(session);
          try { await this.group.volumes.get(volume, {abortSignal: signal}); }
          catch (error) {
            if (!status(error, 404)) throw error;
            await this.group.volumes.create(volume, {type: 'DataDisk', size: '128GiB', labels, abortSignal: signal});
          }
          binding.createAttempted = true;
          await this.write(`sessions/${session}.json`, binding, lease);
          box = await this.group.sandboxes.beginCreate({sourcesRef: {diskImage: {id: this.options.diskImageId}},
            resources: {cpu: '2000m', memory: '4096Mi', disk: '40Gi'},
            lifecycle: {autoSuspend: {enabled: false, mode: 'Disk'}, autoDelete: {enabled: false}},
            labels, volumes: [{volumeName: volume, mountpoint: '/files'}],
            entrypoint: ['/bin/sh', '-c'], cmd: ['sleep infinity'],
            environment: {AZURE_CLIENT_ID: this.options.identityClientId, KEY_VAULT_URI: this.options.vaultUri,
              JARVIS_WORK_ROOT: '/files/jarvis', JARVIS_FACTORY_MANAGED_SANDBOX: 'true',
              JARVIS_FACTORY_WORKER_BLOB_URL: container.url,
              JARVIS_FACTORY_MAILBOX_SAS_FILE: '/files/jarvis/.mailbox-sas',
              JARVIS_BACKEND_URL: this.options.backendUrl, JARVIS_API_SCOPE: this.options.apiScope,
              JARVIS_GITHUB_APP_TOKEN_ENABLED: 'true', JARVIS_DISK_LOW_THRESHOLD_BYTES: String(2 * 1024 ** 3)},
          }, {abortSignal: signal}).pollUntilDone();
        }
        if (box) { binding.sandboxId = box.id; await this.write(`sessions/${session}.json`, binding, lease); }
      }
      if (box && (box.labels['jarvis-session'] !== session || box.labels['jarvis-purpose'] !== 'factory')) throw new Error('Sandbox ownership mismatch');
      if (deleting) {
        if (box) await this.group.sandboxes.beginDelete(box.id, {abortSignal: signal}).pollUntilDone();
        try { await this.group.volumes.beginDelete(sandboxMailboxName(session), {abortSignal: signal}).pollUntilDone(); }
        catch (error) { if (!status(error, 404)) throw error; }
        binding.deleted = true;
        await this.write(`sessions/${session}.json`, binding, lease);
        return;
      }
      if (!box) return;
      if (queued && ['Stopped', 'Suspended', 'Idle'].includes(box.state ?? '')) {
        box = await this.group.sandboxes.beginResume(box.id, {abortSignal: signal}).pollUntilDone();
        binding.booted = false;
        binding.suspended = false;
      }
      if (box.state !== 'Running') return;
      // Idle means the managed consumer has exited its claim loop. Stop even
      // when a new command arrived since its last queue read; resume next poll.
      if (binding.booted && health?.['idle'] === true) {
        await this.group.sandboxes.beginStop(box.id, {abortSignal: signal}).pollUntilDone();
        binding.booted = false;
        binding.suspended = true;
        await this.write(`sessions/${session}.json`, binding, lease);
        return;
      }
      // Relaunch only the fenced consumer after a process failure. Its durable
      // claims mark uncertain work interrupted; it never replays that work.
      const heartbeatAt = typeof health?.['at'] === 'number' ? health['at'] * 1000 : (binding.bootedAt ?? Date.now());
      if (binding.booted && Date.now() - heartbeatAt > 180_000) binding.booted = false;
      if (!binding.booted || Date.now() - (binding.sasRenewedAt ?? 0) > 4 * 3600_000) {
        // A stopped consumer's idle marker must not stop its successor. Preserve
        // the live heartbeat when this is only a credential rotation.
        if (!binding.booted) await container.getBlobClient('health.json').deleteIfExists(io());
        const startsOn = new Date(Date.now() - 5 * 60_000);
        const expiresOn = new Date(Date.now() + 7 * 3600_000);
        const key = await this.options.storage.getUserDelegationKey(startsOn, expiresOn, io());
        const sas = generateBlobSASQueryParameters({containerName: container.containerName,
          permissions: ContainerSASPermissions.parse('racwdl'), startsOn, expiresOn, protocol: SASProtocol.Https},
        key, this.options.storage.accountName).toString();
        const setup = await this.group.sandboxes.exec(box.id, {command: 'mkdir -p /files/jarvis && chmod 700 /files/jarvis'}, {abortSignal: signal});
        if (setup.exitCode) throw new Error('Sandbox workspace initialization failed');
        await this.group.files.write(box.id, '/files/jarvis/.mailbox-sas.next', sas, {abortSignal: signal});
        const boot = await this.group.sandboxes.exec(box.id, {command:
          'chmod 600 /files/jarvis/.mailbox-sas.next && mv /files/jarvis/.mailbox-sas.next /files/jarvis/.mailbox-sas && cd /app && (nohup python worker.py </dev/null >>/files/jarvis/.worker.log 2>&1 &)'}, {abortSignal: signal});
        if (boot.exitCode) throw new Error('Sandbox worker boot failed');
        binding.booted = true;
        binding.bootedAt = Date.now();
        binding.sasRenewedAt = Date.now();
        await this.write(`sessions/${session}.json`, binding, lease);
      }
    } finally {
      clearInterval(renew);
      await lease.releaseLease(io()).catch(() => undefined);
    }
  }
  private async poll(): Promise<void> {
    await this.index.createIfNotExists(io());
    // Restore every durable assignment after a backend restart. No worker count is
    // inferred from the number of SQL tasks accepted by the dispatcher.
    for await (const blob of this.index.listBlobsFlat({prefix: 'sessions/', ...io()})) {
      const session = blob.name.slice('sessions/'.length, -'.json'.length);
      if (idPattern.test(session)) this.schedule(session);
    }
  }
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (!this.polling) this.polling = this.poll().catch(this.options.onError).finally(() => {this.polling = undefined;});
    }, 5_000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.polling;
    await Promise.allSettled(this.running.values());
  }
}

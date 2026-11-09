import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SandboxGroupClient } from '@azure/containerapps-sandbox';
import type { BlobServiceClient } from '@azure/storage-blob';
import type { TaskStore } from './task-store.js';
import { FactorySandboxPool, installSandboxCredential, sandboxMailboxName } from './sandbox-pool.js';

function fixture() {
  const data = new Map<string, string>();
  const boxes = new Map<string, {id: string; labels: Record<string, string>; state: string}>();
  const errors: unknown[] = [];
  const uploads: {id: string; path: string; body: string}[] = [];
  const creates: Record<string, unknown>[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {release = resolve;});
  const storage = {
    accountName: 'teststorage',
    getContainerClient: (name: string) => ({
      containerName: name, url: `https://teststorage.blob.core.windows.net/${name}`,
      createIfNotExists: async () => undefined,
      getBlobClient: (key: string) => ({
        download: async () => {
          const value = data.get(`${name}/${key}`);
          if (!value) throw {statusCode: 404};
          return {contentLength: value.length, readableStreamBody: Readable.from([Buffer.from(value)])};
        },
        deleteIfExists: async () => {data.delete(`${name}/${key}`);},
        getBlobLeaseClient: () => ({leaseId: 'lease', acquireLease: async () => undefined,
          renewLease: async () => undefined, releaseLease: async () => undefined}),
      }),
      getBlockBlobClient: (key: string) => ({upload: async (value: string) => {data.set(`${name}/${key}`, value);}}),
      async *listBlobsFlat({prefix}: {prefix: string}) {
        for (const key of data.keys()) if (key.startsWith(`${name}/${prefix}`)) yield {name: key.slice(name.length + 1), properties: {createdOn: new Date()}};
      },
    }),
    getUserDelegationKey: vi.fn(async () => ({signedObjectId: '00000000-0000-4000-8000-000000000001',
      signedTenantId: '00000000-0000-4000-8000-000000000002', signedStartsOn: new Date(),
      signedExpiresOn: new Date(Date.now() + 8 * 3600_000), signedService: 'b', signedVersion: '2023-11-03',
      value: Buffer.from('synthetic-test-key').toString('base64')})),
  };
  const client = {
    sandboxes: {
      async *list() { yield* boxes.values(); },
      get: vi.fn(async (id: string) => { if (!boxes.has(id)) throw {statusCode: 404}; return boxes.get(id); }),
      beginStop: vi.fn((id: string) => ({pollUntilDone: async () => { const box = boxes.get(id)!; box.state = 'Stopped'; return box; }})),
      beginResume: vi.fn((id: string) => ({pollUntilDone: async () => { const box = boxes.get(id)!; box.state = 'Running'; return box; }})),
      beginDelete: vi.fn((id: string) => ({pollUntilDone: async () => { boxes.delete(id); }})),
      beginCreate: (body: Record<string, unknown>) => ({pollUntilDone: async () => {
        creates.push(body);
        await gate;
        const session = (body['labels'] as Record<string, string>)['jarvis-session'];
        const box = {id: session, labels: body['labels'] as Record<string, string>, state: 'Running'};
        boxes.set(session, box);
        return box;
      }}),
      exec: vi.fn(async () => ({exitCode: 0, stdout: '', stderr: ''})),
    },
    volumes: {get: async () => {throw {statusCode: 404};}, create: vi.fn(async () => undefined), beginDelete: vi.fn(() => ({pollUntilDone: async () => undefined}))},
    files: {write: vi.fn(async (id: string, path: string, body: string) => {uploads.push({id, path, body});})},
  };
  const options = {storage: storage as unknown as BlobServiceClient, client: client as unknown as SandboxGroupClient,
    credential: {getToken: async () => null}, subscriptionId: '00000000-0000-4000-8000-000000000001', region: 'swedencentral',
    resourceGroup: 'rg-jarvis', group: 'jarvis-factory', diskImageId: 'qualified-image', identityClientId: 'test-client',
    vaultUri: 'https://testvault.vault.azure.net/', backendUrl: 'https://backend.invalid', apiScope: 'api://test/.default',
    enabled: true, tasks: {get: async () => ({state: 'Paused'}), getActiveRepository: async () => undefined, recordEvent: async () => undefined} as unknown as TaskStore,
    issueToken: async () => 'unused', ownsInvocation: async () => false, onError: (error: unknown) => {errors.push(error);}};
  return {pool: new FactorySandboxPool(options), client, data, boxes, errors, uploads, creates, release, options};
}
const start = {operation: 'start', path: 'protocols/invocations', method: 'POST',
  body: {agent: 'codex', task_id: '23'}, sessionId: undefined, options: {}};

describe('managed Factory routing', () => {
  it.skipIf(process.platform === 'win32')('publishes private worker-owned credentials and rotates without mutating the uploaded inode', () => {
    const directory = mkdtempSync(join(tmpdir(), 'factory-sas-'));
    const command = installSandboxCredential.replaceAll('/files/jarvis', directory);
    try {
      for (const value of ['synthetic-first', 'synthetic-rotation']) {
        const uploaded = join(directory, '.mailbox-sas.next');
        writeFileSync(uploaded, value, {mode: 0o444});
        const original = statSync(uploaded);
        expect(execFileSync('sh', ['-c', command], {encoding: 'utf8'})).toBe('');
        const published = join(directory, '.mailbox-sas');
        expect(readFileSync(published, 'utf8')).toBe(value);
        expect(statSync(published).mode & 0o777).toBe(0o600);
        expect(statSync(published).uid).toBe(process.getuid!());
        expect(statSync(published).ino).not.toBe(original.ino);
        expect(existsSync(uploaded)).toBe(false);
        expect(existsSync(join(directory, '.mailbox-sas.ready'))).toBe(false);
      }
      expect(() => execFileSync('sh', ['-c', command], {stdio: 'pipe'})).toThrow();
      expect(readFileSync(join(directory, '.mailbox-sas'), 'utf8')).toBe('synthetic-rotation');
    } finally { rmSync(directory, {recursive: true, force: true}); }
  });
  it('accepts five independent tasks while all five sandbox starts are still pending', async () => {
    const t = fixture();
    const results = await Promise.all(Array.from({length: 5}, () => t.pool.transport(start))) as {session_id: string; invocation_id: string; status: string}[];
    await vi.waitFor(() => expect(t.creates).toHaveLength(5));
    expect(new Set(results.map((r) => r.session_id)).size).toBe(5);
    expect(results.every((r) => r.status === 'queued')).toBe(true);
    expect(t.client.volumes.create).not.toHaveBeenCalled();
    expect(t.creates.every((b) => b['volumes'] === undefined)).toBe(true);
    expect(t.creates[0]!['resources']).toEqual({cpu: '8000m', memory: '16384Mi', disk: '160Gi'});
    expect(new Set(t.creates.map((b) => (b['environment'] as Record<string, string>)['JARVIS_FACTORY_WORKER_BLOB_URL'])).size).toBe(5);
    t.release();
    await t.pool.stop();
    expect(t.errors).toEqual([]);
    expect(t.uploads).toHaveLength(5);
    for (const upload of t.uploads) {
      const sas = new URLSearchParams(upload.body);
      expect(sas.get('sr')).toBe('c');
      expect(sas.get('spr')).toBe('https');
      expect(sas.get('sp')).toContain('l');
      expect(sas.has('ss')).toBe(false); // Not an account SAS.
    }
  });
  it('restores invocation-to-session routing after backend restart', async () => {
    const t = fixture();
    const result = await t.pool.transport(start) as {session_id: string; invocation_id: string};
    t.release(); await t.pool.stop();
    t.data.set(`${sandboxMailboxName(result.session_id)}/invocations/${result.invocation_id}.json`, JSON.stringify({status: 'completed'}));
    const restarted = new FactorySandboxPool(t.options);
    expect(await restarted.transport({...start, operation: 'status', path: `protocols/invocations/${result.invocation_id}`})).toEqual({status: 'completed'});
    await restarted.stop();
    expect(t.creates).toHaveLength(1);
  });
  it('rejects malformed/cross-container identifiers before reading or writing', async () => {
    const t = fixture();
    await expect(t.pool.transport({...start, operation: 'resume', sessionId: 'sbx128-../../other'})).rejects.toMatchObject({kind: 'protocol'});
    expect(t.data.size).toBe(0);
    expect(() => sandboxMailboxName('vm128-00000000-0000-4000-8000-000000000001')).toThrow();
    await t.pool.stop();
  });
  it('preserves Foundry tools and old sessions', async () => {
    const t = fixture();
    for (const operation of ['codex-tool', 'renew-codex', 'status']) {
      expect(await t.pool.transport({...start, operation})).toBeUndefined();
    }
    expect(t.data.size).toBe(0);
    await t.pool.stop();
  });
  it('does not allocate a sandbox for an already cancelled submission', async () => {
    const t = fixture();
    await expect(t.pool.transport({...start, options: {signal: AbortSignal.abort()}})).rejects.toMatchObject({kind: 'aborted'});
    expect(t.data.size).toBe(0); expect(t.creates).toHaveLength(0);
    await t.pool.stop();
  });
  it('stops idle compute, skips repeated management reads, and resumes the same sandbox', async () => {
    const t = fixture();
    const result = await t.pool.transport(start) as {session_id: string};
    t.release(); await t.pool.stop();
    const mailbox = sandboxMailboxName(result.session_id);
    for (const key of t.data.keys()) if (key.startsWith(`${mailbox}/commands/`)) t.data.delete(key);
    t.data.set(`${mailbox}/health.json`, JSON.stringify({idle: true, at: Date.now() / 1000}));
    vi.useFakeTimers();
    try {
      t.pool.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.client.sandboxes.beginStop).toHaveBeenCalledTimes(1);
      const reads = t.client.sandboxes.get.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15000);
      expect(t.client.sandboxes.get).toHaveBeenCalledTimes(reads);
      await t.pool.transport({...start, operation: 'resume', sessionId: result.session_id});
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.client.sandboxes.beginResume).toHaveBeenCalledTimes(1);
      expect(t.data.has(`${mailbox}/health.json`)).toBe(false);
      await vi.advanceTimersByTimeAsync(15000);
      expect(t.client.sandboxes.beginStop).toHaveBeenCalledTimes(1);
      expect(t.creates).toHaveLength(1);
      expect(t.errors).toEqual([]);
    } finally { await t.pool.stop(); vi.useRealTimers(); }
  });
  it('stops a quiescent worker with a newly queued turn and resumes without losing it', async () => {
    const t = fixture();
    const result = await t.pool.transport(start) as {session_id: string};
    t.release(); await t.pool.stop();
    const mailbox = sandboxMailboxName(result.session_id);
    const queued = [...t.data.keys()].filter((key) => key.startsWith(`${mailbox}/commands/`));
    expect(queued).toHaveLength(1);
    t.data.set(`${mailbox}/health.json`, JSON.stringify({idle: true, at: Date.now() / 1000}));
    vi.useFakeTimers();
    try {
      t.pool.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.client.sandboxes.beginStop).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20000);
      expect(t.client.sandboxes.beginResume).toHaveBeenCalledTimes(1);
      expect(t.client.sandboxes.beginStop).toHaveBeenCalledTimes(1);
      expect(t.data.has(queued[0]!)).toBe(true);
      expect(t.creates).toHaveLength(1);
      expect(t.errors).toEqual([]);
    } finally { await t.pool.stop(); vi.useRealTimers(); }
  });
  it('retries sandbox and root-disk cleanup after a transient deletion failure', async () => {
    const t = fixture();
    const result = await t.pool.transport(start) as {session_id: string};
    t.release(); await t.pool.stop();
    t.data.set(`factory-sandbox-pool/delete/${result.session_id}.json`, JSON.stringify({session: result.session_id}));
    t.client.sandboxes.beginDelete.mockImplementationOnce(() => ({pollUntilDone: async () => {throw {statusCode: 503};}}));
    vi.useFakeTimers();
    try {
      t.pool.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.boxes.size).toBe(1);
      expect(t.errors).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.client.volumes.beginDelete).not.toHaveBeenCalled();
      expect(t.boxes.size).toBe(0);
      expect(JSON.parse(t.data.get(`factory-sandbox-pool/sessions/${result.session_id}.json`)!)).toMatchObject({deleted: true});
      expect(t.client.sandboxes.beginDelete).toHaveBeenCalledTimes(2);
    } finally { await t.pool.stop(); vi.useRealTimers(); }
  });

});

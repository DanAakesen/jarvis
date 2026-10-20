import { fork,spawn,execFile,type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes,randomUUID } from 'node:crypto';
import { BlobServiceClient,type ContainerClient } from '@azure/storage-blob';
import { QueueServiceClient,type QueueClient } from '@azure/storage-queue';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { AzureHealthBuffer,createBlobHealthVerifier,type HealthBufferFaults } from './azure-buffer.js';
import { buildHealthUploadServer } from './server.js';
import { healthUploadLimit,sha256,type HealthCapability } from './contracts.js';
import { readHealthHostConfig } from './host-config.js';
import { startHealthUploadHost,type HealthReceiptDiagnostics } from './host.js';
import { HealthCapabilityLifecycle,type PreparedHealthCapability } from './capability-lifecycle.js';

const require = createRequire(import.meta.url); const exec = promisify(execFile);
const owner = '11111111-1111-4111-8111-111111111111';
const token = randomBytes(32).toString('base64url'); // Synthetic capability, emulator only; never printed.
const capability: HealthCapability = { version: 1,ownerObjectId: owner,deviceId: 'synthetic-phone',permissions: ['health-ingest','health-heartbeat'],expiresAt: '2099-01-01T00:00:00Z',revoked: false };
const body = Buffer.from('{ "synthetic_private_marker":true,"data":{"metrics":[],"workouts":[]},"units":"bpm","timezone":"Europe/Copenhagen" }');
let emulator: ChildProcess; let directory: string; let connection: string;
let blobs: BlobServiceClient; let queues: QueueServiceClient; let raw: ContainerClient; let auth: ContainerClient; let queue: QueueClient;
const apps: ReturnType<typeof buildHealthUploadServer>[] = []; const children: ChildProcess[] = [];
const hosts: Awaited<ReturnType<typeof startHealthUploadHost>>[] = [];
const deviceDefinition = { deviceId: 'synthetic-lifecycle-device',permissions: ['health-ingest','health-heartbeat'] as HealthCapability['permissions'],expiresAt: '2099-01-01T00:00:00.000Z' };
async function withDevice(address: string,operation: PreparedHealthCapability,route = '/api/health/ingest') {
  return operation.useSecret(secret => post(address,body,{ authorization: `Bearer ${secret}` },route));
}
async function port(): Promise<number> { const server = createServer(); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); const result = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return result; }
async function start(faults: HealthBufferFaults = {},bufferQueue = queue) {
  const app = buildHealthUploadServer({ enabled: true,buffer: new AzureHealthBuffer(raw,bufferQueue,owner,undefined,faults),verifier: createBlobHealthVerifier(auth) });
  apps.push(app); return app.listen({ host: '127.0.0.1',port: 0 });
}
const headers = (session = 'session-one') => ({ authorization: `Bearer ${token}`,'content-type': 'application/json','automation-id': 'sensitive_automation_marker','session-id': session });
async function post(address: string,bytes = body,extra: Record<string,string> = {},route = '/api/health/ingest') {
  return fetch(address + route,{ method: 'POST',headers: { ...headers(),...extra },body: bytes });
}
async function manifests() {
  const result: { name: string; value: Record<string,unknown> }[] = [];
  for await (const blob of raw.listBlobsFlat({ prefix: 'accepted/' })) result.push({ name: blob.name,value: JSON.parse((await raw.getBlobClient(blob.name).downloadToBuffer()).toString()) });
  return result;
}
async function credential(value: unknown = capability) { await auth.getBlockBlobClient(`health-devices/${sha256(token)}.json`).uploadData(Buffer.from(JSON.stringify(value))); }
async function hostConfig(recovery = true) {
  return readHealthHostConfig({ DAILY_HEALTH_UPLOAD_ENABLED: 'true',DAILY_HEALTH_RECOVERY_ENABLED: String(recovery),DAILY_HEALTH_HOST: '127.0.0.1',
    DAILY_HEALTH_PORT: String(await port()),DAILY_HEALTH_RECOVERY_INTERVAL_MS: '1000',DAILY_HEALTH_RECOVERY_PAGE_SIZE: '1',
    DAILY_HEALTH_OWNER_OBJECT_ID: owner,DAILY_HEALTH_MANAGED_IDENTITY_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    DAILY_HEALTH_BLOB_URL: 'https://syntheticaccount.blob.core.windows.net/',DAILY_HEALTH_QUEUE_URL: 'https://syntheticaccount.queue.core.windows.net/',
    DAILY_HEALTH_RAW_CONTAINER: raw.containerName,DAILY_HEALTH_DEVICE_CONTAINER: auth.containerName,DAILY_HEALTH_QUEUE_NAME: queue.name });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(),'jarvis-health-emulator-'));
  const ports = new Set<number>(); while (ports.size < 3) ports.add(await port()); const [blobPort,queuePort,tablePort] = [...ports];
  const key = randomBytes(64).toString('base64');
  connection = `DefaultEndpointsProtocol=http;AccountName=syntheticaccount;AccountKey=${key};BlobEndpoint=http://127.0.0.1:${blobPort}/syntheticaccount;QueueEndpoint=http://127.0.0.1:${queuePort}/syntheticaccount;`;
  emulator = spawn(process.execPath,[join(dirname(require.resolve('azurite/package.json')),'dist/src/azurite.js'),
    '--silent','--disableTelemetry','--location',directory,'--blobHost','127.0.0.1','--queueHost','127.0.0.1','--tableHost','127.0.0.1',
    '--blobPort',String(blobPort),'--queuePort',String(queuePort),'--tablePort',String(tablePort)],{
    env: { ...process.env,AZURITE_ACCOUNTS: `syntheticaccount:${key}` },stdio: 'ignore' });
  blobs = BlobServiceClient.fromConnectionString(connection,{ retryOptions: { maxTries: 1 } });
  queues = QueueServiceClient.fromConnectionString(connection,{ retryOptions: { maxTries: 1 } });
  const deadline = Date.now() + 20000;
  while (true) {
    try { await blobs.getAccountInfo(); break; }
    catch { if (emulator.exitCode !== null || Date.now() > deadline) throw new Error('Synthetic Azurite startup failed'); await new Promise(resolve => setTimeout(resolve,100)); }
  }
  // Compile the actual runtime artifact for a real killed gateway process, not a mock restart.
  await exec(process.execPath,[require.resolve('typescript/bin/tsc'),'--project','tsconfig.json'],{ cwd: join(dirname(require.resolve('azurite/package.json')),'../../apps/backend'),timeout: 60000 });
},90000);
beforeEach(async () => {
  const id = randomUUID().replaceAll('-',''); raw = blobs.getContainerClient(`raw-${id}`); auth = blobs.getContainerClient(`auth-${id}`); queue = queues.getQueueClient(`queue-${id}`);
  await raw.create(); await auth.create(); await queue.create(); await credential();
});
afterAll(async () => {
  await Promise.all(hosts.map(host => host.stop()));
  for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child,'exit'); }
  await Promise.all(apps.map(app => app.close()));
  if (emulator?.exitCode === null) { emulator.kill('SIGTERM'); await once(emulator,'exit'); }
  if (directory) await rm(directory,{ recursive: true,force: true });
},30000);
describe('actual HTTP -> private Blob -> pointer Queue on synthetic Azurite',() => {
  it('conditionally issues random opaque capabilities with exact retries, isolated devices and redacted handles',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner); const operation = lifecycle.prepare(deviceDefinition);
    const other = lifecycle.prepare({ ...deviceDefinition,deviceId: 'second-synthetic-device' });
    expect(operation.reference === other.reference).toBe(false);
    await operation.useSecret(async secret => { expect(/^[A-Za-z0-9_-]{43}$/u.test(secret)).toBe(true); expect(JSON.stringify(operation).includes(secret)).toBe(false); });
    expect(JSON.stringify(operation)).toBe('{"type":"prepared-health-capability","secret":"redacted"}');
    const issued = await Promise.all(Array.from({ length: 5 },() => lifecycle.issue(operation,AbortSignal.timeout(10000))));
    expect(issued).toEqual(Array.from({ length: 5 },() => ({ state: 'issued' })));
    const address = await start(); expect((await withDevice(address,operation)).status).toBe(202);
    await lifecycle.issue(other,AbortSignal.timeout(10000)); expect((await withDevice(address,other)).status).toBe(202);
    expect(await lifecycle.revoke(operation.reference,AbortSignal.timeout(10000))).toEqual({ state: 'revoked' });
    expect((await withDevice(address,operation)).status).toBe(403); expect((await withDevice(address,other)).status).toBe(202);
    expect(await lifecycle.issue(operation,AbortSignal.timeout(10000))).toEqual({ state: 'revoked' });
    expect(await lifecycle.revoke(operation.reference,AbortSignal.timeout(10000))).toEqual({ state: 'revoked' });
  },20000);
  it('imports the compiled lifecycle artifact and exercises it against the actual HTTP verifier',async () => {
    const { HealthCapabilityLifecycle: CompiledLifecycle } = await import(join(import.meta.dirname,'../../../dist/daily/health-upload/capability-lifecycle.js'));
    const lifecycle = new CompiledLifecycle(auth,owner); const operation = lifecycle.prepare(deviceDefinition);
    expect(await lifecycle.issue(operation,AbortSignal.timeout(10000))).toEqual({ state: 'issued' });
    expect((await withDevice(await start(),operation)).status).toBe(202);
  });
  it('rejects invalid lifecycle definitions and refuses unrelated, malformed and public capability storage',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner);
    for (const input of [{ ...deviceDefinition,permissions: [] },{ ...deviceDefinition,permissions: ['nutrition-export'] },
      { ...deviceDefinition,permissions: ['health-ingest','health-ingest'] },{ ...deviceDefinition,deviceId: ' padded ' },
      { ...deviceDefinition,expiresAt: '2020-01-01T00:00:00.000Z' },{ ...deviceDefinition,expiresAt: '2099-02-30T00:00:00.000Z' },
      { ...deviceDefinition,ownerObjectId: owner }]) expect(() => lifecycle.prepare(input as typeof deviceDefinition)).toThrow('invalid-input');
    const operation = lifecycle.prepare(deviceDefinition); const blob = auth.getBlockBlobClient(`health-devices/${operation.reference}.json`);
    const foreign = { ...capability,ownerObjectId: '22222222-2222-4222-8222-222222222222',expiresAt: deviceDefinition.expiresAt };
    await blob.uploadData(Buffer.from(JSON.stringify(foreign)));
    await expect(lifecycle.issue(operation,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    await expect(lifecycle.revoke(operation.reference,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    expect(JSON.parse((await blob.downloadToBuffer()).toString())).toEqual(foreign);
    await blob.uploadData(Buffer.from('{"malformed":true}'));
    await expect(lifecycle.revoke(operation.reference,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    expect((await blob.downloadToBuffer()).toString()).toBe('{"malformed":true}');
    await auth.setAccessPolicy('blob');
    await expect(lifecycle.issue(lifecycle.prepare(deviceDefinition),AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'unavailable' });
    await auth.setAccessPolicy();
  });
  it('verifies scoped and expired issued devices through real HTTP without changing human auth',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner);
    const heartbeat = lifecycle.prepare({ ...deviceDefinition,permissions: ['health-heartbeat'] });
    await lifecycle.issue(heartbeat,AbortSignal.timeout(10000)); const address = await start();
    expect((await withDevice(address,heartbeat)).status).toBe(403);
    expect((await withDevice(address,heartbeat,'/api/health/heartbeat')).status).toBe(202);
    // Synthetic controlled clock creates a genuinely expired v1 record; no live credential.
    const historical = new HealthCapabilityLifecycle(auth,owner,() => Date.parse('2019-01-01T00:00:00Z'));
    const expired = historical.prepare({ ...deviceDefinition,expiresAt: '2020-01-01T00:00:00.000Z' });
    await historical.issue(expired,AbortSignal.timeout(10000)); expect((await withDevice(address,expired)).status).toBe(403);
    const foreignOwner = new HealthCapabilityLifecycle(auth,'22222222-2222-4222-8222-222222222222');
    const foreign = foreignOwner.prepare(deviceDefinition); await foreignOwner.issue(foreign,AbortSignal.timeout(10000));
    expect((await withDevice(address,foreign)).status).toBe(403);
  });
  it('revokes and rotates accepted lettered mixed-case v1 owner GUIDs without rewriting stored fields',async () => {
    const letterOwner = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const mixedOwner = 'AbCdEfAb-CdEf-4AbC-8DeF-aBcDeFaBcDeF';
    const lifecycle = new HealthCapabilityLifecycle(auth,letterOwner.toUpperCase());
    const app = buildHealthUploadServer({ enabled: true,buffer: new AzureHealthBuffer(raw,queue,letterOwner),verifier: createBlobHealthVerifier(auth) });
    apps.push(app); const address = await app.listen({ host: '127.0.0.1',port: 0 });
    const original = { ...capability,ownerObjectId: letterOwner.toUpperCase() };
    await credential(original); expect((await post(address)).status).toBe(202);
    expect(await lifecycle.revoke(sha256(token),AbortSignal.timeout(10000))).toEqual({ state: 'revoked' });
    expect(JSON.parse((await auth.getBlobClient(`health-devices/${sha256(token)}.json`).downloadToBuffer()).toString())).toEqual({ ...original,revoked: true });
    expect((await post(address)).status).toBe(403);

    const old = lifecycle.prepare(deviceDefinition); await lifecycle.issue(old,AbortSignal.timeout(10000));
    const blob = auth.getBlockBlobClient(`health-devices/${old.reference}.json`);
    const stored = { ...JSON.parse((await blob.downloadToBuffer()).toString()),ownerObjectId: mixedOwner };
    await blob.uploadData(Buffer.from(JSON.stringify(stored)));
    expect((await withDevice(address,old)).status).toBe(202);
    expect(await lifecycle.issue(old,AbortSignal.timeout(10000))).toEqual({ state: 'issued' });
    const next = lifecycle.prepare(deviceDefinition);
    expect(await lifecycle.rotate(old.reference,next,AbortSignal.timeout(10000))).toEqual({ state: 'rotated' });
    expect(JSON.parse((await blob.downloadToBuffer()).toString())).toEqual({ ...stored,revoked: true });
    expect((await withDevice(address,old)).status).toBe(403); expect((await withDevice(address,next)).status).toBe(202);

    const nextBlob = auth.getBlockBlobClient(`health-devices/${next.reference}.json`);
    const wrong = { ...stored,ownerObjectId: 'bbcdefab-cdef-4abc-8def-abcdefabcdef' };
    await nextBlob.uploadData(Buffer.from(JSON.stringify(wrong)));
    await expect(lifecycle.revoke(next.reference,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    expect(JSON.parse((await nextBlob.downloadToBuffer()).toString())).toEqual(wrong);
    expect((await withDevice(address,next)).status).toBe(403);
  });
  it('reserves one rotation replacement, revokes first and handles concurrent identical/different rotations',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner); const original = lifecycle.prepare(deviceDefinition);
    await lifecycle.issue(original,AbortSignal.timeout(10000)); const replacement = lifecycle.prepare(deviceDefinition);
    const competing = lifecycle.prepare(deviceDefinition);
    const outcomes = await Promise.allSettled([replacement,replacement,competing].map(next => lifecycle.rotate(original.reference,next,AbortSignal.timeout(10000))));
    const reserved = JSON.parse((await auth.getBlobClient(`health-device-rotations/${original.reference}.json`).downloadToBuffer()).toString());
    const winner = reserved.replacementReference === replacement.reference ? replacement : competing;
    const loser = winner === replacement ? competing : replacement;
    expect(outcomes.some(row => row.status === 'fulfilled' && row.value.state === 'rotated')).toBe(true);
    const address = await start(); expect((await withDevice(address,original)).status).toBe(403);
    expect((await withDevice(address,winner)).status).toBe(202); expect((await withDevice(address,loser)).status).toBe(403);
    expect(await lifecycle.rotate(original.reference,winner,AbortSignal.timeout(10000))).toEqual({ state: 'rotated' });
    await lifecycle.revoke(winner.reference,AbortSignal.timeout(10000));
    expect(await lifecycle.rotate(original.reference,winner,AbortSignal.timeout(10000))).toEqual({ state: 'replacement-revoked' });
    expect((await withDevice(address,winner)).status).toBe(403);
  },20000);
  it('preserves existing v1 expiry spelling and scope on rotation and denies scope expansion',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner);
    const next = lifecycle.prepare({ ...deviceDefinition,deviceId: capability.deviceId,permissions: ['health-heartbeat'] });
    expect(await lifecycle.rotate(sha256(token),next,AbortSignal.timeout(10000))).toEqual({ state: 'rotated' });
    const previous = JSON.parse((await auth.getBlobClient(`health-devices/${sha256(token)}.json`).downloadToBuffer()).toString());
    expect(previous).toEqual({ ...capability,revoked: true });
    const expanded = lifecycle.prepare({ ...deviceDefinition,deviceId: capability.deviceId });
    await expect(lifecycle.rotate(next.reference,expanded,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    const address = await start(); expect((await withDevice(address,next,'/api/health/heartbeat')).status).toBe(202);
  });
  it('preserves safe rotation gap and resumes exact operation after replacement write failure',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner); const original = lifecycle.prepare(deviceDefinition);
    await lifecycle.issue(original,AbortSignal.timeout(10000)); const replacement = lifecycle.prepare(deviceDefinition);
    const get = auth.getBlockBlobClient.bind(auth);
    const spy = vi.spyOn(auth,'getBlockBlobClient').mockImplementation(name => {
      const client = get(name);
      if (name === `health-devices/${replacement.reference}.json`) vi.spyOn(client,'uploadData').mockRejectedValue(new Error('synthetic-private-provider-message'));
      return client;
    });
    await expect(lifecycle.rotate(original.reference,replacement,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'unavailable',outcome: 'unknown',message: 'Health capability operation unavailable' });
    spy.mockRestore(); const address = await start();
    expect((await withDevice(address,original)).status).toBe(403); expect((await withDevice(address,replacement)).status).toBe(403);
    expect(await lifecycle.rotate(original.reference,replacement,AbortSignal.timeout(10000))).toEqual({ state: 'rotated' });
    expect((await withDevice(address,replacement)).status).toBe(202);
  });
  it('recovers committed create/revoke response loss, cancellation and expired prepared-operation failures',async () => {
    let clock = Date.now(); const lifecycle = new HealthCapabilityLifecycle(auth,owner,() => clock); const operation = lifecycle.prepare(deviceDefinition);
    const get = auth.getBlockBlobClient.bind(auth); let lost = false;
    const spy = vi.spyOn(auth,'getBlockBlobClient').mockImplementation(name => {
      const client = get(name); const upload = client.uploadData.bind(client);
      vi.spyOn(client,'uploadData').mockImplementation(async (...args) => {
        const response = await upload(...args); if (!lost) { lost = true; throw new Error('synthetic-private-response-loss'); } return response;
      }); return client;
    });
    await expect(lifecycle.issue(operation,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'unavailable',outcome: 'unknown' });
    expect(await lifecycle.issue(operation,AbortSignal.timeout(10000))).toEqual({ state: 'issued' });
    lost = false; await expect(lifecycle.revoke(operation.reference,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'unavailable' });
    expect(await lifecycle.revoke(operation.reference,AbortSignal.timeout(10000))).toEqual({ state: 'revoked' }); spy.mockRestore();
    const canceled = new AbortController(); canceled.abort(new Error('synthetic-private-cancel'));
    const untouched = lifecycle.prepare(deviceDefinition);
    await expect(lifecycle.issue(untouched,canceled.signal)).rejects.toMatchObject({ code: 'canceled',message: 'Health capability operation canceled' });
    expect(await auth.getBlobClient(`health-devices/${untouched.reference}.json`).exists()).toBe(false);
    clock = Date.parse('2100-01-01T00:00:00Z');
    await expect(lifecycle.issue(untouched,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(operation.useSecret(async secret => { throw new Error(secret); })).rejects.toMatchObject({ message: 'Health capability operation unavailable' });
  });
  it('resumes reserved rotation after a deadline/response gap without issuing a second replacement',async () => {
    const lifecycle = new HealthCapabilityLifecycle(auth,owner); const original = lifecycle.prepare(deviceDefinition);
    await lifecycle.issue(original,AbortSignal.timeout(10000)); const next = lifecycle.prepare(deviceDefinition);
    const controller = new AbortController(); const get = auth.getBlockBlobClient.bind(auth);
    const spy = vi.spyOn(auth,'getBlockBlobClient').mockImplementation(name => {
      const client = get(name); const upload = client.uploadData.bind(client);
      if (name.startsWith('health-device-rotations/')) vi.spyOn(client,'uploadData').mockImplementation(async (...args) => {
        await upload(...args); controller.abort(new DOMException('synthetic-private-timeout','TimeoutError')); throw controller.signal.reason;
      }); return client;
    });
    await expect(lifecycle.rotate(original.reference,next,controller.signal)).rejects.toMatchObject({ code: 'canceled',outcome: 'unknown' });
    spy.mockRestore(); const address = await start();
    expect((await withDevice(address,original)).status).toBe(202); expect((await withDevice(address,next)).status).toBe(403);
    const different = lifecycle.prepare(deviceDefinition);
    await expect(lifecycle.rotate(original.reference,different,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    expect(await lifecycle.rotate(original.reference,next,AbortSignal.timeout(10000))).toEqual({ state: 'rotated' });
    expect((await withDevice(address,original)).status).toBe(403); expect((await withDevice(address,next)).status).toBe(202);
    // Malformed operation evidence is never replaced to make a retry look successful.
    const journal = auth.getBlockBlobClient(`health-device-rotations/${original.reference}.json`);
    await journal.uploadData(Buffer.from('{"invalid":true}'));
    await expect(lifecycle.rotate(original.reference,next,AbortSignal.timeout(10000))).rejects.toMatchObject({ code: 'conflict' });
    expect((await journal.downloadToBuffer()).toString()).toBe('{"invalid":true}');
  });
  it('persists byte-exact empty-workout data and de-duplicates concurrent same-session/checksum retries',async () => {
    const address = await start();
    const results = await Promise.all(Array.from({ length: 6 },async () => { const response = await post(address,body,{ checksum: sha256(body),'x-payload-checksum': sha256(body) }); expect(response.status).toBe(202); return response.json(); }));
    expect(new Set(results.map(row => row.acceptanceId)).size).toBe(1);
    expect(results.every(row => row.status === 'accepted' && row.processing === 'not-confirmed')).toBe(true);
    const stored = await manifests(); expect(stored).toHaveLength(1); expect(stored[0]?.value.ownerObjectId).toBe(owner);
    expect((await raw.getBlobClient(stored[0]!.value.rawKey as string).downloadToBuffer()).equals(body)).toBe(true);
    const messages = (await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems; expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(JSON.parse(message.messageText)).toEqual({ version: 1,manifest: stored[0]!.name });
      for (const secret of [token,'sensitive_automation_marker','session-one','synthetic_private_marker',sha256(body)]) expect(message.messageText).not.toContain(secret);
      expect(message.expiresOn.getUTCFullYear()).toBeGreaterThan(2099);
    }
    for (const row of results) for (const secret of [token,'sensitive_automation_marker','session-one','synthetic_private_marker']) expect(JSON.stringify(row)).not.toContain(secret);
  },30000);
  it('rejects changed-payload and incorrect checksum conflicts without overwriting acknowledged bytes',async () => {
    const address = await start(); expect((await post(address)).status).toBe(202);
    expect((await post(address,Buffer.from('{"synthetic":"different"}'))).status).toBe(409);
    expect((await post(address,body,{ checksum: '0'.repeat(64) })).status).toBe(409);
    const stored = await manifests(); expect(stored).toHaveLength(1);
    expect((await raw.getBlobClient(stored[0]!.value.rawKey as string).downloadToBuffer()).equals(body)).toBe(true);
  });
  it('fails closed on live revocation, wrong owner/scope and missing capability without SQL',async () => {
    const address = await start();
    for (const value of [{ ...capability,revoked: true },{ ...capability,ownerObjectId: '22222222-2222-4222-8222-222222222222' },
      { ...capability,permissions: ['nutrition-export'] },{ ...capability,expiresAt: '2020-01-01T00:00:00Z' }]) {
      await credential(value); expect((await post(address)).status).toBe(403); expect(await manifests()).toEqual([]);
    }
    await credential(); expect((await post(address)).status).toBe(202); await credential({ ...capability,revoked: true });
    expect((await post(address,body,{ 'session-id': 'other' })).status).toBe(403);
    const inactive = buildHealthUploadServer(); apps.push(inactive);
    expect((await inactive.inject({ method: 'POST',url: '/api/health/ingest',payload: {} })).statusCode).toBe(404);
    const unavailable = buildHealthUploadServer({ enabled: true }); apps.push(unavailable);
    expect((await unavailable.inject({ method: 'POST',url: '/api/health/ingest',headers: headers(),payload: {} })).statusCode).toBe(503);
  });
  it('retains accepted work through Queue/SQL/agent outage and recovers pending pointers after restart',async () => {
    await queue.delete(); const address = await start();
    const response = await post(address); expect(response.status).toBe(202); const receipt = await response.json();
    expect(receipt.queue).toBe('pending'); expect(receipt.processing).toBe('not-confirmed');
    await queue.create(); const fresh = new AzureHealthBuffer(raw,queue,owner);
    expect(await fresh.recover({ limit: 10 },AbortSignal.timeout(10000))).toMatchObject({ inspected: 1,queued: 1,failed: 0,next: null });
    expect((await queue.peekMessages()).peekedMessageItems).toHaveLength(1);
    expect((await post(address)).status).toBe(202); expect((await manifests())[0]?.value.acceptanceId).toBe(receipt.acceptanceId);
  });
  it('recovers ambiguous committed Queue send by at-least-once pointer replay, never exactly once',async () => {
    const address = await start({ afterQueue: async () => { throw new Error('Synthetic queue-response loss with sensitive_marker'); } });
    const response = await post(address); expect(response.status).toBe(202); expect((await response.json()).queue).toBe('pending');
    expect((await queue.peekMessages()).peekedMessageItems).toHaveLength(1);
    await new AzureHealthBuffer(raw,queue,owner).recover({ limit: 10 },AbortSignal.timeout(10000));
    const messages = (await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems;
    expect(messages).toHaveLength(2); expect(messages[0]?.messageText).toBe(messages[1]?.messageText);
  });
  it.each(['raw','manifest'])('survives actual gateway SIGKILL after %s commit, then retries/replays safely',async stage => {
    const child = fork(join(import.meta.dirname,'crash-fixture.mjs'),[],{ env: { ...process.env,SYNTHETIC_CONNECTION: connection,SYNTHETIC_RAW: raw.containerName,
      SYNTHETIC_AUTH: auth.containerName,SYNTHETIC_QUEUE: queue.name,SYNTHETIC_OWNER: owner,SYNTHETIC_STAGE: stage },stdio: ['ignore','ignore','ignore','ipc'] });
    children.push(child); const [ready] = await once(child,'message') as [{ address: string }];
    const stopped = once(child,'message'); const request = post(ready.address).catch(() => null);
    const [message] = await stopped as [{ stage: string }]; expect(message.stage).toBe(stage);
    child.kill('SIGKILL'); await once(child,'exit'); expect(await request).toBeNull();
    const fresh = new AzureHealthBuffer(raw,queue,owner);
    if (stage === 'manifest') expect(await fresh.recover({ limit: 10 },AbortSignal.timeout(10000))).toMatchObject({ queued: 1 });
    else expect(await manifests()).toEqual([]);
    const response = await post(await start()); expect(response.status).toBe(202); expect(await manifests()).toHaveLength(1);
    expect((await raw.getBlobClient((await manifests())[0]!.value.rawKey as string).downloadToBuffer()).equals(body)).toBe(true);
  },30000);
  it('cancels after raw commit without ACK and safely accepts the exact retry',async () => {
    const controller = new AbortController();
    const buffer = new AzureHealthBuffer(raw,queue,owner,undefined,{ afterRaw: async () => controller.abort() });
    await expect(buffer.accept('upload',capability,{ automationId: 'cancelled',sessionId: 'one' },body,controller.signal)).rejects.toThrow();
    expect(await manifests()).toEqual([]);
    const retry = await new AzureHealthBuffer(raw,queue,owner).accept('upload',capability,{ automationId: 'cancelled',sessionId: 'one' },body,AbortSignal.timeout(10000));
    expect(retry.status).toBe('accepted'); expect(await manifests()).toHaveLength(1);
  });
  it('accepts exactly 8 MiB, rejects oversized/invalid/missing-identity input and sanitizes failures',async () => {
    const address = await start();
    const overhead = Buffer.byteLength('{"synthetic":""}'); const exact = Buffer.from(`{"synthetic":"${'x'.repeat(healthUploadLimit - overhead)}"}`);
    expect(exact.length).toBe(healthUploadLimit); expect((await post(address,exact,{ 'session-id': 'eight-mib' })).status).toBe(202);
    const oversized = await post(address,Buffer.concat([exact,Buffer.from(' ')]),{ 'session-id': 'oversized' }); expect(oversized.status).toBe(413);
    const invalid = await post(address,Buffer.from('{synthetic_private_marker')); expect(invalid.status).toBe(400); expect(await invalid.text()).not.toContain('synthetic_private_marker');
    expect((await post(address,body,{ 'automation-id': '' })).status).toBe(400);
    expect((await post(address,body,{ authorization: 'Bearer human.password.value' })).status).toBe(403);
    expect(await manifests()).toHaveLength(1);
  },30000);
  it('records heartbeat as acceptance only, ignores body owner selectors, and refuses public raw storage',async () => {
    const address = await start();
    const heartbeat = await fetch(address + '/api/health/heartbeat',{ method: 'POST',headers: { authorization: `Bearer ${token}`,'content-type': 'application/json' },
      body: JSON.stringify({ ownerObjectId: 'untrusted-selector',synthetic: true }) });
    expect(heartbeat.status).toBe(202); expect((await heartbeat.json()).processing).toBe('not-confirmed');
    expect((await manifests())[0]?.value).toMatchObject({ ownerObjectId: owner,kind: 'heartbeat' });
    await raw.setAccessPolicy('blob'); const failure = await post(address); expect(failure.status).toBe(503);
    expect(await manifests()).toHaveLength(1);
  });
  it('durably accepts source-compatible bodyless heartbeat with or without content type',async () => {
    const address = await start();
    for (const extra of [{},{ 'content-type': 'application/json','shortcut-name': 'Synthetic shortcut marker' }] as Record<string,string>[]) {
      const response = await fetch(address + '/api/health/heartbeat',{ method: 'POST',headers: { authorization: `Bearer ${token}`,...extra } });
      expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ status: 'accepted',processing: 'not-confirmed' });
    }
    const stored = await manifests(); expect(stored).toHaveLength(2);
    const records = await Promise.all(stored.map(async row => JSON.parse((await raw.getBlobClient(row.value.rawKey as string).downloadToBuffer()).toString())));
    expect(records).toEqual(expect.arrayContaining([
      { shortcutName: 'Health Overview heartbeat',checkedFeeds: ['metrics','workouts'] },
      { shortcutName: 'Synthetic shortcut marker',checkedFeeds: ['metrics','workouts'] },
    ]));
    for (const item of (await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems) {
      expect(item.messageText).not.toContain('shortcut'); expect(item.messageText).not.toContain('metrics'); expect(item.messageText).not.toContain(token);
    }
  });
  it('bounds heartbeat provenance, rejects duplicate headers and leaves empty upload rejection strict',async () => {
    const address = await start();
    const send = (name: string) => fetch(address + '/api/health/heartbeat',{ method: 'POST',headers: { authorization: `Bearer ${token}`,'shortcut-name': name } });
    expect((await send('x'.repeat(256))).status).toBe(202);
    expect((await send('x'.repeat(257))).status).toBe(400);
    expect((await send('')).status).toBe(400);
    const duplicate = await new Promise<number>((resolve,reject) => {
      const request = httpRequest(address + '/api/health/heartbeat',{ method: 'POST',headers: ['authorization',`Bearer ${token}`,'shortcut-name','first','shortcut-name','second'] },response => {
        response.resume(); response.once('end',() => resolve(response.statusCode!));
      }); request.once('error',reject); request.end();
    });
    expect(duplicate).toBe(400);
    for (const extra of [{},{ 'content-type': 'application/json' }] as Record<string,string>[]) {
      expect((await fetch(address + '/api/health/ingest',{ method: 'POST',headers: { authorization: `Bearer ${token}`,'automation-id': 'synthetic','session-id': 'empty',...extra } })).status).toBe(400);
    }
    expect((await fetch(address + '/api/health/heartbeat',{ method: 'POST',headers: { authorization: `Bearer ${token}`,'content-type': 'application/json' },
      body: 'x'.repeat(32 * 1024 + 1) })).status).toBe(413);
    expect(await manifests()).toHaveLength(1);
  });
  it('paginates bounded recovery and makes continuation/failed coverage explicit',async () => {
    await queue.delete(); const address = await start();
    for (let i = 0; i < 3; i++) expect((await post(address,body,{ 'session-id': `paged-${i}` })).status).toBe(202);
    await queue.create(); const buffer = new AzureHealthBuffer(raw,queue,owner);
    const first = await buffer.recover({ limit: 2 },AbortSignal.timeout(10000)); expect(first).toMatchObject({ inspected: 2,queued: 2,failed: 0 }); expect(first.next).not.toBeNull();
    const last = await buffer.recover({ limit: 2,cursor: first.next! },AbortSignal.timeout(10000)); expect(last).toMatchObject({ inspected: 1,queued: 1,failed: 0,next: null });
    expect((await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems).toHaveLength(3);
  });
  it('fails closed on corrupted manifest types and mismatched pointer identity',async () => {
    await queue.delete(); const address = await start(); expect((await post(address)).status).toBe(202);
    const [stored] = await manifests(); await queue.create();
    for (const value of [{ ...stored!.value,acceptedAt: 2026 },{ ...stored!.value,sessionId: 'different-session' },
      { ...stored!.value,rawKey: `raw/${'0'.repeat(64)}.json` }]) {
      await raw.getBlockBlobClient(stored!.name).uploadData(Buffer.from(JSON.stringify(value)));
      expect(await new AzureHealthBuffer(raw,queue,owner).recover({ limit: 10 },AbortSignal.timeout(10000))).toMatchObject({ inspected: 1,queued: 0,failed: 1 });
      expect((await queue.peekMessages()).peekedMessageItems).toHaveLength(0);
    }
  });
  it('advances a durable recovery cursor across fresh owners instead of rescanning the first page forever',async () => {
    await queue.delete(); const address = await start();
    for (let i = 0; i < 3; i++) expect((await post(address,body,{ 'session-id': `owned-${i}` })).status).toBe(202);
    await queue.create();
    for (let i = 0; i < 3; i++) {
      const result = await new AzureHealthBuffer(raw,queue,owner).recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000));
      expect(result).toMatchObject({ ownership: 'owned',inspected: 1,queued: 1,failed: 0,hasMore: i < 2 });
    }
    expect((await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems).toHaveLength(3);
    expect(await new AzureHealthBuffer(raw,queue,owner).recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000))).toMatchObject({ queued: 0,inspected: 1 });
  });
  it('respects a competing Blob lease and releases ownership on failed validation',async () => {
    const buffer = new AzureHealthBuffer(raw,queue,owner);
    await buffer.recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000));
    const control = raw.getBlockBlobClient(`control/recovery-${sha256(owner)}.json`); const lease = control.getBlobLeaseClient();
    await lease.acquireLease(60);
    expect(await buffer.recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000))).toEqual({ ownership: 'busy',inspected: 0,queued: 0,failed: 0,hasMore: null });
    await lease.releaseLease();
    await control.uploadData(Buffer.from(JSON.stringify({ version: 1,ownerObjectId: 'untrusted-owner',cursor: null })));
    await expect(buffer.recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000))).rejects.toThrow();
    const next = control.getBlobLeaseClient(); await next.acquireLease(60); await next.releaseLease();
    expect((await queue.peekMessages()).peekedMessageItems).toHaveLength(0);
  });
  it('runs the dedicated host with bounded automatic recovery while a live instance exists and shuts down cleanly',async () => {
    await queue.delete(); const address = await start();
    for (let i = 0; i < 3; i++) expect((await post(address,body,{ 'session-id': `host-${i}` })).status).toBe(202);
    await queue.create();
    let finish: () => void = () => {}; const recovered = new Promise<void>(resolve => { finish = resolve; });
    const host = await startHealthUploadHost(await hostConfig(),{ buffer: new AzureHealthBuffer(raw,queue,owner),verifier: createBlobHealthVerifier(auth) },status => {
      if (status.queued >= 3) finish();
    }); hosts.push(host);
    await Promise.race([recovered,new Promise((_,reject) => { const timer = setTimeout(() => reject(new Error('Synthetic host recovery deadline')),10000); timer.unref(); })]);
    expect((await post(host.address,body,{ 'session-id': 'host-retry' })).status).toBe(202);
    const status = host.status(); expect(status).toMatchObject({ lifecycle: 'running',processing: 'not-configured',acceptedUploads: 1,queuedReceipts: 1,recovery: { queued: 3 } });
    for (const secret of [token,owner,raw.containerName,'synthetic_private_marker','sensitive_automation_marker']) expect(JSON.stringify(status)).not.toContain(secret);
    expect(await host.stop()).toBe('drained'); expect(await host.stop()).toBe('drained'); expect(host.status().lifecycle).toBe('stopped');
    await expect(post(host.address)).rejects.toThrow();
  },15000);
  it('cancels an in-flight HTTP write during host shutdown without losing durable bytes or inventing an ACK',async () => {
    let entered: () => void = () => {}; let release: () => void = () => {};
    const enteredRaw = new Promise<void>(resolve => { entered = resolve; }); const blocked = new Promise<void>(resolve => { release = resolve; });
    const buffer = new AzureHealthBuffer(raw,queue,owner,undefined,{ afterRaw: async () => { entered(); await blocked; } });
    const host = await startHealthUploadHost(await hostConfig(false),{ buffer,verifier: createBlobHealthVerifier(auth) }); hosts.push(host);
    const request = post(host.address); await enteredRaw; const stopping = host.stop(); release();
    expect((await request).status).toBe(503); expect(await stopping).toBe('drained'); expect(await manifests()).toEqual([]);
    expect((await post(await start())).status).toBe(202); expect(await manifests()).toHaveLength(1);
    expect((await raw.getBlobClient((await manifests())[0]!.value.rawKey as string).downloadToBuffer()).equals(body)).toBe(true);
  });
  it('emits bounded cumulative runtime receipts, flushes on shutdown and cancels its timer',async () => {
    const snapshots: HealthReceiptDiagnostics[] = [];
    const config = { ...await hostConfig(false),diagnosticsIntervalMs: 1000 };
    const host = await startHealthUploadHost(config,{ buffer: new AzureHealthBuffer(raw,queue,owner),verifier: createBlobHealthVerifier(auth) },undefined,
      snapshot => snapshots.push(snapshot)); hosts.push(host);
    await queue.delete();
    expect((await post(host.address)).status).toBe(202);
    expect((await post(host.address)).status).toBe(202);
    await queue.create(); expect((await post(host.address)).status).toBe(202);
    expect((await post(host.address,body,{ authorization: 'Bearer invalid' })).status).toBe(403);
    expect((await post(host.address,Buffer.alloc(0),{},'/api/health/heartbeat')).status).toBe(202);
    await vi.waitFor(() => expect(snapshots.some(row => row.reason === 'interval' && row.acceptedHeartbeats === 1)).toBe(true),{ timeout: 5000 });
    await host.stop(); await host.stop();
    expect(snapshots.at(-1)).toEqual({ event: 'health_receipt_events',semantics: 'cumulative-receipt-events',reason: 'shutdown',
      lifecycle: 'stopped',acceptance: 'configured',processing: 'not-configured',acceptedUploads: 3,acceptedHeartbeats: 1,
      pendingReceipts: 2,queuedReceipts: 2,duplicateReceipts: 2,rejected: 1 });
    const serialized = JSON.stringify(snapshots);
    for (const secret of [token,owner,'synthetic-phone','sensitive_automation_marker','session-one','synthetic_private_marker',sha256(body)]) expect(serialized).not.toContain(secret);
    const length = snapshots.length; await new Promise(resolve => setTimeout(resolve,1100)); expect(snapshots).toHaveLength(length);
    expect(await manifests()).toHaveLength(2);
  },15000);
  it('isolates throwing runtime observers from HTTP acceptance and shutdown',async () => {
    const sink = vi.fn((snapshot: HealthReceiptDiagnostics) => { throw new Error(`synthetic_private_observer_error:${snapshot.reason}`); });
    const host = await startHealthUploadHost({ ...await hostConfig(false),diagnosticsIntervalMs: 1000 },
      { buffer: new AzureHealthBuffer(raw,queue,owner),verifier: createBlobHealthVerifier(auth) },undefined,sink); hosts.push(host);
    expect((await post(host.address)).status).toBe(202);
    await vi.waitFor(() => expect(sink).toHaveBeenCalled(),{ timeout: 5000 });
    expect((await post(host.address)).status).toBe(202);
    expect(await host.stop()).toBe('drained');
    expect(sink.mock.calls.at(-1)?.[0]).toMatchObject({ reason: 'shutdown',acceptedUploads: 2,duplicateReceipts: 1 });
    const stored = await manifests(); expect(stored).toHaveLength(1);
    expect((await raw.getBlobClient(stored[0]!.value.rawKey as string).downloadToBuffer()).equals(body)).toBe(true);
  },10000);
  it('executes the packaged inactive entry point without credentials and handles real SIGTERM',async () => {
    const listenPort = await port();
    const child = spawn(process.execPath,[join(import.meta.dirname,'../../../dist/daily/health-upload/main.js')],{
      env: { ...process.env,DAILY_HEALTH_UPLOAD_ENABLED: 'false',DAILY_HEALTH_RECOVERY_ENABLED: 'false',DAILY_HEALTH_HOST: '127.0.0.1',DAILY_HEALTH_PORT: String(listenPort),
        DAILY_HEALTH_BLOB_URL: 'synthetic-private-config-marker' },stdio: ['ignore','pipe','pipe'] }); children.push(child);
    let logs = ''; child.stdout!.on('data',chunk => { logs += String(chunk); });
    const [output] = await once(child.stdout!,'data',{ signal: AbortSignal.timeout(10000) }); expect(String(output)).toContain('health_host_started');
    expect(String(output)).not.toContain('synthetic-private-config-marker');
    expect(await (await fetch(`http://127.0.0.1:${listenPort}/health`)).json()).toEqual({ acceptance: 'inactive',processing: 'not-configured' });
    expect((await post(`http://127.0.0.1:${listenPort}`)).status).toBe(404);
    const exited = once(child,'exit'); child.kill('SIGTERM'); expect((await exited)[0]).toBe(0);
    expect(logs.split('\n').filter(Boolean).map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({
      event: 'health_receipt_events',semantics: 'cumulative-receipt-events',reason: 'shutdown',lifecycle: 'stopped',acceptance: 'inactive',processing: 'not-configured' }));
    expect(logs).not.toContain('synthetic-private-config-marker');
  },15000);
  it('retains acknowledged uploads after a recovery owner is SIGKILLed between queue send and checkpoint',async () => {
    await queue.delete(); expect((await post(await start())).status).toBe(202); await queue.create();
    const child = fork(join(import.meta.dirname,'recovery-crash-fixture.mjs'),[],{ env: { ...process.env,SYNTHETIC_CONNECTION: connection,
      SYNTHETIC_RAW: raw.containerName,SYNTHETIC_QUEUE: queue.name,SYNTHETIC_OWNER: owner },stdio: ['ignore','ignore','ignore','ipc'] }); children.push(child);
    expect((await once(child,'message',{ signal: AbortSignal.timeout(10000) }))[0]).toEqual({ stage: 'queued' });
    const exit = once(child,'exit'); child.kill('SIGKILL'); await exit;
    const fresh = new AzureHealthBuffer(raw,queue,owner);
    expect(await fresh.recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000))).toMatchObject({ ownership: 'busy',hasMore: null });
    // Emulate lease expiry after confirmed process death; never break a live production lease.
    await raw.getBlobClient(`control/recovery-${sha256(owner)}.json`).getBlobLeaseClient().breakLease(0);
    expect(await fresh.recoverOwnedPage({ limit: 1 },AbortSignal.timeout(10000))).toMatchObject({ ownership: 'owned',queued: 1,failed: 0 });
    const messages = (await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems;
    expect(messages).toHaveLength(2); expect(messages[0]?.messageText).toBe(messages[1]?.messageText);
    expect((await raw.getBlobClient((await manifests())[0]!.value.rawKey as string).downloadToBuffer()).equals(body)).toBe(true);
  },15000);
  it('fails the packaged entry before listening on malformed enablement without echoing config',async () => {
    await expect(exec(process.execPath,[join(import.meta.dirname,'../../../dist/daily/health-upload/main.js')],{
      env: { ...process.env,DAILY_HEALTH_UPLOAD_ENABLED: 'synthetic-private-config-marker' },timeout: 10000,
    })).rejects.toMatchObject({ code: 1,stdout: '',stderr: 'health_host_configuration_or_startup_failed\n' });
  },15000);
  it('rate-limits sequential requests before verifier/storage, ignores spoofed proxy headers and recovers next window',async () => {
    const buffer = new AzureHealthBuffer(raw,queue,owner); const write = vi.spyOn(buffer,'accept');
    const verifier = vi.fn(createBlobHealthVerifier(auth));
    const app = buildHealthUploadServer({ enabled: true,buffer,verifier,ratePolicy: { perClient: 2,perInstance: 10,windowMs: 1000 } }); apps.push(app);
    const address = await app.listen({ host: '127.0.0.1',port: 0 });
    for (let i = 0; i < 2; i++) expect((await post(address,body,{ 'x-forwarded-for': `203.0.113.${i + 1}` })).status).toBe(202);
    const rejected = await post(address,body,{ authorization: `Bearer ${randomBytes(32).toString('base64url')}`,'x-forwarded-for': '203.0.113.99' });
    expect(rejected.status).toBe(429); expect(Number(rejected.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await rejected.json()).toEqual({ error: 'Health request rate limited' });
    expect(verifier).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledTimes(2); expect(await manifests()).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve,1050));
    expect((await post(address)).status).toBe(202); expect(verifier).toHaveBeenCalledTimes(3); expect(write).toHaveBeenCalledTimes(3);
    expect(await manifests()).toHaveLength(1);
  });
  it('bounds total instance work across trusted clients and keeps source-compatible heartbeat in the same budget',async () => {
    const buffer = new AzureHealthBuffer(raw,queue,owner); const write = vi.spyOn(buffer,'accept'); const verifier = vi.fn(createBlobHealthVerifier(auth));
    const app = buildHealthUploadServer({ enabled: true,buffer,verifier,trustedProxyCidrs: ['127.0.0.1/32'],
      ratePolicy: { perClient: 2,perInstance: 2,windowMs: 1000 } }); apps.push(app);
    const address = await app.listen({ host: '127.0.0.1',port: 0 });
    for (const ip of ['203.0.113.1','203.0.113.2']) expect((await fetch(address + '/api/health/heartbeat',{ method: 'POST',headers: { authorization: `Bearer ${token}`,'x-forwarded-for': ip } })).status).toBe(202);
    const rejected = await post(address,body,{ 'x-forwarded-for': '203.0.113.3' });
    expect(rejected.status).toBe(429); expect(rejected.headers.get('retry-after')).toBe('1');
    expect(verifier).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledTimes(2); expect(await manifests()).toHaveLength(2);
    expect(await rejected.text()).not.toContain(token);
  });
  it('uses the nearest untrusted client hop and groups IPv6 /64 instead of trusting arbitrary header identity',async () => {
    const verifier = vi.fn(createBlobHealthVerifier(auth));
    const app = buildHealthUploadServer({ enabled: true,buffer: new AzureHealthBuffer(raw,queue,owner),verifier,trustedProxyCidrs: ['127.0.0.1/32'],
      ratePolicy: { perClient: 2,perInstance: 10,windowMs: 1000 } }); apps.push(app);
    const address = await app.listen({ host: '127.0.0.1',port: 0 });
    for (let i = 0; i < 2; i++) expect((await post(address,body,{ 'x-forwarded-for': `198.51.100.${i + 1}, 2001:db8:abcd:1::${i + 1}` })).status).toBe(202);
    expect((await post(address,body,{ 'x-forwarded-for': '198.51.100.99, 2001:db8:abcd:1::ffff' })).status).toBe(429);
    expect(verifier).toHaveBeenCalledTimes(2);
  });
});

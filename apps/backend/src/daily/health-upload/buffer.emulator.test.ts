import { fork,spawn,execFile,type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes,randomUUID } from 'node:crypto';
import { BlobServiceClient,type ContainerClient } from '@azure/storage-blob';
import { QueueServiceClient,type QueueClient } from '@azure/storage-queue';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { AzureHealthBuffer,createBlobHealthVerifier,type HealthBufferFaults } from './azure-buffer.js';
import { buildHealthUploadServer } from './server.js';
import { healthUploadLimit,sha256,type HealthCapability } from './contracts.js';

const require = createRequire(import.meta.url); const exec = promisify(execFile);
const owner = '11111111-1111-4111-8111-111111111111';
const token = randomBytes(32).toString('base64url'); // Synthetic capability, emulator only; never printed.
const capability: HealthCapability = { version: 1,ownerObjectId: owner,deviceId: 'synthetic-phone',permissions: ['health-ingest','health-heartbeat'],expiresAt: '2099-01-01T00:00:00Z',revoked: false };
const body = Buffer.from('{ "synthetic_private_marker":true,"data":{"metrics":[],"workouts":[]},"units":"bpm","timezone":"Europe/Copenhagen" }');
let emulator: ChildProcess; let directory: string; let connection: string;
let blobs: BlobServiceClient; let queues: QueueServiceClient; let raw: ContainerClient; let auth: ContainerClient; let queue: QueueClient;
const apps: ReturnType<typeof buildHealthUploadServer>[] = []; const children: ChildProcess[] = [];
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
  for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child,'exit'); }
  await Promise.all(apps.map(app => app.close()));
  if (emulator?.exitCode === null) { emulator.kill('SIGTERM'); await once(emulator,'exit'); }
  if (directory) await rm(directory,{ recursive: true,force: true });
},30000);
describe('actual HTTP -> private Blob -> pointer Queue on synthetic Azurite',() => {
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
  it('paginates bounded recovery and makes continuation/failed coverage explicit',async () => {
    await queue.delete(); const address = await start();
    for (let i = 0; i < 3; i++) expect((await post(address,body,{ 'session-id': `paged-${i}` })).status).toBe(202);
    await queue.create(); const buffer = new AzureHealthBuffer(raw,queue,owner);
    const first = await buffer.recover({ limit: 2 },AbortSignal.timeout(10000)); expect(first).toMatchObject({ inspected: 2,queued: 2,failed: 0 }); expect(first.next).not.toBeNull();
    const last = await buffer.recover({ limit: 2,cursor: first.next! },AbortSignal.timeout(10000)); expect(last).toMatchObject({ inspected: 1,queued: 1,failed: 0,next: null });
    expect((await queue.peekMessages({ numberOfMessages: 32 })).peekedMessageItems).toHaveLength(3);
  });
});

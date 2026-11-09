/** Live qualification of the production pool against temporary, Entra-only storage.
 * Five isolated workers; deliberately invalid task payloads cannot invoke an agent
 * or mutate a repository. Worker probes exercise the actual disk/credential path.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AzureCliCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { SandboxGroupClient, endpointForRegion } from '@azure/containerapps-sandbox';
import { FactorySandboxPool, sandboxMailboxName } from '../../apps/backend/dist/factory/sandbox-pool.js';

const [configurationPath, evidencePath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configurationPath, 'utf8'));
if (!/^stjfqa[0-9]+$/u.test(config.storage)) throw new Error('Temporary qualification storage required');
const credential = new AzureCliCredential();
const storage = new BlobServiceClient(`https://${config.storage}.blob.core.windows.net`, credential);
const client = new SandboxGroupClient(credential, endpointForRegion('swedencentral'), config.subscription,
  'rg-jarvis', 'jarvis-factory', {retryOptions: {maxRetries: 0}});
const evidence = {workersRequested: 5, sessions: [], passed: false, cleanupPassed: false, modelCalls: 0};
const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
const options = {storage, credential, client, subscriptionId: config.subscription,
  region: 'swedencentral', resourceGroup: 'rg-jarvis', group: 'jarvis-factory', diskImageId: config.imageId,
  identityClientId: config.identityClientId, vaultUri: config.vaultUri, backendUrl: config.backendUrl,
  apiScope: config.apiScope, enabled: true,
  tasks: {getActiveRepository: async () => null, recordEvent: async () => { throw new Error('Unexpected task mutation'); }},
  issueToken: async () => { throw new Error('Qualification must not mint repository tokens'); },
  ownsInvocation: async () => false, onError: (error) => { console.log('Pool observation:', error.constructor.name); },
};
let pool = new FactorySandboxPool(options);
const request = (operation, sessionId, invocationId) => ({operation, sessionId,
  path: invocationId ? `protocols/invocations/${invocationId}` : 'protocols/invocations', method: 'POST',
  body: {agent: 'codex', mode: 'qualification-invalid-mode'}, options: {}});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(3000);
  }
  throw new Error(`Qualification did not observe ${label}`);
}
async function jsonBlob(container, path) {
  try { return JSON.parse((await container.getBlobClient(path).downloadToBuffer()).toString('utf8')); }
  catch (error) { if (error.statusCode === 404) return undefined; throw error; }
}
async function put(container, path, value) {
  const body = JSON.stringify(value);
  await container.getBlockBlobClient(path).upload(body, Buffer.byteLength(body), {conditions: {ifNoneMatch: '*'}});
}
async function sandboxFor(session) {
  const matches = [];
  for await (const box of client.sandboxes.list({labels: {'jarvis-purpose': 'factory', 'jarvis-session': session}})) {
    if (box.labels['jarvis-session'] === session && box.labels['jarvis-purpose'] === 'factory') matches.push(box);
  }
  if (matches.length !== 1) throw new Error('Expected exactly one sandbox per session');
  return matches[0];
}
await save();
try {
  await until(async () => {
    try { await storage.getContainerClient('factory-sandbox-pool').createIfNotExists(); return true; }
    catch (error) { if (error.statusCode === 403) return false; throw error; }
  }, 180, 'temporary storage role propagation');
  pool.start();
  // All five requests return accepted while independent environments start.
  const results = await Promise.all(Array.from({length: 5}, () => pool.transport(request('start'))));
  evidence.sessions = results.map((r) => ({session: r.session_id, invocation: r.invocation_id}));
  await save();
  if (new Set(evidence.sessions.map((s) => s.session)).size !== 5) throw new Error('Worker isolation failed');
  await until(async () => {
    const statuses = await Promise.all(evidence.sessions.map((s) => pool.transport(request('status', undefined, s.invocation))));
    return statuses.every((s) => s.status === 'failed' && s.error === 'Worker command failed');
  }, 900, 'five runner refusal responses');
  evidence.commandDeliveryPassed = true;
  console.log('Five independently booted workers returned their command results');
  // Recreate the actual backend adapter; assignments must survive the restart.
  await pool.stop();
  pool = new FactorySandboxPool(options); pool.start();
  for (const record of evidence.sessions) {
    const state = await pool.transport(request('status', undefined, record.invocation));
    if (state.status !== 'failed') throw new Error('Persisted invocation lookup failed');
  }
  evidence.restartRoutingPassed = true;
  // The existing non-model probe reads mounted capacity and both provider credentials.
  await Promise.all(evidence.sessions.map(async (record) => {
    const container = storage.getContainerClient(sandboxMailboxName(record.session));
    const id = 'canary-' + randomUUID();
    await put(container, `commands/${id}.json`, {operation: 'probe', sessionId: record.session,
      invocationId: 'sbx128-' + randomUUID(), body: {}});
    await until(async () => {
      const result = await jsonBlob(container, `responses/${id}.json`);
      if (!result) return false;
      if (result.status !== 'ok' || result.disk_total_bytes < 120 * 1024 ** 3 || result.credentialsAccessible !== true) {
        throw new Error('Worker disk/credential probe failed');
      }
      record.workspaceBytes = result.disk_total_bytes;
      return true;
    }, 90, 'worker probe');
  }));
  evidence.workerProbePassed = true;
  const boxes = await Promise.all(evidence.sessions.map((s) => sandboxFor(s.session)));
  const windows = await Promise.all(boxes.map(async (box) => {
    const result = await client.sandboxes.exec(box.id, {command: 'python -c \'import time,json; s=time.time(); time.sleep(30); print(json.dumps({"start":s,"end":time.time()}))\''});
    if (result.exitCode) throw new Error('Overlapping worker execution failed');
    return JSON.parse(result.stdout.trim());
  }));
  if (Math.max(...windows.map((w) => w.start)) >= Math.min(...windows.map((w) => w.end))) throw new Error('Workers did not overlap');
  evidence.overlappingWorkers = 5;
  await save();
  await until(async () => (await Promise.all(boxes.map((box) => client.sandboxes.get(box.id)))).every((box) => ['Stopped','Suspended','Idle'].includes(box.state)), 240, 'independent idle shutdown');
  evidence.idleShutdownPassed = true;
  // A new turn must resume the same private disk and use its fenced consumer.
  const first = evidence.sessions[0];
  const resumed = await pool.transport(request('resume', first.session));
  await until(async () => (await pool.transport(request('status', undefined, resumed.invocation_id))).status === 'failed', 300, 'resume result');
  evidence.resumePassed = true;
  evidence.passed = true;
  await save();
} catch (error) {
  evidence.failureType = error.constructor.name;
  await save();
  console.error('Factory runtime qualification failed; details withheld to protect credentials');
  process.exitCode = 1;
} finally {
  await pool.stop();
  const errors = [];
  // Even a lost accepted response is discoverable in this test-only storage account.
  const sessions = new Set(evidence.sessions.map((s) => s.session));
  try {
    for await (const blob of storage.getContainerClient('factory-sandbox-pool').listBlobsFlat({prefix: 'sessions/'})) {
      const binding = await jsonBlob(storage.getContainerClient('factory-sandbox-pool'), blob.name);
      if (/^sbx128-[a-f0-9-]{36}$/u.test(binding?.session ?? '')) sessions.add(binding.session);
    }
    for (const session of sessions) {
      for await (const box of client.sandboxes.list({labels: {'jarvis-purpose': 'factory', 'jarvis-session': session}})) {
        if (box.labels['jarvis-session'] === session && box.labels['jarvis-purpose'] === 'factory') await client.sandboxes.beginDelete(box.id).pollUntilDone();
      }
      try { await client.volumes.beginDelete(sandboxMailboxName(session)).pollUntilDone(); }
      catch (error) { if (error.statusCode !== 404) throw error; }
    }
  } catch (error) { errors.push(error.constructor.name); }
  evidence.cleanupErrors = errors; evidence.cleanupPassed = errors.length === 0;
  if (errors.length) process.exitCode = 1;
  await save();
}

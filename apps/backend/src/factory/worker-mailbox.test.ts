import { Readable } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import type { ContainerClient } from '@azure/storage-blob';
import type { TaskStore } from './task-store.js';
import { FactoryWorkerMailbox } from './worker-mailbox.js';

const session = 'sbx128-00000000-0000-4000-8000-000000000001';
const invocation = 'sbx128-00000000-0000-4000-8000-000000000002';
function fixture(enabled = true) {
  const values = new Map<string, unknown>();
  const container = {
    getBlobClient: (key: string) => ({
      download: async () => {
        if (!values.has(key)) throw {statusCode: 404};
        const content = JSON.stringify(values.get(key));
        return {contentLength: content.length, readableStreamBody: Readable.from([Buffer.from(content)])};
      },
      deleteIfExists: async () => { values.delete(key); },
    }),
    getBlockBlobClient: (key: string) => ({upload: async (body: string) => {values.set(key, JSON.parse(body));}}),
    async *listBlobsFlat({prefix}: {prefix: string}) {
      for (const name of values.keys()) if (name.startsWith(prefix)) yield {name, properties: {createdOn: new Date()}};
    },
  };
  const wake = vi.fn(async () => undefined);
  const tasks = {getActiveRepository: vi.fn(async () => 'owner/project'), recordEvent: vi.fn(async () => ({}))};
  const issueToken = vi.fn(async () => 'scoped-test-token');
  const ownsInvocation = vi.fn(async () => true);
  const worker = new FactoryWorkerMailbox({container: container as unknown as ContainerClient,
    sessionId: session, wake,
    enabled, tasks: tasks as unknown as TaskStore, issueToken, ownsInvocation, onError: (error) => {throw error;}});
  return {worker, values, wake, tasks, issueToken, ownsInvocation};
}
const request = (operation: string, path = 'protocols/invocations', body?: Record<string, string>) =>
  ({operation, path, method: 'POST', body, sessionId: undefined, options: {}});

describe('128 GiB worker transport', () => {
  it('queues one task without waiting for sandbox startup and uses the existing invocation contract', async () => {
    const test = fixture();
    const accepted = await test.worker.transport(request('start', undefined, {agent: 'codex', task_id: '23'}));
    expect(accepted).toMatchObject({status: 'queued', agent: 'codex', session_id: expect.stringMatching(/^sbx128-/u)});
    expect([...test.values.keys()].filter((key) => key.startsWith('commands/'))).toHaveLength(1);
    expect(test.wake).toHaveBeenCalledOnce();
  });
  it('retains Foundry for old sessions and non-Factory tools', async () => {
    const test = fixture(false);
    for (const operation of ['start', 'renew-codex', 'codex-tool', 'status']) {
      expect(await test.worker.transport(request(operation))).toBeUndefined();
    }
    expect(test.wake).not.toHaveBeenCalled();
  });
  it('continues monitoring worker tasks even when routing new tasks is disabled', async () => {
    const test = fixture(false);
    test.values.set(`invocations/${invocation}.json`, {status: 'completed', invocation_id: invocation});
    expect(await test.worker.transport(request('status', `protocols/invocations/${invocation}`))).toMatchObject({status: 'completed'});
    expect(test.wake).not.toHaveBeenCalled();
  });
  it('reports lost worker state as interrupted without submitting a replacement command', async () => {
    const test = fixture();
    test.values.set(`invocations/${invocation}.json`, {status: 'running', workerInstance: 'old'});
    test.values.set('health.json', {at: Date.now() / 1000, instance: 'new'});
    expect(await test.worker.transport(request('status', `protocols/invocations/${invocation}`))).toMatchObject({status: 'interrupted'});
    expect([...test.values.keys()].some((key) => key.startsWith('commands/'))).toBe(false);
  });
  it('mints repository tokens only after SQL confirms the active task session', async () => {
    const test = fixture();
    test.values.set('rpc-requests/one.json', {kind: 'github-token', taskId: '23', sessionId: session, expiresAt: Date.now() / 1000 + 2});
    test.tasks.getActiveRepository.mockResolvedValueOnce(undefined as never);
    await test.worker.poll();
    expect(test.issueToken).not.toHaveBeenCalled();
    expect(test.values.get('rpc-responses/one.json')).toEqual({error: 'Task is not active'});
    test.values.set('rpc-requests/two.json', {kind: 'github-token', taskId: '23', sessionId: session, expiresAt: Date.now() / 1000 + 30});
    await test.worker.poll();
    expect(test.tasks.getActiveRepository).toHaveBeenCalledWith('23', session);
    expect(test.issueToken).toHaveBeenCalledWith('owner/project');
  });
  it('rejects events for an invocation outside the task', async () => {
    const test = fixture();
    test.ownsInvocation.mockResolvedValue(false);
    test.values.set('events/one.json', {taskId: '23', sessionId: session, type: 'completed', summary: 'Done', payload: {invocationId: invocation}});
    await test.worker.poll();
    expect(test.tasks.recordEvent).not.toHaveBeenCalled();
  });
  it('does not enqueue anything when the caller has already cancelled', async () => {
    const test = fixture();
    await expect(test.worker.transport({...request('start'), options: {signal: AbortSignal.abort()}})).rejects.toMatchObject({kind: 'aborted'});
    expect(test.values.size).toBe(0);
  });
});

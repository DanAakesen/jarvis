import type { FastifyRequest } from 'fastify';
import { expect, it, vi } from 'vitest';
import { manageModelDeploymentTool } from './model-deployments.js';
import { createFoundryAgentAdmin } from './foundry-agents.js';
import { ToolRefusal } from './tool-registry.js';
import { foundryProjectFixture } from './foundry-agents.testkit.js';

const signal = new AbortController().signal;

it('pins an immutable v1 version without a lifecycle field and refuses a creating preview version', async () => {
  const production = foundryProjectFixture(null);
  const input = { operation: 'activate' as const, agent: production.agent, version: '1', expectedServingVersion: '1' };
  expect(await production.admin(input, signal)).toMatchObject({ pinned: true, servingVersion: '1' });
  const preview = foundryProjectFixture('creating');
  await expect(preview.admin(input, signal)).rejects.toThrow('not active');
  expect(preview.calls.some(call => call.startsWith('PATCH'))).toBe(false);
});

it('passes provider paging cursors as data and returns only the agent selection in lists', async () => {
  const cursor = 'cursor/2?api-version=wrong&kind=hosted';
  const admin = createFoundryAgentAdmin({
    projectEndpoint: 'https://fixture.services.ai.azure.com/api/projects/project',
    getToken: async () => 'offline-token',
    fetch: async (raw) => {
      const url = new URL(String(raw));
      expect(url.searchParams.get('limit')).toBe('1');
      expect(url.searchParams.get('api-version')).toBe('v1');
      expect(url.searchParams.has('kind')).toBe(false);
      const name = url.searchParams.has('after') ? 'second' : 'first';
      if (name === 'second') expect(url.searchParams.get('after')).toBe(cursor);
      return Response.json({ data: [{ name, versions: { latest: { version: '1', definition: { instructions: 'private text' } } } }],
        has_more: name === 'first', last_id: cursor });
    },
  });
  const result = await admin({ operation: 'list', limit: 1 }, signal);
  expect(result).toEqual({ entries: [{ name: 'first', latestVersion: '1', servingVersion: '1', pinned: false }], hasMore: true, nextCursor: cursor });
  expect(await admin({ operation: 'list', limit: 1, after: cursor }, signal)).toMatchObject({ entries: [{ name: 'second' }], hasMore: false, nextCursor: null });
});

it('requires owner approval before PI deletes an ARM deployment', async () => {
  const remove = vi.fn();
  const requestConfirmation = vi.fn().mockRejectedValue(new ToolRefusal('Dan rejected the request.'));
  const request = { agentPrincipal: {}, jarvisPi: 'turn', server: {
    modelDeploymentWorkflow: { delete: remove }, ownerInteractions: { requestConfirmation },
  } } as unknown as FastifyRequest;
  await expect(manageModelDeploymentTool.execute({ action: 'delete', name: 'test-deployment' }, request, signal)).rejects.toThrow('rejected');
  expect(requestConfirmation).toHaveBeenCalledWith('delete', 'Delete the Foundry model deployment test-deployment?', signal);
  expect(remove).not.toHaveBeenCalled();
});

it('keeps the current version serving, verifies a separate version and activates it only when asked', async () => {
  const { admin, calls, versions, instructions, agent } = foundryProjectFixture();
  const edit = { operation: 'create_version' as const, agent, expectedServingVersion: '1', expectedLatestVersion: '1',
    instructions: instructions + '\nKeep the answer short.' };
  expect(await admin(edit, signal)).toMatchObject({ version: '2', servingVersion: '1', pinned: true });
  expect(versions.get('2')).toEqual({ ...versions.get('1'), definition: { ...versions.get('1')!.definition, instructions: edit.instructions } });
  expect(await admin(edit, signal)).toMatchObject({ version: '2', servingVersion: '1' });
  expect(calls.filter(call => call.startsWith('POST'))).toHaveLength(1);
  expect(await admin({ operation: 'activate', agent, version: '2', expectedServingVersion: '1' }, signal)).toMatchObject({ servingVersion: '2', pinned: true });
  expect(await admin({ operation: 'read', agent }, signal)).toMatchObject({ version: '2', instructions: edit.instructions });
  expect((await admin({ operation: 'list', after: 'page', }, signal))).toMatchObject({ entries: [{ name: agent, servingVersion: '2' }] });
});

it('refuses stale or protected edits before changing the project', async () => {
  const { admin, calls, agent } = foundryProjectFixture();
  const base = { operation: 'create_version' as const, agent, expectedServingVersion: '1', expectedLatestVersion: '1' };
  await expect(admin({ ...base, instructions: 'replaced protected contract' }, signal)).rejects.toThrow('protected');
  await expect(admin({ ...base, model: 'model-b', expectedServingVersion: '8' }, signal)).rejects.toThrow('Serving version');
  await expect(admin({ ...base, model: 'model-b', expectedLatestVersion: '8' }, signal)).rejects.toThrow('Latest version');
  expect(calls.every(call => call.startsWith('GET '))).toBe(true);
});

it('refuses to route to a version with a changed protected contract', async () => {
  const { admin, calls, versions, agent } = foundryProjectFixture();
  const original = versions.get('1')!;
  await admin({ operation: 'activate', agent, version: '1', expectedServingVersion: '1' }, signal);
  versions.set('2', { ...original, definition: { ...original.definition, instructions: 'contract removed' } });
  await expect(admin({ operation: 'activate', agent, expectedServingVersion: '1', version: '2' }, signal)).rejects.toThrow('protected');
  expect(calls.filter(call => call.startsWith('PATCH'))).toHaveLength(1);
});

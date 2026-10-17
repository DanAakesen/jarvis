import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { isJarvisToolCall, runModelToolCall } from './tool-origin.js';

const owner = '3f1c7b0e-5a2d-4e8a-9c6b-0d4f2a1b7c90';

function request(principal: { objectId: string } | null, agent = false) {
  return {
    server: { ownerObjectId: owner },
    principal,
    agentPrincipal: agent ? { kind: 'jarvis-agent', objectId: 'agent', tenantId: 'tenant' } : null,
  } as unknown as FastifyRequest;
}

describe('Jarvis tool origin', () => {
  it('trusts the agent identity', () => {
    expect(isJarvisToolCall(request(null, true))).toBe(true);
  });

  it('does not trust the owner’s own browser session, another user or a request without a user', () => {
    expect(isJarvisToolCall(request({ objectId: owner }))).toBe(false);
    expect(isJarvisToolCall(request({ objectId: 'someone-else' }))).toBe(false);
    expect(isJarvisToolCall(request(null))).toBe(false);
  });

  it('trusts a model-issued call on the owner’s request only while that call runs', async () => {
    const owned = request({ objectId: owner.toUpperCase() });
    const seen: boolean[] = [];
    await runModelToolCall(owned, async () => {
      seen.push(isJarvisToolCall(owned));
      await Promise.resolve();
      seen.push(isJarvisToolCall(owned));
    });
    expect(seen).toEqual([true, true]);
    expect(isJarvisToolCall(owned)).toBe(false);
  });

  it('never extends to another request, another user or concurrent work outside the call', async () => {
    const owned = request({ objectId: owner });
    const sibling = request({ objectId: owner });
    const stranger = request({ objectId: 'someone-else' });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const seen: boolean[] = [];
    const running = runModelToolCall(owned, async () => {
      await held;
      seen.push(isJarvisToolCall(owned), isJarvisToolCall(sibling));
    });
    // A reflex action or any other work on the same socket starts outside the call's scope.
    const concurrent = Promise.resolve().then(() => isJarvisToolCall(owned));
    expect(await concurrent).toBe(false);
    release();
    await running;
    expect(seen).toEqual([true, false]);
    await runModelToolCall(stranger, async () => {
      expect(isJarvisToolCall(stranger)).toBe(false);
    });
  });
});

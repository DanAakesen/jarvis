import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { piDispatchObjectId } from '../auth/pi-credential.js';
import { gmailAccessGuard } from './gmail-access-policy.js';
import { readToolOwnerMessage } from './pi-authority.js';
import type { JarvisTool } from './tool-registry.js';

const ownerMessage = { id: '42', role: 'dan', sessionId: '7', text: 'Open Calendar' };
const proactiveMessage = { id: '43', role: 'jarvis', sessionId: '8', text: 'Build finished' };

function fixture(exactResult = ownerMessage) {
  const getHistory = vi.fn(async ({ before }: { before?: string }) => ({
    messages: before === '43' ? [exactResult] : [proactiveMessage],
  }));
  const request = {
    agentPrincipal: { objectId: piDispatchObjectId },
    jarvisPi: 'turn',
    headers: { 'x-jarvis-message-id': '42' },
    server: { conversationStore: { getHistory } },
  } as unknown as FastifyRequest;
  return { request, getHistory };
}

describe('PI tool source authority', () => {
  it('uses the granted message even when Proactive appended a newer row', async () => {
    const { request, getHistory } = fixture();
    expect(await readToolOwnerMessage(request, '42')).toBe(ownerMessage);
    expect(getHistory).toHaveBeenCalledExactlyOnceWith({ limit: 1, before: '43' });
  });

  it.each([
    { ...ownerMessage, id: '41' },
    { ...ownerMessage, role: 'jarvis' },
    { ...ownerMessage, sessionId: '' },
  ])('refuses a history result other than the exact stored owner message (%j)', async (result) => {
    const { request } = fixture(result);
    expect(await readToolOwnerMessage(request, '42')).toBeUndefined();
  });

  it('does not let PI substitute a different message ID', async () => {
    const { request, getHistory } = fixture();
    expect(await readToolOwnerMessage(request, '43')).toBeUndefined();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('leaves the latest-message requirement intact for ordinary agents', async () => {
    const { request, getHistory } = fixture();
    request.agentPrincipal = { ...request.agentPrincipal!, objectId: 'other-agent' };
    expect(await readToolOwnerMessage(request, '42')).toBe(proactiveMessage);
    expect(getHistory).toHaveBeenCalledExactlyOnceWith({ limit: 1 });
  });

  it('lets the computer-use tool guard execute PI once after a proactive append, but refuses an unbound agent', async () => {
    const execute = vi.fn(async () => 'Opened Calendar');
    const guarded = gmailAccessGuard()({ name: 'pc_open', execute } as unknown as JarvisTool);
    const { request } = fixture();
    const input = { value: 'Calendar' };
    const signal = new AbortController().signal;
    await expect(guarded(input, request, signal)).resolves.toBe('Opened Calendar');
    request.agentPrincipal = { ...request.agentPrincipal!, objectId: 'other-agent' };
    await expect(guarded(input, request, signal)).rejects.toThrow('current Dan message could not be verified');
    expect(execute).toHaveBeenCalledExactlyOnceWith(input, request, signal);
  });
});

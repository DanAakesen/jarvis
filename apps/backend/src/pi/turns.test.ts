import { describe, expect, it } from 'vitest';
import { createPiTurnRegistry } from './turns.js';

const owner = '11111111-1111-4111-8111-111111111111';

describe('PI turn authority', () => {
  it('resolves only a live, well-formed reference and ends with the turn', () => {
    const registry = createPiTurnRegistry();
    const grant = registry.open({ ownerObjectId: owner, sessionId: '7', messageId: '42', signal: new AbortController().signal });
    expect(grant.turn).toMatch(/^jt-[A-Za-z0-9_-]{22}$/u);
    expect(registry.resolve(grant.turn)?.messageId).toBe('42');
    expect(registry.resolve('jt-AAAAAAAAAAAAAAAAAAAAAA')).toBeUndefined();
    expect(registry.resolve('42')).toBeUndefined();
    expect(registry.resolve(undefined)).toBeUndefined();
    registry.close(grant.turn);
    expect(registry.resolve(grant.turn)).toBeUndefined();
  });

  it('refuses a reference whose turn was aborted', () => {
    const registry = createPiTurnRegistry();
    const controller = new AbortController();
    const grant = registry.open({ ownerObjectId: owner, sessionId: '7', messageId: '42', signal: controller.signal });
    controller.abort();
    expect(registry.resolve(grant.turn)).toBeUndefined();
  });

  it('gives every turn its own unguessable reference and bounds how many are open', () => {
    const registry = createPiTurnRegistry();
    const signal = new AbortController().signal;
    const turns = Array.from({ length: 8 }, (_, index) => registry.open({ ownerObjectId: owner, sessionId: '7', messageId: String(index + 1), signal }).turn);
    expect(new Set(turns).size).toBe(8);
    expect(() => registry.open({ ownerObjectId: owner, sessionId: '7', messageId: '9', signal })).toThrow('Too many open PI turns');
  });
});

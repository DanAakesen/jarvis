import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEphemeralAudioStore } from './audio-store.js';

describe('ephemeral Teams audio', () => {
  afterEach(() => vi.useRealTimers());

  it('serves bounded audio through an unguessable token until expiry', () => {
    vi.useFakeTimers();
    const store = createEphemeralAudioStore(() => Date.now());
    const bytes = Buffer.from('audio bytes');
    const token = store.put(bytes);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(store.get(token!)).toEqual(bytes);
    expect(store.get(`${token}x`)).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
    expect(store.get(token!)).toBeNull();
  });

  it('clears expired entries and rejects oversized audio without retaining it', () => {
    const store = createEphemeralAudioStore();
    expect(store.put(new Uint8Array(1_500_001))).toBeNull();
    const token = store.put(new Uint8Array([1, 2]));
    store.clear();
    expect(store.get(token!)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { FrameStore } from './frame-store.js';

const identity = { ownerObjectId: 'owner', sessionId: '41', turnId: 'capture', messageId: '42' };
const stores: FrameStore[] = [];
afterEach(() => { stores.splice(0).forEach((store) => store.close()); vi.useRealTimers(); });
const jpeg = () => sharp({ create: { width: 1024, height: 900, channels: 3, background: 'red' } }).jpeg().toBuffer();
function store(ttlMs = 60_000, capacity = 128) {
  const result = new FrameStore(ttlMs, capacity);
  stores.push(result);
  return result;
}

describe('private frame store', () => {
  it('creates random handles, bounds JPEG dimensions, and consumes only once', async () => {
    const frames = store();
    const frameId = await frames.put({ ...identity, image: await jpeg() });
    expect(frameId).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(frames.consume(frameId, identity)).toBeUndefined();
    expect(frames.bind(frameId, identity)).toBe(true);
    const image = frames.consume(frameId, identity)!;
    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(768);
    expect(metadata.height).toBeLessThanOrEqual(768);
    expect(frames.consume(frameId, identity)).toBeUndefined();
    image.fill(0);
  });

  it('rejects foreign owner/session/turn and immutable message rebinding without consuming', async () => {
    const frames = store();
    const frameId = await frames.put({ ...identity, image: await jpeg() });
    for (const foreign of [{ ownerObjectId: 'other' }, { sessionId: '99' }, { turnId: 'other' }]) {
      expect(frames.bind(frameId, { ...identity, ...foreign })).toBe(false);
    }
    expect(frames.bind(frameId, identity)).toBe(true);
    expect(frames.bind(frameId, { ...identity, messageId: '99' })).toBe(false);
    expect(frames.consume(frameId, { ...identity, messageId: '99' })).toBeUndefined();
    frames.consume(frameId, identity)?.fill(0);
  });

  it('zeroes overwritten, evicted, consumed, and timer-expired backing buffers', async () => {
    vi.useFakeTimers();
    const frames = store(100, 1);
    const internals = frames as unknown as { frames: Map<string, { image: Buffer; timer: ReturnType<typeof setTimeout> }> };
    const first = await frames.put({ ...identity, image: await jpeg() });
    const overwritten = internals.frames.get(first)!.image;
    const second = await frames.put({ ...identity, image: await jpeg() });
    expect(overwritten.every((byte) => byte === 0)).toBe(true);
    const evicted = internals.frames.get(second)!.image;
    const third = await frames.put({ ...identity, turnId: 'new', image: await jpeg() });
    expect(evicted.every((byte) => byte === 0)).toBe(true);
    const expired = internals.frames.get(third)!;
    expect(expired.timer.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(expired.image.every((byte) => byte === 0)).toBe(true);
    expect(internals.frames.size).toBe(0);
    const fourth = await frames.put({ ...identity, image: await jpeg() });
    const consumed = internals.frames.get(fourth)!.image;
    frames.bind(fourth, identity);
    frames.consume(fourth, identity)?.fill(0);
    expect(consumed.every((byte) => byte === 0)).toBe(true);
  });

  it('expires without reads, clears session resources, and bounds configuration', async () => {
    vi.useFakeTimers();
    const frames = store();
    const frameId = await frames.put({ ...identity, image: await jpeg() });
    frames.forgetSession(identity.sessionId);
    expect(frames.bind(frameId, identity)).toBe(false);
    expect(() => new FrameStore(60_001)).toThrow();
    expect(() => new FrameStore(0)).toThrow();
    expect(() => new FrameStore(100, 129)).toThrow();
    frames.close();
    await expect(frames.put({ ...identity, image: await jpeg() })).rejects.toThrow('closed');
  });

  it('never extends frame lifetime by slow caption inference', async () => {
    vi.useFakeTimers();
    const frames = store();
    await expect(frames.put({ ...identity, image: await jpeg(), capturedAt: Date.now() - 60_000 }))
      .rejects.toThrow('expired');
    const frameId = await frames.put({ ...identity, image: await jpeg(), capturedAt: Date.now() - 50_000 });
    expect(frames.bind(frameId, identity)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(frames.consume(frameId, identity)).toBeUndefined();
  });
});

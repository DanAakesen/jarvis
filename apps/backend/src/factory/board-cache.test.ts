import { describe, expect, it, vi } from 'vitest';
import { createFactoryBoard, FactoryBoardCache } from './board.js';
import { FactoryBoardReadError } from './board-errors.js';
import type { FactoryBoard } from '@jarvis/contracts';

function snapshot(projectId: string, at = 1_000): FactoryBoard {
  return createFactoryBoard(projectId, 'DanAakesen/jarvis', { issues: [], pullRequests: [] }, [], [], at);
}

describe('Factory board cache ownership', () => {
  it('does not replace a shared source owner after explicit invalidation', async () => {
    const cache = new FactoryBoardCache();
    const initial = Promise.withResolvers<FactoryBoard>();
    const fresh = snapshot('42', 2_000);
    const load = vi.fn(async () => fresh).mockReturnValueOnce(initial.promise);
    const first = cache.get('42', load);
    cache.invalidateAll();
    const joined = cache.get('42', load);
    try {
      expect(load).toHaveBeenCalledOnce();
      initial.resolve(snapshot('42'));
      expect(await Promise.all([first, joined])).toEqual([
        { board: fresh, stale: false }, { board: fresh, stale: false },
      ]);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      initial.resolve(snapshot('42'));
      await Promise.allSettled([first, joined]);
    }
  });

  it('coalesces repeated invalidations into one clean follow-up shared by every waiter', async () => {
    const cache = new FactoryBoardCache();
    const initial = Promise.withResolvers<FactoryBoard>();
    const followUp = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(followUp.promise);
    const unusedLoad = vi.fn(async () => snapshot('42'));
    const paths: string[] = [];
    const first = cache.get('42', load, (path) => paths.push(path));
    cache.invalidate('42');
    cache.invalidate('42');
    const second = cache.get('42', unusedLoad, (path) => paths.push(path));
    expect(load).toHaveBeenCalledOnce();
    initial.resolve(snapshot('42'));
    await initial.promise;
    expect(load).toHaveBeenCalledTimes(2);
    const reconnected = cache.get('42', unusedLoad, (path) => paths.push(path));
    const fresh = snapshot('42', 2_000);
    followUp.resolve(fresh);
    expect(await Promise.all([first, second, reconnected])).toEqual(
      Array.from({ length: 3 }, () => ({ board: fresh, stale: false })),
    );
    expect(unusedLoad).not.toHaveBeenCalled();
    expect(paths).toEqual(['source_load', 'shared_wait', 'shared_wait']);
    await expect(cache.get('42', unusedLoad)).resolves.toEqual({ board: fresh, stale: false });
    expect(unusedLoad).not.toHaveBeenCalled();
  });

  it('bounds an invalidated follow-up and leaves its snapshot stale until the next clean owner', async () => {
    const cache = new FactoryBoardCache();
    const initial = Promise.withResolvers<FactoryBoard>();
    const followUp = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(followUp.promise);
    const first = cache.get('42', load);
    cache.invalidate('42');
    initial.resolve(snapshot('42'));
    await initial.promise;
    cache.invalidate('42');
    cache.invalidate('42');
    const unusedLoad = vi.fn(async () => snapshot('42'));
    const joined = cache.get('42', unusedLoad);
    const invalidated = snapshot('42', 2_000);
    followUp.resolve(invalidated);
    expect(await Promise.all([first, joined])).toEqual([
      { board: invalidated, stale: true }, { board: invalidated, stale: true },
    ]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(unusedLoad).not.toHaveBeenCalled();
    const fresh = snapshot('42', 3_000);
    const refresh = vi.fn(async () => fresh);
    await expect(cache.get('42', refresh)).resolves.toEqual({ board: fresh, stale: false });
    await expect(cache.get('42', unusedLoad)).resolves.toEqual({ board: fresh, stale: false });
    expect(refresh).toHaveBeenCalledOnce();
    expect(unusedLoad).not.toHaveBeenCalled();
  });

  it('does not report a snapshot as fresh when publication invalidates it before waiter settlement', async () => {
    const cache = new FactoryBoardCache();
    const source = Promise.withResolvers<FactoryBoard>();
    const board = snapshot('42');
    const pending = cache.get('42', () => source.promise);
    const publication = source.promise.then(() => cache.invalidate('42'));
    source.resolve(board);
    await publication;
    await expect(pending).resolves.toEqual({ board, stale: true });
    const fresh = snapshot('42', 2_000);
    await expect(cache.get('42', async () => fresh)).resolves.toEqual({ board: fresh, stale: false });
  });

  it.each([false, true])('preserves an invalidated shared failure without retrying (fallback: %s)', async (cached) => {
    const cache = new FactoryBoardCache();
    const board = snapshot('42');
    if (cached) await cache.get('42', async () => board);
    cache.invalidate('42');
    const pending = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn(() => pending.promise);
    const first = cache.get('42', load);
    cache.invalidate('42');
    const second = cache.get('42', load);
    const results = Promise.allSettled([first, second]);
    const failure = new FactoryBoardReadError('token', 'invalid_token_permissions', 403);
    pending.reject(failure);
    expect(await results).toEqual(cached ? [
      { status: 'fulfilled', value: { board, stale: true, failure } },
      { status: 'fulfilled', value: { board, stale: true, failure } },
    ] : [
      { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure },
    ]);
    expect(load).toHaveBeenCalledOnce();
    const fresh = snapshot('42', 2_000);
    await expect(cache.get('42', async () => fresh)).resolves.toEqual({ board: fresh, stale: false });
  });

  it('retains the validated initial snapshot and typed failure when its dirty follow-up fails', async () => {
    const cache = new FactoryBoardCache();
    const initial = Promise.withResolvers<FactoryBoard>();
    const failure = new FactoryBoardReadError('source', 'request_failed', 429);
    const board = snapshot('42');
    const load = vi.fn(() => Promise.reject<FactoryBoard>(failure)).mockReturnValueOnce(initial.promise);
    const first = cache.get('42', load);
    cache.invalidate('42');
    const joined = cache.get('42', load);
    initial.resolve(board);
    expect(await Promise.all([first, joined])).toEqual([
      { board, stale: true, failure }, { board, stale: true, failure },
    ]);
    expect(load).toHaveBeenCalledTimes(2);
    const fresh = snapshot('42', 2_000);
    await expect(cache.get('42', async () => fresh)).resolves.toEqual({ board: fresh, stale: false });
  });

  it('keeps another project cached and pending work independent across scope switches', async () => {
    const cache = new FactoryBoardCache();
    const other = snapshot('43');
    const otherLoad = vi.fn(async () => other);
    await cache.get('43', otherLoad);
    const pending = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn(() => pending.promise);
    const first = cache.get('42', load);
    cache.invalidate('43');
    const shared = cache.get('42', load);
    pending.resolve(snapshot('42'));
    await Promise.all([first, shared]);
    expect(load).toHaveBeenCalledOnce();
    await cache.get('43', otherLoad);
    expect(otherLoad).toHaveBeenCalledTimes(2);
    cache.invalidate('42');
    await cache.get('43', otherLoad);
    expect(otherLoad).toHaveBeenCalledTimes(2);
  });

  it('leaves ownership with the cache when an individual caller stops waiting', async () => {
    const cache = new FactoryBoardCache();
    const pending = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn(() => pending.promise);
    const cancellation = Promise.withResolvers<never>();
    const first = Promise.race([cache.get('42', load), cancellation.promise]);
    const cancelled = new DOMException('Caller changed project', 'AbortError');
    const refusal = expect(first).rejects.toBe(cancelled);
    cancellation.reject(cancelled);
    await refusal;
    const remaining = cache.get('42', load);
    const board = snapshot('42');
    pending.resolve(board);
    await expect(remaining).resolves.toEqual({ board, stale: false });
    expect(load).toHaveBeenCalledOnce();
  });

  it('starts the fresh TTL at clean publication and keeps in-flight ownership after expiry', async () => {
    let now = 1_000;
    const cache = new FactoryBoardCache(() => now, 10);
    await cache.get('42', async () => snapshot('42'));
    now = 1_010;
    const initial = Promise.withResolvers<FactoryBoard>();
    const followUp = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(followUp.promise);
    const first = cache.get('42', load);
    cache.invalidate('42');
    now = 2_000;
    const joined = cache.get('42', load);
    initial.resolve(snapshot('42', now));
    await initial.promise;
    now = 3_000;
    const fresh = snapshot('42', now);
    followUp.resolve(fresh);
    expect(await Promise.all([first, joined])).toEqual([
      { board: fresh, stale: false }, { board: fresh, stale: false },
    ]);
    now = 3_009;
    await expect(cache.get('42', load)).resolves.toEqual({ board: fresh, stale: false });
    expect(load).toHaveBeenCalledTimes(2);
    now = 3_010;
    const next = vi.fn(async () => snapshot('42', now));
    await cache.get('42', next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('retains bounded LRU entries without evicting or duplicating pending source owners', async () => {
    let now = 1_000;
    const cache = new FactoryBoardCache(() => now, 10);
    const oldest = snapshot('1');
    await cache.get('1', async () => oldest);
    now += 10;
    const pending = Promise.withResolvers<FactoryBoard>();
    const load = vi.fn(() => pending.promise);
    const first = cache.get('1', load);
    for (let id = 2; id <= 33; id++) await cache.get(String(id), async () => snapshot(String(id)));
    const shared = cache.get('1', load);
    expect(load).toHaveBeenCalledOnce();
    const fresh = snapshot('1', 2_000);
    pending.resolve(fresh);
    await Promise.all([first, shared]);
    const unused = vi.fn(async () => snapshot('1'));
    await cache.get('1', unused);
    expect(unused).not.toHaveBeenCalled();
    const evicted = vi.fn(async () => snapshot('2'));
    await cache.get('2', evicted);
    expect(evicted).toHaveBeenCalledOnce();
    const retained = vi.fn(async () => snapshot('33'));
    await cache.get('33', retained);
    expect(retained).not.toHaveBeenCalled();
  });

  it('retains explicit global invalidation without replacing any pending owner', async () => {
    const cache = new FactoryBoardCache();
    const one = Promise.withResolvers<FactoryBoard>();
    const two = Promise.withResolvers<FactoryBoard>();
    const loadOne = vi.fn(async () => snapshot('42', 2_000)).mockReturnValueOnce(one.promise);
    const loadTwo = vi.fn(async () => snapshot('43', 2_000)).mockReturnValueOnce(two.promise);
    const first = cache.get('42', loadOne);
    const second = cache.get('43', loadTwo);
    cache.invalidateAll();
    const joined = cache.get('42', loadOne);
    one.resolve(snapshot('42'));
    two.resolve(snapshot('43'));
    const results = await Promise.all([first, second, joined]);
    expect(results.every(({ stale }) => !stale)).toBe(true);
    expect(loadOne).toHaveBeenCalledTimes(2);
    expect(loadTwo).toHaveBeenCalledTimes(2);
  });

  it('expires an evicted snapshot before its waiter settles and loses invalidation reachability', async () => {
    const cache = new FactoryBoardCache(() => 1_000, 10);
    const initial = Promise.withResolvers<FactoryBoard>();
    const board = snapshot('42');
    const load = vi.fn(() => initial.promise);
    const first = cache.get('42', load);
    const others = Array.from({ length: 32 }, (_, index) => {
      const projectId = String(index + 100);
      const source = Promise.withResolvers<FactoryBoard>();
      const read = vi.fn(() => source.promise);
      return { projectId, source, read, result: cache.get(projectId, read) };
    });
    const publication = others[31]!.source.promise.then(() => cache.invalidate('42'));
    initial.resolve(board);
    for (const other of others) other.source.resolve(snapshot(other.projectId));
    await publication;
    await expect(first).resolves.toEqual({ board, stale: true });
    await Promise.all(others.map(({ result }) => result));
    expect(load).toHaveBeenCalledOnce();
    for (const other of others) expect(other.read).toHaveBeenCalledOnce();
    const fresh = snapshot('42', 2_000);
    const refresh = vi.fn(async () => fresh);
    await expect(cache.get('42', refresh)).resolves.toEqual({ board: fresh, stale: false });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

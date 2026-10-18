import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthProcessingWorker } from './worker.js';

afterEach(() => { vi.useRealTimers(); });

describe('HealthProcessingWorker', () => {
  it('recovers retained work at startup and limits each immediate batch', async () => {
    vi.useFakeTimers();
    const processNext = vi.fn().mockResolvedValue({ state: 'processed' });
    const worker = new HealthProcessingWorker({ processNext });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(1);
    for (let attempt = 0; attempt < 9; attempt++) await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(999);
    expect(processNext).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(11);
    await worker.stop();
  });

  it('polls idle/retry results at a bounded interval and wakes after committed acceptance', async () => {
    vi.useFakeTimers();
    const processNext = vi.fn().mockResolvedValue({ state: 'idle' });
    const worker = new HealthProcessingWorker({ processNext });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(1);
    worker.wake();
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(processNext).toHaveBeenCalledTimes(3);
    await worker.stop();
  });

  it('cancels active processing and prevents work after shutdown', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    const processNext = vi.fn().mockImplementation((value: AbortSignal) => {
      signal = value;
      return new Promise(resolve => { finish = () => resolve({ state: 'idle' }); });
    });
    const worker = new HealthProcessingWorker({ processNext });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopped = worker.stop();
    expect(signal?.aborted).toBe(true);
    finish();
    await stopped;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processNext).toHaveBeenCalledTimes(1);
  });
});

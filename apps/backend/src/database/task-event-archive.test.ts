import { describe, expect, it, vi } from 'vitest';
import type { TaskEventArchiveBlobStore } from './task-event-archive.js';
import {
  createTaskEventArchive, createTaskEventArchiveJob, planArchivedTaskEvents, type TaskEventArchive,
} from './task-event-archive.js';

class MemoryArchiveBlobStore implements TaskEventArchiveBlobStore {
  readonly blobs = new Map<string, { body: Buffer; count: number }>();
  readonly downloads: string[] = [];
  failUploads = false;

  async upload(name: string, body: Buffer): Promise<void> {
    if (this.failUploads) throw new Error('Blob storage unavailable');
    const decoded = JSON.parse(body.toString('utf8')) as unknown[];
    this.blobs.set(name, { body, count: decoded.length });
  }

  async download(name: string): Promise<Buffer> {
    this.downloads.push(name);
    const blob = this.blobs.get(name);
    if (!blob) throw new Error('Archive blob not found');
    return blob.body;
  }

  add(name: string, events: unknown[]) {
    this.blobs.set(name, { body: Buffer.from(JSON.stringify(events)), count: events.length });
  }
}

const pool = {} as ConstructorParameters<typeof createTaskEventArchive>[0];

describe('task event archive reads', () => {
  it('restores only the requested archived page and preserves payload truncation', async () => {
    const blobs = new MemoryArchiveBlobStore();
    blobs.add('task-events/42/20200101000000000000000-0000000000000000001.json', [
      { id: '1', type: 'started', summary: 'first', payload: null, source: 'backend', at: '2020-01-01T00:00:00.000Z' },
    ]);
    blobs.add('task-events/42/20200102000000000000000-0000000000000000002.json', [
      { id: '2', type: 'progress', summary: 'second', payload: JSON.stringify('x'.repeat(2500)), source: 'runner', at: '2020-01-02T00:00:00.000Z' },
    ]);
    blobs.add('task-events/42/20200103000000000000000-0000000000000000003.json', [
      { id: '3', type: 'finished', summary: 'third', payload: null, source: 'backend', at: '2020-01-03T00:00:00.000Z' },
    ]);
    const archive = createTaskEventArchive(pool, blobs);

    const plan = planArchivedTaskEvents('42', 3, [
      { name: 'task-events/42/20200101000000000000000-0000000000000000001.json', count: 1, firstOffset: 0 },
      { name: 'task-events/42/20200102000000000000000-0000000000000000002.json', count: 1, firstOffset: 1 },
      { name: 'task-events/42/20200103000000000000000-0000000000000000003.json', count: 1, firstOffset: 2 },
    ], 1, 1);
    expect(plan).toEqual({
      taskId: '42',
      slices: [{
        name: 'task-events/42/20200102000000000000000-0000000000000000002.json',
        count: 1,
        skip: 0,
        take: 1,
      }],
      total: 3,
      eventCount: 1,
      complete: false,
    });

    await expect(archive.restoreArchivedEvents(plan)).resolves.toEqual([{
        id: '2', type: 'progress', summary: 'second', payload: null, payloadTruncated: true,
        source: 'runner', at: '2020-01-02T00:00:00.000Z',
    }]);
    expect(blobs.downloads).toEqual(['task-events/42/20200102000000000000000-0000000000000000002.json']);
  });

  it('fails visibly when an archive blob is missing or corrupt', async () => {
    const blobs = new MemoryArchiveBlobStore();
    blobs.add('task-events/42/20200101000000000000000-0000000000000000001.json', [
      { id: '1', type: 'started', summary: 'first', payload: null, source: 'backend', at: '2020-01-01T00:00:00.000Z' },
    ]);
    const archive = createTaskEventArchive(pool, blobs);
    blobs.download = vi.fn(async () => Buffer.from('{'));

    const plan = planArchivedTaskEvents('42', 1, [
      { name: 'task-events/42/20200101000000000000000-0000000000000000001.json', count: 1, firstOffset: 0 },
    ], 0, 1);
    await expect(archive.restoreArchivedEvents(plan)).rejects.toThrow('Task event archive blob is invalid');
  });
});

describe('task event archive job', () => {
  it('skips startup and recurring SQL work while no sandbox is active', async () => {
    vi.useFakeTimers();
    const archiveExpiredEvents = vi.fn(async () => 0);
    const archive = { archiveExpiredEvents } as unknown as TaskEventArchive;
    const active = { value: false };
    const job = createTaskEventArchiveJob(archive, vi.fn(), () => active.value, 60_000);

    job.start();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(archiveExpiredEvents).not.toHaveBeenCalled();

    active.value = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(archiveExpiredEvents).toHaveBeenCalledOnce();
    await job.stop();
  });
});

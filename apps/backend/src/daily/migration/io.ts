import { constants } from 'node:fs';
import { open, mkdir, lstat, opendir, unlink, rmdir, type FileHandle } from 'node:fs/promises';
import { resolve, parse, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fail } from './manifest.js';

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** Reject symlinks in every existing component, including the private output directory. */
export async function safeDirectory(path: string, create = false): Promise<string> {
  const full = resolve(path);
  let current = parse(full).root;
  for (const part of full.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    if (create) await mkdir(current, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('unsafe-path');
  }
  return full;
}

/** Directory descriptors anchor reads even if an untrusted ancestor is renamed. Linux only. */
export class BundleReader {
  private constructor(private readonly root: FileHandle, readonly lineLimit: number) {}
  static async create(path: string, lineLimit: number): Promise<BundleReader> {
    const full = resolve(path);
    let handle = await open('/', constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      for (const part of full.split('/').filter(Boolean)) {
        const next = await open(`/proc/self/fd/${handle.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        await handle.close(); handle = next;
      }
      return new BundleReader(handle, lineLimit);
    } catch {
      await handle.close();
      return fail('unsafe-path');
    }
  }
  async close(): Promise<void> { await this.root.close(); }
  async entries(): Promise<string[]> {
    const result: string[] = [];
    const dir = await opendir(`/proc/self/fd/${this.root.fd}`);
    for await (const entry of dir) {
      if (result.length >= 70) fail('unexpected-files');
      if (entry.isSymbolicLink()) fail('unsafe-path');
      result.push(entry.name);
    }
    return result;
  }
  async file(path: string): Promise<FileHandle> {
    const parts = path.split('/');
    if (parts.some(p => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === '.' || p === '..') || parts.length > 2) return fail('unsafe-path');
    let directory = this.root;
    try {
      if (parts.length === 2) directory = await open(`/proc/self/fd/${this.root.fd}/${parts[0]}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const handle = await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!(await handle.stat()).isFile()) { await handle.close(); return fail('unsafe-path'); }
      return handle;
    } finally { if (directory !== this.root) await directory.close(); }
  }
  async *chunks(path: string): AsyncGenerator<Buffer> {
    const handle = await this.file(path);
    try {
      const buffer = Buffer.alloc(Math.min(16_384, this.lineLimit));
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        yield buffer.subarray(0, bytesRead);
      }
    } finally { await handle.close(); }
  }
  async boundedJson(path: string, limit: number): Promise<unknown> {
    return (await this.boundedJsonWithHash(path, limit)).value;
  }
  async boundedJsonWithHash(path: string, limit: number): Promise<{ value: unknown; sha256: string }> {
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of this.chunks(path)) {
      size += chunk.length;
      if (size > limit) fail('manifest-too-large');
      hash.update(chunk);
      chunks.push(Buffer.from(chunk));
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), sha256: hash.digest('hex') };
  }
  async lines(path: string, consume: (line: string) => Promise<void>): Promise<{ rows: number; bytes: number; sha256: string }> {
    const hash = createHash('sha256');
    const line = Buffer.alloc(this.lineLimit);
    let used = 0, rows = 0, bytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of this.chunks(path)) {
      hash.update(chunk); bytes += chunk.length;
      let start = 0;
      for (let i = 0; i <= chunk.length; i++) {
        if (i !== chunk.length && chunk[i] !== 10) continue;
        const length = i - start;
        if (used + length > this.lineLimit) fail('line-too-large');
        chunk.copy(line, used, start, i); used += length;
        if (i < chunk.length) {
          await consume(decoder.decode(line.subarray(0, used)));
          rows++; used = 0;
        }
        start = i + 1;
      }
    }
    if (used) { await consume(decoder.decode(line.subarray(0, used))); rows++; }
    return { rows, bytes, sha256: hash.digest('hex') };
  }
  async hash(path: string): Promise<{ bytes: number; sha256: string }> {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of this.chunks(path)) { bytes += chunk.length; hash.update(chunk); }
    return { bytes, sha256: hash.digest('hex') };
  }
}

/** Exact digest membership on disk. No row-proportional in-memory set or LRU. */
export class DiskIndex {
  private constructor(readonly path: string) {}
  static async create(reportDirectory: string): Promise<DiskIndex> {
    const path = join(reportDirectory, `.daily-index-${randomUUID()}`);
    await mkdir(path, { mode: 0o700 });
    return new DiskIndex(path);
  }
  private async location(namespace: string, key: string): Promise<string> {
    const digest = sha256(`${namespace}\0${key}`);
    const directory = join(this.path, digest.slice(0, 2));
    await mkdir(directory, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
    return join(directory, digest.slice(2));
  }
  async add(namespace: string, key: string, value = ''): Promise<boolean> {
    try {
      const handle = await open(await this.location(namespace, key), 'wx', 0o600);
      try { await handle.writeFile(value); } finally { await handle.close(); }
      return true;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  }
  async get(namespace: string, key: string): Promise<string | null> {
    try {
      const handle = await open(await this.location(namespace, key), 'r');
      try { return await handle.readFile('utf8'); } finally { await handle.close(); }
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async close(): Promise<void> {
    // Stream cleanup too: recursive rm/readdir would materialize a growing bucket.
    const prefixes = await opendir(this.path);
    for await (const prefix of prefixes) {
      const path = join(this.path, prefix.name);
      const entries = await opendir(path);
      for await (const entry of entries) await unlink(join(path, entry.name));
      await rmdir(path);
    }
    await rmdir(this.path);
  }
}

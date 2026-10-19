import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { contentHash, contentSize, isSafePath, normalizeContent, normalizePath } from '../engine/normalize.js';
import type { FileRecord } from '../engine/types.js';

export interface WorkspaceFile {
  readonly record: FileRecord;
  readonly text?: string;
}

export interface WorkspaceSnapshot {
  readonly files: ReadonlyMap<string, WorkspaceFile>;
  readonly bytes: ReadonlyMap<string, Buffer>;
}

async function walk(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError('Unsafe working-copy entry');
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
  }
  return files;
}

function safePath(path: string): string {
  const normalized = normalizePath(path);
  if (!isSafePath(normalized)) throw new TypeError('Unsafe vault path');
  return normalized;
}

async function ensureParent(root: string, path: string, preserveSpelling = false): Promise<string> {
  if (!isSafePath(normalizePath(path))) throw new TypeError('Unsafe vault path');
  const safe = preserveSpelling ? path : safePath(path);
  const target = resolve(root, ...safe.split('/'));
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new TypeError('Unsafe vault path');
  let current = root;
  for (const segment of safe.split('/').slice(0, -1)) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Unsafe vault path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError('Unsafe vault path');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return target;
}

export async function snapshotWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const files = new Map<string, WorkspaceFile>();
  const bytes = new Map<string, Buffer>();
  for (const path of await walk(root)) {
    const normalized = normalizePath(path);
    if (!isSafePath(normalized)) continue;
    const target = await ensureParent(root, path, true);
    const value = await readFile(target);
    const info = await stat(target);
    let text: string | undefined;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(value); }
    catch { /* Invalid UTF-8 remains an unreadable record and cannot be written back. */ }
    bytes.set(path, value);
    files.set(path, {
      record: {
        hash: text === undefined ? createHash('sha256').update(value).digest('hex') : contentHash(text),
        size: value.byteLength,
        mode: (info.mode & 0o111) === 0 ? '100644' : '100755',
      },
      ...(text === undefined ? {} : { text }),
    });
  }
  return { files, bytes };
}

export async function writeWorkspaceFile(root: string, path: string, text: string): Promise<void> {
  const aliases = (await walk(root)).filter(candidate => normalizePath(candidate) === normalizePath(path));
  if (aliases.length > 1) throw new TypeError('Ambiguous vault path');
  const target = await ensureParent(root, aliases[0] ?? path, true);
  const temporary = resolve(dirname(target), `.jarvis-mirror-${randomUUID()}`);
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function deleteWorkspaceFile(root: string, path: string): Promise<void> {
  const aliases = (await walk(root)).filter(candidate => normalizePath(candidate) === normalizePath(path));
  if (aliases.length > 1) throw new TypeError('Ambiguous vault path');
  const target = await ensureParent(root, aliases[0] ?? path, true);
  await rm(target, { force: true });
}

export async function restoreWorkspace(root: string, snapshot: WorkspaceSnapshot): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const currentPaths = await walk(root);
  const saved = new Set(snapshot.bytes.keys());
  for (const path of currentPaths) {
    safePath(path);
    if (!saved.has(path)) await rm(await ensureParent(root, path, true));
  }
  for (const [path, value] of snapshot.bytes) {
    const target = await ensureParent(root, path, true);
    const temporary = resolve(dirname(target), `.jarvis-mirror-${randomUUID()}`);
    try {
      await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function workspaceDiff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): Set<string> {
  const normalize = (files: ReadonlyMap<string, WorkspaceFile>): Map<string, WorkspaceFile> =>
    new Map([...files].map(([path, file]) => [normalizePath(path), file]));
  const oldFiles = normalize(before.files);
  const newFiles = normalize(after.files);
  const paths = new Set([...oldFiles.keys(), ...newFiles.keys()]);
  return new Set([...paths].filter(path =>
    oldFiles.get(path)?.record.hash !== newFiles.get(path)?.record.hash ||
    oldFiles.get(path)?.record.mode !== newFiles.get(path)?.record.mode));
}

export function samePaths(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(path => right.has(path));
}

export function fileRecord(text: string): FileRecord {
  const normalized = normalizeContent(text);
  return { hash: contentHash(normalized), size: contentSize(normalized), mode: '100644' };
}

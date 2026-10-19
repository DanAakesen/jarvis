import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { contentHash, contentSize, isSafePath, normalizeContent } from '../engine/normalize.js';
import type { BaseRecord, FileRecord } from '../engine/types.js';
import { MAX_ARCHIVE_BYTES } from './types.js';

export interface StoredFile extends BaseRecord {
  readonly text: string;
}

export type PendingWrite =
  | { readonly kind: 'write'; readonly file: StoredFile }
  | { readonly kind: 'delete' };

export interface MirrorState {
  readonly version: 1;
  initialized: boolean;
  setupComplete: boolean;
  base: Record<string, StoredFile>;
  conflictFirstSeenAt: Record<string, number>;
  pendingWriteBack: Record<string, PendingWrite>;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
}

export function emptyState(): MirrorState {
  return {
    version: 1, initialized: false, setupComplete: false, base: {},
    conflictFirstSeenAt: {}, pendingWriteBack: {}, consecutiveFailures: 0, lastSuccessAt: null,
  };
}

function validStoredFile(value: unknown): value is StoredFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['hash', 'size', 'mode', 'text', 'conflictFirstSeenAt'].includes(key)) ||
    typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(record.hash) ||
    !Number.isSafeInteger(record.size) || (record.size as number) < 0 ||
    typeof record.mode !== 'string' || typeof record.text !== 'string') return false;
  if (record.conflictFirstSeenAt !== undefined &&
    (typeof record.conflictFirstSeenAt !== 'number' || !Number.isFinite(record.conflictFirstSeenAt) ||
      record.conflictFirstSeenAt < 0)) return false;
  const text = normalizeContent(record.text);
  return contentHash(text) === record.hash && contentSize(text) === record.size;
}

function validRecords(value: unknown): value is Record<string, StoredFile> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([path, record]) => isSafePath(path) && validStoredFile(record));
}

function validPending(value: unknown): value is Record<string, PendingWrite> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([path, pending]) => {
      if (!isSafePath(path) || !pending || typeof pending !== 'object' || Array.isArray(pending)) return false;
      const record = pending as Record<string, unknown>;
      return Object.keys(record).length === 2 &&
        (record.kind === 'write' && Object.keys(record).every(key => ['kind', 'file'].includes(key)) &&
          validStoredFile(record.file) ||
          record.kind === 'delete' && Object.keys(record).every(key => key === 'kind'));
    });
}

function parseState(value: unknown): MirrorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Corrupt mirror state');
  const state = value as Record<string, unknown>;
  const expected = ['version', 'initialized', 'setupComplete', 'base', 'conflictFirstSeenAt',
    'pendingWriteBack', 'consecutiveFailures', 'lastSuccessAt'];
  if (Object.keys(state).length !== expected.length || Object.keys(state).some(key => !expected.includes(key)) ||
    state.version !== 1 || typeof state.initialized !== 'boolean' || typeof state.setupComplete !== 'boolean' ||
    !validRecords(state.base) || !validPending(state.pendingWriteBack) ||
    state.conflictFirstSeenAt === null || typeof state.conflictFirstSeenAt !== 'object' ||
    Array.isArray(state.conflictFirstSeenAt) ||
    !Object.entries(state.conflictFirstSeenAt).every(([path, timestamp]) =>
      isSafePath(path) && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0) ||
    !Number.isSafeInteger(state.consecutiveFailures) || (state.consecutiveFailures as number) < 0 ||
    state.lastSuccessAt !== null && (typeof state.lastSuccessAt !== 'string' ||
      !Number.isFinite(Date.parse(state.lastSuccessAt)))) throw new TypeError('Corrupt mirror state');
  return state as unknown as MirrorState;
}

function safeArchivePath(name: string): boolean {
  return !name.startsWith('/') && !name.includes('\\') &&
    name.split('/').filter((part, index, all) => !(part === '' && index === all.length - 1))
      .every(part => part !== '' && part !== '.' && part !== '..' && !part.includes(':'));
}

function inspectZip(bytes: Uint8Array): void {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_ARCHIVE_BYTES) throw new TypeError('Corrupt mirror archive');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
    throw new TypeError('Corrupt mirror archive');
  }
  const entries = view.getUint16(eocd + 10, true);
  const directoryBytes = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries > 100_000 || directoryOffset + directoryBytes > eocd) throw new TypeError('Corrupt mirror archive');
  let offset = directoryOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new TypeError('Corrupt mirror archive');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (flags & 1 || (method !== 0 && method !== 8) || next > bytes.byteLength) {
      throw new TypeError('Corrupt mirror archive');
    }
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!safeArchivePath(name)) throw new TypeError('Corrupt mirror archive');
    const externalAttributes = view.getUint32(offset + 38, true);
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0o170000;
    if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
      throw new TypeError('Corrupt mirror archive');
    }
    totalExpanded += expanded;
    if (totalExpanded > MAX_ARCHIVE_BYTES) throw new TypeError('Corrupt mirror archive');
    offset = next;
  }
  if (offset !== directoryOffset + directoryBytes) throw new TypeError('Corrupt mirror archive');
}

async function addDirectory(files: Record<string, Uint8Array>, source: string, prefix: string): Promise<number> {
  let total = 0;
  const visit = async (directory: string, name: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new TypeError('Unsafe mirror archive entry');
      if (entry.isDirectory()) await visit(path, `${name}${entry.name}/`);
      else if (entry.isFile()) {
        const file = await readFile(path);
        total += file.byteLength;
        if (total > MAX_ARCHIVE_BYTES) throw new TypeError('Oversized mirror archive');
        files[`${name}${entry.name}`] = file;
      }
    }
  };
  await visit(source, prefix);
  return total;
}

export async function encodeState(
  state: MirrorState,
  workingCopy: string,
  configHome: string,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'mirror.json': strToU8(JSON.stringify(state)),
  };
  const expanded = (await addDirectory(files, workingCopy, 'vault/')) +
    (await addDirectory(files, configHome, 'headless/'));
  if (expanded > MAX_ARCHIVE_BYTES) throw new TypeError('Oversized mirror archive');
  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new TypeError('Oversized mirror archive');
  return archive;
}

export async function decodeState(
  archive: Uint8Array,
  workingCopy: string,
  configHome: string,
): Promise<MirrorState> {
  inspectZip(archive);
  const entries = unzipSync(archive);
  const stateBytes = entries['mirror.json'];
  if (!stateBytes) throw new TypeError('Corrupt mirror archive');
  const state = parseState(JSON.parse(strFromU8(stateBytes)) as unknown);
  let expanded = stateBytes.byteLength;
  const writes: { root: 'vault' | 'headless'; path: string; bytes: Uint8Array }[] = [];
  for (const [name, content] of Object.entries(entries)) {
    if (name === 'mirror.json' || name.endsWith('/')) continue;
    if (!safeArchivePath(name)) throw new TypeError('Corrupt mirror archive');
    const separator = name.indexOf('/');
    const prefix = name.slice(0, separator);
    const relative = name.slice(separator + 1);
    if ((prefix !== 'vault' && prefix !== 'headless') || !relative || !safeArchivePath(relative)) {
      throw new TypeError('Corrupt mirror archive');
    }
    expanded += content.byteLength;
    if (expanded > MAX_ARCHIVE_BYTES) throw new TypeError('Corrupt mirror archive');
    writes.push({ root: prefix, path: relative, bytes: content });
  }
  for (const [prefix, root] of [['vault', workingCopy], ['headless', configHome]] as const) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    for (const item of writes) {
      if (item.root !== prefix) continue;
      const target = resolve(root, ...item.path.split('/'));
      const relative = target.slice(root.length + 1);
      if (!relative || relative === '..' || relative.startsWith('../')) throw new TypeError('Corrupt mirror archive');
      await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
      await writeFile(target, item.bytes, { mode: 0o600, flag: 'w' });
    }
  }
  return state;
}

export function checksum(archive: Uint8Array): string {
  return createHash('sha256').update(archive).digest('hex');
}

export function mapBaseRecords(state: MirrorState): Map<string, BaseRecord> {
  return new Map(Object.entries(state.base).map(([path, file]) => [path, {
    hash: file.hash,
    size: file.size,
    mode: file.mode,
    ...(file.conflictFirstSeenAt === undefined ? {} : { conflictFirstSeenAt: file.conflictFirstSeenAt }),
  }]));
}

export function recordForState(text: string, record: FileRecord): StoredFile {
  const normalized = normalizeContent(text);
  if (contentHash(normalized) !== record.hash || contentSize(normalized) !== record.size) {
    throw new TypeError('Invalid mirror record');
  }
  return { ...record, text: normalized };
}

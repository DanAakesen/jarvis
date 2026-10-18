import type { createGitHubVaultClient } from '../vault/github-client.js';
import { MAX_VAULT_FILE_BYTES, VaultFileTooLargeError } from '../vault/github-client.js';
import { isVaultNotePath } from '../vault/index.js';
import { parseTodos, type ParsedTodo } from './todo-file.js';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;
export const MAX_TODO_FILES = 256;
export const MAX_TODO_SCAN_BYTES = 4 * 1024 * 1024;
export const TODO_READ_CONCURRENCY = 4;

export class TodoDiscoveryError extends Error {
  constructor(readonly reason: string) {
    super('Vault tasks are unavailable');
  }
}

interface CachedFile {
  sha: string;
  bytes: number;
  todos: ParsedTodo[];
}

function inScope(path: string): boolean {
  return isVaultNotePath(path) && !path.split('/').some((part) => part.startsWith('.') || part.toLowerCase() === 'archive') &&
    (/^(?:Personal|Work)\//u.test(path) || /^(?:task|tasks)\.md$/iu.test(path));
}

const readers = new WeakMap<VaultReader, ReturnType<typeof createReader>>();

function createReader(vault: VaultReader) {
  let cache = new Map<string, CachedFile>();
  return async (signal: AbortSignal): Promise<ParsedTodo[]> => {
    const controller = new AbortController();
    const boundedSignal = AbortSignal.any([signal, controller.signal]);
    const scan = async () => {
      const files = (await vault.tree(boundedSignal)).filter(({ path }) => inScope(path));
      boundedSignal.throwIfAborted();
      if (files.length === 0) throw new TodoDiscoveryError('todo_file_missing');
      if (files.filter(({ path }) => !path.includes('/')).length > 1) {
        throw new TodoDiscoveryError('todo_file_ambiguous');
      }
      if (files.length > MAX_TODO_FILES) throw new TodoDiscoveryError('scan_limit');
      let budget = 0;
      for (const file of files) {
        const cached = cache.get(file.path);
        const bytes = cached?.sha === file.sha ? cached.bytes : file.size ?? MAX_VAULT_FILE_BYTES;
        if (bytes > MAX_VAULT_FILE_BYTES) throw new VaultFileTooLargeError();
        budget += bytes;
      }
      if (budget > MAX_TODO_SCAN_BYTES) throw new TodoDiscoveryError('scan_limit');

      const next = new Map<string, CachedFile>();
      let index = 0;
      let totalBytes = 0;
      await Promise.all(Array.from({ length: Math.min(TODO_READ_CONCURRENCY, files.length) }, async () => {
        while (index < files.length) {
          boundedSignal.throwIfAborted();
          const entry = files[index++]!;
          let parsed = cache.get(entry.path);
          if (parsed?.sha !== entry.sha) {
            const file = await vault.read(entry.path, boundedSignal);
            boundedSignal.throwIfAborted();
            if (!file || file.sha !== entry.sha || file.path !== entry.path) {
              throw new TodoDiscoveryError('read_failed');
            }
            const bytes = Buffer.byteLength(file.content, 'utf8');
            if (bytes > MAX_VAULT_FILE_BYTES) throw new VaultFileTooLargeError();
            parsed = { sha: entry.sha, bytes, todos: parseTodos(file.content) };
          }
          totalBytes += parsed.bytes;
          if (totalBytes > MAX_TODO_SCAN_BYTES) throw new TodoDiscoveryError('scan_limit');
          next.set(entry.path, parsed);
        }
      }));
      boundedSignal.throwIfAborted();
      cache = next;
      return files.flatMap(({ path }) => next.get(path)!.todos);
    };
    let abort: () => void = () => {};
    try {
      return await Promise.race([
        scan(),
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(new TodoDiscoveryError('timeout'));
          boundedSignal.addEventListener('abort', abort, { once: true });
          if (boundedSignal.aborted) abort();
        }),
      ]);
    } finally {
      boundedSignal.removeEventListener('abort', abort);
      controller.abort();
    }
  };
}

export function readVaultTodos(vault: VaultReader, signal: AbortSignal): Promise<ParsedTodo[]> {
  let reader = readers.get(vault);
  if (!reader) {
    reader = createReader(vault);
    readers.set(vault, reader);
  }
  return reader(signal);
}

import { VaultWriteConflictError, type createGitHubVaultClient } from '../vault/github-client.js';
import { shouldRedact } from '../vault/index.js';

type VaultClient = ReturnType<typeof createGitHubVaultClient>;
export type PiVault = Pick<VaultClient, 'read' | 'write' | 'tree' | 'move'>;

export class PiAreaError extends Error {
  constructor(readonly code: 'invalid' | 'refused' | 'too_large' | 'unavailable' | 'not_found' | 'conflict', message: string) {
    super(message);
    this.name = 'PiAreaError';
  }
}

/** Where PI writes in the vault: its own decision log, its watches and its free notes. Nowhere else. */
export const PI_AREAS = ['Log', 'Watches', 'Notes'] as const;
export type PiArea = typeof PI_AREAS[number];
export const PI_AREA_ROOT = 'PI';
export const MAX_PI_NOTE_BYTES = 64 * 1024;
export const MAX_PI_FILE_BYTES = 256 * 1024;

const fileName = /^[^/\\:*?"<>|#%^[\]\p{Cc}\p{Cf}.][^/\\:*?"<>|#%^[\]\p{Cc}\p{Cf}]{0,99}\.md$/u;
const maxAttempts = 3;
/** A credential-like word in a note name is refused like one in its text. Say that, not that the folder is wrong. */
const credentialName = 'Secrets and credentials can never be saved to the vault, and that includes the note name. Nothing was written.';

/** True for a note PI may write: `PI/<Log|Watches|Notes>/<name>.md`, or `PI/Watches/Closed/<name>.md`. */
export function isPiPath(path: string): boolean {
  const parts = path.split('/');
  if (parts[0] !== PI_AREA_ROOT) return false;
  const closed = parts.length === 4 && parts[1] === 'Watches' && parts[2] === 'Closed';
  if (parts.length !== 3 && !closed) return false;
  if (!(PI_AREAS as readonly string[]).includes(parts[1]!)) return false;
  return fileName.test(parts.at(-1)!) && !shouldRedact(path);
}

function assertWritable(path: string, content: string): void {
  if (!isPiPath(path)) throw new PiAreaError('refused', shouldRedact(path) ? credentialName : 'PI may only write notes under PI/Log, PI/Watches and PI/Notes. Nothing was written.');
  if (Buffer.byteLength(content, 'utf8') > MAX_PI_FILE_BYTES) {
    throw new PiAreaError('too_large', 'That note would be too large. Start a new note instead. Nothing was written.');
  }
  if (shouldRedact(content)) throw new PiAreaError('refused', 'Secrets and credentials can never be saved to the vault. Nothing was written.');
}

function unavailable(error: unknown): never {
  if (error instanceof PiAreaError) throw error;
  if (error instanceof Error && error.name === 'AbortError') throw error;
  throw new PiAreaError('unavailable', 'The vault could not be reached. Nothing is confirmed as written.');
}

/**
 * Free-text notes in PI's own corner of the vault. The guard is exact: path shape, size, and the same secret filter as every
 * other vault write. What a note says is the model's to decide; nothing here parses it.
 */
export function createPiArea(options: { readonly vault: PiVault }) {
  const { vault } = options;

  async function read(path: string, signal: AbortSignal): Promise<{ content: string; sha: string } | null> {
    if (!isPiPath(path)) throw new PiAreaError('refused', shouldRedact(path) ? credentialName : 'That is not a PI note path.');
    try {
      const file = await vault.read(path, signal);
      return file ? { content: file.content, sha: file.sha } : null;
    } catch (error) { return unavailable(error); }
  }

  /** Creates the note, or changes it from what it is now; retried on a concurrent change, never overwriting a stranger's edit. */
  async function change(
    path: string,
    signal: AbortSignal,
    message: string,
    next: (current: string | null) => string,
  ): Promise<{ created: boolean; content: string }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const current = await read(path, signal);
      const content = next(current?.content ?? null);
      assertWritable(path, content);
      try {
        await vault.write(path, content, message, current?.sha, signal);
        return { created: current === null, content };
      } catch (error) {
        if (error instanceof VaultWriteConflictError && attempt < maxAttempts) continue;
        if (error instanceof VaultWriteConflictError) {
          throw new PiAreaError('conflict', 'That note changed again while it was being saved. Read it and try again; nothing was overwritten.');
        }
        return unavailable(error);
      }
    }
    throw new PiAreaError('conflict', 'That note changed again while it was being saved. Read it and try again.');
  }

  return {
    read,
    /** All PI notes of one area (and the closed watches), by path, from the vault tree. */
    async list(area: PiArea, signal: AbortSignal, options: { closed?: boolean } = {}): Promise<{ path: string; sha: string }[]> {
      try {
        const prefix = `${PI_AREA_ROOT}/${area}/${options.closed ? 'Closed/' : ''}`;
        return (await vault.tree(signal))
          .filter(({ path }) => path.startsWith(prefix) && isPiPath(path) && (options.closed || path.split('/').length === 3))
          .map(({ path, sha }) => ({ path, sha }));
      } catch (error) { return unavailable(error); }
    },
    /** Appends one block; a new note starts with the heading. */
    async append(path: string, heading: string, block: string, signal: AbortSignal, message = 'PI: note'): Promise<{ created: boolean }> {
      if (Buffer.byteLength(block, 'utf8') > MAX_PI_NOTE_BYTES) throw new PiAreaError('too_large', 'That note is too large. Condense it. Nothing was written.');
      return change(path, signal, message, (current) => current === null ? `# ${heading}\n\n${block.trim()}\n` : `${current.trimEnd()}\n\n${block.trim()}\n`);
    },
    /** Replaces the whole note. */
    async replace(path: string, content: string, signal: AbortSignal, message = 'PI: note'): Promise<{ created: boolean }> {
      if (Buffer.byteLength(content, 'utf8') > MAX_PI_NOTE_BYTES) throw new PiAreaError('too_large', 'That note is too large. Condense it. Nothing was written.');
      return change(path, signal, message, () => `${content.trimEnd()}\n`);
    },
    /** Applies one minimal transform to the latest revision, retrying a concurrent edit without overwriting it. */
    async transform(
      path: string,
      signal: AbortSignal,
      message: string,
      transform: (current: string | null) => string | null,
    ): Promise<{ created: boolean; content: string | null; changed: boolean }> {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const current = await read(path, signal);
        const transformed = transform(current?.content ?? null);
        if (transformed === null) return { created: false, content: current?.content ?? null, changed: false };
        const content = `${transformed.trimEnd()}\n`;
        if (content === current?.content) {
          return { created: false, content, changed: false };
        }
        assertWritable(path, content);
        try {
          await vault.write(path, content, message, current?.sha, signal);
          return { created: current === null, content, changed: true };
        } catch (error) {
          if (error instanceof VaultWriteConflictError && attempt < maxAttempts) continue;
          if (error instanceof VaultWriteConflictError) {
            throw new PiAreaError('conflict', 'That note changed again while it was being saved. Read it and try again; nothing was overwritten.');
          }
          return unavailable(error);
        }
      }
      throw new PiAreaError('conflict', 'That note changed again while it was being saved. Read it and try again.');
    },
    /** Creates a note only when it still does not exist. */
    async create(path: string, content: string, signal: AbortSignal, message = 'PI: note'): Promise<{ content: string }> {
      if (Buffer.byteLength(content, 'utf8') > MAX_PI_NOTE_BYTES) throw new PiAreaError('too_large', 'That note is too large. Condense it. Nothing was written.');
      const value = `${content.trimEnd()}\n`;
      assertWritable(path, value);
      try {
        await vault.write(path, value, message, undefined, signal);
        return { content: value };
      } catch (error) {
        if (error instanceof VaultWriteConflictError) {
          throw new PiAreaError('conflict', 'That note was created while PI was choosing its name. Read the current watches and try again.');
        }
        return unavailable(error);
      }
    },
    /** Moves a note within the area as one commit (a watch closing), with new content if given. */
    async move(from: string, to: string, signal: AbortSignal, options: { content?: (current: string) => string; message?: string } = {}): Promise<void> {
      if (!isPiPath(from) || !isPiPath(to)) throw new PiAreaError('refused', 'PI may only move notes inside its own area.');
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const source = await read(from, signal);
          if (!source) throw new PiAreaError('not_found', 'That note does not exist.');
          const content = options.content ? options.content(source.content) : source.content;
          assertWritable(to, content);
          await vault.move(from, to, content, source.sha, options.message ?? 'PI: move note', signal);
          return;
        } catch (error) {
          if (error instanceof VaultWriteConflictError && attempt < maxAttempts) continue;
          if (error instanceof VaultWriteConflictError) {
            throw new PiAreaError('conflict', 'That watch changed again while it was being closed. Read it and try again; nothing was overwritten.');
          }
          return unavailable(error);
        }
      }
      throw new PiAreaError('conflict', 'That watch changed again while it was being closed. Read it and try again.');
    },
  };
}

export type PiAreaStore = ReturnType<typeof createPiArea>;

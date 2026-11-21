import { createHash } from 'node:crypto';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../../../core/memory-embeddings.js';
import {
  VectorSearchUnavailableError,
  type VaultGraphData, type VaultGraphFile, type VaultIndexedChunk, type VaultIndexedFile, type VaultIndexStore, type VaultSearchHit,
} from '../../../database/memory-store.js';
import { blobSha } from '../../../inbox/note.js';
import {
  MAX_VAULT_FILE_BYTES, VaultFileTooLargeError, VaultWriteConflictError, type VaultCommit, type VaultTreeFile, type createGitHubVaultClient,
} from '../../../vault/github-client.js';

/**
 * The vault side of the notes group: a GitHub-like vault in memory (a write needs the sha the note has now, a creation needs
 * none, a rename or delete needs the sha it sees) and the database index over its notes (chunks with embeddings, links).
 */

export type VaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface MemoryVault extends VaultClient {
  /** Every note by path, with the content a read returns. */
  readonly files: ReadonlyMap<string, string>;
  /** Puts a note in the vault without a commit; for seeding. */
  seed(path: string, content: string): void;
  /** The git blob sha of a note now, the way GitHub reports it. */
  shaOf(path: string): string | undefined;
}

export function createMemoryVault(): MemoryVault {
  const files = new Map<string, string>();
  const commits = new Map<string, VaultCommit[]>();
  let counter = 0;
  const commit = (path: string, message: string): string => {
    counter += 1;
    const sha = createHash('sha1').update(`commit ${counter} ${path}`).digest('hex');
    commits.set(path, [{ sha, updatedAt: new Date(), message }, ...(commits.get(path) ?? [])]);
    return sha;
  };
  const shaOf = (path: string): string | undefined => {
    const content = files.get(path);
    return content === undefined ? undefined : blobSha(content);
  };
  return {
    files,
    shaOf,
    seed(path, content) { files.set(path, content); },
    async tree(signal): Promise<VaultTreeFile[]> {
      signal.throwIfAborted();
      return [...files].map(([path, content]) => ({ path, sha: blobSha(content), size: Buffer.byteLength(content, 'utf8') }))
        .sort((left, right) => left.path.localeCompare(right.path));
    },
    async read(path, signal) {
      signal.throwIfAborted();
      const content = files.get(path);
      if (content === undefined) return null;
      if (Buffer.byteLength(content, 'utf8') > MAX_VAULT_FILE_BYTES) throw new VaultFileTooLargeError();
      return { path, sha: blobSha(content), content };
    },
    async history(path, limit, signal) {
      signal.throwIfAborted();
      return (commits.get(path) ?? []).slice(0, limit);
    },
    async write(path, content, message, sha, signal) {
      signal.throwIfAborted();
      const current = shaOf(path);
      if (current === undefined ? sha !== undefined : sha?.toLowerCase() !== current) throw new VaultWriteConflictError();
      files.set(path, content);
      return commit(path, message);
    },
    async move(from, to, content, expectedSha, message, signal) {
      signal.throwIfAborted();
      if (shaOf(from) !== expectedSha.toLowerCase() || files.has(to)) throw new VaultWriteConflictError();
      files.delete(from);
      files.set(to, content);
      return commit(to, message);
    },
    async delete(path, sha, message, signal) {
      signal.throwIfAborted();
      if (shaOf(path) !== sha.toLowerCase()) throw new VaultWriteConflictError();
      files.delete(path);
      return commit(path, message);
    },
  };
}

interface IndexedNote {
  blobSha: string;
  chunks: readonly VaultIndexedChunk[];
  links: readonly string[];
  indexedAt: Date;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
}

export function createVaultIndexFake(): VaultIndexStore {
  const notes = new Map<string, IndexedNote>();
  const chunkRows = () => [...notes].sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, note]) => note.chunks.map((chunk) => ({ path, chunk })));
  const hit = (path: string, chunk: VaultIndexedChunk, score: number): VaultSearchHit => ({ path, heading: chunk.heading, content: chunk.content, score });

  return {
    async initialize() {},
    supportsVectorSearch: () => true,
    async summary(embeddingModel, signal) {
      signal.throwIfAborted();
      const rows = chunkRows();
      const latest = [...notes.values()].reduce<Date | null>((at, note) => at === null || note.indexedAt > at ? note.indexedAt : at, null);
      return {
        notes: notes.size, chunks: rows.length,
        embeddedChunks: rows.filter(({ chunk }) => chunk.embedding !== null && chunk.embeddingModel === embeddingModel).length,
        latestIndexedAt: latest,
      };
    },
    async files(embeddingModel, signal): Promise<VaultIndexedFile[]> {
      signal.throwIfAborted();
      return [...notes].sort(([left], [right]) => left.localeCompare(right)).map(([path, note]) => ({
        path, blobSha: note.blobSha,
        embeddingMissing: embeddingModel === null || note.chunks.some((chunk) => chunk.embedding === null || chunk.embeddingModel !== embeddingModel),
      }));
    },
    async replaceFile(path, sha, chunks, links, signal) {
      signal.throwIfAborted();
      if (!/^[\da-f]{40}$/u.test(sha) || chunks.length > 512 || links.length > 512) throw new TypeError('Vault index entry is invalid');
      for (const { embedding, embeddingModel } of chunks) {
        const valid = embedding === null
          ? embeddingModel === null
          : embedding.length === MEMORY_EMBEDDING_DIMENSIONS && embedding.every(Number.isFinite) && typeof embeddingModel === 'string';
        if (!valid) throw new TypeError('Vault index embedding is invalid');
      }
      notes.set(path, { blobSha: sha, chunks: [...chunks], links: [...links], indexedAt: new Date() });
    },
    async deleteFiles(paths, signal) {
      signal.throwIfAborted();
      for (const path of paths) notes.delete(path);
    },
    async graphFiles(signal): Promise<VaultGraphFile[]> {
      signal.throwIfAborted();
      return [...notes].sort(([left], [right]) => left.localeCompare(right)).map(([path, note]) => ({
        path, title: note.chunks.find((chunk) => chunk.heading !== 'Introduction')?.heading ?? '', updatedAt: note.indexedAt,
      }));
    },
    async graphData(paths, embeddingModel, signal): Promise<VaultGraphData> {
      signal.throwIfAborted();
      const wanted = new Set(paths);
      const rows = chunkRows().filter(({ path }) => wanted.has(path));
      return {
        links: [...notes].filter(([path]) => wanted.has(path)).flatMap(([path, note]) => note.links.map((targetPath) => ({ sourcePath: path, targetPath }))),
        similarities: [],
        embeddings: rows.flatMap(({ path, chunk }) => chunk.embedding !== null && chunk.embeddingModel === embeddingModel ? [{ path, embedding: chunk.embedding }] : []),
        contents: rows.map(({ path, chunk }) => ({ path, content: chunk.content })),
      };
    },
    async searchByVector(embedding, embeddingModel, limit, signal) {
      signal.throwIfAborted();
      if (embedding.length !== MEMORY_EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) throw new VectorSearchUnavailableError();
      return chunkRows()
        .flatMap(({ path, chunk }) => chunk.embedding !== null && chunk.embeddingModel === embeddingModel
          ? [{ path, chunk, score: cosine(embedding, chunk.embedding) }] : [])
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.chunk.index - right.chunk.index)
        .slice(0, limit).map(({ path, chunk, score }) => hit(path, chunk, score));
    },
    async searchByTerms(terms, limit, signal) {
      signal.throwIfAborted();
      if (terms.length === 0) return [];
      const lowered = terms.map((term) => term.toLowerCase());
      return chunkRows()
        .map(({ path, chunk }) => ({
          path, chunk,
          matches: lowered.filter((term) => chunk.content.toLowerCase().includes(term) || chunk.heading.toLowerCase().includes(term) || path.toLowerCase().includes(term)).length,
        }))
        .filter(({ matches }) => matches > 0)
        .sort((left, right) => right.matches - left.matches || left.path.localeCompare(right.path) || left.chunk.index - right.chunk.index)
        .slice(0, limit).map(({ path, chunk, matches }) => hit(path, chunk, matches / terms.length));
    },
  };
}

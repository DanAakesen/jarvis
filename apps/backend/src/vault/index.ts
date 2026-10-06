import type { FastifyRequest } from 'fastify';
import {
  VectorSearchUnavailableError,
  type MemoryStore,
  type VaultIndexStore,
  type VaultIndexedChunk,
} from '../database/memory-store.js';
import type { MemoryEmbedder } from '../core/memory-embeddings.js';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import type { BackendModule } from '../modules.js';
import {
  MAX_VAULT_FILE_BYTES,
  VAULT_BRANCH,
  VAULT_REPOSITORY,
  VaultAppNotInstalledError,
  VaultWriteConflictError,
  createGitHubVaultClient,
  type VaultFile,
} from './github-client.js';

const folderNames = new Set(['People', 'Work', 'Personal', 'General']);
const skippedFolders = new Set(['.obsidian', '.github', '.codex', '.vscode']);
const maxQueryLength = 500;
const maxPathLength = 180;
const maxReasonLength = 120;
const maxSearchResults = 8;
const maxSnippetLength = 500;
const maxMarkdownFiles = 10_000;
const maxRoutingBytes = 512 * 1024;
const maxInstructionFiles = 32;
const maxVaultChunks = 512;
const credentialPattern = /\b(?:password|passphrase|secret|api[ -]?key|access[ -]?token|credential|private[ -]?key|seed[ -]?phrase|recovery[ -]?phrase)\b/iu;
const sensitivePattern = /\b(?:bank(?:ing)?|bank account|credit card|debit card|account number|iban|routing number|swift code|health|medical|diagnosis|medication|symptom|patient|clinic|therapy|prescription|social security|ssn)\b/iu;
const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b|(?:password|client[_ -]?secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*["']?[^\s"']{8,}/iu;
const sourceMessagePattern = /^[1-9]\d{0,18}$/u;
const maxSqlMessageId = 9_223_372_036_854_775_807n;

export interface VaultLogFields {
  readonly outcome: 'ok' | 'error' | 'refused';
  readonly added?: number;
  readonly changed?: number;
  readonly removed?: number;
  readonly folder?: string;
  readonly folders?: readonly string[];
}

export interface VaultModule extends BackendModule {
  synchronize(signal: AbortSignal): Promise<{ readonly added: number; readonly changed: number; readonly removed: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function safeFolder(path: string): string | undefined {
  const folder = path.split('/')[0];
  return folderNames.has(folder ?? '') ? folder : undefined;
}

function validatePath(value: unknown, requireRoutedFolder = true): string {
  if (typeof value !== 'string' || value.length > maxPathLength || value.includes('\\') ||
      hasControlCharacters(value) || /[?#%]/u.test(value)) {
    throw new ToolRefusal('Use a short Markdown path in People/, Work/, Personal/ or General/.');
  }
  const path = value.normalize('NFC');
  const segments = path.split('/');
  if ((requireRoutedFolder && (segments.length < 2 || !folderNames.has(segments[0] ?? ''))) ||
      !segments.at(-1)?.toLowerCase().endsWith('.md') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..' ||
        (requireRoutedFolder && segment.startsWith('.')))) {
    throw new ToolRefusal(requireRoutedFolder
      ? 'Use a Markdown path in People/, Work/, Personal/ or General/.'
      : 'Use a safe Markdown path in the vault.');
  }
  return path;
}

function validateText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new ToolRefusal(`The vault ${field} is invalid. Nothing was written.`);
  }
  return value.trim();
}

function eligibleMarkdown(path: string): boolean {
  const segments = path.split('/');
  return path.length <= 1024 && path.toLowerCase().endsWith('.md') && !path.startsWith('/') &&
    !path.includes('\\') && !hasControlCharacters(path) &&
    !segments.some((segment) => !segment || segment === '.' || segment === '..' ||
      skippedFolders.has(segment.toLowerCase()));
}

function chunkMarkdown(text: string): Array<{ heading: string; content: string }> {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const sections: Array<{ heading: string; lines: string[] }> = [];
  const headings: Array<{ level: number; text: string }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match) {
      const level = match[1]!.length;
      const parentIndex = headings.findIndex((heading) => heading.level >= level);
      if (parentIndex >= 0) headings.splice(parentIndex);
      headings.push({ level, text: match[2]!.trim() });
      current = { heading: headings.map(({ text: title }) => title).join(' > '), lines: [] };
      sections.push(current);
    } else {
      if (!current) {
        current = { heading: 'Introduction', lines: [] };
        sections.push(current);
      }
      current.lines.push(line);
    }
  }
  const chunks: Array<{ heading: string; content: string }> = [];
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body) continue;
    const pieces = body.match(/[\s\S]{1,3500}(?:\n|$)/gu) ?? [];
    for (const piece of pieces) {
      const content = piece.trim();
      if (content) chunks.push({ heading: section.heading, content: content.slice(0, 4_000) });
      if (chunks.length > maxVaultChunks) throw new Error('Vault note has too many index chunks');
    }
  }
  return chunks;
}

function notesInstruction(path: string, content: string): boolean {
  if (/(?:vault|notes?|markdown)/iu.test(path)) return true;
  const applyTo = /^applyTo:\s*(.+)$/imu.exec(content)?.[1] ?? '';
  return /(?:People|Work|Personal|General)\/|\*\.md|\.md\*\*/iu.test(applyTo) ||
    /\b(?:vault|notes?|markdown)\b/iu.test(content);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function noteUrl(path: string): string {
  return `https://github.com/${VAULT_REPOSITORY}/blob/${VAULT_BRANCH}/${encodePath(path)}`;
}

function commitUrl(sha: string): string {
  return `https://github.com/${VAULT_REPOSITORY}/commit/${sha}`;
}

function queryTerms(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]{2,}/gu)?.map((term) => term.toLowerCase()) ?? [])].slice(0, 12);
}

function snippet(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, maxSnippetLength);
}

function assertCaptureIsSafe(source: string, text: string): void {
  if (credentialPattern.test(`${source}\n${text}`) || secretPattern.test(`${source}\n${text}`)) {
    throw new ToolRefusal('Secrets and credentials can never be saved to the vault. Nothing was written.');
  }
  if (sensitivePattern.test(`${source}\n${text}`) && !/\bremember\b/iu.test(source)) {
    throw new ToolRefusal('I will not save banking or health details unless Dan explicitly says “remember”. Nothing was written.');
  }
}

export function createVaultModule(options: {
  readonly client: ReturnType<typeof createGitHubVaultClient>;
  readonly indexStore: VaultIndexStore;
  readonly memoryStore: Pick<MemoryStore, 'getSourceMessage'>;
  readonly embedder?: MemoryEmbedder;
  readonly log?: (event: 'vault.index' | 'vault.write', fields: VaultLogFields) => void;
}): VaultModule {
  const log = options.log ?? (() => {});
  let routingRules: Promise<{
    readonly text: string;
    readonly folders: ReadonlySet<string>;
  }> | undefined;
  let synchronization: Promise<{ readonly added: number; readonly changed: number; readonly removed: number }> | undefined;
  let indexStatus: 'pending' | 'ready' | 'failed' = 'pending';
  let appMissing = false;

  async function loadRoutingRules(signal: AbortSignal): Promise<{
    readonly text: string;
    readonly folders: ReadonlySet<string>;
  }> {
    if (!routingRules) {
      routingRules = (async () => {
        const tree = await options.client.tree(signal);
        const instructionPaths = tree.map(({ path }) => path)
          .filter((path) => /^\.github\/instructions\/[^/]+\.instructions\.md$/iu.test(path))
          .slice(0, maxInstructionFiles);
        if (tree.filter(({ path }) => /^\.github\/instructions\/[^/]+\.instructions\.md$/iu.test(path)).length >
            maxInstructionFiles) {
          throw new Error('Vault has too many instruction files');
        }
        const requiredPaths = ['AGENTS.md', '.github/agent-state/routing.md'];
        const files = await Promise.all([...requiredPaths, ...instructionPaths]
          .map((path) => options.client.read(path, signal)));
        const base = files.slice(0, requiredPaths.length);
        if (base.some((file) => !file)) throw new Error('Vault routing instructions are unavailable');
        const sections = base.map((file) => file!.content);
        for (const file of files.slice(requiredPaths.length)) {
          if (file && notesInstruction(file.path, file.content)) sections.push(file.content);
        }
        const combined = sections.join('\n\n');
        if (Buffer.byteLength(combined, 'utf8') > maxRoutingBytes) {
          throw new Error('Vault routing instructions exceed the supported size');
        }
        return {
          text: combined,
          folders: new Set([...folderNames].filter((folder) => new RegExp(`\\b${folder}\\b`, 'u').test(combined))),
        };
      })();
    }
    return routingRules;
  }

  async function makeChunks(file: VaultFile, signal: AbortSignal): Promise<VaultIndexedChunk[]> {
    const sections = chunkMarkdown(file.content);
    if (sections.length > maxVaultChunks) throw new Error('Vault note has too many index chunks');
    const chunks: VaultIndexedChunk[] = [];
    for (const [index, section] of sections.entries()) {
      const embedding = options.embedder
        ? await options.embedder.embed(`${section.heading}\n${section.content}`, signal).catch((error: unknown) => {
          if (signal.aborted) throw error;
          return null;
        })
        : null;
      chunks.push({ index, ...section, embedding });
    }
    return chunks;
  }

  async function performSynchronization(signal: AbortSignal) {
    const tree = await options.client.tree(signal);
    const markdown = tree.filter(({ path }) => eligibleMarkdown(path));
    if (markdown.length > maxMarkdownFiles) throw new Error('Vault has too many Markdown notes to index');
    const indexed = await options.indexStore.files(signal);
    if (indexed.length > maxMarkdownFiles) throw new Error('Vault index exceeds the supported size');
    const oldByPath = new Map(indexed.map((file) => [file.path, file.blobSha]));
    const newPaths = new Set(markdown.map(({ path }) => path));
    const remove = indexed.filter(({ path }) => !newPaths.has(path)).map(({ path }) => path);
    let added = 0;
    let changed = 0;
    const touchedFolders = new Set<string>();

    for (const file of markdown) {
      if (oldByPath.get(file.path) === file.sha) continue;
      let note: VaultFile | null;
      try {
        note = await options.client.read(file.path, signal);
      } catch (error) {
        if (error instanceof Error &&
            (error.message === 'GitHub file content is not a bounded text note' ||
             error.message === 'GitHub file content is not valid UTF-8')) {
          remove.push(file.path);
          continue;
        }
        throw error;
      }
      if (!note) {
        remove.push(file.path);
        continue;
      }
      const chunks = await makeChunks(note, signal);
      await options.indexStore.replaceFile(note.path, note.sha, chunks, signal);
      if (oldByPath.has(note.path)) changed += 1;
      else added += 1;
      const folder = safeFolder(note.path);
      if (folder) touchedFolders.add(folder);
    }

    const deleted = [...new Set(remove)];
    await options.indexStore.deleteFiles(deleted, signal);
    for (const path of deleted) {
      const folder = safeFolder(path);
      if (folder) touchedFolders.add(folder);
    }
    const summary = { added, changed, removed: deleted.length };
    log('vault.index', {
      outcome: 'ok', ...summary, folders: [...touchedFolders].sort(),
    });
    return summary;
  }

  function synchronize(signal: AbortSignal) {
    synchronization ??= performSynchronization(signal)
      .then((summary) => {
        indexStatus = 'ready';
        appMissing = false;
        return summary;
      })
      .catch((error: unknown) => {
        indexStatus = 'failed';
        appMissing = error instanceof VaultAppNotInstalledError;
        throw error;
      })
      .finally(() => { synchronization = undefined; });
    return synchronization;
  }

  async function checkSource(request: FastifyRequest, content: string, reason: string, signal: AbortSignal) {
    if (!request.principal && !request.agentPrincipal) throw new ToolRefusal('Vault access is not authorized.');
    const header = request.headers['x-jarvis-message-id'];
    if (typeof header !== 'string' || !sourceMessagePattern.test(header) || BigInt(header) > maxSqlMessageId) {
      throw new ToolRefusal('There is no stored Dan message to verify this capture. Nothing was written.');
    }
    const source = await options.memoryStore.getSourceMessage(header, signal);
    if (!source) throw new ToolRefusal('The source message is missing or is not from Dan. Nothing was written.');
    assertCaptureIsSafe(source.text, `${content}\n${reason}`);
    return source;
  }

  async function write(path: string, value: {
    readonly content?: string;
    readonly append?: string;
    readonly reason: string;
  }, source: string, signal: AbortSignal): Promise<{ path: string; commit: string }> {
    const rules = await loadRoutingRules(signal);
    if (!rules.folders.has(safeFolder(path) ?? '')) {
      throw new ToolRefusal('That folder is not allowed by the vault routing rules. Nothing was written.');
    }
    let current = await options.client.read(path, signal);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const next = value.content !== undefined
        ? value.content
        : `${current?.content ?? ''}${current?.content && !current.content.endsWith('\n') ? '\n' : ''}${value.append ?? ''}`;
      if (Buffer.byteLength(next, 'utf8') > MAX_VAULT_FILE_BYTES) {
        throw new ToolRefusal('Vault notes are limited to 256 KB per write. Nothing was written.');
      }
      assertCaptureIsSafe(source, `${next}\n${value.reason}`);
      try {
        const sha = await options.client.write(
          path,
          next,
          `jarvis: ${value.reason}\n\nCo-authored-by: Jarvis`,
          current?.sha,
          signal,
        );
        return { path, commit: sha };
      } catch (error) {
        if (!(error instanceof VaultWriteConflictError) || attempt === 1) throw error;
        current = await options.client.read(path, signal);
      }
    }
    throw new Error('Vault write did not complete');
  }

  const tools = [
    {
      name: 'vault_search',
      description: "Search Dan's indexed GitHub vault notes by meaning. Return paths, headings, short snippets and source links; use returned evidence only.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: maxQueryLength, pattern: '\\S' },
          k: { type: 'integer', minimum: 1, maximum: maxSearchResults },
        },
        required: ['query'],
        additionalProperties: false,
      },
      sensitive: true,
      execute: async (value: unknown, _request: FastifyRequest, signal: AbortSignal) => {
        if (indexStatus !== 'ready') {
          throw new ToolFailure(appMissing
            ? 'The GitHub App is not installed on DanAakesen/vault with Contents read/write access.'
            : 'The vault index is not ready. Please try again after synchronization finishes.');
        }
        if (!isRecord(value) || Object.keys(value).some((key) => key !== 'query' && key !== 'k') ||
            typeof value.query !== 'string' || !value.query.trim() || value.query.length > maxQueryLength ||
            (value.k !== undefined && (!Number.isInteger(value.k) || Number(value.k) < 1 ||
              Number(value.k) > maxSearchResults))) {
          throw new ToolRefusal('Vault search query or result count is invalid.');
        }
        const query = value.query.trim();
        const limit = value.k === undefined ? 5 : Number(value.k);
        let hits: Awaited<ReturnType<VaultIndexStore['searchByVector']>> = [];
        if (options.indexStore.supportsVectorSearch() && options.embedder) {
          let embedding: readonly number[] | undefined;
          try {
            embedding = await options.embedder.embed(query, signal);
          } catch (error) {
            if (signal.aborted) throw error;
          }
          if (embedding) {
            try {
              hits = await options.indexStore.searchByVector(embedding, limit, signal);
            } catch (error) {
              if (!(error instanceof VectorSearchUnavailableError)) {
                if (signal.aborted) throw error;
                throw new ToolFailure('Vault search is temporarily unavailable.');
              }
            }
          }
        }
        if (hits.length === 0) {
          hits = await options.indexStore.searchByTerms(queryTerms(query), limit, signal);
        }
        return {
          results: hits.map((hit) => ({
            path: hit.path,
            heading: hit.heading,
            snippet: snippet(hit.content),
            url: noteUrl(hit.path),
          })),
          count: hits.length,
          confirmation: hits.length
            ? `Found ${hits.length} vault note${hits.length === 1 ? '' : 's'}.`
            : 'No vault notes matched that search.',
        };
      },
    },
    {
      name: 'vault_read',
      description: 'Read one bounded Markdown note from Dan’s GitHub vault. Use vault_search first when the path is unknown.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', minLength: 1, maxLength: maxPathLength } },
        required: ['path'],
        additionalProperties: false,
      },
      sensitive: true,
      execute: async (value: unknown, _request: FastifyRequest, signal: AbortSignal) => {
        if (!isRecord(value)) throw new ToolRefusal('The vault path is invalid.');
        const path = validatePath(value.path, false);
        let note: VaultFile | null;
        try {
          note = await options.client.read(path, signal);
        } catch (error) {
          if (error instanceof VaultAppNotInstalledError) {
            throw new ToolFailure('The GitHub App is not installed on DanAakesen/vault with Contents read/write access.');
          }
          throw new ToolFailure('Vault read is temporarily unavailable.');
        }
        if (!note) throw new ToolRefusal('That vault note does not exist.');
        return {
          path,
          content: note.content,
          url: noteUrl(path),
          confirmation: `Read vault note: ${path}.`,
        };
      },
    },
    {
      name: 'vault_write',
      description: 'Create, append to, or update one vault Markdown note. Read and follow AGENTS.md, .github/agent-state/routing.md and relevant .github/instructions/*.instructions.md. Use People/, Work/, Personal/ or General/. Never store secrets or credentials. The write is committed to master.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, maxLength: maxPathLength },
          content: { type: 'string', minLength: 1, maxLength: MAX_VAULT_FILE_BYTES },
          append: { type: 'string', minLength: 1, maxLength: MAX_VAULT_FILE_BYTES },
          reason: { type: 'string', minLength: 1, maxLength: maxReasonLength },
        },
        required: ['path', 'reason'],
        additionalProperties: false,
      },
      sensitive: true,
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        if (!isRecord(value) || Object.keys(value).some((key) =>
          !['path', 'content', 'append', 'reason'].includes(key))) {
          throw new ToolRefusal('The vault write request is invalid. Nothing was written.');
        }
        const path = validatePath(value.path);
        const folder = safeFolder(path);
        const logWrite = (outcome: VaultLogFields['outcome']) =>
          log('vault.write', { outcome, ...(folder ? { folder } : {}) });
        if ((value.content === undefined) === (value.append === undefined)) {
          throw new ToolRefusal('Provide exactly one of content or append. Nothing was written.');
        }
        const content = validateText(value.content ?? value.append, 'content', MAX_VAULT_FILE_BYTES);
        const reason = validateText(value.reason, 'reason', maxReasonLength);
        if (hasControlCharacters(reason)) {
          throw new ToolRefusal('The vault write reason must be one line. Nothing was written.');
        }
        let source: Awaited<ReturnType<typeof checkSource>>;
        try {
          source = await checkSource(request, content, reason, signal);
        } catch (error) {
          logWrite(error instanceof ToolRefusal ? 'refused' : 'error');
          throw error;
        }
        let result: { path: string; commit: string };
        try {
          result = await write(path, {
            reason,
            ...(value.content === undefined ? { append: content } : { content }),
          }, source.text, signal);
        } catch (error) {
          if (error instanceof ToolRefusal) {
            logWrite('refused');
            throw error;
          }
          if (error instanceof VaultAppNotInstalledError) {
            logWrite('error');
            throw new ToolFailure('The GitHub App is not installed on DanAakesen/vault with Contents read/write access.');
          }
          if (error instanceof VaultWriteConflictError) {
            logWrite('error');
            throw new ToolFailure('The note changed again while writing. Nothing was committed; retry the request.');
          }
          logWrite('error');
          throw new ToolFailure('Vault write failed. Nothing was reported as saved.');
        }
        const url = commitUrl(result.commit);
        const confirmation = `Saved to vault: ${result.path} — ${url}`;
        logWrite('ok');
        return { ...result, url, confirmation };
      },
    },
  ] as const;

  return {
    id: 'vault',
    tools,
    synchronize,
    registerRoutes: async () => {},
  };
}

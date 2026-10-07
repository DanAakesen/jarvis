import type { FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import {
  VectorSearchUnavailableError,
  type MemoryStore,
  type MemoryRecord,
  type MemoryVersion,
  type VaultGraphData,
  type VaultIndexStore,
  vaultSimilarityThreshold,
  type VaultIndexedChunk,
  type VaultSearchHit,
} from '../database/memory-store.js';
import { isGeneratedView, type WorkspaceCommand } from '@jarvis/contracts';
import type { MemoryEmbedder } from '../core/memory-embeddings.js';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import type { BackendModule } from '../modules.js';
import type { TeamsNotificationService } from '../teams/service.js';
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
const maxMemoryApiResults = 50;
const maxMemoryApiOffset = 10_000;
const maxMemoryApiHistory = 10;
const maxMemoryApiHistoryBytes = 512 * 1024;
const maxGraphNodes = 2_000;
const maxGraphEdges = 8_000;
const maxLinksPerNote = 512;
const similarityThreshold = vaultSimilarityThreshold;
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

interface MemoryApiItem {
  readonly id: string;
  readonly type: 'memory' | 'vault_note';
  readonly folder: string;
  readonly title: string;
  readonly snippet: string;
  readonly updatedAt: string;
  readonly source: { readonly type: 'conversation' | 'github'; readonly url: string; readonly messageId?: string };
  readonly path?: string;
}

interface VaultIndexOutcome {
  readonly outcome: 'pending' | 'ok' | 'error';
  readonly at: string;
  readonly added?: number;
  readonly changed?: number;
  readonly removed?: number;
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

function isRoutedNotePath(path: string): boolean {
  try {
    return safeFolder(validatePath(path)) !== undefined && !shouldRedact(path);
  } catch {
    return false;
  }
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

function vaultItemId(path: string): string {
  return `vault_${Buffer.from(path, 'utf8').toString('base64url')}`;
}

function vaultPathFromId(id: string): string | undefined {
  if (!/^vault_[A-Za-z0-9_-]{1,256}$/u.test(id)) return undefined;
  try {
    const encoded = id.slice('vault_'.length);
    const path = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'));
    if (Buffer.from(path, 'utf8').toString('base64url') !== encoded) return undefined;
    return isRoutedNotePath(path) ? validatePath(path) : undefined;
  } catch {
    return undefined;
  }
}

function conversationUrl(messageId: string): string {
  return `/conversation/history?before=${BigInt(messageId) + 1n}&limit=100`;
}

function memoryApiItem(record: MemoryRecord): MemoryApiItem {
  const redacted = shouldRedact(`${record.key}\n${record.content}`);
  return {
    id: record.id,
    type: 'memory',
    folder: 'General',
    title: redacted ? '[redacted]' : record.key,
    snippet: redacted ? '[redacted]' : snippet(record.content),
    updatedAt: record.updatedAt.toISOString(),
    source: {
      type: 'conversation',
      messageId: record.sourceMessageId,
      url: conversationUrl(record.sourceMessageId),
    },
  };
}

function memoryHistoryItem(version: MemoryVersion) {
  const redacted = shouldRedact(`${version.key}\n${version.content}`);
  return {
    id: version.id,
    category: version.category,
    key: redacted ? '[redacted]' : version.key,
    content: redacted ? '[redacted]' : version.content,
    revision: version.revision,
    changedAt: version.changedAt.toISOString(),
    source: {
      type: 'conversation' as const,
      messageId: version.sourceMessageId,
      url: conversationUrl(version.sourceMessageId),
    },
  };
}

function vaultApiItem(path: string, content: string, updatedAt: Date): MemoryApiItem {
  const redacted = shouldRedact(content);
  const filename = path.slice(path.lastIndexOf('/') + 1);
  return {
    id: vaultItemId(path),
    type: 'vault_note',
    path,
    folder: safeFolder(path) ?? 'General',
    title: redacted ? '[redacted]' : filename.replace(/\.md$/iu, ''),
    snippet: redacted ? '[redacted]' : snippet(content),
    updatedAt: updatedAt.toISOString(),
    source: { type: 'github', url: noteUrl(path) },
  };
}

function shouldRedact(value: string): boolean {
  return credentialPattern.test(value) || secretPattern.test(value);
}

function queryTerms(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]{2,}/gu)?.map((term) => term.toLowerCase()) ?? [])].slice(0, 12);
}

function memorySearchTerms(value: string): string[] {
  return [...new Set(value.match(/[\p{L}\p{N}]{2,}/gu)?.map((term) => term.toLowerCase()) ?? [])].slice(0, 8);
}

function graphNodeId(path: string): string {
  return createHash('sha256').update(path, 'utf8').digest('hex');
}

function extractLinkTargets(content: string): string[] {
  const targets = new Set<string>();
  const add = (target: string | undefined) => {
    if (!target) return;
    const cleaned = target.trim().replace(/^<|>$/gu, '').split(/[|#]/u, 1)[0]?.trim();
    if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) return;
    let decoded: string;
    try {
      if (/^[a-z][a-z\d+.-]*:/iu.test(cleaned)) {
        const url = new URL(cleaned);
        const prefix = `/${VAULT_REPOSITORY}/blob/${VAULT_BRANCH}/`;
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(prefix)) return;
        decoded = decodeURIComponent(url.pathname.slice(prefix.length));
      } else {
        decoded = decodeURIComponent(cleaned);
      }
    } catch {
      return;
    }
    if (decoded.length <= maxPathLength && !decoded.includes('\\') && !hasControlCharacters(decoded)) {
      targets.add(decoded);
    }
  };

  for (const match of content.matchAll(/\[\[([^\]]+)\]\]/gu)) {
    add(match[1]);
  }
  for (const match of content.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/gu)) {
    add(match[1] ?? match[2]);
  }
  return [...targets].slice(0, maxLinksPerNote);
}

function resolveLinkTarget(sourcePath: string, rawTarget: string, paths: ReadonlySet<string>): string | undefined {
  let target = rawTarget.replace(/[?#].*$/u, '').replace(/^\/+/u, '');
  if (!target || target.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(target) || target.includes('\\')) return undefined;
  if (!target.toLowerCase().endsWith('.md')) target += '.md';
  const candidates = [target, posix.normalize(posix.join(posix.dirname(sourcePath), target))]
    .filter((candidate) => candidate !== '.' && !candidate.startsWith('../') && !candidate.startsWith('/'));
  for (const candidate of candidates) if (paths.has(candidate)) return candidate;
  if (!target.includes('/')) {
    const matches = [...paths].filter((path) => posix.basename(path).toLowerCase() === target.toLowerCase());
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

interface KnowledgeGraphNode {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly folder: 'People' | 'Work' | 'Personal' | 'General';
  readonly updatedAt: string;
  readonly degree: number;
}

interface KnowledgeGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly type: 'link' | 'similar';
  readonly score?: number;
}

interface KnowledgeGraph {
  readonly nodes: readonly KnowledgeGraphNode[];
  readonly edges: readonly KnowledgeGraphEdge[];
  readonly updatedAt: string;
}

function meanVectors(rows: VaultGraphData['embeddings']): Map<string, number[]> {
  const sums = new Map<string, { values: number[]; count: number }>();
  for (const { path, embedding } of rows) {
    const current = sums.get(path);
    if (!current) sums.set(path, { values: [...embedding], count: 1 });
    else if (current.values.length === embedding.length) {
      for (let index = 0; index < embedding.length; index += 1) {
        current.values[index] = current.values[index]! + embedding[index]!;
      }
      current.count += 1;
    }
  }
  return new Map([...sums].map(([path, { values, count }]) =>
    [path, values.map((value) => value / count)]));
}

const textSimilarityThreshold = 0.12;
const stopWords = new Set(('the and for are but not you all any can had her was one our out has have this that with from they will ' +
  'what when which their there been were into more than then them these those your about would could should also just ' +
  'like some such only over very after before here where while each other most much many make made being does done ' +
  'og det den der som til med for har ikke var jeg vil kan skal fra men eller hvis ved paa').split(' '));

/** TF-IDF vectors of note text: the similarity fallback when the database stores no embeddings. */
function textVectors(contents: NonNullable<VaultGraphData['contents']>): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const { path, content } of contents) {
    const terms = counts.get(path) ?? new Map<string, number>();
    const text = content.toLowerCase().replace(/\[\[[^\]]*\]\]|\]\([^)]*\)|https?:\/\/\S+/gu, ' ');
    for (const word of text.match(/\p{L}[\p{L}\p{N}]{2,}/gu) ?? []) {
      if (!stopWords.has(word)) terms.set(word, (terms.get(word) ?? 0) + 1);
    }
    counts.set(path, terms);
  }
  const documentFrequency = new Map<string, number>();
  for (const terms of counts.values()) {
    for (const term of terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const notes = counts.size;
  const vectors = new Map<string, Map<string, number>>();
  for (const [path, terms] of counts) {
    const weighted = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of terms) {
      const frequency = documentFrequency.get(term)!;
      if (frequency < 2 || frequency > notes * 0.5) continue;
      const weight = (1 + Math.log(count)) * Math.log(notes / frequency);
      weighted.set(term, weight);
      norm += weight * weight;
    }
    if (norm === 0) continue;
    const length = Math.sqrt(norm);
    for (const [term, weight] of weighted) weighted.set(term, weight / length);
    vectors.set(path, weighted);
  }
  return vectors;
}

function sparseCosine(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): number {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  for (const [term, weight] of small) dot += weight * (large.get(term) ?? 0);
  return dot;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length === 0 || left.length !== right.length) return undefined;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return undefined;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
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
  readonly apiMemoryStore?: MemoryStore;
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
  let lastVaultSyncAt: string | null = null;
  let lastIndexOutcome: VaultIndexOutcome = { outcome: 'pending', at: new Date().toISOString() };
  const pendingVaultDeletions = new Set<string>();
  let graphCache: Promise<KnowledgeGraph> | undefined;

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
      await options.indexStore.replaceFile(note.path, note.sha, chunks, extractLinkTargets(note.content), signal);
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
        lastVaultSyncAt = new Date().toISOString();
        lastIndexOutcome = { outcome: 'ok', at: lastVaultSyncAt, ...summary };
        graphCache = undefined;
        return summary;
      })
      .catch((error: unknown) => {
        indexStatus = 'failed';
        appMissing = error instanceof VaultAppNotInstalledError;
        lastVaultSyncAt = new Date().toISOString();
        lastIndexOutcome = { outcome: 'error', at: lastVaultSyncAt };
        throw error;
      })
      .finally(() => { synchronization = undefined; });
    return synchronization;
  }

  async function buildKnowledgeGraph(signal: AbortSignal): Promise<KnowledgeGraph> {
    const files = (await options.indexStore.graphFiles(signal))
      .filter(({ path }) => isRoutedNotePath(path))
      .slice(0, maxGraphNodes);
    const paths = files.map(({ path }) => path);
    const pathSet = new Set(paths);
    const graphData = await options.indexStore.graphData(paths, signal);
    const ids = new Map(paths.map((path) => [path, graphNodeId(path)]));
    const nodes: KnowledgeGraphNode[] = files.flatMap((file) => {
      const folder = safeFolder(file.path);
      if (!folder) return [];
      const filename = posix.basename(file.path).replace(/\.md$/iu, '').replace(/[-_]/gu, ' ');
      const heading = file.title.trim();
      const title = heading && heading !== 'Introduction' ? heading.split(' > ', 1)[0]! : filename;
      return [{
        id: ids.get(file.path)!,
        path: file.path,
        title: title.slice(0, 200),
        folder: folder as KnowledgeGraphNode['folder'],
        updatedAt: file.updatedAt.toISOString(),
        degree: 0,
      }];
    });
    const links: KnowledgeGraphEdge[] = [];
    const seenLinks = new Set<string>();
    const contentLinks = (graphData.contents ?? []).flatMap(({ path, content }) =>
      extractLinkTargets(content).map((targetPath) => ({ sourcePath: path, targetPath })));
    for (const link of [...graphData.links, ...contentLinks]) {
      if (!pathSet.has(link.sourcePath)) continue;
      const target = resolveLinkTarget(link.sourcePath, link.targetPath, pathSet);
      if (!target || target === link.sourcePath) continue;
      const sourceId = ids.get(link.sourcePath)!;
      const targetId = ids.get(target)!;
      const key = `${sourceId}:${targetId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: sourceId, target: targetId, type: 'link' });
    }
    const vectors = meanVectors(graphData.embeddings);
    const similarities: KnowledgeGraphEdge[] = [];
    if (graphData.similarities.length > 0) {
      for (const edge of graphData.similarities) {
        if (!pathSet.has(edge.sourcePath) || !pathSet.has(edge.targetPath) ||
            edge.sourcePath === edge.targetPath || edge.score <= similarityThreshold) continue;
        similarities.push({
          source: ids.get(edge.sourcePath)!,
          target: ids.get(edge.targetPath)!,
          type: 'similar',
          score: Math.max(-1, Math.min(1, edge.score)),
        });
      }
    } else if (vectors.size === 0) {
      const textual = textVectors(graphData.contents ?? []);
      for (const source of paths) {
        const sourceVector = textual.get(source);
        if (!sourceVector) continue;
        const neighbours = paths.flatMap((target) => {
          const targetVector = target === source ? undefined : textual.get(target);
          if (!targetVector) return [];
          const score = sparseCosine(sourceVector, targetVector);
          return score > textSimilarityThreshold ? [{ target, score }] : [];
        }).sort((left, right) => right.score - left.score || left.target.localeCompare(right.target))
          .slice(0, 3);
        for (const neighbour of neighbours) {
          similarities.push({
            source: ids.get(source)!,
            target: ids.get(neighbour.target)!,
            type: 'similar',
            score: Math.round(neighbour.score * 1000) / 1000,
          });
        }
      }
    } else {
      for (const source of paths) {
        const sourceVector = vectors.get(source);
        if (!sourceVector) continue;
        const neighbours = paths.flatMap((target) => {
          if (target === source) return [];
          const targetVector = vectors.get(target);
          if (!targetVector) return [];
          const score = cosineSimilarity(sourceVector, targetVector);
          return score !== undefined && score > similarityThreshold ? [{ target, score }] : [];
        }).sort((left, right) => right.score - left.score || left.target.localeCompare(right.target))
          .slice(0, 3);
        for (const neighbour of neighbours) {
          similarities.push({
            source: ids.get(source)!,
            target: ids.get(neighbour.target)!,
            type: 'similar',
            score: neighbour.score,
          });
        }
      }
    }
    const edges = [...links.slice(0, 2_000), ...similarities.slice(0, maxGraphEdges - 2_000)];
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    return {
      nodes: nodes.map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 })),
      edges,
      updatedAt: lastVaultSyncAt ?? new Date().toISOString(),
    };
  }

  async function knowledgeGraph(signal: AbortSignal): Promise<KnowledgeGraph> {
    if (graphCache) return graphCache;
    if (synchronization) await synchronization;
    if (indexStatus !== 'ready') {
      throw new ToolFailure(appMissing
        ? 'The GitHub App is not installed on DanAakesen/vault with Contents read/write access.'
        : 'The vault index is not ready. Please try again after synchronization finishes.');
    }
    const pending = buildKnowledgeGraph(signal);
    graphCache = pending;
    try {
      return await pending;
    } catch (error) {
      if (graphCache === pending) graphCache = undefined;
      throw error;
    }
  }

  async function searchVault(query: string, limit: number, signal: AbortSignal): Promise<VaultSearchHit[]> {
    if (synchronization) throw new ToolFailure('The vault is synchronizing. Please try again shortly.');
    if (indexStatus !== 'ready') {
      throw new ToolFailure(appMissing
        ? 'The GitHub App is not installed on DanAakesen/vault with Contents read/write access.'
        : 'The vault index is not ready. Please try again after synchronization finishes.');
    }
    let hits: VaultSearchHit[] = [];
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
    if (hits.length === 0) hits = await options.indexStore.searchByTerms(queryTerms(query), limit, signal);
    return hits;
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
  }, source: string, signal: AbortSignal, requireExisting = false): Promise<{ path: string; commit: string }> {
    const rules = await loadRoutingRules(signal);
    if (!rules.folders.has(safeFolder(path) ?? '')) {
      throw new ToolRefusal('That folder is not allowed by the vault routing rules. Nothing was written.');
    }
    let current = await options.client.read(path, signal);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (requireExisting && !current) throw new ToolRefusal('The vault note no longer exists. Nothing was written.');
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
        if (!isRecord(value) || Object.keys(value).some((key) => key !== 'query' && key !== 'k') ||
            typeof value.query !== 'string' || !value.query.trim() || value.query.length > maxQueryLength ||
            (value.k !== undefined && (!Number.isInteger(value.k) || Number(value.k) < 1 ||
              Number(value.k) > maxSearchResults))) {
          throw new ToolRefusal('Vault search query or result count is invalid.');
        }
        const query = value.query.trim();
        const limit = value.k === undefined ? 5 : Number(value.k);
        const hits = await searchVault(query, limit, signal);
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
      name: 'show_knowledge',
      description: 'Search Dan’s vault and open or focus the knowledge graph on matching notes.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1, maxLength: maxQueryLength, pattern: '\\S' } },
        required: ['query'],
        additionalProperties: false,
      },
      sensitive: true,
      execute: async (value: unknown, request: FastifyRequest, signal: AbortSignal) => {
        if (!isRecord(value) || Object.keys(value).some((key) => key !== 'query') ||
              typeof value.query !== 'string' || !value.query.trim() || value.query.length > maxQueryLength) {
            throw new ToolRefusal('Knowledge search query is invalid.');
        }
        const query = value.query.trim();
        const graph = await knowledgeGraph(signal);
        const hits = await searchVault(query, maxSearchResults, signal);
        const byPath = new Map(graph.nodes.map((node) => [node.path, node]));
        const highlight = [...new Set(hits.flatMap((hit) => {
            const node = byPath.get(hit.path);
            return node ? [node.id] : [];
        }))].slice(0, maxSearchResults);
        const view = {
            version: 1 as const,
            title: 'Knowledge graph',
            renderer: 'knowledge-graph' as const,
            source: { id: 'knowledge_graph' as const, status: 'complete' as const, updatedAt: graph.updatedAt },
            data: { query, highlight },
        };
        if (!isGeneratedView(view)) throw new ToolFailure('The knowledge graph view is invalid.');
        const existing = request.server.workspaceCommands.snapshot(request.server.ownerObjectId)
            ?.windows.some((window) => window.viewId === 'knowledge-graph') ?? false;
        const command: WorkspaceCommand = {
            commandId: randomUUID(),
            operation: existing ? 'update' : 'create',
            viewId: 'knowledge-graph',
            view,
        };
        await request.server.workspaceCommands.execute(request.server.ownerObjectId, command, signal);
        await request.server.workspaceCommands.execute(request.server.ownerObjectId, {
          commandId: randomUUID(),
          operation: 'focus',
          viewId: 'knowledge-graph',
        }, signal);
        const summary = hits.length > 0
          ? `Found ${hits.length} vault match${hits.length === 1 ? '' : 'es'}; top hit: ${hits[0]!.path} — ${snippet(hits[0]!.content)}`
          : `No vault notes matched “${query}”.`;
        return { type: 'generated-view', view, summary, confirmation: summary };
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
    registerRoutes: async (app) => {
      const ownerOnly = (request: FastifyRequest, reply: import('fastify').FastifyReply): boolean => {
        if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
          void reply.code(403).send({ error: 'Forbidden' });
          return false;
        }
        reply.header('Cache-Control', 'no-store');
        return true;
      };
      const apiStore = (reply: import('fastify').FastifyReply): MemoryStore | undefined => {
        if (!options.apiMemoryStore) {
          void reply.code(503).send({ error: 'Memory storage unavailable' });
          return undefined;
        }
        return options.apiMemoryStore;
      };
      const apiQuerySchema = {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: maxQueryLength, pattern: '\\S' },
          folder: { type: 'string', enum: [...folderNames] },
          limit: { type: 'integer', minimum: 1, maximum: maxMemoryApiResults },
          offset: { type: 'integer', minimum: 0, maximum: maxMemoryApiOffset },
        },
        additionalProperties: false,
      };
      const apiError = {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
        additionalProperties: false,
      };
      const graphResponseSchema = {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            maxItems: maxGraphNodes,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                path: { type: 'string', minLength: 1, maxLength: 180 },
                title: { type: 'string', minLength: 1, maxLength: 200 },
                folder: { type: 'string', enum: [...folderNames] },
                updatedAt: { type: 'string', format: 'date-time' },
                degree: { type: 'integer', minimum: 0, maximum: maxGraphEdges * 2 },
              },
              required: ['id', 'path', 'title', 'folder', 'updatedAt', 'degree'],
              additionalProperties: false,
            },
          },
          edges: {
            type: 'array',
            maxItems: maxGraphEdges,
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                target: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                type: { type: 'string', enum: ['link', 'similar'] },
                score: { type: 'number', minimum: -1, maximum: 1 },
              },
              required: ['source', 'target', 'type'],
              additionalProperties: false,
            },
          },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['nodes', 'edges', 'updatedAt'],
        additionalProperties: false,
      };
      const graphQuerySchema = {
        type: 'object',
        properties: { q: { type: 'string', minLength: 1, maxLength: maxQueryLength, pattern: '\\S' } },
        required: ['q'],
        additionalProperties: false,
      };

      app.get('/knowledge/graph', {
        schema: { response: { 200: graphResponseSchema, 403: apiError, 503: apiError } },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        if (indexStatus !== 'ready') return reply.code(503).send({ error: 'Vault index is not ready' });
        try {
          return await knowledgeGraph(AbortSignal.timeout(30_000));
        } catch (error) {
          if (error instanceof ToolFailure) return reply.code(503).send({ error: error.message });
          throw error;
        }
      });

      app.get<{ Querystring: { q: string } }>('/knowledge/search', {
        schema: { querystring: graphQuerySchema, response: { 200: {
          type: 'object',
          properties: {
            hits: {
              type: 'array',
              maxItems: maxSearchResults,
              items: {
                type: 'object',
                properties: {
                  nodeId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                  score: { type: 'number', minimum: -1, maximum: 1 },
                  snippet: { type: 'string', maxLength: maxSnippetLength },
                },
                required: ['nodeId', 'score', 'snippet'],
                additionalProperties: false,
              },
            },
          },
          required: ['hits'],
          additionalProperties: false,
        }, 400: apiError, 403: apiError, 503: apiError } },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        if (indexStatus !== 'ready') return reply.code(503).send({ error: 'Vault index is not ready' });
        const signal = AbortSignal.timeout(30_000);
        try {
          const graph = await knowledgeGraph(signal);
          const nodeByPath = new Map(graph.nodes.map((node) => [node.path, node]));
          const ranked = await searchVault(request.query.q.trim(), maxSearchResults, signal);
          const seen = new Set<string>();
          const hits = ranked.flatMap((hit, index) => {
            const node = nodeByPath.get(hit.path);
            if (!node || seen.has(node.id)) return [];
            seen.add(node.id);
            const score = Number.isFinite(hit.score)
              ? Math.max(-1, Math.min(1, hit.score!))
              : Math.max(0, 1 - index / maxSearchResults);
            return [{ nodeId: node.id, score, snippet: snippet(hit.content) }];
          }).slice(0, maxSearchResults);
          return { hits };
        } catch (error) {
          if (error instanceof ToolFailure) return reply.code(503).send({ error: error.message });
          throw error;
        }
      });

      app.get('/memory/status', async (request, reply) => {
        if (!ownerOnly(request, reply) || !apiStore(reply)) return;
        const counts: Record<string, number> = Object.fromEntries([...folderNames].map((folder) => [folder, 0]));
        for (const file of await options.indexStore.files(AbortSignal.timeout(10_000))) {
          const folder = isRoutedNotePath(file.path) ? safeFolder(file.path) : undefined;
          if (folder) counts[folder] = (counts[folder] ?? 0) + 1;
        }
        return {
          lastVaultSyncAt,
          notesByFolder: counts,
          lastIndexOutcome,
        };
      });

      app.get<{
        Querystring: { query?: string; folder?: string; limit?: number; offset?: number };
      }>('/memory', {
        schema: { querystring: apiQuerySchema, response: { 400: apiError, 403: apiError, 503: apiError } },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply)) return;
        const store = apiStore(reply);
        if (!store) return;
        const { query, folder } = request.query;
        const limit = request.query.limit ?? 25;
        const offset = request.query.offset ?? 0;
        const signal = AbortSignal.timeout(30_000);
        const fetchLimit = Math.min(maxMemoryApiOffset + maxMemoryApiResults + 1, offset + limit + 1);
        let memories: MemoryRecord[] = [];
        let vaultHits: Array<{ path: string; content: string }> = [];
        let searchMethod: 'vector' | 'fulltext' | 'substring' | undefined;

        if (query !== undefined) {
          const terms = memorySearchTerms(query);
          if (terms.length > 0) {
            let embedding: readonly number[] | undefined;
            if (options.embedder &&
                (store.supportsVectorSearch() || options.indexStore.supportsVectorSearch())) {
              try {
                embedding = await options.embedder.embed(query, signal);
              } catch (error) {
                if (signal.aborted) throw error;
              }
            }
            if (embedding) {
              try {
                memories = await store.searchByVector(embedding, fetchLimit, signal);
                if (memories.length > 0) searchMethod = 'vector';
              } catch (error) {
                if (!(error instanceof VectorSearchUnavailableError)) throw error;
              }
            }
            if (memories.length === 0) {
              const result = await store.searchByFullText(terms, fetchLimit, signal);
              memories = result.memories;
              searchMethod = result.method;
            }
            if (indexStatus !== 'ready') {
              return reply.code(503).send({ error: 'Vault index is not ready' });
            }
            if (embedding && options.indexStore.supportsVectorSearch()) {
              try {
                vaultHits = await options.indexStore.searchByVector(embedding, fetchLimit, signal);
              } catch (error) {
                if (!(error instanceof VectorSearchUnavailableError)) throw error;
              }
            }
            if (vaultHits.length === 0) {
              vaultHits = await options.indexStore.searchByTerms(queryTerms(query), fetchLimit, signal);
            }
          }
        } else {
          const page = await store.list(fetchLimit, signal);
          memories = page.memories;
          const noteFiles = await options.indexStore.files(signal);
          const notes = noteFiles.filter(({ path }) => isRoutedNotePath(path) &&
            (folder === undefined || safeFolder(path) === folder));
          const eligibleMemories = folder === undefined || folder === 'General' ? memories : [];
          const memoryItems = eligibleMemories.slice(offset, offset + limit + 1).map(memoryApiItem);
          const pageItems: MemoryApiItem[] = [...memoryItems];
          const noteOffset = Math.max(0, offset - eligibleMemories.length);
          const noteLimit = Math.max(0, limit + 1 - memoryItems.length);
          const notePage = notes.slice(noteOffset, noteOffset + noteLimit);
          for (const file of notePage) {
            const note = await options.client.read(file.path, signal);
            if (!note) continue;
            const [commit] = await options.client.history(file.path, 1, signal);
            pageItems.push(vaultApiItem(note.path, note.content, commit?.updatedAt ?? new Date(0)));
          }
          const items = pageItems.slice(0, limit + 1);
          return {
            items: items.slice(0, limit),
            count: Math.min(items.length, limit),
            limit,
            offset,
            hasMore: items.length > limit ||
              (page.hasMore && (folder === undefined || folder === 'General')) ||
              notes.length > noteOffset + notePage.length,
          };
        }

        const filteredMemories = (folder === undefined || folder === 'General' ? memories : [])
          .map(memoryApiItem);
        const uniqueHits = [...new Map(vaultHits.filter((hit) => isRoutedNotePath(hit.path) &&
          (folder === undefined || safeFolder(hit.path) === folder)).map((hit) => [hit.path, hit])).values()];
        const vaultItems: MemoryApiItem[] = [];
        for (const hit of uniqueHits) {
          const [commit] = await options.client.history(hit.path, 1, signal);
          if (commit) vaultItems.push(vaultApiItem(hit.path, hit.content, commit.updatedAt));
        }
        const combined = [...filteredMemories, ...vaultItems];
        const items = combined.slice(offset, offset + limit + 1);
        return {
          items: items.slice(0, limit),
          count: Math.min(items.length, limit),
          limit,
          offset,
          hasMore: items.length > limit,
          ...(searchMethod ? { method: searchMethod } : {}),
        };
      });

      app.get<{ Params: { id: string } }>('/memory/:id', {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'string', pattern: '^(?:[1-9][0-9]{0,18}|vault_[A-Za-z0-9_-]{1,256})$', maxLength: 263 } },
            required: ['id'],
            additionalProperties: false,
          },
          response: { 400: apiError, 403: apiError, 404: apiError, 503: apiError },
        },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply) || !apiStore(reply)) return;
        const { id } = request.params;
        const signal = AbortSignal.timeout(30_000);
        if (/^[1-9][0-9]{0,18}$/u.test(id)) {
          if (BigInt(id) > maxSqlMessageId) return reply.code(400).send({ error: 'Invalid memory ID' });
          const versions = await options.apiMemoryStore!.history(id, maxMemoryApiHistory + 1, signal);
          if (versions.length === 0) return reply.code(404).send({ error: 'Memory not found' });
          const current = versions[0]!;
          return {
            ...memoryApiItem(current),
            category: current.category,
            key: shouldRedact(`${current.key}\n${current.content}`) ? '[redacted]' : current.key,
            content: shouldRedact(`${current.key}\n${current.content}`) ? '[redacted]' : current.content,
            history: versions.slice(0, maxMemoryApiHistory).map(memoryHistoryItem),
            mayHaveMore: versions.length > maxMemoryApiHistory,
          };
        }
        const path = vaultPathFromId(id);
        if (!path) return reply.code(400).send({ error: 'Invalid vault note ID' });
        const note = await options.client.read(path, signal);
        if (!note) return reply.code(404).send({ error: 'Memory not found' });
        const commits = await options.client.history(path, maxMemoryApiHistory, signal);
        const history = [];
        let historyBytes = 0;
        for (const commit of commits) {
          const version = await options.client.read(path, signal, commit.sha);
          if (!version) continue;
          const contentBytes = Buffer.byteLength(version.content, 'utf8');
          if (historyBytes + contentBytes > maxMemoryApiHistoryBytes) break;
          historyBytes += contentBytes;
          const redacted = shouldRedact(version.content);
          history.push({
            updatedAt: commit.updatedAt.toISOString(),
            message: shouldRedact(commit.message) ? '[redacted]' : commit.message,
            url: commitUrl(commit.sha),
            content: redacted ? '[redacted]' : version.content,
          });
        }
        const [latest] = commits;
        return {
          ...vaultApiItem(path, note.content, latest?.updatedAt ?? new Date(0)),
          content: shouldRedact(note.content) ? '[redacted]' : note.content,
          history,
          mayHaveMore: history.length < commits.length || commits.length === maxMemoryApiHistory,
        };
      });

      app.patch<{ Params: { id: string }; Body: { text: string } }>('/memory/:id', {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'string', pattern: '^(?:[1-9][0-9]{0,18}|vault_[A-Za-z0-9_-]{1,256})$', maxLength: 263 } },
            required: ['id'],
            additionalProperties: false,
          },
          body: {
            type: 'object',
            properties: { text: { type: 'string', minLength: 1, maxLength: MAX_VAULT_FILE_BYTES } },
            required: ['text'],
            additionalProperties: false,
          },
          response: { 400: apiError, 403: apiError, 404: apiError, 503: apiError },
        },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply) || !apiStore(reply)) return;
        const text = request.body.text.trim();
        if (!text || Buffer.byteLength(text, 'utf8') > MAX_VAULT_FILE_BYTES ||
            credentialPattern.test(text) || secretPattern.test(text) || sensitivePattern.test(text)) {
          return reply.code(400).send({ error: 'Memory text is invalid or contains restricted sensitive content' });
        }
        const signal = AbortSignal.timeout(30_000);
        const id = request.params.id;
        if (/^[1-9][0-9]{0,18}$/u.test(id)) {
          if (BigInt(id) > maxSqlMessageId) return reply.code(400).send({ error: 'Invalid memory ID' });
          if (text.length > 2_000) return reply.code(400).send({ error: 'Durable memory text exceeds 2,000 characters' });
          const versions = await options.apiMemoryStore!.history(id, 1, signal);
          const current = versions[0];
          if (!current) return reply.code(404).send({ error: 'Memory not found' });
          const embedding = options.embedder && options.apiMemoryStore!.supportsVectorSearch()
            ? await options.embedder.embed(text, signal).catch((error: unknown) => {
              if (signal.aborted) throw error;
              return null;
            })
            : null;
          const corrected = await options.apiMemoryStore!.correct(id, {
            category: current.category,
            key: current.key,
            content: text,
            sourceMessageId: current.sourceMessageId,
            embedding,
          }, signal);
          return { item: memoryApiItem(corrected.memory), commitUrl: null };
        }
        const path = vaultPathFromId(id);
        if (!path) return reply.code(400).send({ error: 'Invalid vault note ID' });
        if (Buffer.byteLength(text, 'utf8') > MAX_VAULT_FILE_BYTES) {
          return reply.code(400).send({ error: 'Vault note exceeds the supported size' });
        }
        const current = await options.client.read(path, signal);
        if (!current) return reply.code(404).send({ error: 'Memory not found' });
        const result = await write(path, { content: text, reason: 'correct memory note' }, '', signal, true);
        const [latestCommit] = await options.client.history(path, 1, signal);
        return {
          item: vaultApiItem(path, text, latestCommit?.updatedAt ?? new Date()),
          commitUrl: commitUrl(result.commit),
        };
      });

      app.delete<{ Params: { id: string } }>('/memory/:id', {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'string', pattern: '^(?:[1-9][0-9]{0,18}|vault_[A-Za-z0-9_-]{1,256})$', maxLength: 263 } },
            required: ['id'],
            additionalProperties: false,
          },
          response: { 400: apiError, 403: apiError, 404: apiError, 503: apiError },
        },
      }, async (request, reply) => {
        if (!ownerOnly(request, reply) || !apiStore(reply)) return;
        const id = request.params.id;
        const signal = AbortSignal.timeout(30_000);
        if (/^[1-9][0-9]{0,18}$/u.test(id)) {
          if (BigInt(id) > maxSqlMessageId) return reply.code(400).send({ error: 'Invalid memory ID' });
          const versions = await options.apiMemoryStore!.history(id, 1, signal);
          if (!versions[0]) return reply.code(404).send({ error: 'Memory not found' });
          const forgotten = await options.apiMemoryStore!.forget(id, versions[0].sourceMessageId, signal);
          if (!forgotten) return reply.code(404).send({ error: 'Memory not found' });
          return reply.code(204).send();
        }
        const path = vaultPathFromId(id);
        if (!path) return reply.code(400).send({ error: 'Invalid vault note ID' });
        const note = await options.client.read(path, signal);
        if (!note) return reply.code(404).send({ error: 'Memory not found' });
        const service: TeamsNotificationService | null = app.teamsNotifications;
        if (!service) return reply.code(503).send({ error: 'Web approval unavailable' });
        try {
          if (app.awayModeStore && (await app.awayModeStore.read()).mode !== 'present') {
            return reply.code(409).send({ error: 'Web approval is unavailable while Jarvis is away' });
          }
        } catch {
          return reply.code(503).send({ error: 'Web approval unavailable' });
        }
        if (pendingVaultDeletions.has(path)) {
          return reply.code(202).send({ status: 'approval_pending', message: 'approval pending in Jarvis' });
        }
        pendingVaultDeletions.add(path);
        void service.runConfirmed('delete', `Permanently delete vault note ${path}.`, async () => {
          const latest = await options.client.read(path, AbortSignal.timeout(15_000));
          if (!latest) return;
          if (latest.sha !== note.sha) throw new VaultWriteConflictError();
          const commit = await options.client.delete(
            path,
            latest.sha,
            'jarvis: forget vault note',
            AbortSignal.timeout(15_000),
          );
          await options.indexStore.deleteFiles([path], AbortSignal.timeout(10_000));
          const folder = safeFolder(path);
          log('vault.write', {
            outcome: 'ok',
            ...(folder ? { folder } : {}),
          });
          return commit;
        }, AbortSignal.timeout(6 * 60_000)).catch(() => {
          app.log.warn('memory.vault_forget_failed');
        }).finally(() => { pendingVaultDeletions.delete(path); });
        return reply.code(202).send({ status: 'approval_pending', message: 'approval pending in Jarvis' });
      });
    },
  };
}

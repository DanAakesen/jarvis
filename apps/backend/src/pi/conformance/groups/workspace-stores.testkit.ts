import { randomBytes, randomUUID } from 'node:crypto';
import type {
  GeneratedView, HtmlArtifact, HtmlArtifactSource, WorkspaceItem, WorkspaceItemKind, WorkspaceItemPatch, WorkspaceItemsSearch, WorkspacePin,
} from '@jarvis/contracts';
import { WorkspaceArtifactNotFound, workspaceImageSizeLimit } from '../../../database/workspace-artifact-store.js';
import {
  WorkspaceHtmlArtifactNotFound, isWellFormedUtf16, workspaceHtmlSizeLimit, type WorkspaceHtmlArtifactVersion,
} from '../../../database/workspace-html-artifact-store.js';
import { WorkspaceItemNotFound, type WorkspaceGraphPayload, type WorkspaceItemRecord } from '../../../database/workspace-items-store.js';
import { WorkspacePinLimitExceeded } from '../../../database/workspace-pin-store.js';

/**
 * In-memory stand-ins for the SQL and blob stores behind the workspace tools. Each keeps the contract of its production class
 * (owner scoping, validation, ordering, the typed not-found errors), so a tool behaves here as it does against the database.
 */

const anyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const artifactUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const itemIdPattern = /^(research|html_app|image|knowledge_graph):([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/u;
const viewIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const searchStopWords = new Set(['a', 'again', 'an', 'and', 'find', 'for', 'get', 'jarvis', 'open', 'pull', 'report', 'research', 'the', 'up']);

const oneLine = (value: string) => Array.from(value, (character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127 ? ' ' : character;
}).join('').replace(/\s+/gu, ' ').trim();

function isHttpsSource(value: unknown): value is HtmlArtifactSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== 'title' && key !== 'url') ||
      typeof source.title !== 'string' || !source.title.trim() || source.title !== source.title.trim() || source.title.length > 200 ||
      typeof source.url !== 'string' || source.url !== source.url.trim() || source.url.length > 2_048) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

// ---- HTML artifacts (workspace_html_artifacts and its version history) -------------------------------------------------------

interface HtmlRow {
  readonly id: string;
  readonly owner: string;
  title: string;
  html: string;
  sources: HtmlArtifactSource[];
  readonly createdAt: string;
  pinned: boolean;
  version: number;
  readonly history: { version: number; title: string; html: string; sources: HtmlArtifactSource[] }[];
}

/** Serves both `WorkspaceHtmlArtifactStore` and the research module's `HtmlArtifactStore`, which share one SQL table. */
export class InMemoryHtmlArtifacts {
  private readonly rows = new Map<string, HtmlRow>();

  seed(owner: string, input: { id: string; title: string; html: string; sources?: HtmlArtifactSource[]; createdAt: string; pinned?: boolean }): void {
    this.rows.set(input.id, {
      id: input.id, owner, title: input.title, html: input.html, sources: input.sources ?? [], createdAt: input.createdAt,
      pinned: input.pinned ?? false, version: 1, history: [],
    });
  }

  /** Every title the artifact has had, which Workspaces search also matches. */
  titlesOf(id: string): string[] {
    const row = this.rows.get(id);
    return row ? [row.title, ...row.history.map((entry) => entry.title)] : [];
  }

  async create(
    owner: string, title: string, html: string, sources: readonly HtmlArtifactSource[], signal: AbortSignal, artifactId?: string,
  ): Promise<HtmlArtifact> {
    signal.throwIfAborted();
    const id = artifactId ?? randomUUID();
    if (!anyUuid.test(owner) || !anyUuid.test(id) || typeof title !== 'string' || !title.trim() || title.length > 200 ||
        typeof html !== 'string' || !html.trim() || !isWellFormedUtf16(html) || Buffer.byteLength(html, 'utf8') > workspaceHtmlSizeLimit ||
        !Array.isArray(sources) || sources.length > 50 || !sources.every(isHttpsSource)) {
      throw new TypeError('Invalid workspace HTML artifact');
    }
    if (this.rows.has(id)) throw new Error('Workspace HTML artifact was not saved');
    const row: HtmlRow = {
      id: id.toLowerCase(), owner: owner.toLowerCase(), title: title.trim(), html, sources: [...sources],
      createdAt: new Date().toISOString(), pinned: false, version: 1, history: [],
    };
    this.rows.set(row.id, row);
    return this.artifactOf(row);
  }

  async read(id: string, owner: string, signal: AbortSignal): Promise<HtmlArtifact> {
    const current = await this.readVersion(id, owner, signal);
    return {
      id: current.id, kind: 'html', title: current.title, html: current.html, sources: current.sources.map((source) => ({ ...source })),
      createdAt: current.createdAt, pinned: current.pinned,
    };
  }

  async readVersion(id: string, owner: string, signal: AbortSignal, version?: number): Promise<WorkspaceHtmlArtifactVersion> {
    signal.throwIfAborted();
    if (!artifactUuid.test(id) || !anyUuid.test(owner)) throw new WorkspaceHtmlArtifactNotFound();
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647)) throw new WorkspaceHtmlArtifactNotFound();
    const row = this.rows.get(id.toLowerCase());
    if (!row || row.owner !== owner.toLowerCase()) throw new WorkspaceHtmlArtifactNotFound();
    if (version === undefined || version === row.version) return { ...this.artifactOf(row), version: row.version };
    const earlier = row.history.find((entry) => entry.version === version);
    if (!earlier) throw new WorkspaceHtmlArtifactNotFound();
    return { ...this.artifactOf({ ...row, title: earlier.title, html: earlier.html, sources: earlier.sources }), version: earlier.version };
  }

  async update(
    id: string, owner: string, html: string, signal: AbortSignal, title?: string, sources?: readonly HtmlArtifactSource[],
  ): Promise<WorkspaceHtmlArtifactVersion> {
    signal.throwIfAborted();
    if (!artifactUuid.test(id) || !anyUuid.test(owner)) throw new WorkspaceHtmlArtifactNotFound();
    if (typeof html !== 'string' || !html.trim() || !isWellFormedUtf16(html) || Buffer.byteLength(html, 'utf8') > workspaceHtmlSizeLimit ||
        title !== undefined && (typeof title !== 'string' || !title.trim() || title !== title.trim() || title.length > 200) ||
        sources !== undefined && (!Array.isArray(sources) || sources.length > 50 || !sources.every(isHttpsSource))) {
      throw new TypeError('Invalid workspace HTML artifact');
    }
    const row = this.rows.get(id.toLowerCase());
    if (!row || row.owner !== owner.toLowerCase()) throw new WorkspaceHtmlArtifactNotFound();
    row.history.push({ version: row.version, title: row.title, html: row.html, sources: row.sources });
    row.title = title ?? row.title;
    row.html = html;
    row.sources = sources === undefined ? row.sources : [...sources];
    row.version += 1;
    return { ...this.artifactOf(row), version: row.version };
  }

  async setPinned(id: string, owner: string, pinned: boolean, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const row = this.rows.get(id.toLowerCase());
    if (!row || row.owner !== owner.toLowerCase()) throw new WorkspaceHtmlArtifactNotFound();
    row.pinned = pinned;
    return pinned;
  }

  private artifactOf(row: Pick<HtmlRow, 'id' | 'title' | 'html' | 'sources' | 'createdAt' | 'pinned'>): HtmlArtifact {
    return { id: row.id, kind: 'html', title: row.title, html: row.html, sources: row.sources.map((source) => ({ ...source })), createdAt: row.createdAt, pinned: row.pinned };
  }
}

// ---- Workspaces items --------------------------------------------------------------------------------------------------------

interface ItemRow {
  readonly id: string;
  readonly owner: string;
  readonly kind: WorkspaceItemKind;
  readonly sourceId: string;
  title: string;
  promptSummary: string;
  readonly createdAt: string;
  pinned: boolean;
  payload: WorkspaceGraphPayload | undefined;
}

function itemParts(id: string): { kind: WorkspaceItemKind; sourceId: string } {
  const match = itemIdPattern.exec(id.toLowerCase());
  if (!match) throw new WorkspaceItemNotFound();
  return { kind: match[1] as WorkspaceItemKind, sourceId: match[2]! };
}

const mapItem = (row: ItemRow): WorkspaceItem => ({
  id: row.id as WorkspaceItem['id'], kind: row.kind, title: row.title, promptSummary: row.promptSummary, createdAt: row.createdAt, pinned: row.pinned,
});

export class InMemoryWorkspaceItems {
  private readonly rows = new Map<string, ItemRow>();

  constructor(private readonly html: Pick<InMemoryHtmlArtifacts, 'titlesOf'>) {}

  /** Saves an item the way `record` does, without a signal (used to seed). */
  seed(owner: string, input: WorkspaceItemRecord): WorkspaceItem {
    return this.upsert(owner, input);
  }

  async record(owner: string, input: WorkspaceItemRecord, signal: AbortSignal): Promise<WorkspaceItem> {
    signal.throwIfAborted();
    return this.upsert(owner, input);
  }

  private upsert(owner: string, input: WorkspaceItemRecord): WorkspaceItem {
    const id = input.id.toLowerCase();
    const sourceId = input.sourceId.toLowerCase();
    const parts = itemParts(id);
    const title = typeof input.title === 'string' ? oneLine(input.title) : '';
    const promptSummary = typeof input.promptSummary === 'string' ? oneLine(input.promptSummary) : '';
    if (!anyUuid.test(owner) || parts.kind !== input.kind || parts.sourceId !== sourceId || !anyUuid.test(sourceId) ||
        !title || title.length > 200 || !promptSummary || promptSummary.length > 500 ||
        !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt ||
        (input.kind === 'knowledge_graph') !== (input.payload !== undefined)) {
      throw new TypeError('Invalid Workspace item record');
    }
    const key = `${owner.toLowerCase()}|${id}`;
    const existing = this.rows.get(key);
    if (existing) {
      existing.title = title;
      existing.promptSummary = promptSummary;
      existing.payload = input.payload;
      return mapItem(existing);
    }
    const row: ItemRow = {
      id, owner: owner.toLowerCase(), kind: input.kind, sourceId, title, promptSummary, createdAt: input.createdAt,
      pinned: input.pinned ?? false, payload: input.payload,
    };
    this.rows.set(key, row);
    return mapItem(row);
  }

  async search(owner: string, filters: WorkspaceItemsSearch, signal: AbortSignal): Promise<WorkspaceItem[]> {
    signal.throwIfAborted();
    if (!anyUuid.test(owner)) throw new TypeError('Invalid Workspace item owner');
    const terms = filters.q?.trim().split(/\s+/u).filter((term) => term.length > 1 && !searchStopWords.has(term.toLowerCase())).slice(0, 8) ?? [];
    const matches = (row: ItemRow, term: string) => {
      const needle = term.toLowerCase();
      return row.title.toLowerCase().includes(needle) || row.promptSummary.toLowerCase().includes(needle) ||
        ((row.kind === 'research' || row.kind === 'html_app') && this.html.titlesOf(row.sourceId).some((title) => title.toLowerCase().includes(needle)));
    };
    return [...this.rows.values()]
      .filter((row) => row.owner === owner.toLowerCase() && (filters.kind === undefined || row.kind === filters.kind) &&
        (filters.before === undefined || Date.parse(row.createdAt) < Date.parse(filters.before)) && terms.every((term) => matches(row, term)))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id))
      .slice(0, 100).map(mapItem);
  }

  async get(owner: string, id: string, signal: AbortSignal): Promise<{ item: WorkspaceItem; sourceId: string; payload?: WorkspaceGraphPayload }> {
    signal.throwIfAborted();
    const { kind, sourceId } = itemParts(id);
    const row = this.rows.get(`${owner.toLowerCase()}|${id.toLowerCase()}`);
    if (!row || row.kind !== kind) throw new WorkspaceItemNotFound();
    return { item: mapItem(row), sourceId, ...(row.payload ? { payload: { ...row.payload } } : {}) };
  }

  async update(owner: string, id: string, patch: WorkspaceItemPatch, signal: AbortSignal): Promise<WorkspaceItem> {
    signal.throwIfAborted();
    itemParts(id);
    if (!anyUuid.test(owner) || Object.keys(patch).length === 0 || (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 200))) {
      throw new TypeError('Invalid Workspace item update');
    }
    const row = this.rows.get(`${owner.toLowerCase()}|${id.toLowerCase()}`);
    if (!row) throw new WorkspaceItemNotFound();
    if (patch.title !== undefined) row.title = patch.title.trim();
    if (patch.pinned !== undefined) row.pinned = patch.pinned;
    return mapItem(row);
  }

  async delete(owner: string, id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    itemParts(id);
    if (!this.rows.delete(`${owner.toLowerCase()}|${id.toLowerCase()}`)) throw new WorkspaceItemNotFound();
  }
}

// ---- Pins ----------------------------------------------------------------------------------------------------------------------

export class InMemoryWorkspacePins {
  private readonly pins = new Map<string, WorkspacePin>();

  seed(owner: string, pin: WorkspacePin): void {
    this.pins.set(`${owner.toLowerCase()}|${pin.viewId}`, pin);
  }

  async list(owner: string, signal: AbortSignal): Promise<WorkspacePin[]> {
    signal.throwIfAborted();
    if (!anyUuid.test(owner)) throw new TypeError('Invalid workspace pin owner');
    return [...this.pins.entries()].filter(([key]) => key.startsWith(`${owner.toLowerCase()}|`)).map(([, pin]) => structuredClone(pin))
      .sort((left, right) => Date.parse(left.pinnedAt) - Date.parse(right.pinnedAt) || left.viewId.localeCompare(right.viewId)).slice(0, 20);
  }

  async pin(owner: string, viewId: string, view: GeneratedView, signal: AbortSignal): Promise<WorkspacePin> {
    signal.throwIfAborted();
    if (!anyUuid.test(owner) || !viewIdPattern.test(viewId)) throw new TypeError('Invalid workspace pin');
    const key = `${owner.toLowerCase()}|${viewId}`;
    const existing = this.pins.get(key);
    if (!existing && [...this.pins.keys()].filter((entry) => entry.startsWith(`${owner.toLowerCase()}|`)).length >= 20) throw new WorkspacePinLimitExceeded();
    const pin: WorkspacePin = { viewId, view: structuredClone(view), pinnedAt: existing?.pinnedAt ?? new Date().toISOString() };
    this.pins.set(key, pin);
    return structuredClone(pin);
  }

  async unpin(owner: string, viewId: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    return this.pins.delete(`${owner.toLowerCase()}|${viewId}`);
  }
}

// ---- Generated images (blob container) ----------------------------------------------------------------------------------------

/** What the image generator returns: a real 1×1 PNG, small enough to read in a test. */
export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64',
);

function validPng(image: Buffer): boolean {
  return image.length >= 33 && image.length <= workspaceImageSizeLimit &&
    image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && image.readUInt32BE(8) === 13 &&
    image.toString('ascii', 12, 16) === 'IHDR' && image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0;
}

export class InMemoryImageArtifacts {
  private readonly stored = new Map<string, { owner: string; contentType: string }>();
  private readonly pending = new Map<string, { artifactId: string; owner: string; digest?: string }>();

  /** `account` is the blob account the signed read URLs name; the world installs the same one as the trusted blob host. */
  constructor(private readonly account: string) {}

  seed(owner: string, artifactId: string): void {
    this.stored.set(artifactId, { owner: owner.toLowerCase(), contentType: 'image/png' });
  }

  registerUpload(owner: string): { artifactId: string; uploadKey: string } {
    if (!anyUuid.test(owner)) throw new TypeError('Invalid workspace artifact owner');
    const artifactId = randomUUID();
    const uploadKey = randomBytes(32).toString('base64url');
    this.pending.set(uploadKey, { artifactId, owner: owner.toLowerCase() });
    return { artifactId, uploadKey };
  }

  releaseUpload(uploadKey: string): void {
    this.pending.delete(uploadKey);
  }

  async upload(uploadKey: string, contentType: string, image: Buffer, signal: AbortSignal): Promise<string> {
    const registration = this.pending.get(uploadKey);
    if (!registration || contentType !== 'image/png' || !validPng(image)) throw new Error('Workspace image upload is invalid or expired');
    signal.throwIfAborted();
    this.stored.set(registration.artifactId, { owner: registration.owner, contentType });
    return registration.artifactId;
  }

  async readUrl(artifactId: string, owner: string, signal: AbortSignal): Promise<string> {
    if (!artifactUuid.test(artifactId) || !anyUuid.test(owner)) throw new Error('Workspace artifact reference is invalid');
    signal.throwIfAborted();
    const image = this.stored.get(artifactId.toLowerCase());
    if (!image || image.owner !== owner.toLowerCase()) throw new WorkspaceArtifactNotFound();
    return `https://${this.account}.blob.core.windows.net/artifacts/workspace-images/${artifactId}.png?sv=2024-01-01&sp=r&sig=conformance`;
  }
}

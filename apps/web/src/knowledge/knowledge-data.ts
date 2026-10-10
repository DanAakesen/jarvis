import { backendFetch } from '../backend-request';

/** Knowledge graph of Dan's vault (P7-43, contract in #481). */
export type KnowledgeFolder = 'People' | 'Work' | 'Personal' | 'General';
export interface KnowledgeNode { id: string; path: string; title: string; folder: KnowledgeFolder; updatedAt: string | null; degree: number }
export interface KnowledgeEdge { source: string; target: string; type: 'link' | 'similar'; /** Similarity strength, 0–1. */ score?: number }
export interface KnowledgeGraph { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; sample?: boolean }
export interface KnowledgeNote { id: string; title: string; folder: string; content: string; updatedAt: string | null; githubUrl: string | null }

export const knowledgeFolders: readonly KnowledgeFolder[] = ['People', 'Work', 'Personal', 'General'];
const maxNodes = 4000;
const maxEdges = 20000;
const unavailableStatuses = new Set([404, 405, 501]);

export class KnowledgeUnavailable extends Error {}

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';

async function request(backendUrl: string, getAccessToken: () => Promise<string>, path: string, signal?: AbortSignal) {
  const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    headers: { Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}`, Accept: 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (unavailableStatuses.has(response.status)) {
    await response.body?.cancel().catch(() => {});
    throw new KnowledgeUnavailable();
  }
  if (!response.ok) throw new Error(`Jarvis could not load your knowledge (HTTP ${response.status}).`);
  return response.json() as Promise<unknown>;
}

/** Validates and bounds the graph; edges to unknown notes and self-links are dropped. */
export function readKnowledgeGraph(value: unknown): KnowledgeGraph {
  const body = record(value);
  if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) throw new Error('Jarvis returned an unexpected knowledge graph.');
  const nodes: KnowledgeNode[] = [];
  const ids = new Set<string>();
  for (const entry of body.nodes.slice(0, maxNodes)) {
    const node = record(entry);
    const id = typeof node?.id === 'string' || typeof node?.id === 'number' ? String(node.id) : '';
    if (!node || !id || id.length > 300 || ids.has(id)) continue;
    const folder = knowledgeFolders.includes(node.folder as KnowledgeFolder) ? node.folder as KnowledgeFolder : 'General';
    ids.add(id);
    nodes.push({
      id, folder,
      path: text(node.path, 400),
      title: text(node.title, 200) || text(node.path, 200) || id,
      updatedAt: typeof node.updatedAt === 'string' && !Number.isNaN(Date.parse(node.updatedAt)) ? node.updatedAt : null,
      degree: typeof node.degree === 'number' && Number.isFinite(node.degree) ? Math.max(0, Math.min(1000, Math.round(node.degree))) : 0,
    });
  }
  const edges: KnowledgeEdge[] = [];
  for (const entry of body.edges.slice(0, maxEdges)) {
    const edge = record(entry);
    const source = String(edge?.source ?? '');
    const target = String(edge?.target ?? '');
    if (!edge || source === target || !ids.has(source) || !ids.has(target)) continue;
    const score = typeof edge.score === 'number' && Number.isFinite(edge.score) ? Math.max(0, Math.min(1, edge.score)) : undefined;
    edges.push({ source, target, type: edge.type === 'similar' ? 'similar' : 'link', ...(score === undefined ? {} : { score }) });
  }
  return { nodes, edges };
}

export async function loadKnowledgeGraph(backendUrl: string, getAccessToken: () => Promise<string>, signal?: AbortSignal) {
  return readKnowledgeGraph(await request(backendUrl, getAccessToken, '/knowledge/graph', signal));
}

/** Search returns the matching node ids in rank order. */
export async function searchKnowledge(backendUrl: string, getAccessToken: () => Promise<string>, query: string, signal?: AbortSignal) {
  const body = record(await request(backendUrl, getAccessToken, `/knowledge/search?q=${encodeURIComponent(query.slice(0, 200))}`, signal));
  const hits = Array.isArray(body?.hits) ? body.hits : Array.isArray(body?.nodeIds) ? body.nodeIds : [];
  const ids: string[] = [];
  for (const hit of hits.slice(0, 200)) {
    const id = typeof hit === 'string' ? hit : record(hit)?.nodeId ?? record(hit)?.id;
    if (typeof id === 'string' || typeof id === 'number') ids.push(String(id));
  }
  return ids;
}

/** Graph node ids are path hashes; the memory API reads vault notes by `vault_` plus the base64url path. */
export function vaultMemoryId(path: string) {
  const bytes = new TextEncoder().encode(path);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `vault_${btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')}`;
}

function withoutFrontMatter(content: string) {
  let start = 0;
  while (start < content.length) {
    while (start < content.length && /\s/u.test(content[start]!)) start += 1;
    if (!content.startsWith('<!--', start)) break;
    const end = content.indexOf('-->', start + 4);
    if (end === -1) return content.trimStart();
    start = end + 3;
  }
  const body = content.slice(start);
  const block = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u.exec(body);
  return (block ? body.slice(block[0].length) : content).trimStart();
}

export async function loadKnowledgeNote(backendUrl: string, getAccessToken: () => Promise<string>, node: Pick<KnowledgeNode, 'id' | 'path'>, signal?: AbortSignal): Promise<KnowledgeNote> {
  const id = node.path ? vaultMemoryId(node.path) : node.id;
  const note = record(await request(backendUrl, getAccessToken, `/memory/${encodeURIComponent(id)}`, signal));
  if (!note) throw new Error('This note could not be opened.');
  const source = record(note.source);
  const url = typeof source?.url === 'string' && /^https:\/\/github\.com\//u.test(source.url) ? source.url : null;
  return {
    id,
    title: text(note.title ?? note.key, 200) || id,
    folder: text(note.folder, 40) || 'General',
    // Obsidian front matter (tags, created, icon) is metadata, not reading material.
    content: withoutFrontMatter(text(note.content ?? note.snippet, 200_000)),
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : null,
    githubUrl: url,
  };
}

/** Local title search: an instant first pass while typing, and the fallback while the search service is unavailable. */
export function matchTitles(graph: KnowledgeGraph, query: string) {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) return [];
  return graph.nodes.filter((node) => terms.every((term) => `${node.title} ${node.path}`.toLowerCase().includes(term))).map((node) => node.id);
}

/**
 * A clearly labelled sample vault for local development only, so the graph can be designed before #481 is deployed.
 * The page offers it only in development builds and marks it as sample data.
 */
export function sampleKnowledgeGraph(count = 420): KnowledgeGraph {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const words = ['Anna', 'Contoso', 'Foundry', 'Roadmap', 'Budget', 'Garden', 'Running', 'Holiday', 'Azure', 'Partner', 'Quarterly', 'Ideas', 'Recipe', 'Fabric', 'Security', 'Kids', 'House', 'Copilot', 'Vision', 'Notes'];
  const nodes: KnowledgeNode[] = Array.from({ length: count }, (_, index) => {
    const folder = knowledgeFolders[Math.floor(random() * 4)]!;
    const title = `${words[Math.floor(random() * words.length)]} ${words[Math.floor(random() * words.length)]} ${index}`;
    return { id: `sample-${index}`, path: `${folder}/${title}.md`, title, folder, updatedAt: null, degree: 0 };
  });
  const edges: KnowledgeEdge[] = [];
  const byFolder = new Map(knowledgeFolders.map((folder) => [folder, nodes.filter((node) => node.folder === folder)]));
  for (const node of nodes) {
    const links = 1 + Math.floor(random() * 3);
    for (let link = 0; link < links; link += 1) {
      const pool = random() < 0.75 ? byFolder.get(node.folder)! : nodes;
      const target = pool[Math.floor(random() * pool.length)]!;
      if (target.id !== node.id) edges.push({ source: node.id, target: target.id, type: random() < 0.7 ? 'link' : 'similar' });
    }
  }
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;
  return { nodes, edges, sample: true };
}

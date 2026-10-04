import type { BackendModule } from '../modules.js';
import { ToolFailure } from '../core/tool-registry.js';
import type { GraphClient } from '../graph/client.js';

const maxQueryLength = 200;
const defaultLimit = 5;
const maxLimit = 10;
const maxSnippetLength = 600;
const graphFolderFields = '$select=id,webUrl,folder';
const querySchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: maxQueryLength, pattern: '\\S' },
    limit: { type: 'integer', minimum: 1, maximum: maxLimit },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

interface NotesSearchInput {
  readonly query: string;
  readonly limit?: number;
}

interface SearchResult {
  readonly title: string;
  readonly snippet: string;
  readonly link: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseInput(input: unknown): NotesSearchInput {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'query' && key !== 'limit') ||
    typeof input.query !== 'string' || input.query.trim().length === 0 ||
    input.query.trim().length > maxQueryLength ||
    (input.limit !== undefined && (!Number.isInteger(input.limit) || (input.limit as number) < 1 ||
      (input.limit as number) > maxLimit))) {
    throw new TypeError('Invalid notes search input');
  }
  return { query: input.query.trim(), ...(input.limit === undefined ? {} : { limit: input.limit as number }) };
}

function encodeFolderPath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function sharePointUrl(value: unknown): URL {
  if (typeof value !== 'string') throw new Error('Microsoft Graph folder location was invalid');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.sharepoint.com') ||
    url.username || url.password || url.search || url.hash) {
    throw new Error('Microsoft Graph folder location was invalid');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url;
}

function quoteKql(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function isWithinFolder(value: unknown, folder: URL): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === folder.origin &&
      url.pathname.startsWith(`${folder.pathname}/`);
  } catch {
    return false;
  }
}

function plainSnippet(value: unknown): string {
  if (typeof value !== 'string') return 'Microsoft Search did not return a text snippet.';
  const snippet = value
    .replace(/<\/?c\d+>/giu, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&amp;/giu, '&')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxSnippetLength);
  return snippet || 'Microsoft Search did not return a text snippet.';
}

function searchHits(response: unknown): unknown[] {
  if (!isRecord(response) || !Array.isArray(response.value)) {
    throw new Error('Microsoft Search returned an invalid response');
  }
  const hits: unknown[] = [];
  for (const query of response.value) {
    if (!isRecord(query) || !Array.isArray(query.hitsContainers)) {
      throw new Error('Microsoft Search returned an invalid response');
    }
    for (const container of query.hitsContainers) {
      if (!isRecord(container) || !Array.isArray(container.hits)) {
        throw new Error('Microsoft Search returned an invalid response');
      }
      hits.push(...container.hits);
    }
  }
  return hits;
}

async function findNotes(
  graph: GraphClient,
  ownerObjectId: string,
  folderPath: string,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const folder = await graph.get(
    `users/${encodeURIComponent(ownerObjectId)}/drive/root:/${encodeFolderPath(folderPath)}?${graphFolderFields}`,
    signal,
  );
  if (!isRecord(folder) || typeof folder.id !== 'string' || !folder.id || !isRecord(folder.folder)) {
    throw new Error('Microsoft Graph notes folder was not found');
  }
  const folderUrl = sharePointUrl(folder.webUrl);
  const terms = query.split(/\s+/u).map(quoteKql);
  const queryString = `${terms.join(' AND ')} AND path:${quoteKql(folderUrl.href)}`;
  const response = await graph.post('search/query', {
    requests: [{
      entityTypes: ['driveItem'],
      query: { queryString },
      from: 0,
      size: limit,
      fields: ['name', 'webUrl', 'parentReference'],
    }],
  }, signal);

  return searchHits(response).flatMap((hit): SearchResult[] => {
    if (!isRecord(hit) || !isRecord(hit.resource)) return [];
    const item = hit.resource;
    if (typeof item.name !== 'string' || !item.name || !isWithinFolder(item.webUrl, folderUrl)) return [];
    return [{
      title: item.name.slice(0, 200),
      snippet: plainSnippet(hit.summary),
      link: new URL(item.webUrl as string).href,
    }];
  }).slice(0, limit);
}

export function createNotesModule(options: {
  readonly graph: GraphClient;
  readonly ownerObjectId: string;
  readonly folderPath: string;
}): BackendModule {
  return {
    id: 'notes',
    tools: [{
      name: 'notes_search',
      description: "Search Dan's configured OneDrive notes folder and return matching titles, snippets, and links.",
      inputSchema: querySchema,
      execute: async (input, _request, signal) => {
        const { query, limit = defaultLimit } = parseInput(input);
        let results: SearchResult[];
        try {
          results = await findNotes(
            options.graph, options.ownerObjectId, options.folderPath, query, limit, signal,
          );
        } catch {
          throw new ToolFailure('Notes search is temporarily unavailable. Please try again.');
        }
        return results.length
          ? { message: `Found ${results.length} note${results.length === 1 ? '' : 's'}.`, results }
          : { message: `No notes matched that search in ${options.folderPath}.`, results: [] };
      },
    }],
    registerRoutes: async () => {},
  };
}

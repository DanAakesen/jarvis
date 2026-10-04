import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import type { GraphClient } from '../graph/client.js';
import { createNotesModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const folderUrl = 'https://dan-my.sharepoint.com/personal/dan/Documents/Jarvis/Notes';
const folderResult = { id: 'notes-id', webUrl: folderUrl, folder: { childCount: 2 } };
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(graphOverrides: Partial<GraphClient> = {}) {
  const graph: GraphClient = {
    get: vi.fn(async () => folderResult),
    post: vi.fn(async () => ({
      value: [{
        hitsContainers: [{
          hits: [{
            summary: 'A <c0>private</c0> note &amp; its detail.',
            resource: {
              name: 'Research.docx',
              webUrl: `${folderUrl}/Research.docx`,
            },
          }],
        }],
      }],
    })),
    ...graphOverrides,
  };
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule, createNotesModule({
      graph,
      ownerObjectId: config.auth.ownerObjectId,
      folderPath: config.notesFolderPath,
    })],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, graph, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('notes_search', () => {
  it('registers the backend tool and returns bounded, folder-scoped title, snippet, and link results', async () => {
    const { app, graph, record } = fixture();
    const catalogue = await app.inject({ url: '/tools', headers });
    expect(catalogue.statusCode).toBe(200);
    expect(catalogue.json().map(({ name }: { name: string }) => name)).toContain('notes_search');

    const response = await app.inject({
      method: 'POST',
      url: '/tools/notes_search',
      headers,
      payload: { query: 'private notes', limit: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tool: 'notes_search',
      outcome: 'ok',
      result: {
        message: 'Found 1 note.',
        results: [{
          title: 'Research.docx',
          snippet: 'A private note & its detail.',
          link: `${folderUrl}/Research.docx`,
        }],
      },
    });
    expect(graph.get).toHaveBeenCalledWith(
      `users/${config.auth.ownerObjectId}/drive/root:/Jarvis/Notes?$select=id,webUrl,folder`,
      expect.any(AbortSignal),
    );
    const searchBody = vi.mocked(graph.post).mock.calls[0]?.[1] as {
      requests: { query: { queryString: string }; size: number }[];
    };
    expect(searchBody.requests[0]?.query.queryString).toContain('"private" AND "notes" AND path:');
    expect(searchBody.requests[0]?.query.queryString).toContain(folderUrl);
    expect(searchBody.requests[0]?.size).toBe(2);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'notes_search',
      arguments: { query: 'private notes', limit: 2 },
      outcome: 'ok',
    }));
  });

  it('explains empty results and excludes search hits outside the configured folder', async () => {
    const graph: Partial<GraphClient> = {
      post: vi.fn(async () => ({
        value: [{
          hitsContainers: [{
            hits: [{
              summary: 'outside notes',
              resource: { name: 'Private.docx', webUrl: 'https://other.sharepoint.com/Private.docx' },
            }],
          }],
        }],
      })),
    };
    const { app } = fixture(graph);

    const response = await app.inject({
      method: 'POST',
      url: '/tools/notes_search',
      headers,
      payload: { query: 'missing' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { message: 'No notes matched that search in /Jarvis/Notes.', results: [] },
    });
  });

  it('explains provider failures without exposing provider details', async () => {
    const { app, record } = fixture({
      post: vi.fn(async () => { throw new Error('token=secret provider response'); }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/tools/notes_search',
      headers,
      payload: { query: 'private notes' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'Notes search is temporarily unavailable. Please try again.' },
      confirmation: 'Not done: notes_search failed.',
    });
    expect(response.body).not.toContain('secret');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'error',
      result: { error: 'Notes search is temporarily unavailable. Please try again.' },
    }));
  });

  it('reports malformed Graph search responses as failures instead of empty results', async () => {
    const { app } = fixture({
      post: vi.fn(async () => ({ value: [{ hitsContainers: null }] })),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/tools/notes_search',
      headers,
      payload: { query: 'private notes' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'Notes search is temporarily unavailable. Please try again.' },
    });
  });

  it('rejects invalid input before contacting Graph or recording a call', async () => {
    const { app, graph, record } = fixture();

    const response = await app.inject({
      method: 'POST',
      url: '/tools/notes_search',
      headers,
      payload: { query: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(graph.get).not.toHaveBeenCalled();
    expect(graph.post).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { WorkspaceHtmlArtifactNotFound, WorkspaceHtmlArtifactStore, workspaceHtmlSizeLimit } from './workspace-html-artifact-store.js';

const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const html = '<!doctype html><html><head></head><body><h1>Example</h1></body></html>';
const sources = [{ title: 'Example', url: 'https://example.com' }];

function fixture(recordset: unknown[] = []) {
  let rows = recordset;
  const query = vi.fn(async (statement: string) => ({
    recordset: statement.startsWith('UPDATE') ? [{ pinned: true }] : rows,
  }));
  const input = vi.fn();
  const request = { input, query, cancel: vi.fn() };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const store = new WorkspaceHtmlArtifactStore(pool);
  return { store, query, input, request, setRows: (next: unknown[]) => { rows = next; } };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    title: 'Example',
    html,
    sources_json: JSON.stringify(sources),
    created_at: new Date('2026-10-06T10:00:00.000Z'),
    pinned: false,
    ...overrides,
  };
}

describe('workspace HTML artifact store', () => {
  it('persists bounded HTML, its sources, and private owner metadata', async () => {
    const fixtureData = fixture([row()]);
    const artifact = await fixtureData.store.create(ownerId, ' Example ', html, sources, new AbortController().signal);
    expect(artifact).toMatchObject({ id: artifactId, kind: 'html', title: 'Example', html, sources, pinned: false });
    expect(artifact.createdAt).toBe('2026-10-06T10:00:00.000Z');
    expect(fixtureData.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, ownerId);
    expect(fixtureData.input).toHaveBeenCalledWith('size', sql.Int, Buffer.byteLength(html, 'utf8'));
    expect(fixtureData.input).toHaveBeenCalledWith('html', sql.NVarChar(sql.MAX), html);
    expect(fixtureData.query.mock.calls[0]?.[0]).toContain('INSERT dbo.workspace_html_artifacts');
  });

  it('reads and updates only artifacts belonging to the supplied owner', async () => {
    const fixtureData = fixture([row()]);
    await expect(fixtureData.store.read(artifactId, ownerId, new AbortController().signal))
      .resolves.toMatchObject({ id: artifactId, html });
    expect(fixtureData.query.mock.calls[0]?.[0]).toContain('WHERE id = @id AND owner_object_id = @owner');
    await expect(fixtureData.store.setPinned(artifactId, ownerId, true, new AbortController().signal)).resolves.toBe(true);
    expect(fixtureData.query.mock.calls[1]?.[0]).toContain('UPDATE dbo.workspace_html_artifacts SET pinned = @pinned');
  });

  it('does not reveal missing artifacts and refuses invalid or oversized content before SQL', async () => {
    const fixtureData = fixture();
    await expect(fixtureData.store.read(artifactId, ownerId, new AbortController().signal))
      .rejects.toBeInstanceOf(WorkspaceHtmlArtifactNotFound);
    fixtureData.query.mockClear();
    await expect(fixtureData.store.create(ownerId, 'Example', 'x'.repeat(workspaceHtmlSizeLimit + 1), [], new AbortController().signal))
      .rejects.toThrow('Invalid workspace HTML artifact');
    await expect(fixtureData.store.create(ownerId, 'Example', html, [{ title: 'Local', url: 'http://example.com' }], new AbortController().signal))
      .rejects.toThrow('Invalid workspace HTML artifact');
    expect(fixtureData.query).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { WorkspaceHtmlArtifactNotFound, WorkspaceHtmlArtifactStore, workspaceHtmlSizeLimit } from './workspace-html-artifact-store.js';

const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const html = '<!doctype html><html><head></head><body><h1>Example</h1></body></html>';
const sources = [{ title: 'Example', url: 'https://example.com' }];

const transactions = vi.hoisted(() => ({
  begin: vi.fn(async () => {}), commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}),
}));
vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: { request: () => unknown }) {}
    begin = transactions.begin;
    commit = transactions.commit;
    rollback = transactions.rollback;
    request() { return this.parent.request(); }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction } };
});

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
    version_number: 1,
    ...overrides,
  };
}

describe('workspace HTML artifact store', () => {
  it('archives content and updates atomically without replacing identity, Folio or pin metadata', async () => {
    const data = fixture([row({ id: artifactId.toUpperCase(), pinned: true, version_number: 2 })]);
    const result = await data.store.update(artifactId, ownerId, html, new AbortController().signal);
    expect(result).toMatchObject({ id: artifactId, version: 2, pinned: true, title: 'Example', sources });
    expect(data.input).toHaveBeenCalledWith('title', sql.NVarChar(200), null);
    expect(data.input).toHaveBeenCalledWith('sources', sql.NVarChar(sql.MAX), null);
    const statement = data.query.mock.calls[0]?.[0] ?? '';
    expect(statement).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(statement).toContain('INSERT dbo.workspace_html_artifact_versions');
    expect(statement).toContain('version_number = version_number + 1');
    expect(statement).toContain('COALESCE(@sources, sources_json)');
    expect(statement).not.toContain('DELETE');
    expect(statement).not.toContain('folio_items');
    expect(statement).not.toContain('SET pinned');
    expect(transactions.commit).toHaveBeenCalledOnce();
    expect(transactions.rollback).not.toHaveBeenCalled();
  });

  it('binds replacement metadata and rolls back failed SQL', async () => {
    const data = fixture([row({ version_number: 2 })]);
    await data.store.update(artifactId, ownerId, html, new AbortController().signal, 'Monthly totals', []);
    expect(data.input).toHaveBeenCalledWith('title', sql.NVarChar(200), 'Monthly totals');
    expect(data.input).toHaveBeenCalledWith('sources', sql.NVarChar(sql.MAX), '[]');
    data.query.mockRejectedValueOnce(new Error('SQL failure'));
    await expect(data.store.update(artifactId, ownerId, html, new AbortController().signal)).rejects.toThrow('SQL failure');
    expect(transactions.rollback).toHaveBeenCalledOnce();
    expect(transactions.commit).toHaveBeenCalledOnce();
  });

  it('refuses missing and inaccessible artifacts without committing changes', async () => {
    const data = fixture();
    for (const owner of [ownerId, '1b475880-a077-40cd-90b7-3278bfc45b5b']) {
      await expect(data.store.update(artifactId, owner, html, new AbortController().signal))
        .rejects.toBeInstanceOf(WorkspaceHtmlArtifactNotFound);
    }
    expect(transactions.commit).not.toHaveBeenCalled();
    expect(transactions.rollback).toHaveBeenCalledTimes(2);
    expect(data.query.mock.calls[0]?.[0]).toContain('WHERE id = @id AND owner_object_id = @owner');
  });

  it('reads historical versions only through an owner-scoped artifact join', async () => {
    const data = fixture([row()]);
    await expect(data.store.readVersion(artifactId, ownerId, new AbortController().signal, 1))
      .resolves.toMatchObject({ version: 1, html, sources });
    expect(data.input).toHaveBeenCalledWith('version', sql.Int, 1);
    expect(data.query.mock.calls[0]?.[0]).toContain('artifact.owner_object_id = @owner AND history.version_number = @version');
    data.setRows([]);
    await expect(data.store.readVersion(artifactId, ownerId, new AbortController().signal, 7))
      .rejects.toBeInstanceOf(WorkspaceHtmlArtifactNotFound);
  });

  it('refuses oversized updates and stored reads, and cancellation before SQL', async () => {
    const data = fixture([row({ html: 'x'.repeat(workspaceHtmlSizeLimit + 1) })]);
    await expect(data.store.update(artifactId, ownerId, 'x'.repeat(workspaceHtmlSizeLimit + 1), new AbortController().signal))
      .rejects.toThrow('Invalid workspace HTML artifact');
    expect(data.query).not.toHaveBeenCalled();
    await expect(data.store.readVersion(artifactId, ownerId, new AbortController().signal))
      .rejects.toThrow('Stored workspace HTML exceeds 512 KB');
    data.query.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(data.store.update(artifactId, ownerId, html, controller.signal)).rejects.toThrow();
    expect(data.query).not.toHaveBeenCalled();
    expect(transactions.commit).not.toHaveBeenCalled();
  });

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

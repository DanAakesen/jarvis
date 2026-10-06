import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { HtmlArtifactNotFound, HtmlArtifactStore } from './html-artifact-store.js';

const owner = '6b4d9fe9-3d9b-4cad-bae0-3f24f8b3f16e';
const artifactId = 'c9d6ba74-3d80-4b21-9cb5-cc480dd8942a';
const sources = [{ title: 'Example source', url: 'https://example.com/report' }];
const row = {
  id: artifactId,
  title: 'Research report',
  html: '<!doctype html><title>Report</title>',
  size_bytes: Buffer.byteLength('<!doctype html><title>Report</title>', 'utf8'),
  sources_json: JSON.stringify(sources),
  created_at: new Date('2026-10-06T12:00:00.000Z'),
  pinned: false,
};

function fakePool(results: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = []) {
  const query = vi.fn(async () => results.shift() ?? { recordset: [] });
  const input = vi.fn();
  const request = { input, query, cancel: vi.fn() };
  input.mockReturnValue(request);
  return {
    pool: { request: vi.fn(() => request) } as unknown as sql.ConnectionPool,
    input,
    query,
    request,
  };
}

describe('HTML artifact store', () => {
  it('stores bounded HTML and source metadata under the authenticated owner', async () => {
    const fake = fakePool([{ recordset: [row] }]);
    const store = new HtmlArtifactStore(fake.pool);
    const result = await store.create(owner, 'Research report', row.html, sources, new AbortController().signal);

    expect(result).toMatchObject({ id: artifactId, kind: 'html', title: 'Research report', sources });
    expect(fake.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(fake.input).toHaveBeenCalledWith('size', sql.Int, Buffer.byteLength(row.html, 'utf8'));
    expect(fake.input).toHaveBeenCalledWith('sources', sql.NVarChar(sql.MAX), JSON.stringify(sources));
    expect(fake.query.mock.calls[0]?.[0]).toContain('INSERT dbo.workspace_html_artifacts');
  });

  it('rejects unsafe, invalid, or oversized report content before touching SQL', async () => {
    const fake = fakePool();
    const store = new HtmlArtifactStore(fake.pool);

    await expect(store.create(owner, 'Report', '<script src="https://example.com/a.js"></script>', sources, new AbortController().signal))
      .rejects.toThrow('HTML artifact is invalid or exceeds its size limit');
    await expect(store.create(owner, 'Report', `<p>${'é'.repeat(270_000)}</p>`, sources, new AbortController().signal))
      .rejects.toThrow('HTML artifact is invalid or exceeds its size limit');
    expect(fake.pool.request).not.toHaveBeenCalled();
  });

  it('scopes reads and updates to the owner and reports inaccessible rows as not found', async () => {
    const fake = fakePool([{ recordset: [] }]);
    const store = new HtmlArtifactStore(fake.pool);

    await expect(store.get(artifactId, owner, new AbortController().signal)).rejects.toBeInstanceOf(HtmlArtifactNotFound);
    expect(fake.query.mock.calls[0]?.[0]).toContain('WHERE id = @id AND owner_object_id = @owner');
  });

  it('keeps only the current report and nineteen prior versions during edits', async () => {
    const fake = fakePool([{ recordset: [row] }]);
    await new HtmlArtifactStore(fake.pool).update(
      artifactId, owner, 'Updated report', '<!doctype html><title>Updated</title>', sources, new AbortController().signal,
    );
    const statement = fake.query.mock.calls[0]?.[0] ?? '';
    expect(statement).toContain('BEGIN TRANSACTION');
    expect(statement).toContain('INSERT dbo.workspace_html_artifact_versions');
    expect(statement).toContain('version_number < @version - 18');
    expect(statement).toContain('WHERE id = @id AND owner_object_id = @owner');
  });

  it('restores the latest saved version without allowing another owner to undo it', async () => {
    const fake = fakePool([{ recordset: [row] }]);
    await new HtmlArtifactStore(fake.pool).undo(artifactId, owner, new AbortController().signal);
    const statement = fake.query.mock.calls[0]?.[0] ?? '';
    expect(statement).toContain('MAX(version_number)');
    expect(statement).toContain('currentArtifact.owner_object_id = @owner');
    expect(statement).toContain('DELETE FROM dbo.workspace_html_artifact_versions');
  });

  it('pins only owner-owned artifacts and permits one repair attempt per version', async () => {
    const fake = fakePool([{ rowsAffected: [1] }, { rowsAffected: [1] }, { rowsAffected: [0] }]);
    const store = new HtmlArtifactStore(fake.pool);
    const signal = new AbortController().signal;

    await expect(store.setPinned(artifactId, owner, true, signal)).resolves.toBeUndefined();
    await expect(store.claimRepair(artifactId, owner, signal)).resolves.toBe(true);
    await expect(store.claimRepair(artifactId, owner, signal)).resolves.toBe(false);
    expect(fake.query.mock.calls[0]?.[0]).toContain('owner_object_id = @owner');
    expect(fake.query.mock.calls[1]?.[0]).toContain('repair_attempted = 0');
  });

  it('cancels a pending database query when its job is aborted', async () => {
    const fake = fakePool();
    const store = new HtmlArtifactStore(fake.pool);
    const controller = new AbortController();
    const pending = store.get(artifactId, owner, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(fake.request.cancel).toHaveBeenCalledOnce();
  });
});

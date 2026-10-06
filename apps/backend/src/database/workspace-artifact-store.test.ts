import { describe, expect, it, vi } from 'vitest';
import type { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import sql from 'mssql';
import {
  WorkspaceArtifactNotFound,
  WorkspaceArtifactStore,
} from './workspace-artifact-store.js';

const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const htmlId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const htmlSources = [{ title: 'Jarvis', url: 'https://example.com/research' }];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5wAAAABJRU5ErkJggg==',
  'base64',
);

function fixture(queryResult: { recordset: unknown[] } = { recordset: [] }) {
  const query = vi.fn(async () => queryResult);
  const input = vi.fn();
  const request = { input, query, cancel: vi.fn() };
  input.mockReturnValue(request);
  const blob = {
    uploadData: vi.fn(async () => {}),
    deleteIfExists: vi.fn(async () => ({ succeeded: true })),
    url: 'https://jarvisstore.blob.core.windows.net/artifacts/workspace-images/image.png',
  };
  const container = {
    containerName: 'artifacts',
    getBlockBlobClient: vi.fn(() => blob),
  } as unknown as ContainerClient;
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const serviceClient = { getUserDelegationKey: vi.fn() } as unknown as BlobServiceClient;
  const store = new WorkspaceArtifactStore({
    pool, container, serviceClient, storageAccount: 'jarvisstore',
  });
  return { store, query, input, request, blob, container, pool, serviceClient };
}

describe('workspace artifact store', () => {
  it('validates bounded owner-scoped uploads, persists metadata, and is idempotent for identical retries', async () => {
    const { store, query, input, blob, container } = fixture();
    const upload = store.registerUpload(ownerId);

    const artifactId = await store.upload(upload.uploadKey, 'image/png', png, new AbortController().signal);
    await expect(store.upload(upload.uploadKey, 'image/png', png, new AbortController().signal))
      .resolves.toBe(artifactId);

    expect(artifactId).toBe(upload.artifactId);
    expect(blob.uploadData).toHaveBeenCalledOnce();
    expect(container.getBlockBlobClient).toHaveBeenCalledWith(`workspace-images/${artifactId}.png`);
    expect(input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, ownerId);
    expect(query.mock.calls[0]?.[0]).toContain('INSERT dbo.workspace_artifacts');
  });

  it('rejects malformed content, unsupported media, exhausted keys, and different replay bytes', async () => {
    const { store, blob } = fixture();
    const upload = store.registerUpload(ownerId);

    await expect(store.upload(upload.uploadKey, 'image/png', Buffer.from('invalid'), new AbortController().signal))
      .rejects.toThrow('invalid or expired');
    await expect(store.upload(upload.uploadKey, 'image/gif', png, new AbortController().signal))
      .rejects.toThrow('invalid or expired');
    await store.upload(upload.uploadKey, 'image/png', png, new AbortController().signal);
    await expect(store.upload(upload.uploadKey, 'image/png', Buffer.concat([png, Buffer.from([0])]), new AbortController().signal))
      .rejects.toThrow('already used');
    expect(blob.uploadData).toHaveBeenCalledOnce();
    expect(() => store.registerUpload('not-an-owner')).toThrow('Invalid workspace artifact owner');
  });

  it('deletes an uploaded blob if the metadata insert fails', async () => {
    const { store, query, blob } = fixture();
    query.mockRejectedValueOnce(new Error('database unavailable'));
    const upload = store.registerUpload(ownerId);

    await expect(store.upload(upload.uploadKey, 'image/png', png, new AbortController().signal))
      .rejects.toThrow('database unavailable');

    expect(blob.uploadData).toHaveBeenCalledOnce();
    expect(blob.deleteIfExists).toHaveBeenCalledOnce();
  });

  it('authorizes reads by owner and signs short-lived HTTPS read-only Blob URLs', async () => {
    const { store, input, query, serviceClient, container } = fixture({
      recordset: [{ content_type: 'image/png' }],
    });
    const now = new Date();
    vi.mocked(serviceClient.getUserDelegationKey).mockResolvedValue({
      signedObjectId: '00000000-0000-4000-8000-000000000001',
      signedTenantId: '00000000-0000-4000-8000-000000000002',
      signedStartsOn: new Date(now.getTime() - 300_000),
      signedExpiresOn: new Date(now.getTime() + 86_400_000),
      signedService: 'b',
      signedVersion: '2022-11-02',
      value: Buffer.alloc(32, 7).toString('base64'),
    } as never);

    const url = await store.readUrl(uploadId, ownerId, new AbortController().signal);

    expect(input).toHaveBeenCalledWith('id', sql.UniqueIdentifier, uploadId);
    expect(input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, ownerId);
    expect(query.mock.calls[0]?.[0]).toContain('owner_object_id = @owner');
    expect(url).toContain('sp=r');
    expect(url).toContain('spr=https');
    expect(url).toContain('sig=');
    expect(container.getBlockBlobClient).toHaveBeenCalledWith(`workspace-images/${uploadId}.png`);
  });

  it('does not reveal an artifact when the owner-scoped lookup misses', async () => {
    const { store } = fixture();
    await expect(store.readUrl(uploadId, ownerId, new AbortController().signal))
      .rejects.toBeInstanceOf(WorkspaceArtifactNotFound);
  });

  it('keeps generated HTML transient until pinning and owner-scopes artifact reads', async () => {
    const { store, query } = fixture();
    const artifact = store.createTransientHtml(ownerId, 'create-html', 'Research', '<h1>Findings</h1>', htmlSources);
    expect(artifact).toMatchObject({ kind: 'html', title: 'Research', pinned: false, sources: htmlSources });
    await expect(store.getHtml(artifact.id, ownerId, new AbortController().signal)).resolves.toEqual(artifact);
    await expect(store.getHtml(artifact.id, 'd5b41c2f-33f4-4b4f-9a52-09346e50c8de', new AbortController().signal))
      .rejects.toBeInstanceOf(WorkspaceArtifactNotFound);
    expect(query.mock.calls.every(([statement]) => !String(statement).includes('INSERT dbo.workspace_html_artifacts'))).toBe(true);
  });

  it('pins validated HTML metadata in SQL and lists only pinned artifact summaries', async () => {
    const { store, input, query, pool, container, serviceClient } = fixture();
    const artifact = store.createTransientHtml(ownerId, 'pin-html', 'Research', '<h1>Findings</h1>', htmlSources);
    query.mockResolvedValueOnce({ recordset: [] });
    query.mockResolvedValueOnce({ recordset: [{ created_at: new Date('2026-10-06T10:00:00.000Z') }] });
    await expect(store.pinHtml(artifact.id, ownerId, new AbortController().signal))
      .resolves.toMatchObject({ id: artifact.id, pinned: true, title: 'Research' });
    expect(input).toHaveBeenCalledWith('html', sql.NVarChar(sql.MAX), '<h1>Findings</h1>');
    expect(input).toHaveBeenCalledWith('sources', sql.NVarChar(sql.MAX), JSON.stringify(htmlSources));
    expect(input).toHaveBeenCalledWith('size', sql.Int, Buffer.byteLength('<h1>Findings</h1>', 'utf8'));
    expect(query.mock.calls[1]?.[0]).toContain('INSERT dbo.workspace_html_artifacts');

    query.mockResolvedValueOnce({ recordset: [{
      id: artifact.id,
      title: 'Research',
      sources_json: JSON.stringify(htmlSources),
      created_at: new Date('2026-10-06T10:00:00.000Z'),
      pinned: true,
    }] });
    await expect(store.listPinnedHtml(ownerId, new AbortController().signal))
      .resolves.toEqual([{ id: artifact.id, kind: 'html', title: 'Research', sources: htmlSources,
        createdAt: '2026-10-06T10:00:00.000Z', pinned: true }]);

    const reloadedStore = new WorkspaceArtifactStore({
      pool, container, serviceClient, storageAccount: 'jarvisstore',
    });
    query.mockResolvedValueOnce({ recordset: [{
      id: artifact.id,
      title: 'Research',
      html: '<h1>Findings</h1>',
      sources_json: JSON.stringify(htmlSources),
      created_at: new Date('2026-10-06T10:00:00.000Z'),
      pinned: true,
    }] });
    await expect(reloadedStore.getHtml(artifact.id, ownerId, new AbortController().signal))
      .resolves.toMatchObject({ id: artifact.id, html: '<h1>Findings</h1>', pinned: true });
  });

  it('unpins an artifact by deleting its durable row while keeping it available transiently', async () => {
    const { store, query } = fixture();
    const pinnedRow = {
      id: htmlId,
      title: 'Research',
      html: '<h1>Findings</h1>',
      sources_json: JSON.stringify(htmlSources),
      created_at: new Date('2026-10-06T10:00:00.000Z'),
      pinned: true,
    };
    query.mockResolvedValueOnce({ recordset: [pinnedRow] });
    query.mockResolvedValueOnce({ recordset: [] });
    await store.unpinHtml(htmlId, ownerId, new AbortController().signal);
    expect(query.mock.calls[1]?.[0]).toContain('DELETE dbo.workspace_html_artifacts');
    await expect(store.getHtml(htmlId, ownerId, new AbortController().signal))
      .resolves.toMatchObject({ id: htmlId, pinned: false, html: '<h1>Findings</h1>' });
  });
});

const uploadId = htmlId;

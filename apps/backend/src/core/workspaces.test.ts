import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { WorkspaceHtmlArtifactNotFound, type WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import { WorkspaceItemNotFound, type WorkspaceItemsStore } from '../database/workspace-items-store.js';
import { createWorkspacesModule } from './workspaces.js';

const itemId = 'html_app:5eed0000-0000-4000-8000-000000000001';
const request = { agentPrincipal: { objectId: 'agent' }, server: { ownerObjectId: '12bcfab7-49ba-4cf7-8be7-780a13911f93' } } as unknown as FastifyRequest;
const notFound = { name: 'ToolRefusal', message: 'That Workspaces item was not found.' };

function open(name: string, store: Partial<WorkspaceItemsStore>, htmlArtifacts: Partial<WorkspaceHtmlArtifactStore> = {}) {
  const tool = createWorkspacesModule(store as WorkspaceItemsStore, htmlArtifacts as WorkspaceHtmlArtifactStore).tools.find((entry) => entry.name === name)!;
  return tool.execute({ id: itemId }, request, new AbortController().signal);
}

describe('opening a saved Workspaces item that is gone', () => {
  it.each(['workspaces_open', 'folio_open'])('%s says the item was not found instead of failing', async (name) => {
    await expect(open(name, { get: async () => { throw new WorkspaceItemNotFound(); } })).rejects.toMatchObject(notFound);
  });

  it('says so too when the item is listed but its saved page is gone', async () => {
    const store = { get: async () => ({ item: { id: itemId, kind: 'html_app', title: 'Spending', promptSummary: 'Spending', createdAt: '2026-11-20T09:00:00.000Z', pinned: false }, sourceId: itemId.slice(9) }) };
    await expect(open('workspaces_open', store as unknown as Partial<WorkspaceItemsStore>, { read: async () => { throw new WorkspaceHtmlArtifactNotFound(); } }))
      .rejects.toMatchObject(notFound);
  });
});

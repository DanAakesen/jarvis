import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRefusal } from '../core/tool-registry.js';
import { repositoryTools } from './repository-tools.js';

const tool = (name: string) => repositoryTools.find((candidate) => candidate.name === name)!;
const issuer = { issueForContents: async () => 'installation-token', issueForRepositoryRead: async () => 'installation-token' };
const request = { server: { githubAppTokenIssuer: issuer } } as unknown as FastifyRequest;
const signal = new AbortController().signal;
const caught = (work: Promise<unknown>) => work.then(() => undefined, (error: unknown) => error);

afterEach(() => { vi.unstubAllGlobals(); });

describe('repo_read', () => {
  it('refuses to read a folder as a file and points to repo_list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/contents')
      ? new Response(JSON.stringify([{ name: 'tools.ts', path: 'apps/backend/src/factory/tools.ts', type: 'file', size: 10 }]), { status: 200 })
      : new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 })));
    const error = await caught(tool('repo_read').execute({ path: 'apps/backend/src/factory' }, request, signal));
    expect(error).toBeInstanceOf(ToolRefusal);
    expect((error as Error).message).toBe('That repository path is a folder, not a file; use repo_list to see what is in it.');
  });
});

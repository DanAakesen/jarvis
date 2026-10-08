import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import { buildApp } from '../app.js';
import type { BackendModule } from '../modules.js';
import type { ToolCallStore } from './tool-calls.js';
import { coreModule } from './index.js';
import { createHtmlViewModule } from './html-view.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const otherId = '1b475880-a077-40cd-90b7-3278bfc45b5b';
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const html = '<!doctype html><html><head><title>Example</title></head><body><h1>Example</h1></body></html>';
const artifact = {
  id: artifactId,
  kind: 'html' as const,
  title: 'Example',
  html,
  sources: [{ title: 'Example', url: 'https://example.com' }],
  createdAt: '2026-10-06T10:00:00.000Z',
  pinned: false,
};
const appInstances: ReturnType<typeof buildApp>[] = [];
const authorization = (token: string) => ({ authorization: `${['Bear', 'er'].join('')} ${token}` });

function appFor(options: {
  readonly connected?: boolean;
  readonly create?: WorkspaceHtmlArtifactStore['create'];
  readonly read?: WorkspaceHtmlArtifactStore['read'];
  readonly setPinned?: WorkspaceHtmlArtifactStore['setPinned'];
} = {}) {
  const create = options.create ?? vi.fn(async () => artifact);
  const read = options.read ?? vi.fn(async () => artifact);
  const setPinned = options.setPinned ?? vi.fn(async (_id: string, _owner: string, pinned: boolean) => pinned);
  const artifacts = { create, read, setPinned } as unknown as WorkspaceHtmlArtifactStore;
  const execute = vi.fn(async () => ({ opened: true }));
  const pcModule: BackendModule = {
    id: 'pc-test',
    tools: [{
      name: 'pc_open',
      description: 'Open a URL in Chrome.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute,
    }],
    registerRoutes: async () => {},
  };
  const workspaceCommands = {
    isConnected: vi.fn(() => options.connected ?? true),
    execute: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const record = vi.fn(async () => {});
  const auth: TokenVerifier = async (token) => {
    if (token === 'agent.e30.sig') {
      return { kind: 'jarvis-agent', objectId: ownerId, tenantId: config.auth.tenantId };
    }
    if (token === 'other.e30.sig') {
      return { objectId: otherId, tenantId: config.auth.tenantId, displayName: 'Other' };
    }
    return { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' };
  };
  const app = buildApp(config, undefined, {
    auth,
    modules: [coreModule, createHtmlViewModule(artifacts), pcModule],
    toolCallStore: { record } as unknown as ToolCallStore,
    workspaceCommands: workspaceCommands as never,
  });
  appInstances.push(app);
  return { app, create, read, setPinned, execute, workspaceCommands, record };
}

afterEach(async () => {
  await Promise.all(appInstances.splice(0).map((app) => app.close()));
});

describe('HTML workspace app routes and tool', () => {
  it('describes bounded, self-contained visual apps for the sandbox CSP', () => {
    const fixture = appFor();
    const description = fixture.app.jarvisTools.get('create_html_view')?.description ?? '';
    expect(description).toContain('within 512 KB');
    expect(description).toContain('up to 50 HTTPS sources');
    expect(description).toContain('inline scripts and styles');
    expect(description).toContain("connect-src 'none'");
    expect(description).toContain('do not use external libraries, scripts, stylesheets or fetches');
    expect(description).toContain('hand-written inline SVG or canvas');
  });

  it('creates an artifact and opens only its reference through the workspace command path', async () => {
    const fixture = appFor();
    const payload = { title: artifact.title, html, sources: artifact.sources };
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/tools/create_html_view',
      headers: { ...authorization('agent.e30.sig'), 'x-jarvis-message-id': '42' },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tool: 'create_html_view',
      outcome: 'ok',
      result: { artifactId, confirmation: 'HTML app opened in the sandboxed workspace.' },
    });
    expect(fixture.create).toHaveBeenCalledWith(ownerId, 'Example', html, artifact.sources, expect.any(AbortSignal));
    expect(fixture.workspaceCommands.execute).toHaveBeenCalledWith(ownerId, {
      commandId: expect.any(String),
      operation: 'create',
      viewId: `html-${artifactId.replaceAll('-', '')}`,
      view: expect.objectContaining({
        title: 'Example',
        renderer: 'html-app',
        data: { artifactId },
      }),
    }, expect.any(AbortSignal));
    expect(fixture.record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'create_html_view',
      arguments: { redacted: true },
      result: { redacted: true },
    }));
    expect(JSON.stringify(fixture.record.mock.calls[0]?.[0])).not.toContain('<h1>Example</h1>');
  });

  it('refuses invalid HTML and creation when no signed-in workspace is connected', async () => {
    const invalid = appFor();
    const response = await invalid.app.inject({
      method: 'POST',
      url: '/tools/create_html_view',
      headers: { ...authorization('agent.e30.sig'), 'x-jarvis-message-id': '43' },
      payload: { title: 'Example', html: '<html><head></head><body>x</body></html>', sources: [] },
    });
    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(invalid.create).not.toHaveBeenCalled();

    const disconnected = appFor({ connected: false });
    const offlineResponse = await disconnected.app.inject({
      method: 'POST',
      url: '/tools/create_html_view',
      headers: { ...authorization('agent.e30.sig'), 'x-jarvis-message-id': '44' },
      payload: { title: 'Example', html, sources: [] },
    });
    expect(offlineResponse.json()).toMatchObject({ outcome: 'refused' });
    expect(disconnected.create).not.toHaveBeenCalled();
  });

  it('serves HTML only as owner-authorized JSON and persists pin state', async () => {
    const fixture = appFor();
    const response = await fixture.app.inject({
      url: `/factory/workspace-artifacts/html/${artifactId}`,
      headers: authorization('user.e30.sig'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual(artifact);
    expect(fixture.read).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));

    const other = await fixture.app.inject({
      url: `/factory/workspace-artifacts/html/${artifactId}`,
      headers: authorization('other.e30.sig'),
    });
    expect(other.statusCode).toBe(404);
    expect(fixture.read).toHaveBeenCalledOnce();

    const pinned = await fixture.app.inject({
      method: 'PATCH',
      url: `/factory/workspace-artifacts/html/${artifactId}`,
      headers: { ...authorization('user.e30.sig'), 'content-type': 'application/json' },
      payload: { pinned: true },
    });
    expect(pinned.json()).toEqual({ pinned: true });
    expect(fixture.setPinned).toHaveBeenCalledWith(artifactId, ownerId, true, expect.any(AbortSignal));
  });

  it('routes validated open_url bridge requests through pc_open and rejects non-owners', async () => {
    const fixture = appFor();
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/html/open-url',
      headers: { ...authorization('user.e30.sig'), 'content-type': 'application/json' },
      payload: { url: 'https://example.com/path' },
    });
    expect(response.json()).toEqual({ opened: true });
    expect(fixture.execute).toHaveBeenCalledWith(
      { target: 'url', value: 'https://example.com/path' },
      expect.objectContaining({ principal: expect.objectContaining({ objectId: ownerId }) }),
      expect.any(AbortSignal),
    );

    expect((await fixture.app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/html/open-url',
      headers: { ...authorization('other.e30.sig'), 'content-type': 'application/json' },
      payload: { url: 'https://example.com' },
    })).statusCode).toBe(403);
    expect((await fixture.app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/html/open-url',
      headers: { ...authorization('user.e30.sig'), 'content-type': 'application/json' },
      payload: { url: 'javascript:alert(1)' },
    })).statusCode).toBe(400);
    expect(fixture.execute).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedView, WorkspaceCommand } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { WorkspaceHtmlArtifactNotFound, type WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import { coreModule } from './index.js';
import { createHtmlViewModule } from './html-view.js';
import { WorkspaceCommandBroker } from './workspace-commands.js';
import { workspaceContext } from './workspace-context.js';
import { capabilityInstructions } from './capability-instructions.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const otherId = '1b475880-a077-40cd-90b7-3278bfc45b5b';
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const headers = (identity = 'agent') => ({
  authorization: ['Bearer', `header.${identity}.signature`].join(' '),
  'x-jarvis-message-id': '101',
});
const base = { version: 1 as const, title: 'Report', source: { id: 'research', status: 'complete' as const } };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(html = '<!doctype html><html><body><h1>Report</h1></body></html>') {
  const artifact = {
    id: artifactId, kind: 'html' as const, title: 'HTML report', html,
    sources: [{ title: 'Evidence', url: 'https://example.com/report' }],
    createdAt: '2026-10-10T08:00:00Z', pinned: false,
  };
  const read = vi.fn(async () => artifact);
  const store = { create: vi.fn(async () => artifact), read } as unknown as WorkspaceHtmlArtifactStore;
  const broker = new WorkspaceCommandBroker();
  const record = vi.fn(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule, createHtmlViewModule(store)], workspaceCommands: broker, workspaceHtmlArtifacts: store,
    toolCallStore: { record },
    auth: async (token) => token === 'header.agent.signature'
      ? { kind: 'jarvis-agent', objectId: otherId, tenantId: config.auth.tenantId }
      : { objectId: token === 'header.other.signature' ? otherId : ownerId, tenantId: config.auth.tenantId, displayName: 'User' },
  });
  apps.push(app);
  const connection = broker.connect(ownerId, (event, data) => {
    if (event === 'workspace-command') broker.acknowledge(ownerId, connection.sessionId, data.command.commandId, true);
    return true;
  });
  const send = (view: GeneratedView, viewId = 'report', operation: 'create' | 'update' = 'create') =>
    app.inject({ method: 'POST', url: '/tools/workspace_command', headers: headers(),
      payload: { commandId: `command-${++sequence}`, operation, viewId, view } });
  let sequence = 0;
  const readWindow = (viewId = 'report', identity = 'agent') => app.inject({
    method: 'POST', url: '/tools/read_window', headers: headers(identity), payload: { viewId },
  });
  return { app, broker, connection, send, readWindow, read, record };
}

describe('read_window', () => {
  it.each([
    { ...base, renderer: 'chart', data: { kind: 'line', series: [
      { name: 'Revenue (USD)', points: [{ x: 'October', y: 42 }] },
      { name: 'Costs (USD)', points: [{ x: 'October', y: 12 }] },
    ] } },
    { ...base, renderer: 'timeline', data: { events: [
      { at: '1880-11-13', title: 'Founded' }, { label: '2009/10', title: 'Season', description: 'Won' },
    ] } },
    { ...base, renderer: 'list', data: { items: [{ title: 'Finding', description: 'Supported by evidence' }] } },
    { ...base, renderer: 'table', data: { columns: ['Name', 'Count'], rows: [['Finding', 42]] } },
  ] satisfies GeneratedView[])('reads a generated $renderer and preserves its data and units', async (view) => {
    const { send, readWindow, record } = fixture();
    expect((await send(view)).json().outcome).toBe('ok');
    const result = (await readWindow()).json();
    expect(result.outcome).toBe('ok');
    expect(result.result).toMatchObject({ viewId: 'report', untrusted: true });
    expect(result.result.text).toContain(`Report\nRenderer: ${view.renderer}`);
    const delivered = JSON.parse(result.result.text.split('\n')[2]);
    const expectedData = view.renderer === 'table'
      ? { ...view.data, rows: [['Finding', '42']] } : view.data;
    expect(delivered).toMatchObject(expectedData);
    expect(Buffer.byteLength(result.result.text)).toBeLessThanOrEqual(8192);
    expect(record.mock.calls.at(-1)).toEqual([expect.objectContaining({
      tool: 'read_window', arguments: { redacted: true }, result: { redacted: true },
    })]);
  });

  it('reads an HTML report created by Jarvis without scripts, styles, markup or hidden text', async () => {
    const html = '<!doctype html><html><head><title>Secret head</title><style>.x{color:red}</style></head><body>' +
      '<h1>Results &amp; analysis</h1><p>Revenue is <strong>42 USD</strong>.</p><svg><text>Chart label</text></svg>' +
      '<script>privateScript()</script><!-- private comment --><template>private template</template>' +
      '<p hidden>private hidden</p><p aria-hidden="true">private aria</p><p style="display:none">private style</p>' +
      '<p>&lt;script&gt;quoted markup&lt;/script&gt;</p></body></html>';
    const { app, readWindow, read } = fixture(html);
    const created = await app.inject({
      method: 'POST', url: '/tools/create_html_view', headers: headers(),
      payload: { title: 'HTML report', html, sources: [{ title: 'Evidence', url: 'https://example.com/report' }] },
    });
    expect(created.json().outcome).toBe('ok');
    const response = await readWindow(`html-${artifactId.replaceAll('-', '')}`);
    const text = response.json().result.text;
    expect(text).toContain('HTML report\nRenderer: html-app\nSources: Evidence (https://example.com/report)');
    expect(text).toContain('Results & analysis Revenue is 42 USD');
    expect(text).toContain('Chart label');
    expect(text).not.toMatch(/private|Secret head|<|>/u);
    expect(read).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));
  });

  it('prefers page content and includes selection, including for non-generated windows', async () => {
    const { app, connection, send, readWindow, read } = fixture();
    await send({ ...base, renderer: 'list', data: { items: [{ title: 'Cached finding' }] } });
    const state = await app.inject({
      method: 'POST', url: '/now/workspace/state', headers: headers('owner'),
      payload: { sessionId: connection.sessionId, contextPanelOpen: false, windows: [
        { viewId: 'report', title: 'Live report', content: 'Page finding: Array<T> &amp;\n  indented', selection: 'Selected finding: Array<T>' },
        { viewId: 'settings', title: 'Settings', content: 'Voice: Ryan', front: true },
        { viewId: 'task', title: 'Task', selection: 'Selected task detail' },
      ] },
    });
    expect(state.statusCode).toBe(204);
    const text = (await readWindow()).json().result.text;
    expect(text).toContain('Selection: Selected finding');
    expect(text).toContain('Page finding');
    expect(text).toContain('Array‹T› &amp;\n  indented');
    expect(text).not.toMatch(/Cached finding|bad\(\)|<|>/u);
    expect((await readWindow('settings', 'owner')).json().result.text).toContain('Voice: Ryan');
    expect((await readWindow('task')).json().result.text).toContain('Selection: Selected task detail');
    expect(read).not.toHaveBeenCalled();
  });

  it('uses front as the snapshot resolution hint without exposing page content in model context', () => {
    const context = workspaceContext({ windows: [
      { viewId: 'first', title: 'First' }, { viewId: 'report', title: 'Report', front: true, content: 'Private page text' },
    ], contextPanelOpen: false });
    expect(context).toContain('"Report" [viewId=report] (focused)');
    expect(context).not.toContain('Private page text');
    expect(capabilityInstructions({ automaticCapture: false })).toContain('read_window with its viewId resolved from front/focus and titles');
  });

  it('falls back for old snapshots, reads the latest update, and retains a defensive bounded cache', async () => {
    const { broker, connection, send, readWindow } = fixture();
    await send({ ...base, renderer: 'text', data: { format: 'plain', content: 'Old' } });
    await send({ ...base, renderer: 'text', data: { format: 'plain', content: 'Latest' } }, 'report', 'update');
    broker.updateSnapshot(ownerId, connection.sessionId, { windows: [{ viewId: 'report', title: 'Report' }], contextPanelOpen: false });
    const copy = broker.view(ownerId, 'report')!;
    copy.title = 'Mutated';
    expect((await readWindow()).json().result.text).toContain('Report\nRenderer: text');
    expect((await readWindow()).json().result.text).toContain('Latest');
    expect(broker.view(otherId, 'report')).toBeUndefined();
    for (let index = 0; index < 128; index += 1) {
      await broker.execute(ownerId, { commandId: `evict-${index}`, operation: 'show', viewId: 'report' }, new AbortController().signal);
    }
    expect(broker.view(ownerId, 'report')).toBeUndefined();
  });

  it('refuses unknown IDs, non-owner callers, and malformed tool input', async () => {
    const { app, send, readWindow } = fixture();
    await send({ ...base, renderer: 'list', data: { items: [{ title: 'Private finding' }] } });
    expect((await readWindow('unknown')).json().outcome).toBe('refused');
    const denied = await readWindow('report', 'other');
    expect(denied.json().outcome).toBe('refused');
    expect(denied.body).not.toContain('Private finding');
    for (const payload of [{ viewId: '../report' }, {}, { viewId: 'report', extra: true }]) {
      expect((await app.inject({ method: 'POST', url: '/tools/read_window', headers: headers(), payload })).json().outcome).toBe('refused');
    }
  });

  it('refuses unavailable HTML reports and bounds large Unicode text, rows and events', async () => {
    const { send, readWindow, read } = fixture();
    await send({ ...base, renderer: 'html-app', data: { artifactId } });
    read.mockRejectedValueOnce(new WorkspaceHtmlArtifactNotFound());
    expect((await readWindow()).json().outcome).toBe('refused');
    await send({ ...base, renderer: 'text', data: { format: 'plain', content: '😀'.repeat(5000) } }, 'report', 'update');
    const text = (await readWindow()).json().result.text;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
    expect(text).toContain('[truncated]');
    expect(text).not.toContain('\ufffd');
    for (const view of [
      { ...base, renderer: 'list', data: { items: Array.from({ length: 51 }, (_, i) => ({ title: `Row-${i}` })) } },
      { ...base, renderer: 'table', data: { columns: ['Name'], rows: Array.from({ length: 51 }, (_, i) => [`Row-${i}`]) } },
      { ...base, renderer: 'timeline', data: { events: Array.from({ length: 101 }, (_, i) => ({ label: 'Season', title: `Event-${i}` })) } },
    ] satisfies GeneratedView[]) {
      await send(view, 'report', 'update');
      const text = (await readWindow()).json().result.text;
      expect(text).toContain('"omitted":1');
      expect(text).not.toMatch(/Row-50|Event-100/u);
    }
  });

  it.each([
    { content: 'x'.repeat(8193) }, { selection: 'x'.repeat(2049) },
    { content: '😀'.repeat(2049) }, { selection: '😀'.repeat(513) },
  ])('rejects oversize snapshot text at the HTTP boundary', async (fields) => {
    const { app, connection } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/now/workspace/state', headers: headers('owner'),
      payload: { sessionId: connection.sessionId, contextPanelOpen: false,
        windows: [{ viewId: 'report', title: 'Report', ...fields }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('does not cache views that were never sent', async () => {
    const broker = new WorkspaceCommandBroker();
    const connection = broker.connect(ownerId, () => false);
    const command: WorkspaceCommand = { commandId: 'failed', operation: 'create', viewId: 'report',
      view: { ...base, renderer: 'list', data: { items: [] } } };
    await expect(broker.execute(ownerId, command, new AbortController().signal)).rejects.toThrow();
    expect(broker.view(ownerId, 'report')).toBeUndefined();
    connection.close();
    broker.dispose();
  });

  it('retains the previous readable view when every tab refuses a replacement', async () => {
    const broker = new WorkspaceCommandBroker();
    let applied = true;
    const connection = broker.connect(ownerId, (event, data) => {
      if (event === 'workspace-command') broker.acknowledge(ownerId, connection.sessionId,
        data.command.commandId, applied, applied ? undefined : 'Window already exists');
      return true;
    });
    const view: GeneratedView = { ...base, renderer: 'text', data: { format: 'plain', content: 'Visible' } };
    await broker.execute(ownerId, { commandId: 'original', operation: 'create', viewId: 'report', view }, new AbortController().signal);
    applied = false;
    await expect(broker.execute(ownerId, { commandId: 'replacement', operation: 'create', viewId: 'report',
      view: { ...view, data: { format: 'plain', content: 'Never shown' } } }, new AbortController().signal)).rejects.toThrow();
    expect(broker.view(ownerId, 'report')).toEqual(view);
    connection.close();
    broker.dispose();
  });

  it('preserves literal code, entities and whitespace without returning raw markup', async () => {
    const { send, readWindow } = fixture();
    await send({ ...base, renderer: 'code', data: {
      repo: 'DanAakesen/jarvis', path: 'example.ts',
      content: 'const items: Array<T> = [];\n  // &amp; stays literal', language: 'typescript',
    } });
    const text = (await readWindow()).json().result.text;
    expect(text).toContain('Array‹T›');
    expect(text).toContain('\\n  // &amp; stays literal');
    expect(text).not.toMatch(/<|>/u);
  });
});

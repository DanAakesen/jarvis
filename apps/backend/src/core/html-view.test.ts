import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { WorkspaceHtmlArtifactNotFound } from '../database/workspace-html-artifact-store.js';
import { createHtmlViewModule } from './html-view.js';
import { coreModule } from './index.js';
import { WorkspaceCommandBroker } from './workspace-commands.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const owner = config.auth.ownerObjectId;
const artifactId = '3b6f0a52-8c1d-4e5a-9f0b-2a6d9e4b1c07';
const compactId = artifactId.replaceAll('-', '');
const page = (text: string) => `<!doctype html><html><head><title>Report</title></head><body><p>${text}</p></body></html>`;

/** The one saved artifact, as the SQL store keeps it: reads find it, an update adds a version. */
let version = 1;
const current = (id: string) => {
  if (id !== artifactId) throw new WorkspaceHtmlArtifactNotFound();
  return { id, kind: 'html', title: 'Report', html: page('first'), sources: [], createdAt: '2026-11-18T09:30:00.000Z', pinned: false, version };
};
const store = {
  readVersion: async (id: string) => current(id),
  create: async () => current(artifactId),
  update: async (id: string) => { current(id); version += 1; return current(id); },
};

/** Dan's signed-in tab. `applies` says which commands the page can apply; it refuses an update for a window that is not open. */
let applies: (operation: string) => boolean = () => true;
const sent: { operation: string; viewId?: string }[] = [];
const broker = new WorkspaceCommandBroker();
const tab = broker.connect(owner, (...[event, data]) => {
  if (event === 'workspace-command') {
    const { command } = data;
    sent.push({ operation: command.operation, ...('viewId' in command ? { viewId: command.viewId } : {}) });
    const applied = applies(command.operation);
    queueMicrotask(() => {
      broker.acknowledge(owner, tab.sessionId, command.commandId, applied, applied ? undefined : 'No window with that viewId is open.');
    });
  }
  return true;
});

const app = buildApp(config, undefined, {
  modules: [coreModule, createHtmlViewModule(store as never)],
  auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
  toolCallStore: { record: async () => {} },
  workspaceCommands: broker,
});

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  version = 1;
  applies = () => true;
  sent.length = 0;
});

/** One call to an HTML view tool through the real dispatcher, as Jarvis makes it. */
async function callTool(name: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST', url: `/tools/${name}`, payload,
    headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' },
  });
  return response.json() as { outcome: string; result: Record<string, unknown>; confirmation: string };
}

describe('read_html_view by window id', () => {
  it.each(['html', 'research'])('finds the saved artifact behind a %s window the broker has not seen', async (prefix) => {
    const answer = await callTool('read_html_view', { viewId: `${prefix}-${compactId}` });
    expect(answer).toMatchObject({ outcome: 'ok', result: { artifactId, version: 1 } });
  });
});

describe('update_html_view', () => {
  const update = { artifactId, html: page('second') };

  it('updates the window that shows the app, without opening another', async () => {
    const answer = await callTool('update_html_view', update);
    expect(answer).toMatchObject({ outcome: 'ok', result: { artifactId, version: 2 } });
    expect(sent.map((command) => command.operation)).toEqual(['update']);
  });

  it('opens the app in a window when none is open to update', async () => {
    applies = (operation) => operation !== 'update';
    const answer = await callTool('update_html_view', update);
    expect(answer).toMatchObject({ outcome: 'ok', result: { artifactId, version: 2 } });
    expect(sent).toEqual([{ operation: 'update', viewId: `html-${compactId}` }, { operation: 'create', viewId: `html-${compactId}` }]);
  });

  it('still reports the saved version when no window can show it, as written and not as "Not done."', async () => {
    applies = () => false;
    const answer = await callTool('update_html_view', update);
    expect(answer.outcome).toBe('error');
    expect(answer.result.error).toMatch(new RegExp(`${artifactId} version 2 was saved`, 'u'));
    // The version is saved: the call is not "Not done", and a replay of it must not save a third version.
    expect(answer.result.outcomeUnknown).toBe(true);
    expect(answer.confirmation).toBe(answer.result.error);
  });

  it('says the same for a new app that was saved but could not be opened', async () => {
    applies = () => false;
    const answer = await callTool('create_html_view', { title: 'Report', html: page('first'), sources: [] });
    expect(answer).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(answer.confirmation).toMatch(/^HTML app \S+ was saved, but the active workspace could not display it\.$/u);
  });
});

describe('the refusal for HTML that is not a valid document', () => {
  it.each([
    ['create_html_view', { title: 'Report', html: '<html><body>Hi</body></html>', sources: [] }],
    ['update_html_view', { artifactId, html: '<div>Hi</div>' }],
  ])('%s names the doctype and parse error rule', async (tool, payload) => {
    const answer = await callTool(tool, payload);
    expect(answer.outcome).toBe('refused');
    expect(answer.result.refused).toMatch(/starts with <!doctype html>/u);
    expect(answer.result.refused).toMatch(/no HTML parse errors/u);
  });
});

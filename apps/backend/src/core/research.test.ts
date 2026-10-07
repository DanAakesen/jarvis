import { randomUUID } from 'node:crypto';
import type { InvocationAccepted, InvocationSnapshot } from '../foundry/client.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { BackendModule } from '../modules.js';
import { isBackgroundJob, isHtmlArtifact, isHtmlArtifactFrame, type BackgroundJob, type HtmlArtifact, type HtmlArtifactFrame, type WorkspaceCommand } from '@jarvis/contracts';
import { createHtmlResearchModule, defaultReportFrame, reportFrame, researchWindowTitle } from './research.js';
import { coreModule } from './index.js';
import { WorkspaceCommandBroker } from './workspace-commands.js';
import type { WebResearchClient } from './web-research.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const agentHeaders = {
  authorization: ['Bearer', 'header.agent.signature'].join(' '),
  'x-jarvis-message-id': '101',
};
const frame: HtmlArtifactFrame = {
  widthPx: 390,
  heightPx: 844,
  device: 'phone',
  theme: 'dark',
  reducedMotion: true,
  density: 'comfortable',
  designTokens: { '--text': '#ffffff' },
  fonts: { body: 'system-ui', heading: 'system-ui', mono: 'monospace' },
  layout: 'layered',
  pinned: false,
};
const reportHtml = (url = 'https://example.com/source-1') => `<!doctype html>
<html><head><title>Research report</title><style>body { font-family: system-ui; }</style></head>
<body><h1>Research report</h1><p>Evidence-backed finding.</p>
<a href="${url}">Source</a><script>document.title = 'Research report';</script></body></html>`;
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function makeRunner(report = reportHtml(), firstSearchGate?: Promise<void>) {
  let invocation = 0;
  const results = new Map<string, unknown>();
  const requests: { tool: string; query: string }[] = [];
  const accepted = (id: string): InvocationAccepted => ({
    invocationId: id,
    sessionId: `session-${id}`,
    status: 'queued',
    agent: 'codex',
  });
  const client: WebResearchClient = {
    startCodexTool: vi.fn(async (tool, query) => {
      invocation += 1;
      const id = `invocation-${invocation}`;
      requests.push({ tool, query });
      if (invocation === 1 && firstSearchGate) await firstSearchGate;
      results.set(id, tool === 'web_research'
        ? {
          answer: `Finding ${invocation} is supported by retrieved evidence.`,
          sources: [{ title: `Source ${invocation}`, url: `https://example.com/source-${invocation}` }],
        }
        : { title: 'Research report', html: report, spokenSummary: 'The research found a supported result.' });
      return accepted(id);
    }),
    status: vi.fn(async (id) => ({
      ...accepted(id),
      startedAt: 0,
      finishedAt: 1,
      events: [],
      result: results.get(id) ?? null,
      error: null,
      status: 'completed',
    } as InvocationSnapshot)),
    cancel: vi.fn(async (id) => ({ invocationId: id, status: 'cancelled' })),
    deleteSession: vi.fn(async () => {}),
  };
  return { client, requests };
}

function fixture(runner: ReturnType<typeof makeRunner>) {
  const broker = new WorkspaceCommandBroker();
  const commands: WorkspaceCommand[] = [];
  const artifacts: HtmlArtifact[] = [];
  const artifactStore = {
    create: vi.fn(async (owner: string, title: string, html: string, sources: HtmlArtifact['sources']) => {
      const artifact: HtmlArtifact = {
        id: randomUUID(),
        kind: 'html',
        title,
        html,
        sources,
        createdAt: new Date().toISOString(),
        pinned: false,
      };
      if (owner !== ownerId || !isHtmlArtifact(artifact)) throw new Error('invalid artifact');
      artifacts.push(artifact);
      return artifact;
    }),
  };
  const researchModule = createHtmlResearchModule(
    () => runner.client,
    'gpt-5.5',
    artifactStore,
    { invocationTimeoutMs: 100, pollIntervalMs: 1 },
  );
  const module: BackendModule = researchModule;
  const app = buildApp(config, undefined, {
    modules: [coreModule, module],
    auth: async () => ({
      kind: 'jarvis-agent',
      objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef',
      tenantId: config.auth.tenantId,
    }),
    toolCallStore: { record: async () => {} },
    workspaceCommands: broker,
  });
  apps.push(app);
  const connection = broker.connect(ownerId, (event, data) => {
    if (event === 'workspace-command') {
      const command = (data as { command: WorkspaceCommand }).command;
      commands.push(command);
      broker.acknowledge(ownerId, connection.sessionId, command.commandId, true);
    }
    return true;
  });
  broker.updateSnapshot(ownerId, connection.sessionId, {
    windows: [],
    contextPanelOpen: false,
    frame,
  });
  return { app, broker, commands, artifacts, artifactStore, runner: runner.client };
}

async function startResearch(app: ReturnType<typeof buildApp>) {
  return app.inject({
    method: 'POST',
    url: '/tools/research',
    headers: agentHeaders,
    payload: { topic: 'Evidence-based research', depth: 'quick' },
  });
}

describe('background interactive research', () => {
  it('keeps window titles to a few words', () => {
    expect(researchWindowTitle(undefined, 'Microsoft Foundry IQ: what it is, core architecture, and how it compares. Present the findings as a visual cited report with diagrams'))
      .toBe('Research: Microsoft Foundry IQ');
    expect(researchWindowTitle('Foundry IQ overview', 'anything')).toBe('Research: Foundry IQ overview');
    expect(researchWindowTitle('Research Azure pricing', 'x')).toBe('Research Azure pricing');
    expect(researchWindowTitle(undefined, 'one two three four five six seven eight')).toBe('Research: one two three four five six');
    expect(researchWindowTitle(undefined, 'a'.repeat(120)).length).toBeLessThanOrEqual('Research: '.length + 48);
  });

  it('falls back to a valid default frame until the web app reports its window', () => {
    expect(isHtmlArtifactFrame(defaultReportFrame)).toBe(true);
    expect(reportFrame(undefined)).toEqual(defaultReportFrame);
    expect(reportFrame({ windows: [], contextPanelOpen: false })).toEqual(defaultReportFrame);
    expect(reportFrame({ windows: [], contextPanelOpen: false, frame: { ...frame, pinned: true } })).toEqual({ ...frame, pinned: false });
  });

  it('returns after opening progress, then stores a valid report and replaces that view', async () => {
    const gate = deferred();
    const runner = makeRunner(reportHtml(), gate.promise);
    const { app, commands, artifacts, artifactStore } = fixture(runner);
    const completion = vi.fn();
    const jobEvents: BackgroundJob[] = [];
    app.jarvisActivityHub.subscribe((event) => { if (event.type === 'job') jobEvents.push(event.job); });
    app.addHook('preHandler', (request, _reply, done) => {
      request.announceResearchCompletion = completion;
      done();
    });
    const response = await startResearch(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { message: expect.stringContaining('Research has started') } });
    expect(commands[0]).toMatchObject({ operation: 'create', view: { renderer: 'list', source: { id: 'research' } } });
    expect(runner.client.startCodexTool).toHaveBeenCalledTimes(1);

    gate.resolve();
    await vi.waitFor(() => expect(commands.at(-1)?.view.renderer).toBe('html-app'));

    expect(runner.requests).toHaveLength(3);
    expect(runner.requests.map(({ tool }) => tool)).toEqual(['web_research', 'web_research', 'html_report']);
    expect(JSON.parse(runner.requests[2]!.query)).toMatchObject({
      frame: { widthPx: 390, device: 'phone', theme: 'dark', reducedMotion: true, layout: 'layered' },
    });
    expect(artifactStore.create).toHaveBeenCalledOnce();
    expect(artifacts).toHaveLength(1);
    expect(isHtmlArtifact(artifacts[0])).toBe(true);
    expect(commands.at(-1)).toMatchObject({
      operation: 'update',
      view: { renderer: 'html-app', data: { artifactId: artifacts[0]!.id } },
    });
    expect(completion).toHaveBeenCalledWith({
      status: 'complete',
      summary: 'The research found a supported result.',
    });
    expect(jobEvents[0]).toMatchObject({ kind: 'research', status: 'running', step: 0, steps: 3 });
    expect(jobEvents.every((job) => isBackgroundJob(job))).toBe(true);
    expect(jobEvents.at(-1)).toMatchObject({ status: 'done', step: 3, viewId: (commands.at(-1) as { viewId: string }).viewId });
    expect((await app.backgroundJobs.list())[0]).toMatchObject({ status: 'done' });
  });

  it('rejects unsafe generated citations and updates the progress window with failure', async () => {
    const runner = makeRunner(reportHtml('https://untrusted.example/forged'));
    const { app, commands, artifactStore } = fixture(runner);
    const completion = vi.fn();
    app.addHook('preHandler', (request, _reply, done) => {
      request.announceResearchCompletion = completion;
      done();
    });
    const response = await startResearch(app);

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    await vi.waitFor(() => expect(commands.at(-1)?.view.source.status).toBe('unavailable'));

    expect(artifactStore.create).not.toHaveBeenCalled();
    expect(commands.at(-1)).toMatchObject({ operation: 'update', view: { renderer: 'list' } });
    const failedView = commands.at(-1)?.view;
    expect(failedView?.renderer).toBe('list');
    if (failedView?.renderer === 'list') {
      expect(failedView.data.items).toContainEqual(
        expect.objectContaining({ title: 'Research could not be completed' }),
      );
    }
    expect(completion).toHaveBeenCalledWith({ status: 'failed' });
  });
});

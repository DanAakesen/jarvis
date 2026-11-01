import { randomUUID } from 'node:crypto';
import type { InvocationAccepted, InvocationSnapshot } from '../foundry/client.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { BackendModule } from '../modules.js';
import { isBackgroundJob, isHtmlArtifact, isHtmlArtifactFrame, type BackgroundJob, type WorkspaceItem, type HtmlArtifact, type HtmlArtifactFrame, type WorkspaceCommand } from '@jarvis/contracts';
import type { WorkspaceItemsStore } from '../database/workspace-items-store.js';
import type { WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import { createHtmlResearchModule, defaultReportFrame, reportFrame, researchWindowTitle } from './research.js';
import { createWorkspacesModule } from './workspaces.js';
import { coreModule } from './index.js';
import { WorkspaceCommandBroker } from './workspace-commands.js';
import type { WebResearchClient } from './web-research.js';
import type { SettingsStore } from './settings.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const agentHeaders = {
  authorization: ['Bearer', 'header.agent.signature'].join(' '),
  'x-jarvis-message-id': '101',
};
const ownerHeaders = { authorization: ['Bearer', 'owner.e30.sig'].join(' ') };
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

function makeRunner(
  report = reportHtml(),
  firstSearchGate?: Promise<void>,
  reportGate?: Promise<void>,
  failedSearches: readonly number[] = [],
) {
  let invocation = 0;
  let searchInvocation = 0;
  const results = new Map<string, unknown>();
  const requests: { tool: string; query: string; model: string; reasoning?: string }[] = [];
  const accepted = (id: string): InvocationAccepted => ({
    invocationId: id,
    sessionId: `session-${id}`,
    status: 'queued',
    agent: 'codex',
  });
  const client: WebResearchClient = {
    startCodexTool: vi.fn(async (tool, query, model, options) => {
      invocation += 1;
      const id = `invocation-${invocation}`;
      requests.push({
        tool,
        query,
        model,
        ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
      });
      if (invocation === 1 && firstSearchGate) await firstSearchGate;
      if (tool === 'web_research' && failedSearches.includes(++searchInvocation)) {
        throw new Error('Search failed.');
      }
      if (tool === 'html_report' && reportGate) await reportGate;
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

function fixture(
  runner: ReturnType<typeof makeRunner>,
  settingsStore?: SettingsStore,
  invocationTimeoutMs: number | undefined = 100,
) {
  const broker = new WorkspaceCommandBroker();
  const commands: WorkspaceCommand[] = [];
  const artifacts: HtmlArtifact[] = [];
  const workspaceItems = new Map<string, WorkspaceItem>();
  const artifactStore = {
    create: vi.fn(async (owner: string, title: string, html: string, sources: HtmlArtifact['sources'], _signal: AbortSignal, artifactId?: string) => {
      const artifact: HtmlArtifact = {
        id: artifactId ?? randomUUID(),
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
  const workspaceItemsStore = {
    record: vi.fn(async (_owner: string, value: Omit<WorkspaceItem, 'pinned'>) => {
      const item: WorkspaceItem = { ...value, pinned: false };
      workspaceItems.set(item.id, item);
      return item;
    }),
    get: vi.fn(async (_owner: string, id: string) => {
      const item = workspaceItems.get(id);
      if (!item) throw new Error('Workspace item was not found');
      return { item, sourceId: id.slice('research:'.length) };
    }),
    search: vi.fn(async () => [...workspaceItems.values()]),
  } as unknown as WorkspaceItemsStore;
  const htmlArtifacts = {
    read: vi.fn(async (id: string) => artifacts.find((artifact) => artifact.id === id)),
  } as unknown as WorkspaceHtmlArtifactStore;
  const researchModule = createHtmlResearchModule(
    () => runner.client,
    'gpt-5.5',
    artifactStore,
    { ...(invocationTimeoutMs === undefined ? {} : { invocationTimeoutMs }), pollIntervalMs: 1 },
    workspaceItemsStore,
  );
  const module: BackendModule = researchModule;
  const app = buildApp(config, undefined, {
    modules: [coreModule, module, createWorkspacesModule(workspaceItemsStore, htmlArtifacts)],
    auth: async (token) => token === 'owner.e30.sig'
      ? { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' }
      : {
        kind: 'jarvis-agent',
        objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef',
        tenantId: config.auth.tenantId,
      },
    toolCallStore: { record: async () => {} },
    workspaceCommands: broker,
    ...(settingsStore ? { settingsStore } : {}),
  });
  apps.push(app);
  let disconnectOnHtml = false;
  let connection!: ReturnType<typeof broker.connect>;
  const connect = () => broker.connect(ownerId, (event, data) => {
    if (event === 'workspace-command') {
      const command = (data as { command: WorkspaceCommand }).command;
      commands.push(command);
      if (disconnectOnHtml && command.view.renderer === 'html-app') {
        connection.close();
        return true;
      }
      broker.acknowledge(ownerId, connection.sessionId, command.commandId, true);
    }
    return true;
  });
  connection = connect();
  broker.updateSnapshot(ownerId, connection.sessionId, {
    windows: [],
    contextPanelOpen: false,
    frame,
  });
  return {
    app, broker, commands, artifacts, artifactStore, workspaceItems, workspaceItemsStore, connection,
    disconnectOnHtml: () => { disconnectOnHtml = true; },
    reconnect: () => {
      connection = connect();
      broker.updateSnapshot(ownerId, connection.sessionId, {
        windows: [], contextPanelOpen: false, frame,
      });
      return connection;
    },
    runner: runner.client,
  };
}

async function startResearch(
  app: ReturnType<typeof buildApp>,
  depth?: 'quick' | 'standard' | 'deep',
) {
  return app.inject({
    method: 'POST',
    url: '/tools/research',
    headers: agentHeaders,
    payload: { topic: 'Evidence-based research', ...(depth ? { depth } : {}) },
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
    const reportGate = deferred();
    const runner = makeRunner(reportHtml(), gate.promise, reportGate.promise);
    const settingsStore: SettingsStore = {
      read: async () => ({
        'roles.research.model': JSON.stringify('gpt-6-luna'),
        'roles.research.reasoning_effort': JSON.stringify('high'),
        'research.depth': JSON.stringify('deep'),
      }),
      write: async () => {},
    };
    const { app, commands, artifacts, artifactStore } = fixture(runner, settingsStore);
    const completion = vi.fn();
    const jobEvents: BackgroundJob[] = [];
    app.jarvisActivityHub.subscribe((event) => { if (event.type === 'job') jobEvents.push(event.job); });
    app.addHook('preHandler', (request, _reply, done) => {
      request.announceResearchCompletion = completion;
      done();
    });
    const response = await startResearch(app, 'quick');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { message: expect.stringContaining('Research has started') } });
    expect(commands[0]).toMatchObject({ operation: 'create', view: { renderer: 'list', source: { id: 'research' } } });
    expect(commands[0]?.view.source.status).toBe('running');
    if (commands[0]?.view.renderer === 'list') {
      expect(commands[0].view.data.items).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining('Report is ready') }),
      ]));
    }
    expect(runner.client.startCodexTool).toHaveBeenCalledTimes(1);

    gate.resolve();
    await vi.waitFor(() => expect(runner.requests).toHaveLength(3));
    await vi.waitFor(() => {
      const writingView = commands.findLast(({ view }) => view.renderer === 'list' &&
        view.data.items.some(({ title }) => title === 'Writing the report…'));
      expect(writingView?.view.source.status).toBe('running');
      if (writingView?.view.renderer === 'list') {
        expect(writingView.view.data.items).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ title: expect.stringContaining('Report is ready') }),
        ]));
      }
    });
    for (const { view } of commands.filter(({ view }) => view.renderer === 'list')) {
      expect(view.source.status).toBe('running');
      if (view.renderer === 'list') {
        expect(view.data.items).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ title: expect.stringContaining('Report is ready') }),
        ]));
      }
    }
    reportGate.resolve();
    await vi.waitFor(() => expect(commands.at(-1)?.view.renderer).toBe('html-app'));

    expect(runner.requests).toHaveLength(3);
    expect(runner.requests.map(({ tool }) => tool)).toEqual(['web_research', 'web_research', 'html_report']);
    expect(runner.requests.map(({ model, reasoning }) => [model, reasoning])).toEqual([
      ['gpt-6-luna', 'high'],
      ['gpt-6-luna', 'high'],
      ['gpt-6-luna', 'high'],
    ]);
    expect(JSON.parse(runner.requests[2]!.query)).toMatchObject({
      frame: { widthPx: 390, device: 'phone', theme: 'dark', reducedMotion: true, layout: 'layered' },
    });
    expect(artifactStore.create).toHaveBeenCalledOnce();
    expect(artifacts).toHaveLength(1);
    expect(isHtmlArtifact(artifacts[0])).toBe(true);
    expect(commands.at(-1)).toMatchObject({
      operation: 'update',
      view: { renderer: 'html-app', source: { status: 'complete' }, data: { artifactId: artifacts[0]!.id } },
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

  it('keeps a saved result complete without a connected workspace and reopens it after reload without research', async () => {
    const searchGate = deferred();
    const reportGate = deferred();
    const runner = makeRunner(reportHtml(), searchGate.promise, reportGate.promise);
    const { app, broker, commands, artifacts, workspaceItems, connection, reconnect } = fixture(runner);
    const started = await startResearch(app);
    const jobId = started.json().result.jobId as string;

    connection.close();
    searchGate.resolve();
    await vi.waitFor(() => expect(runner.requests).toHaveLength(3));
    reportGate.resolve();
    await vi.waitFor(async () => {
      expect(await app.backgroundJobs.list()).toEqual([
        expect.objectContaining({
          jobId, status: 'done', resultId: `research:${jobId}`, resultDelivery: 'pending',
        }),
      ]);
    });

    expect(artifacts).toHaveLength(1);
    expect(workspaceItems.size).toBe(1);
    expect(runner.client.startCodexTool).toHaveBeenCalledTimes(3);

    const reopenedConnection = reconnect();
    const reopened = await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/open-result`,
      headers: ownerHeaders,
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual({ opened: true });
    expect((await app.backgroundJobs.list())[0]).toMatchObject({ status: 'done', resultDelivery: 'delivered' });
    expect(commands.filter((command) => 'view' in command && command.view.renderer === 'html-app')
      .map(({ operation }) => operation)).toEqual(['create']);

    broker.updateSnapshot(ownerId, reopenedConnection.sessionId, {
      windows: [{
        viewId: `research-${jobId.replaceAll('-', '')}`, title: 'Research report', state: 'open',
      }],
      contextPanelOpen: false,
      frame,
    });
    const repeated = await app.inject({
      method: 'POST',
      url: `/jobs/${jobId}/open-result`,
      headers: ownerHeaders,
    });
    expect(repeated.statusCode).toBe(200);
    expect(commands.filter((command) => 'view' in command && command.view.renderer === 'html-app')
      .map(({ operation }) => operation)).toEqual(['create', 'update']);
    expect(artifacts).toHaveLength(1);
    expect(runner.client.startCodexTool).toHaveBeenCalledTimes(3);
  });

  it.each(['missing workspace', 'disconnect during progress', 'aborted tool request', 'request abort after progress'] as const)(
    'runs server-owned research despite %s at startup',
    async (failure) => {
      const runner = makeRunner();
      const { app, broker, connection, artifacts, workspaceItems } = fixture(runner);
      const completion = vi.fn();
      const jobEvents: BackgroundJob[] = [];
      app.jarvisActivityHub.subscribe((event) => { if (event.type === 'job') jobEvents.push(event.job); });
      let abortRequest!: () => void;
      app.addHook('preHandler', (request, _reply, done) => {
        request.announceResearchCompletion = completion;
        abortRequest = () => { request.raw.emit('aborted'); };
        done();
      });
      if (failure === 'missing workspace') {
        connection.close();
      } else if (failure === 'disconnect during progress') {
        connection.close();
        const disconnecting = broker.connect(ownerId, () => {
          disconnecting.close();
          return true;
        });
      } else {
        const execute = broker.execute.bind(broker);
        vi.spyOn(broker, 'execute').mockImplementationOnce(async (owner, command, signal) => {
          if (failure === 'request abort after progress') await execute(owner, command, signal);
          abortRequest();
          expect(signal.aborted).toBe(true);
          connection.close();
          if (failure === 'aborted tool request') return execute(owner, command, signal);
        });
      }

      const response = await startResearch(app, 'quick');

      expect(response.json()).toMatchObject({ outcome: 'ok', result: { jobId: expect.any(String) } });
      const jobId = response.json().result.jobId as string;
      await vi.waitFor(async () => {
        expect(await app.backgroundJobs.list()).toEqual([
          expect.objectContaining({ jobId, status: 'done', resultId: `research:${jobId}`, resultDelivery: 'pending' }),
        ]);
      });
      expect(artifacts).toHaveLength(1);
      expect(workspaceItems.size).toBe(1);
      expect(runner.client.startCodexTool).toHaveBeenCalledTimes(3);
      expect(runner.client.cancel).not.toHaveBeenCalled();
      expect(jobEvents.some((job) => job.status === 'failed')).toBe(false);
      expect(completion).toHaveBeenCalledWith({ status: 'complete', summary: 'The research found a supported result.' });
    },
  );

  it('preserves explicit cancellation after the workspace disconnects', async () => {
    const runner = makeRunner();
    const status = vi.mocked(runner.client.status).getMockImplementation()!;
    vi.spyOn(runner.client, 'status').mockImplementation(async (id, options) => ({
      ...await status(id, options),
      status: 'running',
      finishedAt: null,
      result: null,
    }));
    const { app, connection, artifacts } = fixture(runner, undefined, 5_000);
    const completion = vi.fn();
    const jobEvents: BackgroundJob[] = [];
    app.jarvisActivityHub.subscribe((event) => { if (event.type === 'job') jobEvents.push(event.job); });
    app.addHook('preHandler', (request, _reply, done) => {
      request.announceResearchCompletion = completion;
      done();
    });
    const started = await startResearch(app, 'quick');
    const jobId = started.json().result.jobId as string;
    await vi.waitFor(() => expect(runner.client.status).toHaveBeenCalled());
    connection.close();

    const cancelled = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/cancel`, headers: ownerHeaders,
    });

    expect(cancelled.statusCode).toBe(202);
    await vi.waitFor(() => expect(runner.client.deleteSession).toHaveBeenCalledOnce());
    expect(runner.client.cancel).toHaveBeenCalledOnce();
    expect((await app.backgroundJobs.details(jobId))?.details.job.status).toBe('cancelled');
    expect(jobEvents.at(-1)?.status).toBe('cancelled');
    expect(jobEvents.some((job) => job.status === 'failed')).toBe(false);
    expect(artifacts).toHaveLength(0);
    expect(completion).not.toHaveBeenCalled();
  });

  it('records an ambiguous report acknowledgement without failing the saved research job', async () => {
    const searchGate = deferred();
    const reportGate = deferred();
    const runner = makeRunner(reportHtml(), searchGate.promise, reportGate.promise);
    const { app, artifacts, disconnectOnHtml } = fixture(runner);
    const started = await startResearch(app);
    const jobId = started.json().result.jobId as string;

    searchGate.resolve();
    await vi.waitFor(() => expect(runner.requests).toHaveLength(3));
    disconnectOnHtml();
    reportGate.resolve();
    await vi.waitFor(async () => {
      expect(await app.backgroundJobs.list()).toEqual([
        expect.objectContaining({ jobId, status: 'done', resultDelivery: 'unknown' }),
      ]);
    });

    expect(artifacts).toHaveLength(1);
    expect((await app.backgroundJobs.list())[0]).toHaveProperty('resultId', `research:${jobId}`);
    expect(runner.client.startCodexTool).toHaveBeenCalledTimes(3);
  });

  it.each(['artifact', 'workspace items'] as const)('keeps a true %s persistence failure marked failed', async (failure) => {
    const runner = makeRunner();
    const fixtureData = fixture(runner);
    const completion = vi.fn();
    fixtureData.app.addHook('preHandler', (request, _reply, done) => {
      request.announceResearchCompletion = completion;
      done();
    });
    if (failure === 'artifact') {
      fixtureData.artifactStore.create.mockRejectedValueOnce(new Error('Synthetic artifact persistence failure.'));
    } else {
      vi.mocked(fixtureData.workspaceItemsStore.record).mockRejectedValueOnce(new Error('Synthetic Workspaces persistence failure.'));
    }

    const response = await startResearch(fixtureData.app);
    const jobId = response.json().result.jobId as string;
    await vi.waitFor(async () => {
      expect((await fixtureData.app.backgroundJobs.list()).find((job) => job.jobId === jobId))
        .toMatchObject({ status: 'failed' });
    });

    expect(completion).toHaveBeenCalledWith({ status: 'failed' });
    expect((await fixtureData.app.backgroundJobs.details(jobId))?.details.job.resultId).toBeUndefined();
    expect(fixtureData.artifacts).toHaveLength(failure === 'workspace items' ? 1 : 0);
  });

  it('marks the finished report partial only when searches failed', async () => {
    const runner = makeRunner(reportHtml('https://example.com/source-2'), undefined, undefined, [1]);
    const { app, commands } = fixture(runner);

    const response = await startResearch(app, 'quick');

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    await vi.waitFor(() => expect(commands.at(-1)?.view.renderer).toBe('html-app'));
    expect(commands.at(-1)?.view.source.status).toBe('partial');
    expect(JSON.parse(runner.requests.at(-1)!.query)).toMatchObject({ partial: true });
  });

  it('uses the saved depth by default and bounds collected sources', async () => {
    const runner = makeRunner();
    const settingsStore: SettingsStore = {
      read: async () => ({
        'research.depth': JSON.stringify('standard'),
        'research.max_sources': JSON.stringify(1),
      }),
      write: async () => {},
    };
    const { app, artifacts } = fixture(runner, settingsStore);
    const response = await startResearch(app, undefined);

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => expect(runner.requests).toHaveLength(4));

    expect(runner.requests.map(({ tool }) => tool)).toEqual([
      'web_research', 'web_research', 'web_research', 'html_report',
    ]);
    expect(JSON.parse(runner.requests[3]!.query)).toMatchObject({
      depth: 'standard',
      sources: [{ title: 'Source 1', url: 'https://example.com/source-1' }],
    });
    expect(artifacts[0]?.sources).toEqual([{ title: 'Source 1', url: 'https://example.com/source-1' }]);
  });

  it('retries a failed research job from its stored topic once', async () => {
    const runner = makeRunner();
    const { app, commands } = fixture(runner);
    const original = await app.backgroundJobs.start(
      'research',
      'Research: Stored retry topic',
      3,
      undefined,
      'Starting research',
      { retryInput: { topic: 'Stored original research topic', depth: 'quick' } },
    );
    await original.fail('Research could not be completed. Try again shortly.');

    const response = await app.inject({
      method: 'POST',
      url: '/tools/retry_job',
      headers: agentHeaders,
      payload: { jobId: original.jobId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { jobId: expect.any(String), message: expect.stringContaining('Research has started') },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/tools/retry_job',
      headers: agentHeaders,
      payload: { jobId: original.jobId },
    });
    expect(duplicate.json()).toMatchObject({ outcome: 'refused' });

    await vi.waitFor(() => expect(runner.requests).toHaveLength(3));
    expect(runner.requests[0]?.query).toContain('Stored original research topic');
    expect(commands.at(-1)?.view.renderer).toBe('html-app');
    await expect(app.backgroundJobs.details(original.jobId)).resolves.toMatchObject({
      details: { retryable: false },
    });
  });

  it('refuses to retry a failed job without persisted research input', async () => {
    const { app } = fixture(makeRunner());
    const job = await app.backgroundJobs.start('research', 'Research: No saved input', 2);
    await job.fail('Research could not be completed.');
    const response = await app.inject({
      method: 'POST',
      url: '/tools/retry_job',
      headers: agentHeaders,
      payload: { jobId: job.jobId },
    });
    expect(response.json()).toMatchObject({ outcome: 'refused' });
  });

  it('uses the configured timeout for each runner invocation', async () => {
    const runner = makeRunner();
    runner.client.status = vi.fn(async () => ({
      ...{
        invocationId: 'invocation-1',
        sessionId: 'session-invocation-1',
        status: 'queued' as const,
        agent: 'codex' as const,
      },
      startedAt: 0,
      finishedAt: null,
      events: [],
      result: null,
      error: null,
      status: 'running',
    }));
    const settingsStore: SettingsStore = {
      read: async () => ({ 'research.timeout_seconds': JSON.stringify(1) }),
      write: async () => {},
    };
    const { app } = fixture(runner, settingsStore, undefined);

    const response = await startResearch(app);

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => expect(runner.client.cancel).toHaveBeenCalledOnce(), { timeout: 2_000 });
    expect(runner.client.deleteSession).toHaveBeenCalledOnce();
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

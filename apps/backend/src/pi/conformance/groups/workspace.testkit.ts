import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { GeneratedView, WorkspacePin } from '@jarvis/contracts';
import { createHtmlViewModule } from '../../../core/html-view.js';
import { createImageGenerationModule } from '../../../core/image-generation.js';
import { createHtmlResearchModule } from '../../../core/research.js';
import { createWeatherModule } from '../../../core/weather.js';
import { createWebResearchModule } from '../../../core/web-research.js';
import { createWorkspacePinsModule } from '../../../core/workspace-pins.js';
import { createWorkspacesModule } from '../../../core/workspaces.js';
import type { WorkspaceArtifactStore } from '../../../database/workspace-artifact-store.js';
import type { WorkspaceHtmlArtifactStore } from '../../../database/workspace-html-artifact-store.js';
import type { WorkspaceItemsStore } from '../../../database/workspace-items-store.js';
import type { WorkspacePinStore } from '../../../database/workspace-pin-store.js';
import type { BackendModule } from '../../../modules.js';
import type { GroupFactory, ToolCase } from '../types.testkit.js';
import { createFoundryStub, createImageGeneratorStub, createOpenMeteoStub, htmlDocument, outageMarker } from './workspace-services.testkit.js';
import { InMemoryHtmlArtifacts, InMemoryImageArtifacts, InMemoryWorkspaceItems, InMemoryWorkspacePins } from './workspace-stores.testkit.js';

/**
 * Workspace items and pins, HTML views, weather, image generation and research, on in-memory stores. The Foundry runner,
 * Open-Meteo and the image API answer at once, and the tools find Dan's signed-in workspace tab (the core group's
 * `workspaceCommands`), his delete approval service (`ownerInteractions`) and the job table (`backgroundJobStore`) in the app,
 * so every tool runs as it does in production with healthy dependencies. Nothing here can reach the network.
 */

/** The blob account the signed image URLs name; generated views accept images only from this host (as production configures it). */
const blobAccount = 'stjarvisconformance';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const seedId = (number: number) => `5eed0000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const viewIdOf = (artifactId: string) => `html-${artifactId.replaceAll('-', '')}`;

/** The saved things Dan has. Each tool that changes one has its own (the legacy `folio_*` names are separate tools), so cases never depend on order. */
const saved = {
  spending: seedId(1), ignite: seedId(2), bicycle: seedId(3), garden: seedId(4), training: seedId(5),
  folioScratch: seedId(6), workspacesScratch: seedId(7), folioOldGraph: seedId(8), workspacesOldGraph: seedId(9),
};
const graphNode = (character: string) => character.repeat(64);

const sources = [{ title: 'Microsoft Ignite newsroom', url: 'https://news.microsoft.com/ignite/' }];

function pinViews(): readonly WorkspacePin[] {
  const source = (id: 'usage' | 'html_generation' | 'knowledge_graph') => ({ id, status: 'complete' as const, updatedAt: '2026-11-19T08:00:00.000Z' });
  const views: readonly (readonly [string, string, GeneratedView])[] = [
    ['usage-month', '2026-11-18T09:00:00.000Z', {
      version: 1, title: 'Usage this month', renderer: 'table', source: source('usage'),
      data: { columns: ['Day', 'Cost (DKK)'], rows: [['1 Nov', 4.2], ['2 Nov', 3.1]] },
    }],
    ['spending-overview', '2026-11-19T09:00:00.000Z', {
      version: 1, title: 'Monthly spending overview', renderer: 'html-app', source: source('html_generation'), data: { artifactId: saved.spending },
    }],
    ['garden-plan-graph', '2026-11-20T09:00:00.000Z', {
      version: 1, title: 'Garden plan graph', renderer: 'knowledge-graph', source: source('knowledge_graph'), data: { query: 'garden plan', highlight: [] },
    }],
  ];
  return views.map(([viewId, pinnedAt, view]) => ({ viewId, pinnedAt, view }));
}

export const workspaceGroup: GroupFactory = (context) => {
  const owner = context.owner;
  const html = new InMemoryHtmlArtifacts();
  const items = new InMemoryWorkspaceItems(html);
  const images = new InMemoryImageArtifacts(blobAccount);
  const pins = new InMemoryWorkspacePins();
  const openMeteo = createOpenMeteoStub();
  const foundry = createFoundryStub();
  const generator = createImageGeneratorStub();

  const page = (key: keyof typeof saved, title: string, body: string, itemKind: 'html_app' | 'research', summary: string, createdAt: string) => {
    html.seed(owner, { id: saved[key], title, html: htmlDocument(title, body), sources: itemKind === 'research' ? sources : [], createdAt });
    items.seed(owner, { id: `${itemKind}:${saved[key]}`, kind: itemKind, sourceId: saved[key], title, promptSummary: summary, createdAt });
  };
  page('spending', 'Monthly spending overview', '<p>Groceries 3,200 kr. Transport 640 kr.</p>', 'html_app', 'Where the money went in November', '2026-11-20T09:00:00.000Z');
  page('ignite', 'Research: Microsoft Ignite announcements', '<p>Agents, Foundry and security were the themes.</p>', 'research', 'What did Microsoft announce at Ignite this year?', '2026-11-19T09:00:00.000Z');
  page('training', 'Weekly training log', '<p>Monday: bench press 5x5.</p>', 'html_app', 'My weekly training log as a small app', '2026-11-12T09:00:00.000Z');
  page('folioScratch', 'Folio scratch page', '<p>Scratch.</p>', 'html_app', 'Scratch page for the folio tools', '2026-11-11T09:00:00.000Z');
  page('workspacesScratch', 'Workspaces scratch page', '<p>Scratch.</p>', 'html_app', 'Scratch page for the workspaces tools', '2026-11-10T09:00:00.000Z');
  images.seed(owner, saved.bicycle);
  items.seed(owner, {
    id: `image:${saved.bicycle}`, kind: 'image', sourceId: saved.bicycle, title: 'A red bicycle leaning on a brick wall',
    promptSummary: 'A red bicycle leaning on a brick wall', createdAt: '2026-11-18T09:00:00.000Z',
  });
  const graph = (key: 'garden' | 'folioOldGraph' | 'workspacesOldGraph', title: string, query: string, createdAt: string) => items.seed(owner, {
    id: `knowledge_graph:${saved[key]}`, kind: 'knowledge_graph', sourceId: saved[key], title, promptSummary: `Notes linked to ${query}`, createdAt,
    payload: { query, highlight: [graphNode('a')] },
  });
  graph('garden', 'Knowledge graph: garden plan', 'garden plan', '2026-11-17T09:00:00.000Z');
  graph('folioOldGraph', 'Old folio graph to remove', 'folio clean-up', '2026-11-09T09:00:00.000Z');
  graph('workspacesOldGraph', 'Old workspaces graph to remove', 'workspaces clean-up', '2026-11-08T09:00:00.000Z');
  for (const pin of pinViews()) pins.seed(owner, pin);

  // The app, to read what Dan's tab was told after a tool ran: the broker keeps every command a tab acknowledged.
  let application: FastifyInstance | undefined;
  const shown = {
    view: (viewId: string) => application!.workspaceCommands.view(owner, viewId),
    html: (selector: { viewId?: string; artifactId?: string }) => application!.workspaceCommands.htmlView(owner, selector),
  };
  const rememberApp = (module: BackendModule): BackendModule => ({
    ...module, registerServices: (app) => { application = app as unknown as FastifyInstance; },
  });
  // A retry starts from a research job that has already failed, which happens in the background after `research` answered.
  // retry_job brings its own failed job (its case names none), so it does not depend on what another case left behind.
  let failedBeforeRetry = '';
  const waitForFailedResearch = (module: BackendModule): BackendModule => ({
    ...module,
    tools: module.tools.map((tool) => tool.name !== 'retry_job' ? tool : {
      ...tool,
      execute: async (input, request, signal) => {
        const research = module.tools.find((candidate) => candidate.name === 'research');
        if (!research) return tool.execute(input, request, signal);
        const started = await research.execute({ topic: `retry me (${outageMarker})`, title: 'Retry me', depth: 'quick' }, request, signal) as { jobId: string };
        failedBeforeRetry = started.jobId;
        await failedResearchSettled(request.server.backgroundJobs, started.jobId);
        return tool.execute({ ...(input as object), jobId: started.jobId }, request, signal);
      },
    }),
  });

  // ---- Cases ------------------------------------------------------------------------------------------------------------------

  const searchCases: readonly ToolCase[] = [
    { label: 'lists what is saved, pinned items first', arguments: {}, check: (result) => {
      const found = (result as { items: { id: string; kind: string; pinned: boolean }[] }).items;
      expect(found.map((item) => item.id)).toEqual(expect.arrayContaining([`research:${saved.ignite}`, `image:${saved.bicycle}`, `knowledge_graph:${saved.garden}`]));
      expect(found.findIndex((item) => !item.pinned)).toBeGreaterThanOrEqual(0);
    } },
    { label: 'finds the Ignite report by a word of its title', arguments: { q: 'Ignite' }, check: (result) => {
      expect((result as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([`research:${saved.ignite}`]);
    } },
    { label: 'filters by kind', arguments: { kind: 'image' }, check: (result) => {
      const found = (result as { items: { id: string; kind: string }[] }).items;
      expect(found.map((item) => item.id)).toContain(`image:${saved.bicycle}`);
      expect(found.every((item) => item.kind === 'image')).toBe(true);
    } },
  ];

  const openCases: readonly ToolCase[] = [
    { label: 'reopens a research report by a phrase', arguments: { query: 'Ignite research' }, check: (result) => {
      expect(result).toMatchObject({ id: `research:${saved.ignite}`, kind: 'research', opened: true });
      expect(shown.html({ viewId: `research-${saved.ignite.replaceAll('-', '')}` })).toMatchObject({ artifactId: saved.ignite });
    } },
    { label: 'reopens a generated image by id', arguments: { id: `image:${saved.bicycle}` }, check: (result) => {
      expect(result).toMatchObject({ id: `image:${saved.bicycle}`, kind: 'image', opened: true });
      expect(shown.view(`image-${saved.bicycle.replaceAll('-', '')}`)).toMatchObject({ renderer: 'image' });
    } },
    { label: 'reopens a knowledge graph by a phrase', arguments: { query: 'garden plan' }, check: (result) => {
      expect(result).toMatchObject({ id: `knowledge_graph:${saved.garden}`, kind: 'knowledge_graph', opened: true });
      expect(shown.view(`knowledge-graph-${saved.garden.replaceAll('-', '')}`)).toMatchObject({ renderer: 'knowledge-graph' });
    } },
    { label: 'reopens an HTML app by id', arguments: { id: `html_app:${saved.spending}` }, check: (result) => {
      expect(result).toMatchObject({ id: `html_app:${saved.spending}`, kind: 'html_app', opened: true });
      expect(shown.html({ viewId: viewIdOf(saved.spending) })).toMatchObject({ artifactId: saved.spending });
    } },
  ];

  const manageCases = (scratch: string, word: string, oldGraph: string): readonly ToolCase[] => [
    { label: 'renames an item', arguments: { action: 'rename', id: `html_app:${scratch}`, title: `${word} page (renamed)` }, check: (result) => {
      expect(result).toMatchObject({ id: `html_app:${scratch}`, title: `${word} page (renamed)`, action: 'rename' });
    } },
    { label: 'pins an item found by a phrase', arguments: { action: 'pin', query: `${word} scratch` }, check: (result) => {
      expect(result).toMatchObject({ id: `html_app:${scratch}`, pinned: true, action: 'pin' });
    } },
    { label: 'unpins an item', arguments: { action: 'unpin', id: `html_app:${scratch}` }, check: (result) => {
      expect(result).toMatchObject({ id: `html_app:${scratch}`, pinned: false, action: 'unpin' });
    } },
    { label: 'removes an item', arguments: { action: 'delete', id: `knowledge_graph:${oldGraph}` }, check: (result) => {
      expect(result).toMatchObject({ id: `knowledge_graph:${oldGraph}`, deleted: true });
    } },
  ];

  const cases: Record<string, readonly ToolCase[]> = {
    workspaces_search: searchCases,
    folio_search: searchCases,
    workspaces_open: openCases,
    folio_open: openCases,
    workspaces_manage: manageCases(saved.workspacesScratch, 'Workspaces', saved.workspacesOldGraph),
    folio_manage: manageCases(saved.folioScratch, 'Folio', saved.folioOldGraph),

    pins_list: [{ label: 'lists the saved pins, oldest first', arguments: {}, check: (result) => {
      const listed = result as { pins: { viewId: string; title: string; renderer: string }[] };
      expect(listed.pins.map((pin) => pin.viewId)).toEqual(['usage-month', 'spending-overview', 'garden-plan-graph']);
      expect(listed.pins[1]).toMatchObject({ title: 'Monthly spending overview', renderer: 'html-app' });
    } }],
    pin_restore: [
      { label: 'restores a pin by its view id', arguments: { viewId: 'usage-month' }, check: (result) => {
        expect(result).toMatchObject({ viewId: 'usage-month', title: 'Usage this month', restored: true });
        expect(shown.view('usage-month')).toMatchObject({ title: 'Usage this month', renderer: 'table' });
      } },
      { label: 'restores a pin by a word of its title', arguments: { query: 'garden' }, check: (result) => {
        expect(result).toMatchObject({ viewId: 'garden-plan-graph', restored: true });
        expect(shown.view('garden-plan-graph')).toMatchObject({ renderer: 'knowledge-graph' });
      } },
    ],

    create_html_view: [{
      label: 'creates an HTML app with a source',
      arguments: {
        title: 'Tomato harvest tracker', html: htmlDocument('Tomato harvest tracker', '<p>Week 1: 12 tomatoes.</p>'),
        sources: [{ title: 'Growing tomatoes', url: 'https://example.org/tomatoes' }],
      },
      check: (result) => {
        const { artifactId } = result as { artifactId: string };
        expect(artifactId).toMatch(uuid);
        expect(shown.html({ artifactId })).toEqual({ viewId: viewIdOf(artifactId), artifactId });
      },
    }],
    read_html_view: [
      { label: 'reads an app by its artifact id', arguments: { artifactId: saved.spending }, check: (result) => {
        expect(result).toMatchObject({ artifactId: saved.spending, title: 'Monthly spending overview', version: 1, sources: [] });
        expect((result as { html: string }).html).toContain('Groceries 3,200 kr');
      } },
      { label: 'reads an app by the id of its window', arguments: { viewId: viewIdOf(saved.ignite) }, check: (result) => {
        expect(result).toMatchObject({ artifactId: saved.ignite, title: 'Research: Microsoft Ignite announcements', sources });
      } },
      { label: 'reads an earlier version', arguments: { artifactId: saved.spending, version: 1 }, check: (result) => {
        expect(result).toMatchObject({ artifactId: saved.spending, version: 1 });
      } },
    ],
    update_html_view: [{
      label: 'stores a new version and keeps the title',
      arguments: { artifactId: saved.training, html: htmlDocument('Weekly training log', '<p>Monday: squats 5x5.</p>') },
      check: (result) => {
        const updated = result as { artifactId: string; version: number };
        expect(updated.artifactId).toBe(saved.training);
        expect(updated.version).toBeGreaterThanOrEqual(2);
        expect(shown.html({ artifactId: saved.training })).toEqual({ viewId: viewIdOf(saved.training), artifactId: saved.training });
      },
    }],

    weather: [
      { label: 'returns the forecast values without opening a report', arguments: { location: 'Aarhus', days: 2, report: false }, check: (result) => {
        expect(result).toMatchObject({ provider: 'Open-Meteo', location: { name: 'Aarhus', country: 'Denmark' } });
        expect((result as { forecast: unknown[] }).forecast).toHaveLength(2);
        expect(result).not.toHaveProperty('artifactId');
      } },
      // Dan's saved home location is the core group's settings seed; no place is looked up for it.
      { label: 'uses the saved home location when no place is named', arguments: { report: false }, check: (result) => {
        expect(result).toMatchObject({ provider: 'Open-Meteo', location: { name: expect.stringMatching(/\S/u) } });
      } },
      { label: 'adds the hourly values on request', arguments: { location: 'Aarhus', days: 2, hourly: true, report: false }, check: (result) => {
        expect((result as { hourly: { times: string[] } }).hourly.times).toHaveLength(48);
      } },
      { label: 'saves and opens a report in the workspace', arguments: { location: 'Copenhagen', days: 3 }, check: (result) => {
        const report = result as { artifactId: string; jobId: string; confirmation: string };
        expect(report.artifactId).toMatch(uuid);
        expect(report.confirmation).toBe('Weather report opened in the workspace.');
        expect(shown.html({ artifactId: report.artifactId })).toMatchObject({ artifactId: report.artifactId });
        expect(openMeteo.blocked, 'weather reached a host other than Open-Meteo').toEqual([]);
      } },
    ],

    image_generation: [{
      label: 'draws an image and opens it in the workspace',
      arguments: { prompt: 'A lighthouse on a rocky coast at sunrise' },
      check: (result) => {
        const image = result as { artifactId: string; confirmation: string };
        expect(image.artifactId).toMatch(uuid);
        expect(generator.prompts).toContain('A lighthouse on a rocky coast at sunrise');
        expect(shown.view(`image-${image.artifactId.replaceAll('-', '')}`)).toMatchObject({ renderer: 'image' });
      },
    }],

    web_research: [{
      label: 'answers with the sources it found', arguments: { query: 'opening hours of Aarhus public library' },
      check: (result) => {
        const research = result as { answer: string; sources: { title: string; url: string }[] };
        expect(research.sources).toHaveLength(2);
        expect(research.answer).toContain('Sources:');
        expect(research.answer).toContain(research.sources[0]!.url);
      },
    }],
    research: [
      { label: 'starts a cited report in the background', arguments: { topic: 'battery recycling rules in the EU', title: 'EU battery recycling', depth: 'quick' }, check: (result) => {
        expect(result).toMatchObject({ jobId: expect.stringMatching(uuid), message: expect.stringContaining('Research has started') });
      } },
      // The runner drops out for this one, so the job fails in the background and stays retryable for `retry_job`.
      { label: 'a run that cannot finish still starts', arguments: { topic: `solid-state battery supply (${outageMarker})`, title: 'Solid-state batteries', depth: 'quick' }, check: (result) => {
        expect((result as { jobId: string }).jobId).toMatch(uuid);
      } },
    ],
    retry_job: [{
      label: 'starts the failed research again',
      // The job id is replaced by the failed job retry_job starts for itself (see waitForFailedResearch).
      arguments: { jobId: '00000000-0000-4000-8000-000000000000' },
      check: (result) => {
        const retried = result as { jobId: string };
        expect(retried.jobId).toMatch(uuid);
        expect(retried.jobId).not.toBe(failedBeforeRetry);
      },
    }],
  };

  const previousAccount = process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
  process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT ??= blobAccount;

  return {
    id: 'workspace',
    covers: ['workspaces', 'workspacePins', 'htmlView', 'weather', 'imageGeneration', 'webResearch', 'htmlResearch'],
    modules: [
      rememberApp(createWorkspacesModule(items as unknown as WorkspaceItemsStore, html as unknown as WorkspaceHtmlArtifactStore, images as unknown as WorkspaceArtifactStore)),
      createWorkspacePinsModule(pins as unknown as WorkspacePinStore),
      createHtmlViewModule(html as unknown as WorkspaceHtmlArtifactStore, items as unknown as WorkspaceItemsStore),
      createWeatherModule(html, openMeteo.fetch, items as unknown as WorkspaceItemsStore),
      createImageGenerationModule({ generator, artifacts: images as unknown as WorkspaceArtifactStore, workspaceItems: items as unknown as WorkspaceItemsStore }),
      createWebResearchModule(() => foundry.client, 'test-model'),
      createHtmlResearchModule(() => foundry.client, 'test-model', html, {}, items as unknown as WorkspaceItemsStore),
    ].map(waitForFailedResearch),
    appOptions: { workspaceHtmlArtifacts: html },
    cases,
    close() {
      if (previousAccount === undefined && process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT === blobAccount) delete process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
    },
  };
};

/** Waits (bounded) until the research job has failed and can be retried; a job that never fails is left to the tool to refuse. */
async function failedResearchSettled(jobs: { details(jobId: string): Promise<{ details: { retryable: boolean } } | null> }, jobId: string | undefined): Promise<void> {
  if (jobId === undefined) return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await jobs.details(jobId))?.details.retryable) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

import { randomUUID } from 'node:crypto';
import {
  isHtmlArtifact,
  isHtmlArtifactFrame,
  isValidHtmlArtifactHtml,
  isWebResearchResult,
  isWorkspaceCommand,
  type GeneratedView,
  type HtmlArtifact,
  type HtmlArtifactFrame,
  type HtmlArtifactSource,
  researchDepths,
  type ResearchDepth,
  type WebResearchResult,
} from '@jarvis/contracts';
import { parse } from 'parse5';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BackendModule } from '../modules.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { defaultSettings, readSettings } from './settings.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { runCodexToolResult, type WebResearchClient } from './web-research.js';
import type { FolioStore } from '../database/folio-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    announceResearchCompletion?: (
      result: { status: 'complete'; summary: string } | { status: 'failed' },
    ) => void;
  }
}

const inputSchema = Object.freeze({
  type: 'object',
  properties: {
    topic: { type: 'string', minLength: 1, maxLength: 2_000 },
    title: { type: 'string', minLength: 1, maxLength: 80 },
    depth: { enum: [...researchDepths] },
  },
  required: ['topic'],
  additionalProperties: false,
});
const maxJobs = 8;
const maxConcurrentJobs = 2;
const maxReportBytes = 48 * 1024;
const maxReportSources = 12;
const maxFindingLength = 1_000;
const defaultJobTimeoutMs = 15 * 60_000;
const defaultPollIntervalMs = 1_000;
const plans = {
  quick: [
    ['Key findings and current evidence', 'Summarize the key findings and current evidence'],
    ['Important facts and primary sources', 'Find important facts and authoritative primary sources'],
  ],
  standard: [
    ['Key findings and current evidence', 'Summarize the key findings and current evidence'],
    ['Important facts and primary sources', 'Find important facts and authoritative primary sources'],
    ['Limitations and counterpoints', 'Find important limitations, disagreements, and counterpoints'],
  ],
  deep: [
    ['Overview and key context', 'Explain the background and current state'],
    ['Recent developments', 'Find recent developments and dates'],
    ['Evidence and data', 'Find quantitative evidence, datasets, or measured results'],
    ['Benefits and limitations', 'Compare benefits, risks, limitations, and uncertainty'],
    ['Expert perspectives', 'Find credible expert perspectives and disagreements'],
  ],
} as const;

interface ResearchArtifactStore {
  create(
    ownerObjectId: string,
    title: string,
    html: string,
    sources: HtmlArtifactSource[],
    signal: AbortSignal,
  ): Promise<HtmlArtifact>;
}

interface ResearchOptions {
  jobTimeoutMs?: number;
  invocationTimeoutMs?: number;
  pollIntervalMs?: number;
}

interface SearchProgress {
  label: string;
  query: string;
  status: 'pending' | 'searching' | 'complete' | 'failed';
  answer?: string;
}

interface ResearchJob {
  controller: AbortController;
  promise: Promise<void>;
  done: boolean;
}

interface ResearchReport {
  title: string;
  html: string;
  spokenSummary: string;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
}

function safeTopic(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) {
    throw new ToolFailure('A valid research topic is required.');
  }
  return value.trim();
}

const maxWindowTitleWords = 6;
const maxWindowTitleLength = 48;

/** A 3-6 word window and tab title; the full prompt stays in the report itself. */
export function researchWindowTitle(title: unknown, topic: string): string {
  const source = typeof title === 'string' && title.trim() ? title.trim() : topic.trim();
  const firstClause = source.split(/[:\n.;,?!(]| - | \u2013 /u)[0]?.trim() || source;
  let short = firstClause.split(/\s+/u).filter(Boolean).slice(0, maxWindowTitleWords).join(' ');
  if (short.length > maxWindowTitleLength) short = `${short.slice(0, maxWindowTitleLength - 1).trimEnd()}\u2026`;
  return /^research\b/iu.test(short) ? short : `Research: ${short}`;
}

function boundedQuery(topic: string, suffix: string): string {
  const budget = 2_000 - suffix.length - 1;
  let prefix = '';
  for (const character of topic) {
    if (prefix.length + character.length > budget) break;
    prefix += character;
  }
  return `${prefix} ${suffix}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResearchDepth(value: unknown): value is ResearchDepth {
  return typeof value === 'string' && researchDepths.includes(value as ResearchDepth);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function parseReport(value: unknown, sources: readonly HtmlArtifactSource[]): ResearchReport {
  let data: unknown = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      throw new ToolFailure('The report generator returned invalid JSON.');
    }
  }
  if (!isObject(data) || Object.keys(data).some((key) => !['title', 'html', 'spokenSummary'].includes(key)) ||
      typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200 ||
      typeof data.html !== 'string' || !isValidHtmlArtifactHtml(data.html) ||
      typeof data.spokenSummary !== 'string' || !data.spokenSummary.trim() || data.spokenSummary.length > 600 ||
      hasControlCharacter(data.spokenSummary) ||
      Buffer.byteLength(JSON.stringify(data), 'utf8') > maxReportBytes) {
    throw new ToolFailure('The report generator returned an invalid or oversized report.');
  }

  const parseErrors: unknown[] = [];
  const document = parse(data.html, { onParseError: (error) => parseErrors.push(error) }) as unknown as HtmlNode;
  const tags = new Set<string>();
  const trustedSources = new Set<string>();
  let titleFound = false;
  let bodyFound = false;
  let doctypeFound = false;
  let invalid = false;
  for (const source of sources) {
    try {
      trustedSources.add(new URL(source.url).href);
    } catch {
      throw new ToolFailure('The report sources are invalid.');
    }
  }
  const visit = (node: HtmlNode) => {
    if (node.nodeName === '#documentType') doctypeFound = true;
    if (node.tagName) {
      const tag = node.tagName.toLowerCase();
      tags.add(tag);
      if (['base', 'embed', 'form', 'frame', 'frameset', 'iframe', 'link', 'object'].includes(tag)) invalid = true;
      if (tag === 'title') titleFound = true;
      if (tag === 'body') bodyFound = true;
      for (const { name, value } of node.attrs ?? []) {
        if (tag === 'script' && name.toLowerCase() === 'src') invalid = true;
        if (tag === 'meta' && name.toLowerCase() === 'http-equiv' && value.toLowerCase() === 'refresh') invalid = true;
        if (tag === 'a' && name.toLowerCase() === 'href' && !value.startsWith('#')) {
          try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || !trustedSources.has(url.href)) invalid = true;
          } catch {
            invalid = true;
          }
        }
        if (tag === 'img' && name.toLowerCase() === 'src' && !value.startsWith('data:')) {
          try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.port) invalid = true;
          } catch {
            invalid = true;
          }
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  if (parseErrors.length > 0 || !doctypeFound || !tags.has('html') || !tags.has('head') ||
      !titleFound || !bodyFound || invalid) {
    throw new ToolFailure('The generated HTML failed the self-contained report checks.');
  }
  return {
    title: data.title.trim(),
    html: data.html,
    spokenSummary: data.spokenSummary.trim(),
  };
}

// Used until the web app reports its real window frame; matches the dark glass shell on a desktop.
export const defaultReportFrame: HtmlArtifactFrame = {
  widthPx: 1100,
  heightPx: 760,
  device: 'desktop',
  theme: 'dark',
  reducedMotion: false,
  density: 'comfortable',
  designTokens: {
    '--background': '#07090f',
    '--surface': '#111622',
    '--text': '#e8ecf4',
    '--muted': '#9aa3b5',
    '--accent': '#d7a67a',
    '--border': '#2a3142',
  },
  fonts: { body: 'system-ui, sans-serif', heading: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' },
  layout: 'tiled',
  pinned: false,
};

export function reportFrame(snapshot: ReturnType<FastifyInstance['workspaceCommands']['snapshot']>): HtmlArtifactFrame {
  const frame = snapshot?.frame;
  return isHtmlArtifactFrame(frame) ? { ...frame, pinned: false } : defaultReportFrame;
}

function notifyCompletion(
  notify: FastifyRequest['announceResearchCompletion'],
  result: { status: 'complete'; summary: string } | { status: 'failed' },
): void {
  try {
    notify?.(result);
  } catch {
    return;
  }
}

function createProgressView(
  windowTitle: string,
  searches: readonly SearchProgress[],
  sources: readonly HtmlArtifactSource[],
  status: 'complete' | 'partial' | 'unavailable',
  reason?: string,
): GeneratedView {
  const items = searches.map((search) => ({
    title: search.status === 'searching'
      ? `Searching: ${search.label}`
      : search.status === 'failed'
        ? `Search failed: ${search.label}`
        : search.status === 'complete'
          ? `Found: ${search.label}`
          : `Queued: ${search.label}`,
    description: search.status === 'failed'
      ? 'This search did not complete.'
      : search.answer ?? search.query,
  }));
  for (const source of sources) {
    items.push({ title: source.title, description: source.url });
  }
  if (status === 'unavailable') {
    items.unshift({ title: 'Research could not be completed', description: reason ?? 'Try again shortly.' });
  } else if (status === 'complete' || status === 'partial') {
    items.unshift({
      title: status === 'complete' ? 'Report is ready' : 'Report is ready with partial findings',
      description: 'The interactive report has replaced this progress view.',
    });
  }
  return {
    version: 1,
    title: windowTitle,
    renderer: 'list',
    source: {
      id: 'research',
      status,
      updatedAt: new Date().toISOString(),
      ...(status === 'unavailable' ? { reason: reason ?? 'Research could not be completed.' } : {}),
    },
    data: { items: items.slice(0, 100) },
  };
}

function workspaceCommand(
  operation: 'create' | 'update',
  viewId: string,
  view: GeneratedView,
): { commandId: string; operation: 'create' | 'update'; viewId: string; view: GeneratedView } {
  return { commandId: randomUUID(), operation, viewId, view };
}

async function sendProgress(
  app: FastifyInstance,
  ownerId: string,
  viewId: string,
  windowTitle: string,
  searches: readonly SearchProgress[],
  sources: readonly HtmlArtifactSource[],
  signal: AbortSignal,
  status: 'complete' | 'partial' | 'unavailable' = 'partial',
  reason?: string,
): Promise<void> {
  const command = workspaceCommand(
    'update',
    viewId,
    createProgressView(windowTitle, searches, sources, status, reason),
  );
  if (!isWorkspaceCommand(command, generatedViewValidationOptions(app))) {
    throw new ToolFailure('Research progress did not pass workspace validation.');
  }
  await app.workspaceCommands.execute(ownerId, command, signal);
}

function reportRequest(
  topic: string,
  depth: ResearchDepth,
  partial: boolean,
  frame: HtmlArtifactFrame,
  findings: { query: string; answer: string }[],
  sources: HtmlArtifactSource[],
): string {
  return JSON.stringify({ topic, depth, partial, frame, findings, sources });
}

export function createHtmlResearchModule(
  clientFor: () => WebResearchClient,
  model: string,
  artifacts: ResearchArtifactStore,
  options: ResearchOptions = {},
  folio?: FolioStore,
): BackendModule {
  const jobTimeoutMs = options.jobTimeoutMs ?? defaultJobTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
  const jobs = new Map<string, ResearchJob>();
  const executeResearch = async (input: unknown, request: FastifyRequest, signal: AbortSignal, retryOf?: string) => {
        if (!isObject(input) || (input.depth !== undefined && !isResearchDepth(input.depth))) {
          throw new ToolFailure('Choose a research depth of quick, standard, or deep.');
        }
        const topic = safeTopic(input.topic);
        const windowTitle = researchWindowTitle(input.title, topic);
        const ownerId = request.server.ownerObjectId;
        if (!request.agentPrincipal &&
            request.principal?.objectId.toLowerCase() !== ownerId.toLowerCase()) {
          throw new ToolRefusal('Research requires an authenticated workspace owner.');
        }
        const settings = request.server.settingsStore
          ? await readSettings(request.server.settingsStore, await request.server.modelCatalogue.read())
          : defaultSettings;
        const researchSettings = request.server.settingsStore
          ? settings.roles.research
          : { model, reasoningEffort: 'none' as const };
        const depth = isResearchDepth(input.depth) ? input.depth : settings.research.depth;
        const invocationTimeoutMs = options.invocationTimeoutMs ?? settings.research.timeoutSeconds * 1_000;
        const announceCompletion = request.announceResearchCompletion;
        for (const [id, job] of jobs) {
          if (job.done) jobs.delete(id);
        }
        let activeJobs = 0;
        for (const job of jobs.values()) if (!job.done) activeJobs += 1;
        if (activeJobs >= maxConcurrentJobs || jobs.size >= maxJobs) {
          throw new ToolRefusal('Research is busy. Try again when a current report finishes.');
        }
        const jobId = randomUUID();
        const viewId = `research-${jobId.replaceAll('-', '')}`;
        const searches: SearchProgress[] = plans[depth].map(([label, suffix]) => ({
          label,
          query: boundedQuery(topic, suffix),
          status: 'pending',
        }));
        const initialView = createProgressView(windowTitle, searches, [], 'partial');
        const initialCommand = workspaceCommand('create', viewId, initialView);
        if (!isWorkspaceCommand(initialCommand, generatedViewValidationOptions(request.server))) {
          throw new ToolFailure('Research progress did not pass workspace validation.');
        }
        const controller = new AbortController();
        const job: ResearchJob = { controller, promise: Promise.resolve(), done: false };
        const tracker = await request.server.backgroundJobs.start(
          'research', windowTitle, searches.length + 1, () => controller.abort(), 'Starting research',
          { retryInput: { topic, depth }, ...(retryOf ? { retryOf } : {}) },
        );
        try {
          await request.server.workspaceCommands.execute(ownerId, initialCommand, signal);
        } catch (error) {
          job.done = true;
          await tracker.fail('Research could not be started. Try again shortly.');
          throw error;
        }
        jobs.set(jobId, job);
        job.promise = Promise.resolve().then(async () => {
          const timeoutSignal = AbortSignal.timeout(jobTimeoutMs);
          const jobSignal = AbortSignal.any([controller.signal, timeoutSignal]);
          const sourcesByUrl = new Map<string, HtmlArtifactSource>();
          const findings: { query: string; answer: string }[] = [];
          const app = request.server;
          const sources = () => [...sourcesByUrl.values()].slice(0, settings.research.maxSources);
          try {
            // Progress windows are best effort: a tab that misses one update must not stop the research.
            const progress = () => sendProgress(app, ownerId, viewId, windowTitle, searches, sources(), jobSignal)
              .catch(() => { jobSignal.throwIfAborted(); });
            for (const [index, search] of searches.entries()) {
              jobSignal.throwIfAborted();
              search.status = 'searching';
              await tracker.progress(index, `Searching: ${search.label}`);
              await progress();
              try {
                const result = await runCodexToolResult(
                  clientFor(),
                  'web_research',
                  search.query,
                  researchSettings.model,
                  jobSignal,
                  invocationTimeoutMs,
                  pollIntervalMs,
                  (value) => parseWebResearchResult(value),
                  { reasoningEffort: researchSettings.reasoningEffort },
                );
                search.status = 'complete';
                search.answer = result.answer.slice(0, maxFindingLength);
                findings.push({ query: search.query, answer: result.answer.slice(0, maxFindingLength) });
                for (const source of result.sources) {
                  if (sourcesByUrl.size >= settings.research.maxSources) break;
                  sourcesByUrl.set(source.url, { title: source.title, url: source.url });
                }
              } catch (error) {
                if (jobSignal.aborted) throw error;
                search.status = 'failed';
              }
              await tracker.progress(index + 1, search.status === 'failed' ? `Search failed: ${search.label}` : `Found: ${search.label}`);
              await progress();
            }
            if (findings.length === 0) throw new ToolFailure('No research searches completed successfully.');
            const snapshot = app.workspaceCommands.snapshot(ownerId);
            const frame = reportFrame(snapshot);
            const reportSources = sources().slice(0, maxReportSources);
            const partial = searches.some((search) => search.status === 'failed');
            await tracker.progress(searches.length, 'Writing the report');
            const result = await runCodexToolResult(
              clientFor(),
              'html_report',
              reportRequest(topic, depth, partial, frame, findings, reportSources),
              researchSettings.model,
              jobSignal,
              invocationTimeoutMs,
              pollIntervalMs,
              (value) => parseReport(value, reportSources),
              { reasoningEffort: researchSettings.reasoningEffort },
            );
            const artifact = await artifacts.create(ownerId, result.title, result.html, sources(), jobSignal);
            if (!isHtmlArtifact(artifact)) throw new ToolFailure('The report failed artifact validation.');
            await folio?.record(ownerId, {
              id: `research:${artifact.id}`,
              kind: 'research',
              sourceId: artifact.id,
              title: artifact.title,
              promptSummary: topic.replace(/\s+/gu, ' ').slice(0, 500),
              createdAt: artifact.createdAt,
            }, jobSignal);
            const view: GeneratedView = {
              version: 1,
              title: windowTitle,
              renderer: 'html-app',
              source: {
                id: 'research',
                status: partial ? 'partial' : 'complete',
                updatedAt: new Date().toISOString(),
              },
              data: { artifactId: artifact.id },
            };
            const command = workspaceCommand('update', viewId, view);
            if (!isWorkspaceCommand(command, generatedViewValidationOptions(app))) {
              throw new ToolFailure('The report did not pass workspace validation.');
            }
            try {
              await app.workspaceCommands.execute(ownerId, command, jobSignal);
            } catch (error) {
              // No open tab still has the progress window (reloaded or closed): open the report fresh.
              if (!(error instanceof ToolRefusal)) throw error;
              await app.workspaceCommands.execute(ownerId, workspaceCommand('create', viewId, view), jobSignal);
            }
            await tracker.done(viewId, partial ? 'Ready with partial findings' : 'Report ready');
            notifyCompletion(announceCompletion, { status: 'complete', summary: result.spokenSummary });
          } catch (error) {
            if (!controller.signal.aborted) {
              const reason = error instanceof ToolRefusal
                ? 'Research was refused. Check workspace access and try again.'
                : 'Research could not be completed. Try again shortly.';
              await tracker.fail(reason);
              await sendProgress(
                app,
                ownerId,
                viewId,
                windowTitle,
                searches,
                sources(),
                AbortSignal.timeout(5_000),
                'unavailable',
                reason,
              )
                .catch(() => undefined);
              notifyCompletion(announceCompletion, { status: 'failed' });
            }
          } finally {
            job.done = true;
          }
        }).catch(() => undefined);
        return { jobId: tracker.jobId, message: 'Research has started. The workspace window will show progress and the completed report.' };
  };
  return {
    id: 'html-research',
    tools: [
      {
        name: 'research',
        description: 'Research a topic in the background and open an interactive cited HTML report in the workspace. ' +
          'Choose quick, standard, or deep depth; omit depth to use the saved research default. ' +
          'Set title to a short 3-6 word window title such as "Microsoft Foundry IQ"; put the full request in topic.',
        inputSchema,
        sensitive: true,
        execute: (input, request, signal) => executeResearch(input, request, signal),
      },
      {
        name: 'retry_job',
        description: 'Retry a failed research job by its jobId. The saved topic and research depth are reused.',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
          },
          required: ['jobId'],
          additionalProperties: false,
        },
        sensitive: true,
        execute: async (input, request, signal) => {
          if (!isObject(input) || typeof input.jobId !== 'string' ||
              !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(input.jobId)) {
            throw new ToolFailure('A valid background job ID is required.');
          }
          const stored = await request.server.backgroundJobs.details(input.jobId);
          if (!stored?.details.retryable || !stored.retryInput) {
            throw new ToolRefusal('No failed research job can be retried with that ID.');
          }
          return executeResearch({
            topic: stored.retryInput.topic,
            title: stored.details.job.title,
            depth: stored.retryInput.depth,
          }, request, signal, input.jobId);
        },
      },
    ],
    registerRoutes: async (app) => {
      app.addHook('onClose', async () => {
        for (const job of jobs.values()) job.controller.abort();
        await Promise.all([...jobs.values()].map((job) => job.promise));
        jobs.clear();
      });
    },
  };
}

function parseWebResearchResult(value: unknown): WebResearchResult {
  if (!isObject(value) || Object.keys(value).some((key) => !['answer', 'sources'].includes(key)) ||
      typeof value.answer !== 'string' || !value.answer.trim() ||
      !Array.isArray(value.sources) || value.sources.length > 10) {
    throw new ToolFailure('Web research returned an invalid result.');
  }
  const retrievedAt = new Date().toISOString();
  const sources = value.sources.map((source) => {
    if (!isObject(source) || Object.keys(source).some((key) => !['title', 'url'].includes(key)) ||
        typeof source.title !== 'string' || typeof source.url !== 'string') {
      throw new ToolFailure('Web research returned an invalid source.');
    }
    return { title: source.title, url: source.url, retrievedAt };
  });
  const result = { answer: value.answer, sources };
  if (!isWebResearchResult(result)) throw new ToolFailure('Web research returned an invalid or oversized result.');
  return result;
}

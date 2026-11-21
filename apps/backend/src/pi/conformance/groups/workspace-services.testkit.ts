import { randomUUID } from 'node:crypto';
import { FoundryClientError, type CodexToolName, type CodexToolOptions, type InvocationAccepted, type InvocationSnapshot } from '../../../foundry/client.js';
import type { ImageGenerator } from '../../../core/openai-images.js';
import type { WebResearchClient } from '../../../core/web-research.js';
import { tinyPng } from './workspace-stores.testkit.js';

/**
 * Stand-ins for everything the workspace tools reach outside the process: Open-Meteo, the Foundry runner that does web
 * research, and the OpenAI image API. None of them can open a socket. (Dan's open workspace tab is the core group's.)
 */

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** A self-contained HTML document that passes the HTML app checks (doctype, no base element, no script src). */
export const htmlDocument = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;

// ---- Open-Meteo --------------------------------------------------------------------------------------------------------------

const places: Readonly<Record<string, { name: string; latitude: number; longitude: number; country: string }>> = {
  aarhus: { name: 'Aarhus', latitude: 56.1572, longitude: 10.2107, country: 'Denmark' },
  copenhagen: { name: 'Copenhagen', latitude: 55.6761, longitude: 12.5683, country: 'Denmark' },
  odense: { name: 'Odense', latitude: 55.3959, longitude: 10.3883, country: 'Denmark' },
};

function forecastBody(url: URL) {
  const days = Number(url.searchParams.get('forecast_days'));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const dayAt = (offset: number) => new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const hours = Array.from({ length: days * 24 }, (_, index) => `${dayAt(Math.floor(index / 24))}T${String(index % 24).padStart(2, '0')}:00`);
  const perDay = <T>(value: (index: number) => T) => Array.from({ length: days }, (_, index) => value(index));
  return {
    timezone: 'Europe/Copenhagen',
    current: { time: `${dayAt(0)}T12:00`, temperature_2m: 7.4, apparent_temperature: 5.1, relative_humidity_2m: 82, precipitation: 0, weather_code: 3, wind_speed_10m: 14.2 },
    daily: {
      time: perDay(dayAt), weather_code: perDay((index) => (index % 2 === 0 ? 3 : 61)), temperature_2m_max: perDay((index) => 9 - index),
      temperature_2m_min: perDay((index) => 4 - index), precipitation_probability_max: perDay((index) => 20 + index * 10),
    },
    ...(url.searchParams.has('hourly')
      ? { hourly: { time: hours, temperature_2m: hours.map((_, index) => 5 + (index % 6)), precipitation_probability: hours.map((_, index) => index % 40) } } : {}),
  };
}

export interface OpenMeteoStub {
  readonly fetch: typeof fetch;
  /** Requests the stub answered. */
  readonly requests: URL[];
  /** Requests to any other host or path, which the stub refused. A passing run keeps this empty. */
  readonly blocked: string[];
}

/** Answers the two Open-Meteo endpoints the weather tool calls and refuses everything else. */
export function createOpenMeteoStub(): OpenMeteoStub {
  const requests: URL[] = [];
  const blocked: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const stub = async (input: URL | string | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol === 'https:' && url.hostname === 'geocoding-api.open-meteo.com' && url.pathname === '/v1/search') {
      requests.push(url);
      const place = places[(url.searchParams.get('name') ?? '').trim().toLowerCase()];
      return json(place ? { results: [place] } : { generationtime_ms: 0.5 });
    }
    if (url.protocol === 'https:' && url.hostname === 'api.open-meteo.com' && url.pathname === '/v1/forecast') {
      requests.push(url);
      return json(forecastBody(url));
    }
    blocked.push(url.href);
    throw new TypeError(`The conformance suite has no network access to ${url.hostname}.`);
  };
  return { fetch: stub as typeof fetch, requests, blocked };
}

// ---- Foundry (web research and the HTML report writer) -----------------------------------------------------------------------

/** A research topic or web query containing this text hits a runner outage, as a dropped connection would. */
export const outageMarker = 'simulate a runner outage';

export interface FoundryStub {
  readonly client: WebResearchClient;
  /** The invocations the runner accepted. */
  readonly invocations: { readonly tool: CodexToolName; readonly query: string }[];
}

const referenceSources = [
  { title: 'Example Foundation overview', url: 'https://example.org/overview' },
  { title: 'Microsoft Learn reference', url: 'https://learn.microsoft.com/en-us/azure/ai-foundry/' },
];

function reportFor(request: string): { title: string; html: string; spokenSummary: string } {
  const parsed = JSON.parse(request) as { topic: string; findings: { query: string; answer: string }[]; sources: { title: string; url: string }[] };
  const title = `Report: ${parsed.topic.slice(0, 60).trim()}`;
  const findings = parsed.findings.map((finding) => `<li>${escapeHtml(finding.answer)}</li>`).join('');
  const sources = parsed.sources.map((source) => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`).join('');
  return {
    title,
    html: htmlDocument(title, `<section><h2>Findings</h2><ul>${findings}</ul></section><section><h2>Sources</h2><ul>${sources}</ul></section>`),
    spokenSummary: `The report on ${parsed.topic.slice(0, 120)} is ready with ${parsed.findings.length} findings and ${parsed.sources.length} cited sources.`,
  };
}

/** A runner that finishes every invocation at once with a short cited answer, and drops the connection on an outage topic. */
export function createFoundryStub(): FoundryStub {
  const invocations: { tool: CodexToolName; query: string }[] = [];
  const accepted = new Map<string, { accepted: InvocationAccepted; tool: CodexToolName; query: string }>();
  const client = {
    async startCodexTool(tool: CodexToolName, query: string, _model: string, options?: CodexToolOptions): Promise<InvocationAccepted> {
      options?.signal?.throwIfAborted();
      if (query.includes(outageMarker)) throw new FoundryClientError('transport', 'start codex tool');
      const invocation: InvocationAccepted = { invocationId: randomUUID(), sessionId: randomUUID(), status: 'queued', agent: 'codex' };
      accepted.set(invocation.invocationId, { accepted: invocation, tool, query });
      invocations.push({ tool, query });
      return invocation;
    },
    async status(invocationId: string, options?: { signal?: AbortSignal }): Promise<InvocationSnapshot> {
      options?.signal?.throwIfAborted();
      const known = accepted.get(invocationId);
      if (!known) throw new FoundryClientError('http', 'read invocation', 404);
      const result = known.tool === 'web_research'
        ? { answer: `The main points about "${known.query.slice(0, 100)}" are summarised here with their sources.`, sources: referenceSources }
        : reportFor(known.query);
      return { ...known.accepted, status: 'completed', startedAt: Date.now(), finishedAt: Date.now(), events: [], result, error: null };
    },
    async cancel(invocationId: string) { return { invocationId, status: 'cancelled' as const }; },
    async deleteSession() {},
  };
  return { client: client as unknown as WebResearchClient, invocations };
}

// ---- OpenAI Images -----------------------------------------------------------------------------------------------------------

export interface ImageGeneratorStub extends ImageGenerator {
  /** Prompts it was asked to draw. */
  readonly prompts: string[];
}

/** The paid image API, replaced: it returns a 1×1 PNG at once. */
export function createImageGeneratorStub(): ImageGeneratorStub {
  const prompts: string[] = [];
  return {
    prompts,
    async generate(prompt, signal) {
      signal.throwIfAborted();
      prompts.push(prompt);
      return { contentType: 'image/png', bytes: tinyPng };
    },
  };
}

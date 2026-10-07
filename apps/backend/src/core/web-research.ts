import { isWebResearchResult, type WebResearchResult, type WebResearchSource } from '@jarvis/contracts';
import type { CodexToolName, FoundryClient } from '../foundry/client.js';
import type { BackendModule } from '../modules.js';
import { readSettings } from './settings.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const inputSchema = Object.freeze({
  type: 'object',
  properties: { query: { type: 'string', minLength: 1, maxLength: 2_000 } },
  required: ['query'],
  additionalProperties: false,
});
const toolTimeoutMs = 305_000;
const pollIntervalMs = 1_000;
const cleanupTimeoutMs = 5_000;

export type WebResearchClient = Pick<FoundryClient, 'startCodexTool' | 'status' | 'cancel' | 'deleteSession'>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new Error('Web research was cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function resultFrom(value: unknown): WebResearchResult {
  if (!isObject(value) || Object.keys(value).some((key) => !['answer', 'sources'].includes(key)) ||
      typeof value.answer !== 'string' || !value.answer.trim() ||
      !Array.isArray(value.sources) || value.sources.length > 10) {
    throw new ToolFailure('Web research returned an invalid result.');
  }
  const retrievedAt = new Date().toISOString();
  const sources: WebResearchSource[] = value.sources.map((source) => {
    if (!isObject(source) || Object.keys(source).some((key) => !['title', 'url'].includes(key)) ||
        typeof source.title !== 'string' || typeof source.url !== 'string') {
      throw new ToolFailure('Web research returned an invalid source.');
    }
    return { title: source.title, url: source.url, retrievedAt };
  });
  const answer = sources.length
    ? `${value.answer.trim()}\n\nSources:\n${sources.map((source) => `- ${source.title}: ${source.url}`).join('\n')}`
    : `No sources were returned. ${value.answer.trim()}`;
  const result = { answer, sources };
  if (!isWebResearchResult(result)) throw new ToolFailure('Web research returned an invalid or oversized result.');
  return result;
}

async function cleanup(client: WebResearchClient, invocationId: string, sessionId: string, cancel: boolean) {
  const signal = AbortSignal.timeout(cleanupTimeoutMs);
  if (cancel) await client.cancel(invocationId, { signal }).catch(() => undefined);
  await client.deleteSession(sessionId, { signal }).catch(() => undefined);
}

export async function runCodexToolResult<T>(
  client: WebResearchClient,
  tool: CodexToolName,
  query: string,
  model: string,
  signal: AbortSignal,
  timeoutMs: number,
  pollInterval: number,
  parse: (value: unknown) => T,
  options: { reasoningEffort?: string } = {},
): Promise<T> {
  const name = tool === 'web_research' ? 'Web research' : 'HTML report generation';
  const accepted = await client.startCodexTool(tool, query, model, {
    signal,
    ...(options.reasoningEffort && options.reasoningEffort !== 'none'
      ? { reasoning: options.reasoningEffort }
      : {}),
  });
  const deadline = Date.now() + timeoutMs;
  let terminal = false;
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const snapshot = await client.status(accepted.invocationId, { signal });
      if (snapshot.status === 'completed') {
        terminal = true;
        if (snapshot.result === null) throw new ToolFailure(`${name} completed without a result.`);
        return parse(snapshot.result);
      }
      if (['failed', 'cancelled', 'interrupted', 'needs_attention', 'unknown'].includes(snapshot.status)) {
        terminal = true;
        if (snapshot.error === 'Codex usage limit reached') {
          throw new ToolRefusal('Codex usage limit reached.');
        }
        throw new ToolFailure(`${name} could not complete.`);
      }
      await delay(Math.min(pollInterval, deadline - Date.now()), signal);
    }
    throw new ToolFailure(`${name} timed out.`);
  } finally {
    await cleanup(client, accepted.invocationId, accepted.sessionId, !terminal);
  }
}

export function createWebResearchModule(
  clientFor: () => WebResearchClient,
  model: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): BackendModule {
  const timeoutMs = options.timeoutMs ?? toolTimeoutMs;
  const pollInterval = options.pollIntervalMs ?? pollIntervalMs;
  return {
    id: 'web-research',
    registerRoutes: async () => {},
    tools: [{
      name: 'web_research',
      description: 'Research a topic using live web search and return a concise answer with retrieved source links.',
      inputSchema,
      sensitive: true,
      publicAllowedOnPhone: true,
      execute: async (input, request, signal) => {
        if (!isObject(input) || typeof input.query !== 'string' || !input.query.trim() ||
            input.query.length > 2_000) {
          throw new ToolFailure('A valid web research query is required.');
        }
        try {
          const selected = request.server?.settingsStore && request.server.modelCatalogue
            ? (await readSettings(
              request.server.settingsStore,
              await request.server.modelCatalogue.read(),
            )).roles.research
            : undefined;
          return await runCodexToolResult(
            clientFor(), 'web_research', input.query, selected?.model ?? model, signal, timeoutMs, pollInterval,
            resultFrom, { reasoningEffort: selected?.reasoningEffort ?? 'none' },
          );
        } catch (error) {
          if (error instanceof ToolFailure || error instanceof ToolRefusal) throw error;
          if (signal.aborted) throw error;
          throw new ToolFailure('Web research is temporarily unavailable.');
        }
      },
    }],
  };
}

import { FoundryClientError } from '../foundry/client.js';
import { researchSmokeFailureReasons, type SystemStatusResult } from '../system-status.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { runCodexToolResult, type WebResearchClient } from './web-research.js';

/** Classify the existing runner boundary without exposing its body, events or error text. */
export function researchSmokeFailureReason(error: unknown): string {
  if (error instanceof FoundryClientError) {
    const reason = error.kind === 'http'
      ? `research_runner_http_${error.statusCode}` : `research_runner_${error.kind}`;
    return researchSmokeFailureReasons.has(reason) ? reason : 'research_unavailable';
  }
  if (error instanceof ToolRefusal && error.message === 'Codex usage limit reached.') {
    return 'research_usage_limit';
  }
  if (error instanceof ToolFailure) {
    const reason = new Map([
      ['Web research could not complete.', 'research_runner_failed'],
      ['Web research timed out.', 'research_runner_timeout'],
      ['Web research completed without a result.', 'research_result_missing'],
      ['Research smoke response is invalid.', 'research_result_invalid'],
    ]).get(error.message);
    if (reason) return reason;
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'research_runner_timeout';
  return 'research_unavailable';
}

/** Keep the existing fixed dry run and timing; only its sanitized failure evidence changes. */
export function createResearchSmokeProbe(options: {
  configured: boolean;
  clientFor: () => WebResearchClient;
  selectModel: () => Promise<{ model: string; reasoningEffort: string }>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): () => Promise<SystemStatusResult> {
  return async () => {
    if (!options.configured) return { status: 'down', details: { configured: false } };
    let selected;
    try {
      selected = await options.selectModel();
    } catch {
      return { status: 'down', details: { configured: true }, reason: 'research_settings_unavailable' };
    }
    try {
      const timeoutMs = options.timeoutMs ?? 45_000;
      await runCodexToolResult(
        options.clientFor(), 'web_research',
        'Dry run only: answer with one short sentence and no sources; do not browse or save anything.',
        selected.model, AbortSignal.timeout(timeoutMs), timeoutMs, options.pollIntervalMs ?? 1_000,
        (value) => {
          if (typeof value !== 'object' || value === null || Array.isArray(value) ||
              typeof (value as Record<string, unknown>).answer !== 'string' ||
              !Array.isArray((value as Record<string, unknown>).sources)) {
            throw new ToolFailure('Research smoke response is invalid.');
          }
          return true;
        },
        { reasoningEffort: selected.reasoningEffort },
      );
      return { status: 'ok', details: { configured: true } };
    } catch (error) {
      return { status: 'down', details: { configured: true }, reason: researchSmokeFailureReason(error) };
    }
  };
}

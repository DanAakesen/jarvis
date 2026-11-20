import { z } from 'zod';
import type { ToolExecutionMetadata } from '../core/tool-registry.js';
import { piTurnPattern, type PiTurnGrant } from './turns.js';

const toolName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
export const piCompletionSchema = z.object({
  turn: z.string().regex(piTurnPattern),
  kind: z.enum(['conversation', 'quiet', 'current_data', 'action', 'background', 'failed']),
  tool: toolName.optional(),
}).strict();

export type PiToolEvidence =
  | { readonly kind: 'current_data' | 'action'; readonly tool: string }
  | { readonly kind: 'background'; readonly tool: string; readonly id: string; readonly lookup: 'get_job' | 'get_task' };
export type PiCompletion = PiToolEvidence | { readonly kind: 'conversation' | 'quiet' | 'failed' };

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const nonResultStatuses = new Set([
  'awaiting_confirmation', 'blocked', 'cancelled', 'declined', 'error', 'failed', 'not_found',
  'partial', 'pending', 'proposal', 'refused', 'rejected', 'skipped', 'unavailable', 'unverified',
]);
const nonEvidenceTools = new Set(['show_in_chat', 'workspace_command', 'situation_read']);

export function recordPiToolEvidence(
  grant: PiTurnGrant,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
  metadata?: { readonly execution?: ToolExecutionMetadata | undefined; readonly readOnly?: boolean | undefined; readonly durableJobs?: boolean },
): void {
  const body = object(result);
  if (result === null || result === undefined || result === false ||
      typeof result === 'string' && !result.trim() ||
      body && (!Object.keys(body).length || body.ok === false || body.success === false ||
        body.error != null || body.failure != null || body.refused != null ||
        nonResultStatuses.has(String(body.status ?? body.outcome).toLowerCase()))) return;

  const jobId = body?.jobId;
  if (['research', 'retry_job'].includes(tool)) {
    if (metadata?.durableJobs && typeof jobId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(jobId)) {
      grant.evidence.push({ kind: 'background', tool, id: jobId, lookup: 'get_job' });
    }
    return;
  }
  const task = object(body?.task);
  if (['create_task', 'create_issue', 'start_issue', 'retry_task'].includes(tool) &&
      typeof task?.id === 'string' && /^[1-9]\d{0,18}$/u.test(task.id)) {
    grant.evidence.push({ kind: 'background', tool, id: task.id, lookup: 'get_task' });
  }

  if (nonEvidenceTools.has(tool)) return;
  if (tool === 'web_research' && (!Array.isArray(body?.sources) || body.sources.length === 0)) return;
  const operation = metadata?.execution?.operation;
  const value = operation && args[operation.field];
  const declared = (typeof value === 'string' && operation && Object.hasOwn(operation.effects, value)
    ? operation.effects[value] : undefined) ?? metadata?.execution?.defaultEffect;
  // Some older tools do not declare execution metadata. Only recognize explicit read/write verbs there.
  const read = /(?:^|_)(?:get|list|search|read|lookup|query|check|find|status|agenda|next|fetch|history)(?:_|$)/u.test(tool) ||
    ['weather', 'web_research', 'inbox_items'].includes(tool);
  const write = /(?:^|_)(?:create|add|update|edit|write|save|remember|correct|forget|delete|move|complete|send|archive|label|cancel|retry|start|set|merge|draft|log|close)(?:_|$)/u.test(tool);
  const effect = declared === 'read' || declared === 'action' ? declared
    : metadata?.readOnly === true ? 'read'
      : write ? 'action' : read ? 'read' : null;
  if (effect === 'read' || effect === 'action') {
    grant.evidence.push({ kind: effect === 'read' ? 'current_data' : 'action', tool });
  }
}

export function finishPiTurn(grant: PiTurnGrant, input: z.infer<typeof piCompletionSchema>): string | undefined {
  if (grant.completion) return 'This outcome is already recorded.';
  if (grant.inFlightToolCalls > 0) return 'Wait for the tool result before finishing.';
  if (input.kind === 'failed') {
    grant.completion = { kind: 'failed' };
  } else if (input.kind === 'conversation' || input.kind === 'quiet' && !input.tool) {
    if (grant.results.length > 0) return 'Use the actual tool evidence or report failure.';
    grant.completion = { kind: input.kind };
  } else {
    const kind = input.kind === 'quiet' ? 'background' : input.kind;
    const evidence = [...grant.evidence].reverse().find(item => item.tool === input.tool && item.kind === kind);
    if (!evidence) return `There is no verified ${kind} evidence for that tool on this turn. Continue or report failure.`;
    grant.completion = evidence;
  }
  return undefined;
}

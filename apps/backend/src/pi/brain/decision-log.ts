import { dayKey, localTimeLabel } from '../../proactive/time.js';
import type { QueuedEvent } from '../../proactive/events/types.js';
import { shouldRedact } from '../../vault/index.js';
import type { PiBrainRunResult } from '../gateway.js';
import type { PiAreaStore } from '../area.js';

const maxStatement = 3_000;
const oneLine = (value: string, max: number) => Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, max).join('');

export interface DecisionRecord {
  readonly runId: string;
  readonly at: Date;
  /** Why the brain woke: the events it was given, and anything else the wake carried (a watch due). */
  readonly events: readonly Pick<QueuedEvent, 'id' | 'source' | 'kind' | 'summary'>[];
  readonly extra?: readonly string[] | undefined;
  readonly result: Pick<PiBrainRunResult, 'ok' | 'text' | 'usage' | 'costDkk' | 'estimated' | 'outcome' | 'toolResults' | 'run'>;
  readonly errorMessage?: string | undefined;
}

/**
 * One entry of the day's decision log, written by the system from what the tools recorded and what the model said in its
 * own words at the end of the wake. The model decides what to say there; the facts around it (which events, which tools,
 * what was sent, what it cost) are exact. A statement that looks like a credential is withheld, not the entry.
 */
export function renderDecision(record: DecisionRecord): string {
  const { result, events } = record;
  const tools = new Map<string, { ok: number; other: number }>();
  for (const entry of result.toolResults) {
    const counts = tools.get(entry.tool) ?? { ok: 0, other: 0 };
    if (entry.outcome === 'ok') counts.ok += 1; else counts.other += 1;
    tools.set(entry.tool, counts);
  }
  const toolLine = tools.size === 0 ? 'none' : [...tools].map(([name, { ok, other }]) =>
    `${name} ${ok}${other > 0 ? ` ok, ${other} not ok` : ''}`).join(', ');
  const told = result.run.sent.length === 0 ? 'nothing' : result.run.sent.map(({ text }) => `"${oneLine(text, 300)}"`).join('; ');
  const statement = result.text.trim().slice(0, maxStatement);
  const statementText = shouldRedact(statement) ? '(withheld: it looked like a credential)' : statement || '(no statement)';
  const header = `## ${localTimeLabel(record.at)} · run ${record.runId.slice(0, 8)} · ${result.ok ? 'done' : `failed (${record.errorMessage ?? result.outcome})`}`;
  return [
    header,
    '',
    events.length === 0 && !record.extra?.length ? 'Woken by: the timer.' : 'Woken by:',
    ...events.map((event) => `- ${event.source}:${event.kind}: ${oneLine(event.summary, 200)} (${event.id})`),
    ...(record.extra ?? []).map((line) => `- ${oneLine(line, 240)}`),
    '',
    `Looked with: ${toolLine}.`,
    `Told Dan: ${told}.`,
    result.run.wrote.length > 0 ? `Wrote: ${result.run.wrote.join(', ')}.` : 'Wrote: nothing.',
    ...(result.run.looked.length > 0 ? [`Looked at watches: ${result.run.looked.join(', ')}.`] : []),
    `Cost: ${result.usage.inputTokens} in (${result.usage.cachedTokens} cached), ${result.usage.outputTokens} out, ${result.costDkk.toFixed(4)} DKK${result.estimated ? ' (estimated)' : ''}.`,
    '',
    statementText,
  ].join('\n');
}

export function decisionLogPath(at: Date): string {
  return `PI/Log/${dayKey(at)}.md`;
}

export function createDecisionLog(options: { readonly area: PiAreaStore }) {
  return {
    async write(record: DecisionRecord, signal: AbortSignal): Promise<void> {
      const day = dayKey(record.at);
      await options.area.append(decisionLogPath(record.at), `PI decision log ${day}`, renderDecision(record), signal, `PI: decision log ${day}`);
    },
  };
}

export type DecisionLog = ReturnType<typeof createDecisionLog>;

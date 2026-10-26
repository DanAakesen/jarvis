import { useEffect, useState } from 'react';
import { InputOrbCore } from './InputOrbCore';

export type ToolState = 'running' | 'ok' | 'refused' | 'error';

/** Jarvis at work (Dan, 7 October): the orb's amber brain alone, alive and bright. Reduced motion keeps it still. */
export function WorkingCore() {
  return <span className="working-core" aria-hidden="true"><InputOrbCore variant="core" active /></span>;
}
/** A finished call: a bare thin tick (done) or cross (refused or failed), no circle. */
function ToolOutcomeMark({ state }: { state: Exclude<ToolState, 'running'> }) {
  return (
    <svg className="tool-chip-mark" data-state={state} viewBox="0 0 16 16" aria-hidden="true">
      {state === 'ok' ? <path d="m3.2 8.6 3.3 3.2 6.3-7.2" /> : <path d="m4 4 8 8m0-8-8 8" />}
    </svg>
  );
}

const outcomeLabel: Record<ToolState, string> = { running: 'Running', ok: 'Done', refused: 'Refused', error: 'Failed' };

/** Turns `create_task` into “Create task”; unknown shapes are shown as reported. */
function toolLabel(tool: string) {
  const words = tool.replace(/^daily_/u, 'health_').replace(/[_-]+/gu, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : tool;
}

/** One tool call as a compact glass chip: the working core, the tool's name and, unless it simply succeeded, its outcome. */
export function ToolCallChip({ tool, state }: { tool: string; state: ToolState }) {
  return (
    <span className="tool-chip" data-state={state} title={`${toolLabel(tool)} · ${outcomeLabel[state].toLowerCase()}`}>
      {state === 'running' ? <WorkingCore /> : <ToolOutcomeMark state={state} />}
      <span className="tool-chip-name">{toolLabel(tool)}</span>
      {state !== 'ok' && <span className="tool-chip-outcome">{outcomeLabel[state]}</span>}
      <span className="visually-hidden">{state === 'ok' ? ' · done' : ''}</span>
    </span>
  );
}

import { livePhraseFor, type LivePhase } from './live-phrase';

/** The visible line beside the working core. Screen readers get one steady status from the caller instead. */
export function LivePhrase({ phase, tool, text, typeSpeed }: {
  phase: LivePhase; tool?: string | null; text?: string | null; /** Milliseconds per character. */ typeSpeed?: number;
}) {
  // When Jarvis reports what it is actually doing, that line wins over the tool-derived one.
  const line = text || livePhraseFor(phase, tool);
  return <TypedPhrase key={line} text={line} speed={typeSpeed} />;
}
/** Writes a phrase in from the left, then two soft lights sweep across it (CSS). Reduced motion shows it whole. */
function TypedPhrase({ text, speed = 34 }: { text: string; speed?: number | undefined }) {
  const reduced = typeof window !== 'undefined' && ((window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
    document.documentElement.dataset.motion === 'reduced');
  const [typed, setTyped] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setTyped((count) => {
      if (count >= text.length) { window.clearInterval(timer); return count; }
      return count + 1;
    }), speed);
    return () => window.clearInterval(timer);
  }, [reduced, speed, text]);
  const done = typed >= text.length;
  return (
    <span className="live-phrase" data-typed={done || undefined} aria-hidden="true">
      {text.slice(0, typed)}{!done && <span className="live-phrase-caret" />}
    </span>
  );
}
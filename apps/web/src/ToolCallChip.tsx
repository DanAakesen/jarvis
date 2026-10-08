import { useEffect, useState } from 'react';
import { InputOrbCore } from './InputOrbCore';

export type ToolState = 'running' | 'ok' | 'refused' | 'error';

/** Jarvis at work (Dan, 7 October): the orb's amber brain alone, alive and bright. Reduced motion keeps it still. */
export function WorkingCore() {
  return <span className="working-core" aria-hidden="true"><InputOrbCore variant="core" active /></span>;
}
/** A finished call: a small round tick (done) or cross (refused or failed). */
function ToolOutcomeMark({ state }: { state: Exclude<ToolState, 'running'> }) {
  return (
    <svg className="tool-chip-mark" data-state={state} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" />
      {state === 'ok' ? <path d="m4.8 8.2 2.1 2.1 4.3-4.6" /> : <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" />}
    </svg>
  );
}

const outcomeLabel: Record<ToolState, string> = { running: 'Running', ok: 'Done', refused: 'Refused', error: 'Failed' };

/** Turns `create_task` into “Create task”; unknown shapes are shown as reported. */
function toolLabel(tool: string) {
  const words = tool.replace(/[_-]+/gu, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : tool;
}

/** One tool call as a compact glass chip: the working core, the tool's name and, unless it simply succeeded, its outcome. */
export function ToolCallChip({ tool, state }: { tool: string; state: ToolState }) {
  return (
    <span className="tool-chip" data-state={state} title={`${tool} · ${outcomeLabel[state].toLowerCase()}`}>
      {state === 'running' ? <WorkingCore /> : <ToolOutcomeMark state={state} />}
      <span className="tool-chip-name">{toolLabel(tool)}</span>
      {state !== 'ok' && <span className="tool-chip-outcome">{outcomeLabel[state]}</span>}
      <span className="visually-hidden">{state === 'ok' ? ' · done' : ''}</span>
    </span>
  );
}

// Jarvis speaks for itself while it works (Dan, 7 October): short first-person lines, shuffled afresh each turn so
// the same order never repeats, and never the same line twice in a row.
const livePhrases = {
  thinking: [
    'I’m thinking…', 'Let me work this out…', 'Figuring it out…', 'Joining the dots…', 'Mulling it over…',
    'Give me a moment…', 'Thinking this through…', 'Working out the best route…', 'Weighing it up…',
    'Turning it over…', 'Getting my head round it…', 'Piecing it together…', 'Considering the angles…',
    'Sorting the wheat from the chaff…', 'Having a proper think…', 'Running the numbers in my head…',
    'Untangling it…', 'Connecting a few thoughts…', 'One moment, sir…', 'Cogitating, as they say…',
    'Bear with me…', 'Thinking cap on…', 'Mapping it out…', 'Following a hunch…', 'Making sense of it…',
  ],
  working: [
    'On it…', 'Fetching what I need…', 'Checking a few things…', 'Doing the legwork…', 'Digging in…',
    'Rolling up my sleeves…', 'Gathering the facts…', 'Looking into it…', 'Pulling the threads…',
    'Consulting my sources…', 'Having a rummage…', 'Running the errand…', 'Working the problem…',
    'Chasing it down…', 'Cross-checking…', 'Doing the rounds…', 'Fetching the details…', 'Reading up…',
    'Asking the right systems…', 'Getting my hands dirty…',
  ],
  composing: [
    'Putting it together…', 'Shaping the answer…', 'Nearly there…', 'Tidying it up…', 'Finding the right words…',
    'Polishing the reply…', 'Almost ready…', 'Drafting it now…', 'Lining it all up…', 'Adding the finishing touches…',
    'Wrapping it up…', 'Just a moment more…',
  ],
  // Under the amber core while a page loads (Dan, 8 October).
  loading: [
    'Warming up…', 'Fetching your things…', 'Dusting off the archives…', 'Lighting the lamps…', 'Opening the ledgers…',
    'Gathering the papers…', 'Rounding everything up…', 'Laying it all out…', 'Checking the records…',
    'Unrolling the maps…', 'Calling it up…', 'Straightening the shelves…', 'Bringing it in…', 'One moment, sir…',
    'Polishing the glass…', 'Nearly there…', 'Putting the kettle on…', 'Sorting the post…',
  ],
} as const;

function shuffled(phrases: readonly string[], avoidFirst?: string) {
  const order = [...phrases];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  if (avoidFirst && order[0] === avoidFirst && order.length > 1) [order[0], order[1]] = [order[1]!, order[0]!];
  return order;
}

/** The visible, rotating line beside the working core. Screen readers get one steady status from the caller instead. */
export function LivePhrase({ phase, text }: { phase: keyof typeof livePhrases; text?: string | null }) {
  const [state, setState] = useState(() => ({ order: shuffled(livePhrases[phase]), index: 0 }));
  useEffect(() => {
    const timer = window.setInterval(() => setState((current) => {
      const next = current.index + 1;
      // At the end of a pass, reshuffle so the order differs, without repeating the line just shown.
      return next < current.order.length
        ? { ...current, index: next }
        : { order: shuffled(current.order, current.order[current.index]), index: 0 };
    }), 3200);
    return () => window.clearInterval(timer);
  }, []);
  // When Jarvis reports what it is actually doing, that line replaces the canned phrases.
  if (text) return <TypedPhrase key={`work-${text}`} text={text} />;
  return <TypedPhrase key={`${state.index}-${state.order[state.index]}`} text={state.order[state.index] ?? ''} />;
}
/** Writes a phrase in from the left, then two soft lights sweep across it (CSS). Reduced motion shows it whole. */
function TypedPhrase({ text }: { text: string }) {
  const reduced = typeof window !== 'undefined' && ((window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
    document.documentElement.dataset.motion === 'reduced');
  const [typed, setTyped] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setTyped((count) => {
      if (count >= text.length) { window.clearInterval(timer); return count; }
      return count + 1;
    }), 34);
    return () => window.clearInterval(timer);
  }, [reduced, text]);
  const done = typed >= text.length;
  return (
    <span className="live-phrase" data-typed={done || undefined} aria-hidden="true">
      {text.slice(0, typed)}{!done && <span className="live-phrase-caret" />}
    </span>
  );
}
export function formatLocalTime(now: Date, timeZone: string): string {
  return `${now.toLocaleString('sv-SE', { timeZone, hour12: false }).slice(0, 16)} ${timeZone}`;
}

export interface PiTurnText {
  /** Sent with the first turn of a conversation and again when it changes. */
  readonly context?: string | undefined;
  readonly turn: string;
  readonly now: Date;
  readonly timeZone: string;
  readonly text: string;
  /** Trusted app-side notes about this message (attachments, shared screen text, replies to a push). */
  readonly notes?: readonly string[] | undefined;
}

/**
 * One owner message as the agent sees it. The first line carries the turn reference the agent must pass to every tool
 * call; the instructions say only that line counts, and the reference is verified server-side, so a lookalike line in
 * the owner's text gains nothing.
 */
export function formatTurn(input: PiTurnText): string {
  return [
    ...(input.context ? [input.context, ''] : []),
    `[Turn ${input.turn} | ${formatLocalTime(input.now, input.timeZone)}]`,
    ...(input.notes ?? []).flatMap(note => [note, '']),
    input.text,
  ].join('\n');
}

export function formatWarmup(input: { readonly context: string; readonly now: Date; readonly timeZone: string }): string {
  return [
    input.context, '',
    `[Session start | ${formatLocalTime(input.now, input.timeZone)}]`,
    'Session warm-up only. There is no owner message and no tool is needed. Reply with exactly: ready',
  ].join('\n');
}

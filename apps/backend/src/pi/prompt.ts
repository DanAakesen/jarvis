/** Trusted note the voice relay adds to a turn: the reply is read aloud by Voice Live, word for word. */
export const voiceChannelNote =
  '[Channel: voice. Dan hears this reply spoken and can interrupt it. Answer in one to three short spoken sentences: plain words, no markdown, lists, tables, links or code, and say numbers, dates and times the way a person says them. Anything long goes to chat; offer that instead of reading it out. Dan has his screen in front of him: when something is easier to see than to hear (a list, table, chart, forecast, timeline or status), show it on his screen: find_tools (query "workspace command") then call_tool workspace_command with a view, then say one short sentence about it and do not read it out.]';

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
    `[Turn ${input.turn} | ${formatLocalTime(input.now, input.timeZone)}]`,
    ...(input.context ? [input.context, ''] : []),
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

/** Trusted note the voice relay adds to a turn: GPT-Live speaks the returned commentary. */
export const voiceChannelNote =
  '[Channel: voice. Dan hears this reply spoken and can interrupt it. Keep the exact same identity, tone, humour, custom and mode instructions from the trusted context; this channel changes delivery, never personality. Use the language, names, numbers and decisions of the authoritative answer, with plain spoken formatting and no markdown. Keep it naturally concise, not generic: preserve dry wit when the trusted style calls for it. When visual detail is genuinely easier to see than to hear, show it with workspace_command and speak only the concise companion sentence.]';

export function formatLocalTime(now: Date, timeZone: string): string {
  return `${now.toLocaleString('sv-SE', { timeZone, hour12: false }).slice(0, 16)} ${timeZone}`;
}

export interface PiTurnText {
  readonly turn: string;
  readonly now: Date;
  readonly timeZone: string;
  readonly text: string;
  /** App-labelled request payload (attachments, shared context and replies); content is not trusted instruction. */
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
    ...(input.notes ?? []).flatMap(note => [note, '']),
    input.text,
  ].join('\n');
}

export function formatWarmup(input: { readonly now: Date; readonly timeZone: string }): string {
  return [
    `[Session start | ${formatLocalTime(input.now, input.timeZone)}]`,
    'Session warm-up only. There is no owner message and no tool is needed. Reply with exactly: ready',
  ].join('\n');
}

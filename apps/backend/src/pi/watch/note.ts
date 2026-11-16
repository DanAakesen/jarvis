import { shouldRedact } from '../../vault/index.js';

/**
 * A watch is a free-text note. The only fixed thing in it is the time of the next look, kept as a hidden last line so the
 * waker has an exact instant; everything else (what to watch, why, how often, on which events, when to stop) is the model's and
 * Dan's own words. Nothing here parses the prose.
 */
const markerPattern = /^<!-- jarvis-watch:next=(\d{4}-\d\d-\d\dT[\d:.]+Z) -->$/mu;
export const MAX_WATCH_TITLE = 100;
export const MAX_WATCH_TEXT = 8_000;
export const MAX_QUOTE = 1_500;

export class WatchError extends Error {
  constructor(readonly code: 'invalid' | 'refused' | 'not_found' | 'limit' | 'unavailable', message: string) {
    super(message);
    this.name = 'WatchError';
  }
}

export interface ParsedWatch {
  /** The file name without folders or extension: the handle the tools and Dan use. */
  readonly name: string;
  readonly title: string;
  readonly nextLook: Date | null;
  readonly body: string;
  readonly excerpt: string;
}

const oneLine = (value: string) => value.replace(/\s+/gu, ' ').trim();

/** A safe file name from a title: letters, digits, spaces, dash and underscore only. */
export function watchFileName(title: string): string {
  const name = oneLine(title).replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80).trim();
  if (!name) throw new WatchError('invalid', 'The watch needs a short title with letters or digits.');
  return name;
}

function cleaned(value: string, field: string, max: number): string {
  const text = value.trim();
  if (!text) throw new WatchError('invalid', `The watch ${field} is empty.`);
  if (text.length > max) throw new WatchError('invalid', `The watch ${field} is too long. Condense it.`);
  // A marker in free text is never adopted; the only marker is the one written by `withNextLook`.
  return text.replace(/<!--\s*jarvis-watch:[^>]*-->/gu, '');
}

export function stamp(at: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(({ type, value }) => [type, value]));
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

function withoutMarker(content: string): string {
  return content.replace(/\n*<!-- jarvis-watch:[^>]*-->\s*$/u, '').trimEnd();
}

/** Sets or clears the one fixed field. A watch without a next look is woken only by events. */
export function withNextLook(content: string, nextLook: Date | null): string {
  const body = withoutMarker(content);
  return nextLook === null ? `${body}\n` : `${body}\n\n<!-- jarvis-watch:next=${nextLook.toISOString()} -->\n`;
}

export function parseNextLook(content: string): Date | null {
  const match = markerPattern.exec(content);
  const at = match ? new Date(match[1]!) : null;
  return at && Number.isFinite(at.getTime()) ? at : null;
}

export function composeWatch(input: { title: string; text: string; quote?: string | undefined; nextLook?: Date | null | undefined; at: Date; source?: string | undefined }): string {
  const title = oneLine(cleaned(input.title, 'title', MAX_WATCH_TITLE));
  const text = cleaned(input.text, 'text', MAX_WATCH_TEXT);
  const quote = input.quote === undefined ? '' : cleaned(input.quote, 'quote', MAX_QUOTE);
  const attribution = `Dan, ${stamp(input.at)}${input.source ? `, ${input.source}` : ''}: "${quote}"`;
  const quoted = quote ? `${attribution.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n` : '';
  const content = withNextLook(`# ${title}\n\n${quoted}${text}\n\n## Trail\n- ${stamp(input.at)}: watch opened`, input.nextLook ?? null);
  if (shouldRedact(content)) throw new WatchError('refused', 'Secrets and credentials can never be saved to the vault. Nothing was written.');
  return content;
}

/** Adds one dated line to the Trail section (created when missing), keeping the marker last. */
export function appendTrailLine(content: string, line: string, at: Date): string {
  const next = parseNextLook(content);
  const body = withoutMarker(content);
  const entry = `- ${stamp(at)}: ${oneLine(cleaned(line, 'trail line', 700))}`;
  const lastHeading = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*$/gmu)].at(-1);
  const grown = lastHeading && /^trail$/iu.test(lastHeading[1]!) ? `${body}\n${entry}` : `${body}\n\n## Trail\n${entry}`;
  if (shouldRedact(grown)) throw new WatchError('refused', 'Secrets and credentials can never be saved to the vault. Nothing was written.');
  return withNextLook(grown, next);
}

export function parseWatch(path: string, content: string): ParsedWatch {
  const name = path.split('/').at(-1)!.replace(/\.md$/u, '');
  const title = /^#[ \t]+(.+?)[ \t]*$/mu.exec(content)?.[1] ?? name;
  const body = withoutMarker(content);
  const withoutHeading = body.replace(/^#[ \t]+.+\n+/u, '').replace(/\n## Trail[\s\S]*$/u, '');
  return { name, title, nextLook: parseNextLook(content), body, excerpt: Array.from(oneLine(withoutHeading)).slice(0, 280).join('') };
}

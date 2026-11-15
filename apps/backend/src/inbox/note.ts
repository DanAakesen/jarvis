import { createHash, randomBytes } from 'node:crypto';
import { shouldRedact } from '../vault/index.js';

export const INBOX_DIR = 'Inbox';
export const INBOX_CLOSED_DIR = 'Inbox/Closed';
export const MAX_INBOX_NOTE_BYTES = 8 * 1024;
/** Room for 4000 characters in any language (up to four bytes each), so the character limit of capture is the binding one. */
export const MAX_INBOX_QUOTE_BYTES = 16 * 1024;
export const MAX_INBOX_TITLE_LENGTH = 120;
const maxFileNameTitleLength = 80;
const timeZone = 'Europe/Copenhagen';

export class InboxError extends Error {
  constructor(
    readonly code: 'invalid' | 'refused' | 'too_large' | 'not_found' | 'conflict' | 'unavailable',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'InboxError';
  }
}

const idComment = /<!--\s*jarvis-inbox:([0-9a-f]{8,32})\s*-->/giu;
const anyIdComment = /<!--\s*jarvis-inbox:[^>]*-->/giu;
const controlCharacters = /[\p{Cc}\p{Cf}]/gu;
const unsafeFileNameCharacters = /[\\/:*?"<>|#%^[\]]/gu;

export function newInboxId(): string {
  return randomBytes(4).toString('hex');
}

/** Same capture, same id: the owner message and the item's title decide, so a retried tool call lands on the same note. */
export function captureItemId(sourceMessageId: string, title: string): string {
  return createHash('sha256').update(`${sourceMessageId}\n${cleanTitle(title).toLowerCase()}`).digest('hex').slice(0, 12);
}

/** Id of the k-th note made from one raw capture; the client's capture id is the idempotency key. */
export function captureNoteId(captureId: string, position: number): string {
  return createHash('sha256').update(`capture:${captureId.toLowerCase()}:${position}`).digest('hex').slice(0, 12);
}

export function isInboxId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8,32}$/u.test(value);
}

export function isLiveInboxPath(path: string): boolean {
  return /^Inbox\/[^/]+\.md$/u.test(path) && isSafeFileName(path.slice('Inbox/'.length));
}

export function isClosedInboxPath(path: string): boolean {
  return /^Inbox\/Closed\/[^/]+\.md$/u.test(path) && isSafeFileName(path.slice('Inbox/Closed/'.length));
}

export function isInboxPath(path: string): boolean {
  return isLiveInboxPath(path) || isClosedInboxPath(path);
}

function isSafeFileName(name: string): boolean {
  return name.length <= 140 && name === name.normalize('NFC') && !name.startsWith('.') &&
    !/[\p{Cc}\p{Cf}\\:*?"<>|#%^[\]]/u.test(name) && !shouldRedact(name);
}

export function inboxPath(date: string, title: string, copy = 1): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new InboxError('invalid', 'The inbox date is invalid.');
  const path = `${INBOX_DIR}/${date} ${fileNameTitle(title)}${copy > 1 ? ` ${copy}` : ''}.md`;
  if (!isLiveInboxPath(path)) throw new InboxError('refused', 'That title cannot be used as an inbox file name.');
  return path;
}

/** The Closed path for a live note: same name, with a copy suffix when that name is taken. */
export function closedPathFor(path: string, copy = 1): string {
  if (!isLiveInboxPath(path)) throw new InboxError('invalid', 'Only live inbox notes can be closed.');
  const name = path.slice('Inbox/'.length, -'.md'.length);
  return `${INBOX_CLOSED_DIR}/${name}${copy > 1 ? ` ${copy}` : ''}.md`;
}

function fileNameTitle(title: string): string {
  const cleaned = cleanTitle(title)
    .replace(unsafeFileNameCharacters, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const clipped = Array.from(cleaned).slice(0, maxFileNameTitleLength).join('').replace(/[\s.]+$/u, '');
  return clipped.replace(/^[\s.]+/u, '') || 'Untitled';
}

export function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') throw new InboxError('invalid', 'An inbox item needs a title.');
  const title = value
    .normalize('NFC')
    .replace(anyIdComment, ' ')
    .replace(controlCharacters, ' ')
    .replace(/^#+\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!title) throw new InboxError('invalid', 'An inbox item needs a title.');
  if (Array.from(title).length > MAX_INBOX_TITLE_LENGTH) {
    throw new InboxError('too_large', `The title is longer than ${MAX_INBOX_TITLE_LENGTH} characters.`);
  }
  return title;
}

/** Free text from a caller. The id marker is ours, so a caller can never plant one. */
export function cleanText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string') throw new InboxError('invalid', `The ${field} must be text.`);
  const text = value
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(anyIdComment, '')
    .replace(controlCharacters, (character) => character === '\n' || character === '\t' ? character : '')
    .trim();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new InboxError('too_large', `The ${field} is longer than ${maxBytes} bytes.`);
  }
  return text;
}

export function noteId(content: string): string | undefined {
  const matches = [...content.matchAll(idComment)];
  return matches.at(-1)?.[1]?.toLowerCase();
}

/** Identity for a note written by another tool: stable per path until the id comment exists. */
export function pathItemId(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 8);
}

export function noteTitle(content: string, path: string): string {
  const heading = /^#[ \t]+(.+?)[ \t]*$/mu.exec(content)?.[1];
  const fallback = (path.split('/').at(-1) ?? path).replace(/\.md$/iu, '').replace(/^\d{4}-\d{2}-\d{2}[ _-]*/u, '');
  return (heading ?? fallback).trim().slice(0, MAX_INBOX_TITLE_LENGTH) || 'Untitled';
}

export function datePrefix(path: string): string | undefined {
  return /\/(\d{4}-\d{2}-\d{2})[ _-]/u.exec(path)?.[1];
}

export function noteExcerpt(content: string, maxLength = 280): string {
  return withoutIdComment(content).split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('>'))
    .join(' ')
    .slice(0, maxLength);
}

export function withoutIdComment(content: string): string {
  return content.replace(anyIdComment, '').replace(/\n{3,}/gu, '\n\n').trimEnd();
}

/** The hidden id is the last line of the note; it is added (or restored) here and nowhere else. */
export function withId(content: string, id: string): string {
  if (!isInboxId(id)) throw new InboxError('invalid', 'The inbox id is invalid.');
  return `${withoutIdComment(content)}\n\n<!-- jarvis-inbox:${id} -->\n`;
}

function copenhagenParts(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: String(Number(parts.day)),
    month: new Intl.DateTimeFormat('en-GB', { timeZone, month: 'short' }).format(at),
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function inboxDate(at: Date): string {
  return copenhagenParts(at).date;
}

/** Short day label for the trail, for example "18 Nov". */
export function trailDay(at: Date): string {
  const { day, month } = copenhagenParts(at);
  return `${day} ${month}`;
}

export interface NoteDraft {
  readonly title: string;
  readonly note?: string | undefined;
  /** The owner's own words, kept verbatim in a quote. */
  readonly quote?: string | undefined;
  /** Where the words came from, for example "voice" or "chat". */
  readonly source?: string | undefined;
}

export function composeNote(draft: NoteDraft, id: string, at: Date): string {
  const title = cleanTitle(draft.title);
  const note = draft.note === undefined ? '' : cleanText(draft.note, 'note', MAX_INBOX_NOTE_BYTES);
  const quote = draft.quote === undefined ? '' : cleanText(draft.quote, 'quote', MAX_INBOX_QUOTE_BYTES);
  const source = draft.source === undefined ? '' : cleanTitle(draft.source).slice(0, 40);
  if (!note && !quote) throw new InboxError('invalid', 'An inbox item needs a note or the original words.');
  const { day, month, time } = copenhagenParts(at);
  const attribution = `Dan, ${day} ${month} ${time}${source ? `, ${source}` : ''}`;
  const quoted = quote
    ? `${`${attribution}: "${quote}"`.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n`
    : '';
  const content = withId(`# ${title}\n\n${quoted}${note}`, id);
  assertSavable(content);
  return content;
}

export function assertSavable(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_INBOX_NOTE_BYTES + MAX_INBOX_QUOTE_BYTES + 1024) {
    throw new InboxError('too_large', 'The inbox note is too large. Condense it.');
  }
  if (shouldRedact(content)) {
    throw new InboxError('refused', 'Secrets and credentials can never be saved to the vault. Nothing was written.');
  }
}

/** Adds one dated line to the note's Trail section, creating the section when missing. The hidden id stays last. */
export function appendTrail(content: string, line: string, at: Date, id: string): string {
  const entry = `- ${trailDay(at)}: ${cleanText(line, 'trail entry', 600).replace(/\s*\n\s*/gu, ' ')}`;
  const body = withoutIdComment(content);
  const lastHeading = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*$/gmu)].at(-1);
  const next = lastHeading && /^trail$/iu.test(lastHeading[1]!)
    ? `${body}\n${entry}`
    : `${body}\n\n## Trail\n${entry}`;
  const result = withId(next, id);
  assertSavable(result);
  return result;
}

/** Git blob sha of a text note, so a write can be followed without rereading it. */
export function blobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

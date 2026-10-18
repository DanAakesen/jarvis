import { dayKey } from './time.js';
import { parseTodos } from './todo-file.js';

const taskLinePattern = /^\s*(?:(?:>\s*)*)(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]\s*(.*)$/u;
const markerPattern = /<!--\s*jarvis:p:([a-f\d]{16})\s*-->/giu;
const taskMetadata = /[📅⏳🛫➕✅❌🔁🏁⏫🔼🔽⏬🔺🆔⛔]/gu;

export function sanitiseTodoText(value: string): string {
  const oneLine = value.replace(/[\t\n\r\f\v]/gu, ' ').replace(/\p{Cc}/gu, '');
  const withoutComments = oneLine.replace(/<!--[\s\S]*?(?:-->|$)/gu, ' ');
  const withoutLinks = withoutComments.replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/gu, '$1');
  const withoutMetadata = withoutLinks
    .replace(/(?:📅|\bdue::?)\s*(?:\[[^\]]*\]|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?|\S+)?/giu, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, ' ')
    .replace(taskMetadata, ' ')
    .replace(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s]+|(?:\b[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/giu, ' ')
    .replace(/<[^>]*(?:>|$)/gu, ' ')
    .replace(/<!--|-->/gu, ' ')
    .replace(/[`]|(?:\[\[|\]\])/gu, '');
  const withoutLeadingMarkers = withoutMetadata
    .replace(/^\s*(?:(?:[-*+]\s+)|(?:>\s*)|(?:#{1,6}\s*)|(?:\d+[.)]\s+)|(?:\[[ xX]\]\s*))+/u, '');
  return Array.from(withoutLeadingMarkers.replace(/\s+/gu, ' ').trim()).slice(0, 200).join('');
}

export function buildSuggestedTodoLine(text: string, dueAt: string | null, dedupeKey: string): string {
  if (Array.from(text).length < 3 || /[\r\n]/u.test(text) || !/^[a-f\d]{32}$/iu.test(dedupeKey)) {
    throw new RangeError('Invalid suggested todo');
  }
  const due = dueAt === null ? '' : ` 📅 ${dayKey(new Date(dueAt))}`;
  return `- [ ] ${text}${due} <!-- jarvis:p:${dedupeKey.slice(0, 16).toLowerCase()} -->`;
}

export function normaliseTodoText(value: string): string {
  return value
    .replace(/<!--\s*jarvis:p:[a-f\d]{16}\s*-->/giu, ' ')
    .replace(/(?:📅\s*|\bdue::?\s*)(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)?/giu, ' ')
    .toLocaleLowerCase('en')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function hasTodoMarker(content: string, dedupeKey: string): boolean {
  const marker = dedupeKey.slice(0, 16).toLowerCase();
  markerPattern.lastIndex = 0;
  for (const match of content.matchAll(markerPattern)) {
    if (match[1]?.toLowerCase() === marker) return true;
  }
  return false;
}

export function hasDuplicateTodo(content: string, line: string): boolean {
  const taskText = taskLinePattern.exec(line)?.[2] ?? line;
  const candidate = normaliseTodoText(taskText);
  if (!candidate) return false;
  const existing = new Set(parseTodos(content).map(({ text }) => normaliseTodoText(text)));
  return existing.has(candidate);
}

function lineEnding(existing: string): string {
  const firstNewline = existing.indexOf('\n');
  return firstNewline > 0 && existing[firstNewline - 1] === '\r' ? '\r\n' : '\n';
}

function hasJarvisHeading(existing: string): boolean {
  const headings = existing.split(/\r?\n/u)
    .map((line) => /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1]?.trim())
    .filter((heading): heading is string => heading !== undefined);
  return headings.at(-1)?.toLocaleLowerCase('en') === 'suggested by jarvis';
}

function isInsideCodeFence(existing: string): boolean {
  const fences = existing.split(/\r?\n/u).filter((line) => /^\s*(?:`{3,}|~{3,})/u.test(line));
  return fences.length % 2 === 1;
}

export function appendTodos(existing: string, lines: readonly string[]): string {
  if (lines.length === 0) return existing;
  if (lines.some((line) => /[\r\n]/u.test(line))) throw new TypeError('Todo lines must be single lines');
  if (isInsideCodeFence(existing)) throw new Error('Todo file is inside an unclosed code fence');

  const ending = lineEnding(existing);
  const heading = hasJarvisHeading(existing);
  let prefix = '';
  if (heading) {
    if (!existing.endsWith(ending)) prefix = ending;
  }
  if (!heading) {
    const trailingEndings = existing.match(/(?:\r?\n)+$/u)?.[0].match(/\r?\n/gu).length ?? 0;
    if (existing.length === 0) prefix = ending;
    else if (trailingEndings < 2) prefix = ending.repeat(2 - trailingEndings);
    prefix += `## Suggested by Jarvis${ending}`;
  }
  const result = `${existing}${prefix}${lines.join(ending)}`;
  const appended = result.slice(existing.length);
  const expectedLines = lines.join(ending);
  if (!result.startsWith(existing) || !appended.endsWith(expectedLines)) {
    throw new Error('Todo append would change existing content');
  }
  return result;
}

import { dayKey } from './time.js';
import { parseTodos, taskMetadata } from './todo-file.js';

const taskLinePattern = /^\s*(?:(?:>\s*)*)(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]\s*(.*)$/u;
const markerPattern = /<!--\s*jarvis:p:([a-f\d]{16})\s*-->/giu;

export function sanitiseTodoText(value: string): string {
  const oneLine = value.replace(/[\t\n\r\f\v]/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '');
  const withoutComments = oneLine.replace(/<!--[\s\S]*?(?:-->|$)/gu, ' ');
  const withoutLinks = withoutComments.replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/gu, '$1');
  const withoutMetadata = withoutLinks
    .replace(/🕒\s*\d{2}:\d{2}/gu, ' ')
    .replace(/(?:📅|\bdue::?)\s*(?:\[[^\]]*\]|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?|\S+)?/giu, ' ')
    .replace(/\bmailto:[^\s]+/giu, ' ')
    .replace(/(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}(?![\p{L}\p{N}-])/gu, ' ')
    .replace(taskMetadata, ' ')
    .replace(/(?:\b[a-z][a-z\d+.-]*:\/\/|www\.)[^\s]+|(?:\b[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/giu, ' ')
    .replace(/<[^>]*(?:>|$)/gu, ' ')
    .replace(/<!--|--!?>/gu, ' ')
    .replace(/[`]|(?:\[\[|\]\])/gu, '');
  const withoutLeadingMarkers = withoutMetadata
    .replace(/^\s*(?:(?:[-*+]\s+)|(?:>\s*)|(?:#{1,6}\s*)|(?:\d+[.)]\s+)|(?:\[[ xX]\]\s*))+/u, '');
  return Array.from(withoutLeadingMarkers.replace(/\s+/gu, ' ').trim()).slice(0, 200).join('');
}

export function buildSuggestedTodoLine(
  text: string,
  dueAt: string | null,
  dedupeKey: string,
  options: { dueHasTime?: boolean; highPriority?: boolean } = {},
): string {
  if (Array.from(text).length < 3 || /[\r\n]/u.test(text) || !/^[a-f\d]{32}$/iu.test(dedupeKey)) {
    throw new RangeError('Invalid suggested todo');
  }
  const cleanText = text.replace(/^(?:\(proactive\)\s*)+/iu, '').trim();
  const dueDate = dueAt === null ? '' : dayKey(new Date(dueAt));
  const dueTime = dueAt === null ? '' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(dueAt));
  const metadata = [
    options.dueHasTime && dueTime ? `🕒 ${dueTime}` : '',
    dueDate ? `📅 ${dueDate}` : '',
    options.highPriority ? '⏫' : '',
  ].filter(Boolean).join(' ');
  return `- [ ] (proactive) ${cleanText}${metadata ? ` ${metadata}` : ''} <!-- jarvis:p:${dedupeKey.slice(0, 16).toLowerCase()} -->`;
}

export function appendTaskLines(existing: string, lines: readonly string[]): string {
  if (lines.length === 0) return existing;
  if (lines.some((line) => /[\r\n]/u.test(line))) throw new TypeError('Todo lines must be single lines');
  if (isInsideCodeFence(existing)) throw new Error('Todo file is inside an unclosed code fence');
  const ending = lineEnding(existing);
  const prefix = existing.length === 0 || existing.endsWith(ending) ? '' : ending;
  const result = `${existing}${prefix}${lines.join(ending)}`;
  if (!result.startsWith(existing) || !result.slice(existing.length).endsWith(lines.join(ending))) {
    throw new Error('Todo append would change existing content');
  }
  return result;
}

export function normaliseTodoText(value: string): string {
  return value
    .replace(/<!--\s*jarvis:p:[a-f\d]{16}\s*-->/giu, ' ')
    .replace(/(?:📅\s*|\bdue::?\s*)(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)?/giu, ' ')
    .replace(/^\(proactive\)\s*/iu, '')
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

function isInsideCodeFence(existing: string): boolean {
  const fences = existing.split(/\r?\n/u).filter((line) => /^\s*(?:`{3,}|~{3,})/u.test(line));
  return fences.length % 2 === 1;
}

export function isTodoFileWritable(existing: string): boolean {
  return !isInsideCodeFence(existing);
}

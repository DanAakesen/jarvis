import type { createGitHubVaultClient } from '../vault/github-client.js';
import { MAX_VAULT_FILE_BYTES } from '../vault/github-client.js';
import { localDateTimeInstant } from './time.js';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;

export interface ParsedTodo {
  text: string;
  dueAt: string | null;
  dueHasTime: boolean;
  done: boolean;
  highPriority: boolean;
}

export interface ParsedVaultTodo extends ParsedTodo {
  priorityLevel: 'high' | 'medium' | 'normal';
  dueDate: string | null;
  dueTime: string | null;
  path: string;
  line: number;
  heading: string | null;
}

const dueMarkerPattern = /(?:📅\s*|\[due::\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})(?:(?:\s+|T)(\d{2}:\d{2}))?\]?/iu;
const dueMarkersPattern = /(?:📅\s*|\[due::\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})(?:(?:\s+|T)(\d{2}:\d{2}))?\]?/giu;
const highPriorityPattern = /(?:🔺|⏫|\[\s*priority\s*::\s*(?:highest|high)\s*\]|\(\s*priority\s*::\s*(?:highest|high)\s*\)|\bpriority\s*::?\s*P1\s*[-–—]\s*High\b)/iu;
const mediumPriorityPattern = /(?:🔼|\bpriority\s*::?\s*(?:medium\b|P2\b))/iu;
const priorityMarkersPattern = /\s*\[\s*priority\s*::?\s*[^\]]*\]|\s*\(\s*priority\s*::?\s*[^)]*\)|\s+\bpriority\s*::?.*$/giu;
const timeMarkerPattern = /🕒\s*(\d{2}:\d{2})/u;
export const taskMetadata = /[📅⏳🛫➕✅❌🔁🏁⏫🔼🔽⏬🔺🆔⛔🕒]/gu;

export function sanitizeFactText(value: string): string {
  const withoutControls = value.replace(/\p{Cc}/gu, '');
  const withoutHtml = withoutControls.replace(/<[^>]*(?:>|$)/gu, '');
  const withoutLinks = withoutHtml.replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/gu, '$1');
  const withoutAngles = withoutLinks.replace(/</gu, '');
  return Array.from(withoutAngles.replace(/\s+/gu, ' ').trim()).slice(0, 300).join('');
}

export async function resolveTodoFile(
  vault: Pick<VaultReader, 'tree'>,
  signal: AbortSignal,
): Promise<{ path: string } | { reason: 'todo_file_missing' | 'todo_file_ambiguous' }> {
  const files = await vault.tree(signal);
  const matches = files.filter(({ path }) => !path.includes('/') && /^(?:task|tasks)\.md$/iu.test(path));
  if (matches.length === 0) return { reason: 'todo_file_missing' };
  if (matches.length > 1) return { reason: 'todo_file_ambiguous' };
  return { path: matches[0]!.path };
}

function dueDate(date: string, time: string | undefined): string | null {
  try {
    return (time
      ? localDateTimeInstant(date, time)
      : localDateTimeInstant(date, '23:59')).toISOString();
  } catch {
    return null;
  }
}

export function parseTodosWithContext(content: string, path: string): ParsedVaultTodo[] {
  const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const todos: ParsedVaultTodo[] = [];
  let fence: string | undefined;
  let heading: string | null = null;
  for (const [index, line] of lines.entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const headingMatch = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (headingMatch) {
      heading = sanitizeFactText(headingMatch[1] ?? '') || null;
      continue;
    }
    const task = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/u.exec(line);
    if (!task) continue;
    const rawText = task[2] ?? '';
    const dueMarker = dueMarkerPattern.exec(rawText);
    const time = timeMarkerPattern.exec(rawText)?.[1] ?? dueMarker?.[2];
    const dueAt = dueMarker
      ? dueDate(dueMarker[1]!, time)
      : null;
    const text = sanitizeFactText(rawText
      .replace(dueMarkersPattern, ' ')
      .replace(/🕒\s*\d{2}:\d{2}/gu, ' ')
      .replace(/[⏳🛫➕✅❌]\s*\d{4}-\d{2}-\d{2}/gu, ' ')
      .replace(/🔁\s*[^📅⏳🛫➕✅❌🔁🏁⏫🔼🔽⏬🔺🆔⛔🕒[]*/gu, ' ')
      .replace(/[🆔⛔]\s*[a-z\d]+(?:\s*,\s*[a-z\d]+)*/giu, ' ')
      .replace(/🏁\s*(?:delete|keep)\b/giu, ' ')
      .replace(priorityMarkersPattern, ' ')
      .replace(taskMetadata, ' '));
    const highPriority = highPriorityPattern.test(rawText);
    todos.push({
      text,
      dueAt,
      dueHasTime: time !== undefined && dueAt !== null,
      done: task[1]!.toLowerCase() === 'x',
      highPriority,
      priorityLevel: highPriority ? 'high' : mediumPriorityPattern.test(rawText) ? 'medium' : 'normal',
      dueDate: dueAt === null ? null : dueMarker?.[1] ?? null,
      dueTime: dueAt !== null && time !== undefined ? time : null,
      path,
      line: index + 1,
      heading,
    });
  }
  return todos;
}

export function parseTodos(content: string): ParsedTodo[] {
  return parseTodosWithContext(content, '').map(({ text, dueAt, dueHasTime, done, highPriority }) =>
    ({ text, dueAt, dueHasTime, done, highPriority }));
}

export { MAX_VAULT_FILE_BYTES };

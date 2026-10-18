import type { createGitHubVaultClient } from '../vault/github-client.js';
import { MAX_VAULT_FILE_BYTES } from '../vault/github-client.js';
import { localDateTimeInstant } from './time.js';

type VaultReader = Pick<ReturnType<typeof createGitHubVaultClient>, 'tree' | 'read'>;

export interface ParsedTodo {
  text: string;
  dueAt: string | null;
  dueHasTime: boolean;
  done: boolean;
}

const dueMarkerPattern = /(?:📅\s*|\[due::\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})(?:(?:\s+|T)(\d{2}:\d{2}))?\]?/iu;
const dueMarkersPattern = /(?:📅\s*|\[due::\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})(?:(?:\s+|T)(\d{2}:\d{2}))?\]?/giu;

export function sanitizeFactText(value: string): string {
  const withoutControls = value.replace(/\p{Cc}/gu, '');
  const withoutHtml = withoutControls.replace(/<[^>]*(?:>|$)/gu, '');
  const withoutLinks = withoutHtml.replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/gu, '$1');
  return Array.from(withoutLinks.replace(/\s+/gu, ' ').trim()).slice(0, 300).join('');
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

export function parseTodos(content: string): ParsedTodo[] {
  const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const todos: ParsedTodo[] = [];
  for (const line of lines) {
    const task = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/u.exec(line);
    if (!task) continue;
    const rawText = task[2] ?? '';
    const dueMarker = dueMarkerPattern.exec(rawText);
    const dueAt = dueMarker
      ? dueDate(dueMarker[1]!, dueMarker[2])
      : null;
    const text = sanitizeFactText(rawText.replace(dueMarkersPattern, ' '));
    todos.push({
      text,
      dueAt,
      dueHasTime: dueMarker?.[2] !== undefined && dueAt !== null,
      done: task[1]!.toLowerCase() === 'x',
    });
  }
  return todos;
}

export { MAX_VAULT_FILE_BYTES };

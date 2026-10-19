import { diffArrays } from 'diff';

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly replacement: readonly string[];
}

function lines(text: string): string[] {
  if (text === '') return [];
  const result = text.match(/[^\n]*\n|[^\n]+$/gu);
  return result ?? [];
}

function edits(base: readonly string[], changed: readonly string[]): Edit[] {
  const result: Edit[] = [];
  let index = 0;
  let start: number | undefined;
  let end = 0;
  let replacement: string[] = [];
  const flush = (): void => {
    if (start !== undefined) result.push({ start, end, replacement });
    start = undefined;
    end = index;
    replacement = [];
  };
  for (const part of diffArrays([...base], [...changed])) {
    if (part.added) {
      start ??= index;
      replacement.push(...(part.value ?? []));
    } else if (part.removed) {
      start ??= index;
      index += part.count ?? part.value?.length ?? 0;
      end = index;
    } else {
      flush();
      index += part.count ?? part.value?.length ?? 0;
    }
  }
  flush();
  return result;
}

export function mergeThreeWay(baseText: string, oursText: string, theirsText: string):
  { clean: true; text: string } | { clean: false } {
  const base = lines(baseText);
  const ours = edits(base, lines(oursText));
  const theirs = edits(base, lines(theirsText));
  const combined: Edit[] = [...ours];
  for (const right of theirs) {
    const overlaps = combined.filter(left =>
      left.start === right.start && left.end === right.end ||
      left.start < right.end && right.start < left.end ||
      left.start === left.end && right.start === right.end && left.start === right.start ||
      left.start === right.start && left.start === left.end ||
      right.start === left.start && right.start === right.end);
    if (overlaps.length === 0) {
      combined.push(right);
      continue;
    }
    if (overlaps.length === 1) {
      const existing = overlaps[0]!;
      if (existing.start === right.start && existing.end === right.end &&
        existing.replacement.join('') === right.replacement.join('')) continue;
    }
    return { clean: false };
  }
  combined.sort((left, right) => left.start - right.start || left.end - right.end);
  const output: string[] = [];
  let cursor = 0;
  for (const edit of combined) {
    if (edit.start < cursor || edit.end > base.length) return { clean: false };
    output.push(...base.slice(cursor, edit.start), ...edit.replacement);
    cursor = edit.end;
  }
  output.push(...base.slice(cursor));
  return { clean: true, text: output.join('') };
}

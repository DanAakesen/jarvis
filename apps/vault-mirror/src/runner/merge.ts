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
  const open = (): void => {
    if (start !== undefined) return;
    start = index;
    end = index;
  };
  const flush = (): void => {
    if (start !== undefined) result.push({ start, end, replacement });
    start = undefined;
    replacement = [];
  };
  for (const part of diffArrays([...base], [...changed])) {
    const count = part.count ?? part.value?.length ?? 0;
    if (part.added) {
      open();
      replacement.push(...(part.value ?? []));
    } else if (part.removed) {
      open();
      index += count;
      end = index;
    } else {
      flush();
      index += count;
    }
  }
  flush();
  return result;
}

function apply(base: readonly string[], list: readonly Edit[]): string[] | undefined {
  const output: string[] = [];
  let cursor = 0;
  for (const edit of list) {
    if (edit.end < edit.start || edit.start < cursor || edit.end > base.length) return undefined;
    output.push(...base.slice(cursor, edit.start), ...edit.replacement);
    cursor = edit.end;
  }
  output.push(...base.slice(cursor));
  return output;
}

function rebuilds(base: readonly string[], list: readonly Edit[], changed: readonly string[]): boolean {
  const output = apply(base, list);
  return output !== undefined && output.length === changed.length &&
    output.every((line, position) => line === changed[position]);
}

function scripts(base: readonly string[], changed: readonly string[]): Edit[] | undefined {
  const list = edits(base, changed);
  return rebuilds(base, list, changed) ? list : undefined;
}

function combine(base: readonly string[], first: readonly Edit[], second: readonly Edit[]): string | undefined {
  const combined: Edit[] = [...first];
  for (const right of second) {
    // Touching edits overlap: applied together they diff as one hunk, which a retry would apply again.
    const overlaps = combined.filter(left => left.start <= right.end && right.start <= left.end);
    if (overlaps.length === 0) {
      combined.push(right);
      continue;
    }
    if (overlaps.length === 1) {
      const existing = overlaps[0]!;
      if (existing.start === right.start && existing.end === right.end &&
        existing.replacement.join('') === right.replacement.join('')) continue;
    }
    return undefined;
  }
  combined.sort((left, right) => left.start - right.start || left.end - right.end);
  return apply(base, combined)?.join('');
}

export function mergeThreeWay(baseText: string, oursText: string, theirsText: string):
  { clean: true; text: string } | { clean: false } {
  const base = lines(baseText);
  // An edit script that cannot rebuild its own side would repeat or drop lines, so refuse to merge it.
  const ours = scripts(base, lines(oursText));
  const theirs = scripts(base, lines(theirsText));
  if (ours === undefined || theirs === undefined) return { clean: false };
  const text = combine(base, ours, theirs);
  if (text === undefined) return { clean: false };
  // Repeated lines can be aligned differently when the merged text is diffed again, so a retry against it could
  // apply an edit a second time. Trust the merge only when retrying either side against its result reproduces it.
  const merged = scripts(base, lines(text));
  if (merged === undefined || combine(base, ours, merged) !== text || combine(base, merged, theirs) !== text) {
    return { clean: false };
  }
  return { clean: true, text };
}

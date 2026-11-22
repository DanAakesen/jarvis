import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A ToolFailure whose text says the work may have happened, or that only part of it did, must carry `outcomeUnknown`. Without it
 * the confirmation Dan reads starts with "Not done.", which contradicts the sentence after it, and the PI door runs the call again
 * when the model repeats it. This reads the source and covers every ToolFailure whose text is written out in the call; one built
 * from a variable or another function is not seen here and is listed by hand in docs/decisions.md.
 */
const root = new URL('..', import.meta.url);

/** What a text says when the outcome is not known or only part of the work was done. */
const saysTheWorkMayHaveHappened = [
  /\bmay (?:already )?have\b/iu, // "may have committed", "may already have been applied"
  /\bmay not have\b/iu, // "the action may not have happened"
  /\bmay or may not\b/iu,
  /\bcould(?: not|n’t) (?:be )?confirm/iu, // "could not be confirmed", "couldn’t confirm"
  /\bnot confirmed as\b/iu, // "was not confirmed as saved"
  /\b(?:saved|created|stored|applied|queued|completed), but\b/iu, // "was saved, but …", "The task completed, but …"
  /\boutcome (?:is|was) unknown\b/iu,
];
const saysNothingWasDone = /\b(?:nothing|no \w+) (?:was|were) (?:done|written|saved|created|started|changed|sent)\b/iu;
const marked = /outcomeUnknown|mayHaveHappened/u;

function endOfString(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === source[start]) return index;
  }
  return source.length;
}

function endOfBraces(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\'' || char === '"') index = endOfString(source, index);
    else if (char === '`') index = endOfTemplate(source, index);
    else if (char === '{') depth += 1;
    else if (char === '}' && (depth -= 1) === 0) return index;
  }
  return source.length;
}

function endOfTemplate(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === '`') return index;
    else if (source[index] === '$' && source[index + 1] === '{') index = endOfBraces(source, index + 1);
  }
  return source.length;
}

/** The index of the parenthesis that closes the one at `open`. */
function endOfCall(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\'' || char === '"') index = endOfString(source, index);
    else if (char === '`') index = endOfTemplate(source, index);
    else if (char === '(') depth += 1;
    else if (char === ')' && (depth -= 1) === 0) return index;
  }
  return source.length;
}

function toolFailureCalls(): { where: string; call: string }[] {
  const calls: { where: string; call: string }[] = [];
  for (const file of readdirSync(root, { recursive: true }) as string[]) {
    if (!file.endsWith('.ts') || /\.test\.ts$|testkit|\.d\.ts$/u.test(file)) continue;
    const source = readFileSync(new URL(file, root), 'utf8');
    for (let at = source.indexOf('new ToolFailure('); at >= 0; at = source.indexOf('new ToolFailure(', at + 1)) {
      const call = source.slice(at, endOfCall(source, at + 'new ToolFailure'.length) + 1).replace(/\s+/gu, ' ');
      calls.push({ where: `${file}:${source.slice(0, at).split('\n').length}`, call });
    }
  }
  return calls;
}

describe('a ToolFailure that says the work may have happened', () => {
  const calls = toolFailureCalls();
  const show = (list: { where: string; call: string }[]) => list.map(({ where, call }) => `${where} ${call.slice(0, 140)}`);

  it('sees the ToolFailures of the backend, so the checks below are not empty', () => {
    expect(calls.length).toBeGreaterThan(200);
    expect(calls.filter(({ call }) => marked.test(call)).length).toBeGreaterThan(20);
  });

  it('carries outcomeUnknown, so Dan reads it as written and a replay does not run the call again', () => {
    expect(show(calls.filter(({ call }) => saysTheWorkMayHaveHappened.some((pattern) => pattern.test(call)) && !marked.test(call))),
      'add { outcomeUnknown: true } to these ToolFailures, or say plainly that nothing was done').toEqual([]);
  });

  it('is not marked when it says that nothing was done, because that is the tool’s own claim and "Not done." is true', () => {
    expect(show(calls.filter(({ call }) => marked.test(call) && saysNothingWasDone.test(call)))).toEqual([]);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDirectory = 'src';
const stylesheets = readdirSync(sourceDirectory, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css'));

function braceBalance(css: string): { depth: number; firstUnderflow: number | null } {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  let depth = 0;
  let firstUnderflow: number | null = null;
  let quote: string | null = null;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index]!;
    if (quote) {
      if (character === quote && withoutComments[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth < 0 && firstUnderflow === null) firstUnderflow = index;
    }
  }
  return { depth, firstUnderflow };
}

describe('stylesheets', () => {
  it('finds the source stylesheets', () => {
    expect(stylesheets.length).toBeGreaterThan(0);
  });

  // Vite concatenates every imported stylesheet into one bundle, so one unclosed block
  // swallows every later file into it (6 October: the whole shell lost its styles on desktop).
  it.each(stylesheets)('%s closes every block it opens', (file) => {
    expect(braceBalance(readFileSync(join(sourceDirectory, file), 'utf8'))).toEqual({ depth: 0, firstUnderflow: null });
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Specificity = [number, number, number];

// `.app-shell svg` sizes every shell icon at 21px and is emitted after the Daily stylesheets in the production
// bundle. A Daily svg rule that does not out-rank it loses the tie and the chart collapses to a 21px sliver.
const shellSvg: Specificity = [0, 1, 1];
const svgRootClasses = ['daily-sparkline', 'daily-workout-glyph'];

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

function rules(source: string): Array<{ selector: string; body: string }> {
  const plain = source.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...plain.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/gu)]
    .map(match => ({ selector: match[1]!, body: match[2]! }));
}

function specificity(selector: string): Specificity {
  const ids = (selector.match(/#[\w-]+/gu) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/gu) ?? []).length;
  const types = (selector.replace(/\[[^\]]*\]/gu, '').match(/(?:^|[\s>+~(])[a-z][\w-]*/gu) ?? []).length
    + (selector.match(/::[\w-]+/gu) ?? []).length;
  return [ids, classes, types];
}

function outranks(candidate: Specificity, other: Specificity): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] !== other[index]) return candidate[index]! > other[index]!;
  }
  return false;
}

function targetsSvg(selector: string): boolean {
  const target = selector.split(/[\s>+~]+/u).pop() ?? '';
  return /^svg(?![\w-])/u.test(target) || svgRootClasses.some(name => new RegExp(`\\.${name}(?![\\w-])`, 'u').test(target));
}

describe('Daily svg sizing', () => {
  it('guards the shell rule it is written against', () => {
    expect(readFileSync('src/styles.css', 'utf8')).toMatch(/^\.app-shell svg\s*\{[^}]*width:\s*21px/mu);
  });

  it('ranks selectors the way the cascade does', () => {
    expect(specificity('.app-shell svg')).toEqual(shellSvg);
    expect(outranks(specificity('.daily-chart svg'), shellSvg)).toBe(false);
    expect(outranks(specificity('.daily-sparkline'), shellSvg)).toBe(false);
    expect(outranks(specificity('.app-shell .daily-chart svg'), shellSvg)).toBe(true);
    expect(outranks(specificity('.daily-plot .generated-chart svg'), shellSvg)).toBe(true);
    expect(outranks(specificity('.app-shell .workouts-detail-heading .daily-workout-glyph'), shellSvg)).toBe(true);
  });

  it('out-ranks the shell icon size in every Daily rule that sizes an svg', () => {
    const offenders: string[] = [];
    for (const path of cssFiles('src/daily')) {
      for (const { selector, body } of rules(readFileSync(path, 'utf8'))) {
        if (!/(?:^|;)\s*(?:width|height)\s*:/u.test(body)) continue;
        for (const single of selector.split(',').map(part => part.trim())) {
          if (targetsSvg(single) && !outranks(specificity(single), shellSvg)) offenders.push(`${path.replace(/\\/gu, '/')}: ${single}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = new URL('../', import.meta.url).pathname;
const forbiddenDateFormatters = /\bIntl\s*\.\s*DateTimeFormat\b|\.\s*toLocale(?:String|DateString|TimeString)\s*\(/gu;
const allowlistedDateCalculations = new Map([
  ['daily/period.ts', 'extracts Copenhagen calendar parts for period calculations'],
  ['daily/presentation.ts', 'extracts Copenhagen calendar parts for the current data period'],
  ['proactive-data.ts', 'converts Copenhagen wall-clock values for scheduling'],
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe('web date formatter guard', () => {
  it('keeps date formatting in the shared helper or the calculation-only allowlist', () => {
    const violations = sourceFiles(sourceRoot).flatMap((path) => {
      const file = relative(sourceRoot, path).replaceAll('\\', '/');
      if (file === 'format/date-time.ts' || allowlistedDateCalculations.has(file)) return [];
      const matches = [...readFileSync(path, 'utf8').matchAll(forbiddenDateFormatters)];
      return matches.map((match) => `${file}: ${match[0]}`);
    });

    expect(allowlistedDateCalculations.size).toBe(3);
    expect(violations).toEqual([]);
  });
});

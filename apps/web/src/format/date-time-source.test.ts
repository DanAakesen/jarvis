import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const forbiddenDateFormatters = /\bIntl\s*\.\s*DateTimeFormat\b|\.\s*toLocale(?:String|DateString|TimeString)\s*\(/gu;
const allowlistedDateCalculations = new Map<string, { count: number; reason: string }>([
  ['daily/period.ts', { count: 1, reason: 'extracts Copenhagen calendar parts for period calculations' }],
  ['daily/presentation.ts', { count: 1, reason: 'extracts Copenhagen calendar parts for the current data period' }],
  ['proactive-data.ts', { count: 2, reason: 'converts Copenhagen wall-clock values for scheduling' }],
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) && path !== join(sourceRoot, 'format/date-time-source.test.ts') ? [path] : [];
  });
}

describe('web date formatter guard', () => {
  it('keeps date formatting in the shared helper or the calculation-only allowlist', () => {
    const violations = sourceFiles(sourceRoot).flatMap((path) => {
      const file = relative(sourceRoot, path).replaceAll('\\', '/');
      const matches = [...readFileSync(path, 'utf8').matchAll(forbiddenDateFormatters)];
      if (file === 'format/date-time.ts') return [];
      const allowance = allowlistedDateCalculations.get(file);
      if (matches.length === (allowance?.count ?? 0)) return [];
      return [`${file}: found ${matches.length} date formatters; ${allowance?.reason ?? 'use the shared helper'}`];
    });

    expect(allowlistedDateCalculations.size).toBeLessThanOrEqual(3);
    expect(violations).toEqual([]);
  });
});

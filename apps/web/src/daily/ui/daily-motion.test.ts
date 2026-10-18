import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Daily reduced motion', () => {
  it('disables each Daily animation and transition without hiding its state', () => {
    const daily = readFileSync('src/daily/daily.css', 'utf8');
    const overview = readFileSync('src/daily/daily-overview.css', 'utf8');
    const shared = readFileSync('src/daily/ui/daily-ui.css', 'utf8');

    expect(daily).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.daily-records\s*\{\s*transition:\s*none;/u);
    expect(overview).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.daily-status\s*\{\s*animation:\s*none;/u);
    expect(shared).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.daily-meter-track span\s*\{\s*transition:\s*none;/u);
    expect(overview).toContain('.daily-status[data-tone=');
    expect(shared).toContain('.daily-meter-values');
  });
});

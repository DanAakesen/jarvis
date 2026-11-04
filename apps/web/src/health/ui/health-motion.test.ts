import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Health reduced motion', () => {
  it('disables each Health animation and transition without hiding its state', () => {
    const daily = readFileSync('src/health/health.css', 'utf8');
    const overview = readFileSync('src/health/health-overview.css', 'utf8');
    const shared = readFileSync('src/health/ui/health-ui.css', 'utf8');

    expect(daily).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.health-records\s*\{\s*transition:\s*none;/u);
    expect(overview).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.health-top-track\s*\{\s*scroll-behavior:\s*auto;/u);
    expect(shared).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.health-meter-track span\s*\{\s*transition:\s*none;/u);
    expect(overview).toContain('.health-top-card h3 svg { transition: none; }');
    expect(shared).toContain('.health-meter-values');
  });
});

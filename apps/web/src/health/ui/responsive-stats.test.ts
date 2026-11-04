import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('Health phone stat layouts', () => {
  it('wraps existing stat groups and lets an odd final tile fill its row without changing controls', () => {
    const css = readFileSync('src/health/ui/health-ui.css', 'utf8');
    const phoneStyles = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)(?=\n@media|$)/u)?.[1] ?? '';
    for (const group of ['workouts-stats', 'workouts-detail-stats', 'nutrition-stats', 'body-sleep-stats', 'health-grid']) {
      expect(phoneStyles).toContain(`.${group}`);
    }
    expect(phoneStyles).toMatch(/\.app-shell[^{}]+:has\(>\s*\.health-stat-tile\)\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/u);
    expect(phoneStyles).toMatch(/>\s*\.health-stat-tile\s*\{[^}]*flex:\s*1\s+1\s+calc\(50%\s*-\s*var\(--space-3\)\);[^}]*height:\s*auto;/u);
    expect(phoneStyles).not.toMatch(/(?:^|[, :])(?:button|select|input|summary)(?=[\s,{.#])/u);
    expect(phoneStyles).toContain('.health-grid:not(.health-summary-grid)');
  });

  it('keeps the overview cards on a swipeable phone row and a two- then three-column grid', () => {
    const css = readFileSync('src/health/health-overview.css', 'utf8');
    expect(css).toMatch(/\.health-top-track\s*\{[^}]*grid-auto-columns:\s*100%;[^}]*overflow-x:\s*auto;[^}]*scroll-snap-type:\s*x mandatory;/u);
    expect(css).toMatch(/@media \(min-width: 700px\)\s*\{\s*\.health-top-track\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u);
    expect(css).toMatch(/@media \(min-width: 1200px\)\s*\{\s*\.health-top-track\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/u);
  });

  it('contains Nutrition view tabs in their narrow panel and exposes horizontal scrolling', () => {
    const css = readFileSync('src/health/sections/nutrition/nutrition.css', 'utf8');
    expect(css).toMatch(/\.health-nutrition > \.health-section-tabs\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/u);
  });

  it('keeps the Health section row out of the page: sections are listed in the shell navigation panel', () => {
    const css = readFileSync('src/health/health.css', 'utf8');
    expect(css).not.toContain('.health-section-nav');
    expect(css).not.toContain('.health-section-panel:focus-visible');
  });

  it('wraps complete Data record labels and values in phone summaries', () => {
    const css = readFileSync('src/health/sections/data/data.css', 'utf8');
    expect(css).toMatch(/\.health-record-summary\s*\{[^}]*display:\s*grid;/u);
    expect(css).toMatch(/\.health-record-summary\s*>\s*span\s*\{[^}]*overflow-wrap:\s*anywhere;/u);
    expect(css).not.toMatch(/\.health-record-summary\s*>\s*span\s*\{[^}]*(?:text-overflow:\s*ellipsis|white-space:\s*nowrap|overflow:\s*hidden)/u);
  });

  it('keeps Briefs history rows content-sized with a boundary and explicit interaction states', () => {
    const css = readFileSync('src/health/sections/briefs/briefs.css', 'utf8');
    expect(css).not.toMatch(/\.health-brief-list\s*\{[^}]*grid-auto-rows/u);
    expect(css).toMatch(/\.health-briefs \.health-brief-row\s*\{[^}]*border:\s*1px solid var\(--rule\);[^}]*background:\s*var\(--surface-translucent\);/u);
    for (const state of ['hover', 'active', 'focus-visible']) {
      expect(css).toContain(`.health-briefs .health-brief-row:${state}`);
    }
  });

  it('wraps long shared stat notes within their tiles', () => {
    const css = readFileSync('src/health/ui/health-ui.css', 'utf8');
    expect(css).toMatch(/\.health-stat-note,\s*\.health-stat-comparison\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/u);
  });

  it('stacks the Body picker controls on phones so the search placeholder and select text are not clipped', () => {
    const css = readFileSync('src/health/sections/body-sleep/body-sleep.css', 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)\s*\{\s*\.body-sleep-picker\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}\s*\}/u);
  });

  it('keeps section-authored Health tables inside the shared scroll wrapper', () => {
    const sources = [
      ...filesUnder('src/health/sections').filter(file => file.endsWith('.tsx') && !file.includes('.test.')),
      'src/health/ui/HealthChart.tsx',
    ];
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      const tables = source.match(/<table\b/gu)?.length ?? 0;
      const wrappers = source.match(/<ScrollTable\b/gu)?.length ?? 0;
      expect(wrappers, file).toBe(tables);
    }
  });

  it('does not set a fixed Health stylesheet width above 320px without min() or max()', () => {
    const stylesheets = filesUnder('src/health').filter(file => file.endsWith('.css'));
    for (const file of stylesheets) {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
      for (const [, value] of source.matchAll(/(?:^|[;{])\s*width\s*:\s*([^;{}]+)\s*(?=[;}])/gu)) {
        const declaration = value?.trim() ?? '';
        const pixels = [...declaration.matchAll(/(\d+(?:\.\d+)?)px/gu)].map(([, number]) => Number(number));
        if (pixels.some(number => number > 320)) {
          expect(declaration, file).toMatch(/\b(?:min|max)\s*\(/iu);
        }
      }
    }
  });
});

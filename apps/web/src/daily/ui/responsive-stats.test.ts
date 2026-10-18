import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('Daily phone stat layouts', () => {
  it('wraps existing stat groups and lets an odd final tile fill its row without changing controls', () => {
    const css = readFileSync('src/daily/ui/daily-ui.css', 'utf8');
    const phoneStyles = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)(?=\n@media|$)/u)?.[1] ?? '';
    for (const group of ['workouts-stats', 'workouts-detail-stats', 'nutrition-stats', 'body-sleep-stats', 'daily-grid']) {
      expect(phoneStyles).toContain(`.${group}`);
    }
    expect(phoneStyles).toMatch(/\.app-shell[^{}]+:has\(>\s*\.daily-stat-tile\)\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/u);
    expect(phoneStyles).toMatch(/>\s*\.daily-stat-tile\s*\{[^}]*flex:\s*1\s+1\s+calc\(50%\s*-\s*var\(--space-3\)\);[^}]*height:\s*auto;/u);
    expect(phoneStyles).not.toMatch(/(?:^|[, :])(?:button|select|input|summary)(?=[\s,{.#])/u);
    expect(phoneStyles).toContain('.daily-grid:not(.daily-summary-grid)');
  });

  it('keeps the five summary tiles on a one-column phone grid and fills the wide final row', () => {
    const css = readFileSync('src/daily/daily-overview.css', 'utf8');
    expect(css).toMatch(/\.daily-summary \.daily-summary-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
    expect(css).toMatch(/\.daily-summary-tile:nth-child\(5\):last-child\s*\{\s*grid-column:\s*span 2;/u);
  });

  it('contains Nutrition view tabs in their narrow panel and exposes horizontal scrolling', () => {
    const css = readFileSync('src/daily/sections/nutrition/nutrition.css', 'utf8');
    expect(css).toMatch(/\.daily-nutrition > \.daily-section-tabs\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/u);
  });

  it('cues overflow in the Daily section tabs with an edge mask, without showing a native scrollbar', () => {
    const css = readFileSync('src/daily/daily.css', 'utf8');
    expect(css).toMatch(/\.daily-section-nav\[data-overflow-end='true'\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right/u);
    expect(css).toMatch(/\.daily-section-nav\[data-overflow-start='true'\]\s*\{[^}]*mask-image:\s*linear-gradient\(to left/u);
    expect(css).toMatch(/\.daily-section-nav\[data-overflow-start='true'\]\[data-overflow-end='true'\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right, transparent/u);
    expect(css).not.toMatch(/\.daily-section-nav[^{]*::after/u);
    expect(css).toMatch(/\.daily-section-nav\s*\{[^}]*scrollbar-width:\s*none;/u);
    expect(css).toMatch(/\.daily-section-nav::-webkit-scrollbar\s*\{\s*display:\s*none;/u);
  });

  it('wraps complete Data record labels and values in phone summaries', () => {
    const css = readFileSync('src/daily/sections/data/data.css', 'utf8');
    expect(css).toMatch(/\.daily-record-summary\s*\{[^}]*display:\s*grid;/u);
    expect(css).toMatch(/\.daily-record-summary\s*>\s*span\s*\{[^}]*overflow-wrap:\s*anywhere;/u);
    expect(css).not.toMatch(/\.daily-record-summary\s*>\s*span\s*\{[^}]*(?:text-overflow:\s*ellipsis|white-space:\s*nowrap|overflow:\s*hidden)/u);
  });

  it('keeps Briefs history rows content-sized with a boundary and explicit interaction states', () => {
    const css = readFileSync('src/daily/sections/briefs/briefs.css', 'utf8');
    expect(css).not.toMatch(/\.daily-brief-list\s*\{[^}]*grid-auto-rows/u);
    expect(css).toMatch(/\.daily-briefs \.daily-brief-row\s*\{[^}]*border:\s*1px solid var\(--rule\);[^}]*background:\s*var\(--surface-translucent\);/u);
    for (const state of ['hover', 'active', 'focus-visible']) {
      expect(css).toContain(`.daily-briefs .daily-brief-row:${state}`);
    }
  });

  it('wraps long shared stat notes within their tiles', () => {
    const css = readFileSync('src/daily/ui/daily-ui.css', 'utf8');
    expect(css).toMatch(/\.daily-stat-note,\s*\.daily-stat-comparison\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/u);
  });

  it('stacks the Body picker controls on phones so the search placeholder and select text are not clipped', () => {
    const css = readFileSync('src/daily/sections/body-sleep/body-sleep.css', 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)\s*\{\s*\.body-sleep-picker\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}\s*\}/u);
  });

  it('keeps section-authored Daily tables inside the shared scroll wrapper', () => {
    const sources = [
      ...filesUnder('src/daily/sections').filter(file => file.endsWith('.tsx') && !file.includes('.test.')),
      'src/daily/ui/DailyChart.tsx',
    ];
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      const tables = source.match(/<table\b/gu)?.length ?? 0;
      const wrappers = source.match(/<ScrollTable\b/gu)?.length ?? 0;
      expect(wrappers, file).toBe(tables);
    }
  });

  it('does not set a fixed Daily stylesheet width above 320px without min() or max()', () => {
    const stylesheets = filesUnder('src/daily').filter(file => file.endsWith('.css'));
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

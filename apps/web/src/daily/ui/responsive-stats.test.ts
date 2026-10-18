import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Daily phone stat layouts', () => {
  it('wraps existing stat groups and lets an odd final tile fill its row without changing controls', () => {
    const css = readFileSync('src/daily/ui/daily-ui.css', 'utf8');
    const phoneStyles = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)(?=\n@media|$)/u)?.[1] ?? '';
    for (const group of ['workouts-stats', 'workouts-detail-stats', 'nutrition-stats', 'body-sleep-stats', 'daily-grid']) {
      expect(phoneStyles).toContain(`.${group}`);
    }
    expect(phoneStyles).toMatch(/\.app-shell[^{}]+:has\(>\s*\.daily-stat-tile\)\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/u);
    expect(phoneStyles).toMatch(/>\s*\.daily-stat-tile\s*\{[^}]*flex:\s*1\s+1\s+calc\(50%\s*-\s*var\(--space-3\)\);[^}]*height:\s*auto;/u);
    expect(phoneStyles).not.toMatch(/\b(?:button|select|input|summary)\b/u);
  });
});

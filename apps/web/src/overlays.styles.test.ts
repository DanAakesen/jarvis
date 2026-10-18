import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles.css', 'utf8');
const sheets = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.css'));

function stackingViolations(source: string) {
  const violations: string[] = [];
  postcss.parse(source).walkDecls('z-index', (declaration) => {
    const value = declaration.value;
    // Local decoration/control ordering is deliberately limited to -1 and 0–5.
    // Workspace depth is dynamic, but confined by .workspace-canvas isolation.
    if (!/^(?:-1|[0-5]|auto|var\(--z-[\w-]+\)|var\(--workspace-depth\)|calc\(var\(--z-panel\) \+ var\(--workspace-depth, 1\)\))$/u.test(value)) {
      violations.push(value);
    }
  });
  return violations;
}

function declarations(source: string, selector: string) {
  const result = new Map<string, string>();
  postcss.parse(source).walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((declaration) => { result.set(declaration.prop, declaration.value); });
  });
  return result;
}

const surfaces = ':is(.modal, .jobs-popover, .more-menu-list, .more-menu-flyout, .presence-menu, .mobile-menu-sheet, .context-panel[aria-modal="true"])';
function surfaceViolations(source: string) {
  const rules = declarations(source, surfaces);
  return [
    ['border', '1px solid var(--rule)'],
    ['border-radius', 'var(--radius-panel)'],
    ['background', 'var(--surface)'],
    ['box-shadow', 'var(--panel-shadow)'],
  ].filter(([property, value]) => rules.get(property!) !== value);
}

function feedbackViolations(source: string) {
  const feedback = declarations(source, '.workspace-pin-feedback');
  const host = declarations(source, '.workspace-feedback-host');
  return feedback.get('position') !== 'static' || host.get('position') !== 'relative';
}

describe('shared overlay contract', () => {
  it('uses named stacking tokens in every web stylesheet', () => {
    for (const file of sheets) {
      expect(stackingViolations(readFileSync(join('src', file), 'utf8')), file).toEqual([]);
    }
    expect(declarations(styles, '.workspace-canvas').get('isolation')).toBe('isolate');
    const tokens = declarations(styles, ':root');
    const order = ['base', 'panel', 'chrome', 'window', 'tabs', 'dock', 'caption', 'voice-window', 'voice-controls', 'menu', 'sheet', 'modal-backdrop', 'modal', 'toast', 'skip-link'];
    const values = order.map((name) => Number(tokens.get(`--z-${name}`)));
    expect(values.every((value, index) => Number.isFinite(value) && (index === 0 || value > values[index - 1]!))).toBe(true);
  });

  it('shares overlay surface tokens and confines dialog body scrolling', () => {
    expect(surfaceViolations(styles)).toEqual([]);
    expect(declarations(styles, '.modal-body').get('overflow')).toBe('auto');
    expect(declarations(styles, '.modal').get('max-height')).toBe('100%');
    expect(declarations(styles, '.modal-heading h2').get('font-size')).toBe('var(--type-subheading)');
  });

  it('keeps feedback in document flow rather than over page content', () => {
    expect(feedbackViolations(styles)).toBe(false);
  });

  it('shares the backdrop and disables sheet transitions for either reduced-motion preference', () => {
    for (const selector of ['.modal-backdrop', '.mobile-menu-backdrop', '.context-panel-modal-backdrop']) {
      expect(declarations(styles, selector).get('background')).toBe('var(--overlay)');
      expect(declarations(styles, selector).get('backdrop-filter')).toBe('blur(6px)');
    }
    expect(styles).toContain('display var(--motion-state) allow-discrete');
    expect(styles).toContain('.mobile-menu[hidden], .context-panel-modal-backdrop[hidden] { opacity: 0; pointer-events: none; }');
    for (const preference of ['@media (prefers-reduced-motion: reduce)', ':root[data-motion="reduced"]']) {
      expect(styles.slice(styles.lastIndexOf(preference))).toContain('.context-panel-modal-backdrop');
      expect(styles.slice(styles.lastIndexOf(preference))).toContain('animation: none; transition: none;');
    }
  });

  it('rejects removed or regressed stacking, surface and feedback rules', () => {
    expect(stackingViolations('.popover { z-index: 1200; }')).toEqual(['1200']);
    expect(stackingViolations('.popover { z-index: calc(10 + var(--workspace-depth)); }')).not.toEqual([]);
    expect(surfaceViolations('')).toHaveLength(4);
    expect(surfaceViolations(`${surfaces} { border: 1px solid var(--rule); border-radius: var(--radius-panel); background: transparent; box-shadow: var(--panel-shadow); }`)).not.toEqual([]);
    expect(feedbackViolations('')).toBe(true);
    expect(feedbackViolations(styles.replace('.workspace-pin-feedback { position: static;', '.workspace-pin-feedback { position: absolute;'))).toBe(true);
  });
});

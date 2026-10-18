import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const sourceDirectory = 'src';
const stylesheets = readdirSync(sourceDirectory, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css'));

type AllowlistEntry = {
  file: string;
  selector: string;
  property: string;
  reason: string;
  value?: string;
};

const sideBorderAllowlist: AllowlistEntry[] = [
  { file: 'styles.css', selector: '.area-rail', property: 'border-right', value: '1px solid var(--rule)', reason: 'Structural separator between the navigation rail and page.' },
  { file: 'styles.css', selector: '.area-sidebar', property: 'border-right', value: '1px solid var(--rule)', reason: 'Structural separator between the sidebar and page.' },
  { file: 'styles.css', selector: '.app-topbar', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural separator below the shared header.' },
  { file: 'styles.css', selector: '.context-panel', property: 'border-left', value: '1px solid var(--rule)', reason: 'Structural boundary of the desktop context panel.' },
  { file: 'styles.css', selector: '.setup-status > div + div', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates consecutive setup status rows.' },
  { file: 'styles.css', selector: '.workspace-resize-edge-corner::after', property: 'border-right', value: '1px solid var(--rule)', reason: 'Part of the functional workspace resize grip glyph.' },
  { file: 'styles.css', selector: '.workspace-resize-edge-corner::after', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Part of the functional workspace resize grip glyph.' },
  { file: 'styles.css', selector: '.generated-view-table th, .generated-view-table td', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural row separators in a data table.' },
  { file: 'styles.css', selector: '.activity-list > li + li', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates consecutive activity rows.' },
  { file: 'styles.css', selector: '.repository-list', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates repository content from the preceding section.' },
  { file: 'styles.css', selector: '.repository-list > li + li', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates consecutive repository rows.' },
  { file: 'styles.css', selector: '.project-archive', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates the archive action from the project list.' },
  { file: 'styles.css', selector: '.release-record-list, .release-run-list, .release-deployment-list', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates release history lists from their headings.' },
  { file: 'styles.css', selector: '.release-record, .release-run-list > li, .release-deployment-list > li', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Separates release history rows.' },
  { file: 'styles.css', selector: '.task-usage-table th, .task-usage-table td', property: 'border-top', value: '1px solid var(--rule)', reason: 'Structural row separators in a task usage table.' },
  { file: 'styles.css', selector: '.usage-group', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates usage groups.' },
  { file: 'styles.css', selector: '.usage-tool-counts', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates usage tool counts from adjacent content.' },
  { file: 'styles.css', selector: '.usage-tool-counts dl > div', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates tool-count rows.' },
  { file: 'styles.css', selector: '.usage-table th, .usage-table td', property: 'border-top', value: '1px solid var(--rule)', reason: 'Structural row separators in a usage table.' },
  { file: 'styles.css', selector: '.area-sidebar', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural boundary below the sidebar on narrow layouts.' },
  { file: 'styles.css', selector: '.context-panel', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural boundary below the context panel on narrow layouts.' },
  { file: 'styles.css', selector: '.mobile-menu-actions', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates navigation from menu actions.' },
  { file: 'styles.css', selector: '.system-status-row + .system-status-row', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates consecutive system status rows.' },
  { file: 'daily/daily-overview.css', selector: '.daily-overview-row', property: 'border-top', value: '1px solid var(--rule)', reason: 'Daily overview row separator; file is owned by the parallel Daily work.' },
  { file: 'daily/daily.css', selector: '.daily-table th, .daily-table td', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Daily table row separator; file is owned by the parallel Daily work.' },
  { file: 'proactive.css', selector: '.proactive-block', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Separates Proactive page sections.' },
  { file: 'proactive.css', selector: '.proactive-item-row, .proactive-source-row, .proactive-runs-list > li', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Separates Proactive list rows.' },
];

const insetShadowAllowlist: AllowlistEntry[] = [
  { file: 'ConversationHistory.css', selector: '.conversation-history .composer-send', property: 'box-shadow', value: 'inset 0 0 0 1px color-mix(in srgb, var(--glass-rim-light) 35%, transparent)', reason: 'Composer button styling is owned by P14-03 and is explicitly out of scope.' },
  { file: 'ConversationHistory.css', selector: '.conversation-history .composer-send:not(:disabled)', property: 'box-shadow', value: 'inset 0 0 0 1px color-mix(in srgb, var(--glass-glow-warm) 80%, transparent), 0 0 14px -2px color-mix(in srgb, var(--glass-glow-warm) 70%, transparent)', reason: 'Composer button styling is owned by P14-03 and is explicitly out of scope.' },
  { file: 'ConversationHistory.css', selector: '.conversation-history .composer-send:hover:not(:disabled)', property: 'box-shadow', value: 'inset 0 0 0 1px var(--glass-glow-warm), 0 0 20px 0 color-mix(in srgb, var(--glass-glow-warm) 80%, transparent)', reason: 'Composer button styling is owned by P14-03 and is explicitly out of scope.' },
  { file: 'ConversationHistory.css', selector: '.input-orb span', property: 'box-shadow', value: '0 0 0 1.5px color-mix(in srgb, var(--stage-orb) 85%, transparent), 0 0 16px color-mix(in srgb, var(--stage-orb) 45%, transparent), inset 0 0 10px color-mix(in srgb, var(--stage-orb) 35%, transparent)', reason: 'The inset shading is part of the genuine circular voice orb, not a border.' },
  { file: 'ConversationHistory.css', selector: '.input-orb:is(:hover, :focus-visible):not(:disabled) span', property: 'box-shadow', value: '0 0 0 1.5px color-mix(in srgb, var(--glass-glow-warm) 80%, transparent), 0 0 20px color-mix(in srgb, var(--glass-glow-warm) 55%, transparent), inset 0 0 12px color-mix(in srgb, var(--glass-glow-warm) 45%, transparent)', reason: 'The inset shading is part of the genuine circular voice orb, not a border.' },
  { file: 'ConversationHistory.css', selector: '.conversation-latest', property: 'box-shadow', value: 'inset 0 1px 0 var(--glass-rim-light), inset 0 0 0 1px color-mix(in srgb, var(--glass-rim-light) 28%, transparent), 0 8px 20px -12px rgb(0 0 0 / 70%)', reason: 'This compact action button is owned by P14-03 and is explicitly out of scope.' },
  { file: 'ConversationHistory.css', selector: '.conversation-latest:hover', property: 'box-shadow', value: 'inset 0 0 0 1px color-mix(in srgb, var(--glass-rim-light) 40%, transparent), 0 0 14px color-mix(in srgb, var(--glass-edge-cool) 14%, transparent)', reason: 'This compact action button is owned by P14-03 and is explicitly out of scope.' },
];

const rawColorAllowlist: AllowlistEntry[] = [
  { file: 'ConversationHistory.css', selector: '.conversation-history .composer-send:not(:disabled)', property: 'background', value: 'radial-gradient(circle at 50% 28%, color-mix(in srgb, #fff 34%, transparent), transparent 62%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--glass-glow-warm) 75%, transparent), color-mix(in srgb, var(--glass-glow-warm) 28%, transparent) 70%)', reason: 'Composer button styling is owned by P14-03 and is explicitly out of scope.' },
  { file: 'ConversationHistory.css', selector: '.input-orb span', property: 'background', value: 'radial-gradient(circle at 34% 28%, rgb(255 255 255 / 18%), transparent 42%), radial-gradient(circle, var(--stage-background) 52%, color-mix(in srgb, var(--stage-orb) 55%, var(--stage-background)) 100%)', reason: 'The orb highlight is part of the P14-03-owned circular voice control.' },
  { file: 'ConversationHistory.css', selector: '.conversation-latest', property: 'box-shadow', value: 'inset 0 1px 0 var(--glass-rim-light), inset 0 0 0 1px color-mix(in srgb, var(--glass-rim-light) 28%, transparent), 0 8px 20px -12px rgb(0 0 0 / 70%)', reason: 'This compact action button is owned by P14-03 and is explicitly out of scope.' },
];

const literalRadiusAllowlist = [
  { value: '0', reason: 'Zero is required for square geometry or an intentionally unrounded edge.' },
  { value: '50%', reason: 'Percentage radii are reserved for true circles and circular controls.' },
];

const radiusAllowlist: AllowlistEntry[] = [
  { file: 'styles.css', selector: '.deployment-add', property: 'border-radius', value: '14px', reason: 'This button shape is owned by P14-03 and is explicitly out of scope.' },
];

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function radiusFallbacks(value: string): string {
  let fallbacks = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.slice(index, index + 4).toLowerCase() !== 'var(') {
      fallbacks += value[index];
      continue;
    }

    let depth = 1;
    let end = index + 4;
    let separator = -1;
    for (; end < value.length && depth > 0; end += 1) {
      const character = value[end]!;
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (character === ',' && depth === 1 && separator < 0) separator = end;
    }
    if (separator >= 0) fallbacks += radiusFallbacks(value.slice(separator + 1, end - 1));
    index = end - 1;
  }
  return fallbacks.trim();
}

function matchesAllowlist(
  entries: AllowlistEntry[],
  file: string,
  selector: string,
  property: string,
  value: string,
): boolean {
  const normalizedSelector = normalize(selector);
  return entries.some((entry) => entry.file === file
    && normalize(entry.selector) === normalizedSelector
    && entry.property === property
    && (entry.value === undefined || normalize(entry.value) === normalize(value)));
}

function stylesheetViolations(file: string, source: string): string[] {
  const violations: string[] = [];
  const root = postcss.parse(source, { from: file });

  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const selector = declaration.parent.type === 'rule' ? declaration.parent.selector : '';
    const value = normalize(declaration.value);
    const location = `${file}:${declaration.source?.start?.line ?? 1} ${selector} ${property}`;

    if (property === 'border-radius' && !property.startsWith('--')) {
      const fallback = radiusFallbacks(value);
      if (/999px/iu.test(value)) {
        violations.push(`${location}: 999px radius token`);
      } else if (fallback
        && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(fallback)
        && fallback.split(/[\s/]+/u).filter(Boolean)
          .some((part) => !literalRadiusAllowlist.some((entry) => entry.value === part))
        && !matchesAllowlist(radiusAllowlist, file, selector, property, value)) {
        violations.push(`${location}: literal radius has no role token or reasoned exception`);
      }
    }

    if (/^border-(top|right|bottom|left)$/u.test(property)
      && !/^(?:0|none)(?:\s|$)/iu.test(value)
      && !matchesAllowlist(sideBorderAllowlist, file, selector, property, value)) {
      violations.push(`${location}: visible side border has no classification`);
    }

    if ((property === 'box-shadow' || property.endsWith('shadow')) && /\binset\b/iu.test(value)
      && !matchesAllowlist(insetShadowAllowlist, file, selector, property, value)) {
      violations.push(`${location}: inset shadow has no reasoned exception`);
    }

    if (!property.startsWith('--') && /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/iu.test(value)
      && !matchesAllowlist(rawColorAllowlist, file, selector, property, value)) {
      violations.push(`${location}: raw color literal must use a named token`);
    }
  });

  return violations;
}

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

  it.each(stylesheets)('%s follows the shared geometry and surface rules', (file) => {
    expect(stylesheetViolations(file, readFileSync(join(sourceDirectory, file), 'utf8'))).toEqual([]);
  });

  it('rejects reintroduced stylesheet violations', () => {
    const css = `
      .new-surface {
        border-radius: 4px;
        border-radius: var(--new-radius, 4px);
        border-radius: 999px;
        border-left: 1px solid var(--rule);
        box-shadow: inset 0 0 0 1px var(--rule);
        color: #fff;
      }
    `;

    expect(stylesheetViolations('probe.css', css)).toHaveLength(6);
    expect(stylesheetViolations('styles.css', '.area-rail { border-right: 2px solid #fff; }')).toHaveLength(2);
  });

  it('gives every exception an explicit reason', () => {
    const exceptions = [...sideBorderAllowlist, ...insetShadowAllowlist, ...rawColorAllowlist, ...radiusAllowlist];
    expect(exceptions.every((entry) => entry.reason.trim().length > 0)).toBe(true);
    expect(literalRadiusAllowlist.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });
});

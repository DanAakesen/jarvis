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

const legacyStateStyles = [
  ['styles.css', '.project-empty'],
  ['styles.css', '.workspace-empty'],
  ['styles.css', '.task-column-empty'],
  ['styles.css', '.usage-empty'],
  ['daily/daily.css', '.daily-empty'],
  ['styles.css', '.settings-feedback'],
  ['styles.css', '.projects-feedback'],
  ['styles.css', '.project-policy-feedback'],
  ['styles.css', '.task-control-error'],
  ['styles.css', '.release-feedback'],
  ['styles.css', '.usage-feedback'],
  ['ConversationHistory.css', '.conversation-history-error'],
  ['ConversationHistory.css', '.chat-error'],
  ['styles.css', '.task-detail-error'],
  ['styles.css', '.workspace-pin-feedback'],
] as const;

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
  { file: 'daily/ui/daily-ui.css', selector: '.daily-chart-legend-mark', property: 'border-top', value: '2px solid currentColor', reason: 'Chart series line marker is paired with the series label.' },
  { file: 'daily/ui/daily-ui.css', selector: '.daily-chart-legend-mark--area', property: 'border-bottom', value: '2px solid currentColor', reason: 'Area chart legend marker depicts the plotted series.' },
  { file: 'daily/sections/workouts/workouts.css', selector: '.workouts-history-row', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural separator between workout history rows.' },
  { file: 'daily/sections/nutrition/nutrition.css', selector: '.nutrition-record', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural separator between recorded meals and library rows.' },
  { file: 'daily/sections/nutrition/nutrition.css', selector: '.nutrition-weekly-list > li', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural separator between weekly nutrition summaries.' },
  { file: 'daily/sections/nutrition/nutrition.css', selector: '.nutrition-meal', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural separator between meals in the period list.' },
  { file: 'styles.css', selector: '.area-sidebar', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural boundary below the sidebar on narrow layouts.' },
  { file: 'styles.css', selector: '.context-panel', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Structural boundary below the context panel on narrow layouts.' },
  { file: 'styles.css', selector: '.mobile-menu-actions', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates navigation from menu actions.' },
  { file: 'styles.css', selector: '.system-status-row + .system-status-row', property: 'border-top', value: '1px solid var(--rule)', reason: 'Separates consecutive system status rows.' },
  { file: 'daily/daily.css', selector: '.daily-table th, .daily-table td', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Daily table row separator; file is owned by the parallel Daily work.' },
  { file: 'daily/ui/daily-ui.css', selector: '.daily-scroll-table th, .daily-scroll-table td', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Daily scroll table row separator; file is owned by the parallel Daily work.' },
  { file: 'proactive.css', selector: '.proactive-block', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Separates Proactive page sections.' },
  { file: 'proactive.css', selector: '.proactive-item-row, .proactive-source-row, .proactive-runs-list > li', property: 'border-bottom', value: '1px solid var(--rule)', reason: 'Separates Proactive list rows.' },
];

const insetShadowAllowlist: AllowlistEntry[] = [
  { file: 'ConversationHistory.css', selector: '.input-orb span', property: 'box-shadow', value: '0 0 0 1.5px color-mix(in srgb, var(--stage-orb) 85%, transparent), 0 0 16px color-mix(in srgb, var(--stage-orb) 45%, transparent), inset 0 0 10px color-mix(in srgb, var(--stage-orb) 35%, transparent)', reason: 'The inset shading is part of the genuine circular voice orb, not a border.' },
  { file: 'ConversationHistory.css', selector: '.input-orb:is(:hover, :focus-visible):not(:disabled) span', property: 'box-shadow', value: '0 0 0 1.5px color-mix(in srgb, var(--glass-glow-warm) 80%, transparent), 0 0 20px color-mix(in srgb, var(--glass-glow-warm) 55%, transparent), inset 0 0 12px color-mix(in srgb, var(--glass-glow-warm) 45%, transparent)', reason: 'The inset shading is part of the genuine circular voice orb, not a border.' },
];

const rawColorAllowlist: AllowlistEntry[] = [
  { file: 'ConversationHistory.css', selector: '.input-orb span', property: 'background', value: 'radial-gradient(circle at 34% 28%, rgb(255 255 255 / 18%), transparent 42%), radial-gradient(circle, var(--stage-background) 52%, color-mix(in srgb, var(--stage-orb) 55%, var(--stage-background)) 100%)', reason: 'The orb highlight is part of the P14-03-owned circular voice control.' },
];

const typeSpacingAllowlist: AllowlistEntry[] = [
  { file: 'ConversationHistory.css', selector: '.markdown-content :not(pre) > code', property: 'font-size', value: '.9em', reason: 'Inline Markdown code scales with the surrounding heading or prose.' },
  { file: 'ConversationHistory.css', selector: '.markdown-content pre', property: 'font-size', value: '.9em', reason: 'Fenced Markdown code scales with the surrounding prose while retaining its readable monospace treatment.' },
  { file: 'ConversationHistory.css', selector: '.conversation-message .markdown-content :is(h1, h2, h3, h4, h5, h6)', property: 'font-size', value: '1.15em', reason: 'Message Markdown headings remain proportionate to their surrounding message text.' },
  { file: 'proactive.css', selector: '.proactive-urgency-icon', property: 'font-size', value: '.9em', reason: 'The urgency glyph scales with its adjacent urgency label.' },
  { file: 'styles.css', selector: '.release-graph-lane text', property: 'font', value: '12px system-ui, sans-serif', reason: 'The SVG release-graph labels retain their pixel-exact chart scale.' },
  { file: 'daily/ui/daily-ui.css', selector: '.daily-chart-grid text', property: 'font', value: '12px var(--font-body)', reason: 'The Daily chart axis labels retain their pixel-exact chart scale.' },
  { file: 'daily/ui/daily-ui.css', selector: '.daily-chart-xaxis text', property: 'font', value: '12px var(--font-body)', reason: 'The Daily chart axis labels retain their pixel-exact chart scale.' },
  { file: 'daily/ui/daily-ui.css', selector: '.daily-chart-target text', property: 'font', value: '12px var(--font-body)', reason: 'The Daily chart target label is SVG text sized in viewBox units, so it retains the chart scale.' },
  { file: 'daily/ui/daily-ui.css', selector: '.daily-chart-active-point text', property: 'font', value: '12px var(--font-body)', reason: 'The Daily chart readout label is SVG text sized in viewBox units, so it retains the chart scale.' },
  { file: 'daily/daily.css', selector: '.daily-page pre', property: 'font', value: 'var(--type-caption)/1.5 var(--font-mono)', reason: 'The ongoing Daily work owns its preformatted text line-height; the type size already uses the shared caption role.' },
  { file: 'daily/sections/workouts/workouts.css', selector: '.workouts-type-volume', property: 'margin-inline-start', value: 'calc(1.5rem + var(--space-2))', reason: 'The offset is the 1.5rem workout glyph column plus its gap, so the volume bar aligns under the type name.' },
  { file: 'ConversationHistory.css', selector: '.conversation-message.live-turn::before, .conversation-message[data-speaker="jarvis"][data-latest]::before', property: 'padding', value: '1.5px', reason: 'This pseudo-element padding creates the conversation glass rim, not content spacing.' },
  { file: 'ConversationHistory.css', selector: '.visually-hidden', property: 'margin', value: '-1px', reason: 'The one-pixel inset is part of the accessible visually-hidden clipping pattern.' },
  { file: 'ConversationHistory.css', selector: '.conversation-transcript', property: 'padding', value: '0 max(var(--space-1), calc((100% - 760px) / 2)) var(--space-6)', reason: 'The 760px value caps the centered transcript line length; it is not a spacing step.' },
  { file: 'styles.css', selector: '.visually-hidden', property: 'margin', value: '-1px', reason: 'The one-pixel inset is part of the accessible visually-hidden clipping pattern.' },
  { file: 'styles.css', selector: '.luminous-glass::before', property: 'padding', value: '1px', reason: 'This pseudo-element padding creates the shared glass rim, not content spacing.' },
  { file: 'styles.css', selector: '.workspace-window.luminous-glass::before', property: 'padding', value: '1.5px', reason: 'This pseudo-element padding creates the workspace glass rim, not content spacing.' },
  { file: 'styles.css', selector: '.app-shell[data-voice-active="false"] .workspace-window-conversation.luminous-glass::before', property: 'padding', value: '1.5px 1.5px 0', reason: 'This pseudo-element padding creates the conversation glass rim, not content spacing.' },
  { file: 'styles.css', selector: '.conversation-input.luminous-glass::before', property: 'padding', value: '1.5px', reason: 'This pseudo-element padding creates the composer glass rim, not content spacing.' },
  { file: 'styles.css', selector: '.app-shell:not(.app-signed-out) .app-topbar::before', property: 'padding', value: '1px', reason: 'This pseudo-element padding creates the topbar glass rim, not content spacing.' },
  { file: 'styles.css', selector: '.app-shell:not(.app-signed-out) :is(.area-rail, .area-sidebar, .context-panel)::before', property: 'padding', value: '1px', reason: 'These pseudo-element paddings create shell glass rims, not content spacing.' },
  { file: 'styles.css', selector: '.conversation-input.luminous-glass:not(:focus-within)::after', property: 'padding', value: '1.25px', reason: 'This pseudo-element padding creates the composer glass rim, not content spacing.' },
  { file: 'proactive.css', selector: '.proactive-page', property: 'margin-bottom', value: 'max(160px, calc(env(safe-area-inset-bottom) + 144px))', reason: 'The fixed lower reserve keeps Proactive content clear of the phone dock and voice controls.' },
  { file: 'styles.css', selector: '.workspace-window.luminous-glass:not(.workspace-window-conversation)::before', property: 'padding', value: '1px', reason: 'This pseudo-element padding creates a workspace glass rim, not content spacing.' },
  { file: 'styles.css', selector: '.workspaces-item:hover .workspaces-title, .workspaces-item:focus-within .workspaces-title', property: 'margin-right', value: '100px', reason: 'This reserve keeps the Workspaces title clear of its inline hover/focus actions.' },
  { file: 'ConversationHistory.css', selector: '.jarvis-page', property: 'padding', value: 'var(--space-5) clamp(var(--space-3), 3vw, var(--space-7))', reason: 'The shell gutter interpolates only between existing spacing steps to fit the responsive stage.' },
  { file: 'ConversationHistory.css', selector: '.app-shell[data-voice-active="false"] .shell-main:is([data-home="true"] > *) .workspace-shell-area', property: 'padding', value: 'var(--space-4) clamp(var(--space-3), 3vw, var(--space-7)) 0', reason: 'The workspace shell gutter interpolates only between existing spacing steps to fit the responsive stage.' },
  { file: 'ConversationHistory.css', selector: '.conversation-transcript:has(.conversation-greeting)', property: 'padding', value: 'clamp(var(--space-4), 12vh, var(--space-7)) var(--space-3) var(--space-6)', reason: 'The greeting position interpolates between existing vertical spacing steps as the viewport changes.' },
  { file: 'styles.css', selector: '.shell-main', property: 'padding', value: 'var(--space-6) clamp(var(--space-5), 4vw, var(--space-7)) var(--space-7)', reason: 'The shell gutter interpolates only between existing spacing steps to fit the responsive stage.' },
  { file: 'styles.css', selector: '.app-shell:not(.app-signed-out) :is(.area-rail, .area-sidebar, .context-panel)', property: 'margin', value: 'var(--slab-gap) 0 clamp(var(--space-4), 9vh, var(--space-7))', reason: 'The glass-slab reserve interpolates between existing vertical spacing steps for the available height.' },
  { file: 'styles.css', selector: '.modal-backdrop', property: 'padding', value: 'max(env(safe-area-inset-top), clamp(var(--space-4), 6dvh, var(--space-7))) max(var(--space-4), env(safe-area-inset-right)) max(var(--space-4), env(safe-area-inset-bottom)) max(var(--space-4), env(safe-area-inset-left))', reason: 'The dialog gutter interpolates between existing spacing steps for the available height and never drops below the device safe areas.' },
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
    const parent = declaration.parent;
    const selector = parent && 'selector' in parent && typeof parent.selector === 'string' ? parent.selector : '';
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

    if (property === 'font-size' && !/^var\(--type-[\w-]+\)$/u.test(value)
      && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)
      && !matchesAllowlist(typeSpacingAllowlist, file, selector, property, value)) {
      violations.push(`${location}: font size must use a type role or a reasoned exception`);
    }

    if (property === 'line-height' && !/^var\(--line-[\w-]+\)$/u.test(value)
      && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)
      && !matchesAllowlist(typeSpacingAllowlist, file, selector, property, value)) {
      violations.push(`${location}: line height must use a line role or a reasoned exception`);
    }

    if (property === 'font' && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)
      && (!/var\(--type-[\w-]+\)/u.test(value) || (value.includes('/') && !/\/var\(--line-[\w-]+\)/u.test(value)))
      && !matchesAllowlist(typeSpacingAllowlist, file, selector, property, value)) {
      violations.push(`${location}: font shorthand must use type and line roles or a reasoned exception`);
    }

    const isSpacing = /^(?:margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|gap|row-gap|column-gap)$/u.test(property);
    const hasNonzeroDimensionSpacing = isSpacing
      && [...value.matchAll(/(-?(?:\d+\.?\d*|\.\d+))(?:px|rem|em|%|vw|vh|svh|dvh|lvh|ch|ex|pt|cm|mm|in|pc)\b/giu)]
        .some(([, amount]) => Number.parseFloat(amount ?? '0') !== 0);
    if (hasNonzeroDimensionSpacing && !matchesAllowlist(typeSpacingAllowlist, file, selector, property, value)) {
      violations.push(`${location}: spacing must use a --space-* role or a reasoned exception`);
    }
  });

  return violations;
}

function stylesheetScaleInventory(file: string, source: string) {
  const inventory = { fontSize: 0, lineHeight: 0, fontShorthand: 0, spacing: 0 };
  const root = postcss.parse(source, { from: file });
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const value = normalize(declaration.value);
    if (property === 'font-size' && !/^var\(--type-[\w-]+\)$/u.test(value)
      && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)) inventory.fontSize += 1;
    if (property === 'line-height' && !/^var\(--line-[\w-]+\)$/u.test(value)
      && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)) inventory.lineHeight += 1;
    if (property === 'font' && !/^(?:inherit|initial|unset|revert|revert-layer)$/iu.test(value)
      && (!/var\(--type-[\w-]+\)/u.test(value) || (value.includes('/') && !/\/var\(--line-[\w-]+\)/u.test(value)))) {
      inventory.fontShorthand += 1;
    }
    if (/^(?:margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|gap|row-gap|column-gap)$/u.test(property)
      && [...value.matchAll(/(-?(?:\d+\.?\d*|\.\d+))px/giu)]
        .some(([, amount]) => Number.parseFloat(amount ?? '0') !== 0)) inventory.spacing += 1;
  });
  return inventory;
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

  it.each(stylesheets)('%s follows the shared geometry, typography, spacing and surface rules', (file) => {
    expect(stylesheetViolations(file, readFileSync(join(sourceDirectory, file), 'utf8'))).toEqual([]);
  });

  it('reports the remaining raw type and spacing exceptions', () => {
    const inventory = stylesheets.reduce((total, file) => {
      const result = stylesheetScaleInventory(file, readFileSync(join(sourceDirectory, file), 'utf8'));
      total.fontSize += result.fontSize;
      total.lineHeight += result.lineHeight;
      total.fontShorthand += result.fontShorthand;
      total.spacing += result.spacing;
      return total;
    }, { fontSize: 0, lineHeight: 0, fontShorthand: 0, spacing: 0 });
    expect(inventory).toEqual({ fontSize: 4, lineHeight: 0, fontShorthand: 6, spacing: 14 });
  });

  it('keeps legacy state selectors on shared semantic tokens or removes their styles', () => {
    const sharedStateToken = /var\(--(?:text-muted|error|error-surface|surface(?:-[\w-]+)?|rule|type-(?:body|small|caption)|space-[1-7]|radius-panel)\)/u;
    for (const [file, selector] of legacyStateStyles) {
      const root = postcss.parse(readFileSync(join(sourceDirectory, file), 'utf8'), { from: file });
      const declarations: string[] = [];
      root.walkRules((rule) => {
        if (rule.selector.includes(selector)) {
          rule.walkDecls((declaration) => { declarations.push(declaration.value); });
        }
      });
      if (declarations.length === 0) continue;
      expect(declarations.some((value) => sharedStateToken.test(value)), `${file}: ${selector}`).toBe(true);
    }
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

  it('rejects raw type, line-height and spacing values unless exactly reasoned', () => {
    const css = '.probe { font-size: 16px; line-height: 1.4; gap: 8px; padding-inline: 1rem; }';
    expect(stylesheetViolations('probe.css', css)).toHaveLength(4);
    expect(stylesheetViolations('probe.css', '.probe { font: 12px/1.5 Arial; }')).toHaveLength(1);
    expect(stylesheetViolations('probe.css', '.probe { font: var(--type-body)/var(--line-body) var(--font-body); }')).toEqual([]);
    expect(stylesheetViolations('ConversationHistory.css', '.markdown-content pre { font-size: .9em; }')).toEqual([]);
    expect(stylesheetViolations('styles.css', '.luminous-glass::before { padding: 1px; }')).toEqual([]);
    expect(stylesheetViolations('styles.css', '.release-graph-lane text { font: 12px system-ui, sans-serif; }')).toEqual([]);
  });

  it('gives every exception an explicit reason', () => {
    const exceptions = [...sideBorderAllowlist, ...insetShadowAllowlist, ...rawColorAllowlist, ...typeSpacingAllowlist, ...radiusAllowlist];
    expect(exceptions.every((entry) => entry.reason.trim().length > 0)).toBe(true);
    expect(literalRadiusAllowlist.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it.each(['primary-button', 'secondary-button', 'ghost-button', 'danger-button', 'danger-button--filled'])(
    'keeps hover, pressed, focus-visible and disabled rules for .%s',
    (variant) => {
      const source = readFileSync(join(sourceDirectory, 'styles.css'), 'utf8');
      const root = postcss.parse(source);
      for (const state of [':hover', ':active', ':focus-visible', ':disabled']) {
        let found = false;
        root.walkRules((rule) => {
          if (rule.selector.includes(`.${variant}`) && rule.selector.includes(state) && rule.nodes?.length) found = true;
        });
        expect(found, `.${variant}${state} rule`).toBe(true);
      }
      let busy = false;
      root.walkRules((rule) => {
        if (rule.selector.includes(`.${variant}`) && rule.selector.includes('[aria-busy="true"]')) busy = true;
      });
      expect(busy, `.${variant}[aria-busy="true"] rule`).toBe(true);
    },
  );

  it('keeps explicit contrast, coarse-pointer targets, and token-only button colours', () => {
    const source = readFileSync(join(sourceDirectory, 'styles.css'), 'utf8');
    const coarseRules: string[] = [];
    postcss.parse(source).walkAtRules('media', (atRule) => {
      if (atRule.params.includes('(pointer: coarse)')) {
        atRule.walkRules((rule) => {
          coarseRules.push(`${rule.selector} { ${rule.nodes?.map((node) => node.toString()).join('; ')} }`);
        });
      }
    });
    expect(coarseRules.some((rule) => rule.includes('.primary-button') && rule.includes('min-height: 44px'))).toBe(true);
    expect(coarseRules.some((rule) => rule.includes('.secondary-button') && rule.includes('min-height: 44px'))).toBe(true);
    expect(coarseRules.some((rule) => rule.includes('.ghost-button') && rule.includes('min-height: 44px'))).toBe(true);
    expect(coarseRules.some((rule) => rule.includes('.danger-button') && rule.includes('min-height: 44px'))).toBe(true);
    expect(coarseRules.some((rule) => rule.includes('.conversation-history .composer-send') && rule.includes('min-height: 44px'))).toBe(true);
    expect(source).toContain('@media (prefers-contrast: more)');
    expect(source).toContain('@media (forced-colors: active)');
    const buttonClasses = [
      '.primary-button', '.secondary-button', '.ghost-button', '.danger-button',
      '.danger-button--filled', '.jobs-action-primary', '.composer-send', '.conversation-latest',
    ];
    for (const file of stylesheets) {
      const root = postcss.parse(readFileSync(join(sourceDirectory, file), 'utf8'), { from: file });
      root.walkRules((rule) => {
        if (!buttonClasses.some((buttonClass) => rule.selector.includes(buttonClass))) return;
        rule.walkDecls((declaration) => {
          expect(declaration.value, `${file}: ${rule.selector} ${declaration.prop}`)
            .not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/iu);
        });
      });
    }
  });

  it('keeps the composer send action a bare icon with finite, reduced-motion-safe motion', () => {
    const history = postcss.parse(readFileSync(join(sourceDirectory, 'ConversationHistory.css'), 'utf8'), { from: 'ConversationHistory.css' });
    const keyframes = new Set<string>();
    history.walkAtRules('keyframes', (atRule) => { keyframes.add(atRule.params); });
    expect([...keyframes]).toEqual(expect.arrayContaining(['composer-send-arm', 'composer-send-launch']));

    const baseSelector = '.conversation-history .composer-send';
    const surfaceProps = new Set([
      'background', 'background-color', 'background-image', 'box-shadow',
      'border', 'border-color', 'border-width', 'border-style',
      'border-top', 'border-right', 'border-bottom', 'border-left',
    ]);
    for (const file of stylesheets) {
      const root = postcss.parse(readFileSync(join(sourceDirectory, file), 'utf8'), { from: file });
      root.walkRules((rule) => {
        if (!rule.selector.includes('.composer-send')) return;
        rule.walkDecls((declaration) => {
          const label = `${file}: ${rule.selector} ${declaration.prop}`;
          if (surfaceProps.has(declaration.prop)) {
            expect(rule.selector, label).toBe(baseSelector);
            expect(declaration.value, label).toMatch(/^(?:none|0)$/u);
          }
          if (declaration.prop.startsWith('animation')) {
            expect(declaration.value, label).not.toContain('infinite');
            const name = declaration.value.split(/\s+/u)[0] ?? '';
            if (declaration.prop === 'animation') expect(['none', ...keyframes], label).toContain(name);
          }
        });
      });
    }

    const reducesLaunch = (rule: postcss.Rule) => rule.selector.includes('.composer-send-glyph[data-sent]')
      && rule.nodes?.some((node) => node.toString() === 'animation: none');
    let reducedByMedia = false;
    history.walkAtRules('media', (atRule) => {
      if (!atRule.params.includes('prefers-reduced-motion: reduce')) return;
      atRule.walkRules((rule) => { reducedByMedia ||= Boolean(reducesLaunch(rule)); });
    });
    let reducedBySetting = false;
    history.walkRules((rule) => {
      if (rule.selector.startsWith(':root[data-motion="reduced"]') && reducesLaunch(rule)) reducedBySetting = true;
    });
    expect(reducedByMedia).toBe(true);
    expect(reducedBySetting).toBe(true);
  });
});

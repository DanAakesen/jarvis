import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Theme = 'light' | 'dark';
type Color = { red: number; green: number; blue: number; alpha: number };
type Background = { label: string; layers: string[] };
type Pairing = {
  label: string;
  foreground: string;
  backgrounds: Background[];
  threshold: number;
  allowlistReason?: string;
  beforeLayers?: string[];
  heroSample?: 'body' | 'muted';
};

const source = readFileSync('src/styles.css', 'utf8');
const stageSamples = [
  { label: 'darkest stage sample', color: '#000000' },
  { label: 'lightest stage sample', color: '#ffffff' },
] as const;
const heroSamples: Record<Theme, Record<'body' | 'muted', { label: string; color: string }>> = {
  light: {
    body: { label: 'light hero sample for body text at (1424, 560)', color: '#3f4646' },
    muted: { label: 'light hero sample for muted text at (1424, 710)', color: '#4c5b5f' },
  },
  dark: {
    body: { label: 'dark hero sample for body text at (1400, 910)', color: '#f3f3e5' },
    muted: { label: 'dark hero sample for muted text at (16, 910)', color: '#f7f0e5' },
  },
};
const surfaces = [
  '--page', '--surface', '--surface-muted', '--surface-translucent',
  '--report-surface', '--code-surface', '--stage-slab', '--shell-slab',
  '--board-slab', '--stage-glass',
];

function declaration(sourceText: string, selector: string, token: string): string | undefined {
  for (const match of sourceText.matchAll(/([^{}]+)\{([^{}]*)\}/gs)) {
    const selectors = match[1]!.replace(/\/\*[\s\S]*?\*\//gu, '').split(',').map((item) => item.trim());
    if (!selectors.includes(selector)) continue;
    const value = match[2]!.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];
    if (value) return value.trim();
  }
  return undefined;
}

function themeToken(sourceText: string, token: string, theme: Theme): string {
  const themeSelector = theme === 'dark' ? ':root[data-theme="dark"]' : ':root[data-theme="light"]';
  const specific = declaration(sourceText, themeSelector, token);
  if (specific) return specific;
  if (theme === 'dark') {
    const sharedDark = declaration(sourceText, ':root, :root[data-theme="dark"]', token);
    if (sharedDark) return sharedDark;
  }
  const base = declaration(sourceText, ':root', token);
  if (!base) throw new Error(`Missing ${token} for ${theme} theme`);
  return base;
}

function splitArguments(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (value[index] === ',' && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function parseColor(value: string): Color {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/iu)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((part) => `${part}${part}`).join('') : hex;
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: 1,
    };
  }
  if (value === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 };
  const rgb = value.match(/^rgb\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s*\/\s*([\d.]+)%?)?\)$/u);
  if (!rgb) throw new Error(`Unsupported audit color: ${value}`);
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (value.includes('%') ? 100 : 1);
  return { red: Number(rgb[1]), green: Number(rgb[2]), blue: Number(rgb[3]), alpha };
}

function resolveColor(expression: string, theme: Theme, seen: string[] = []): Color {
  const value = expression.trim();
  const variable = value.match(/^var\((--[\w-]+)(?:\s*,\s*(.*))?\)$/su);
  if (variable) {
    const [, name, fallback] = variable;
    if (seen.includes(name!)) throw new Error(`Cyclic color token: ${[...seen, name].join(' → ')}`);
    try {
      return resolveColor(themeToken(source, name!, theme), theme, [...seen, name!]);
    } catch (error) {
      if (fallback === undefined) throw error;
      return resolveColor(fallback, theme, seen);
    }
  }

  if (value.startsWith('color-mix(') && value.endsWith(')')) {
    const [space, first, second] = splitArguments(value.slice(10, -1));
    if (space !== 'in srgb' || !first || !second) throw new Error(`Unsupported color mix: ${value}`);
    const firstPart = first.match(/^(.*)\s+([\d.]+)%$/su);
    const secondPart = second.match(/^(.*)\s+([\d.]+)%$/su);
    const firstColor = resolveColor(firstPart?.[1] ?? first, theme, seen);
    const secondColor = resolveColor(secondPart?.[1] ?? second, theme, seen);
    const firstWeight = firstPart ? Number(firstPart[2]) / 100 : secondPart ? 1 - Number(secondPart[2]) / 100 : 0.5;
    const secondWeight = secondPart ? Number(secondPart[2]) / 100 : 1 - firstWeight;
    const alpha = firstColor.alpha * firstWeight + secondColor.alpha * secondWeight;
    if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
    return {
      red: (firstColor.red * firstColor.alpha * firstWeight + secondColor.red * secondColor.alpha * secondWeight) / alpha,
      green: (firstColor.green * firstColor.alpha * firstWeight + secondColor.green * secondColor.alpha * secondWeight) / alpha,
      blue: (firstColor.blue * firstColor.alpha * firstWeight + secondColor.blue * secondColor.alpha * secondWeight) / alpha,
      alpha,
    };
  }

  return parseColor(value);
}

function composite(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
    green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
    blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
    alpha,
  };
}

function luminance(color: Color): number {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(first: Color, second: Color): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function measure(
  theme: Theme,
  pairing: Pairing,
  report: Array<{
    pairing: string;
    theme: Theme;
    backdrop: string;
    ratio: number;
    threshold: number;
    result: string;
    allowlistReason?: string;
    beforeRatio?: number;
  }>,
  samples: readonly { label: string; color: string }[] = stageSamples,
): void {
  const foreground = resolveColor(pairing.foreground.startsWith('--')
    ? `var(${pairing.foreground})`
    : pairing.foreground, theme);
  for (const background of pairing.backgrounds) {
    for (const stage of samples) {
      const backdrop = parseColor(stage.color);
      const renderedBackground = background.layers.reduce(
        (result, layer) => composite(resolveColor(layer.startsWith('--') ? `var(${layer})` : layer, theme), result),
        backdrop,
      );
      const ratio = contrast(composite(foreground, renderedBackground), renderedBackground);
      const beforeBackground = pairing.beforeLayers?.reduce(
        (result, layer) => composite(resolveColor(layer.startsWith('--') ? `var(${layer})` : layer, theme), result),
        backdrop,
      );
      report.push({
        pairing: `${pairing.label} — ${background.label}`,
        theme,
        backdrop: stage.label,
        ratio,
        threshold: pairing.threshold,
        result: ratio >= pairing.threshold ? 'Pass' : pairing.allowlistReason ? 'Allow-listed' : 'Fail',
        ...(ratio < pairing.threshold && pairing.allowlistReason
          ? { allowlistReason: pairing.allowlistReason }
          : {}),
        ...(beforeBackground ? { beforeRatio: contrast(composite(foreground, beforeBackground), beforeBackground) } : {}),
      });
    }
  }
}

function tokens(...names: string[]): string[] {
  return names.map((name) => `var(${name})`);
}

const buttonPairings: Pairing[] = [
  {
    label: 'Primary button / rest',
    foreground: 'var(--primary-action-text)',
    backgrounds: [
      { label: 'top gradient stop', layers: ['color-mix(in srgb, var(--primary-action) 93%, var(--highlight-solid))'] },
      { label: 'bottom gradient stop', layers: ['color-mix(in srgb, var(--primary-action) 94%, var(--ink-solid))'] },
    ],
    threshold: 4.5,
  },
  {
    label: 'Primary button / hover',
    foreground: 'var(--primary-action-text)',
    backgrounds: [
      { label: 'top gradient stop', layers: ['color-mix(in srgb, var(--primary-action-hover) 94%, var(--highlight-solid))'] },
      { label: 'bottom gradient stop', layers: ['color-mix(in srgb, var(--primary-action-hover) 92%, var(--ink-solid))'] },
    ],
    threshold: 4.5,
  },
  {
    label: 'Primary button / pressed',
    foreground: 'var(--primary-action-text)',
    backgrounds: [
      { label: 'top gradient stop', layers: ['color-mix(in srgb, var(--primary-action) 84%, var(--ink-solid))'] },
      { label: 'bottom gradient stop', layers: ['color-mix(in srgb, var(--primary-action) 78%, var(--ink-solid))'] },
    ],
    threshold: 4.5,
  },
  ...([
    { label: 'Secondary button', foreground: 'var(--text)' },
    { label: 'Ghost button', foreground: 'var(--text)' },
    { label: 'Danger button', foreground: 'var(--error)' },
  ] as const).flatMap(({ label, foreground }) => {
    const states: readonly (readonly [string, string])[] = label === 'Secondary button'
      ? [
        ['rest', 'color-mix(in srgb, var(--text) 6%, var(--surface))'],
        ['hover', 'color-mix(in srgb, var(--text) 12%, var(--surface))'],
        ['pressed', 'color-mix(in srgb, var(--text) 18%, var(--surface))'],
      ]
      : label === 'Ghost button'
        ? [
          ['rest', 'transparent'],
          ['hover', 'var(--glass-hover)'],
          ['pressed', 'var(--glass-pressed)'],
        ]
        : [
          ['rest', 'color-mix(in srgb, var(--error-surface) 72%, var(--surface))'],
          ['hover', 'var(--error-surface)'],
          ['pressed', 'color-mix(in srgb, var(--error-surface) 76%, var(--error))'],
        ];
    return states.map(([state, fill]) => ({
      label: `${label} / ${state}`,
      foreground,
      backgrounds: label === 'Ghost button'
        ? ['--page', '--surface', '--surface-translucent', '--stage-slab', '--shell-slab', '--board-slab', '--stage-glass'].map((base) => ({
          label: `${base} host`,
          layers: [base.startsWith('--') ? `var(${base})` : base, fill],
        }))
        : [{ label: 'button fill', layers: [fill] }],
      threshold: 4.5,
    }));
  }),
  ...([
    { label: 'Filled danger button / rest', stops: ['93%','94%'], mix: ['var(--highlight-solid)','var(--ink-solid)'] },
    { label: 'Filled danger button / hover', stops: ['88%','90%'], mix: ['var(--highlight-solid)','var(--ink-solid)'] },
    { label: 'Filled danger button / pressed', stops: ['84%','78%'], mix: ['var(--ink-solid)','var(--ink-solid)'] },
  ] as const).flatMap(({ label, stops, mix }) => ({
    label,
    foreground: 'var(--danger-action-text)',
    backgrounds: stops.map((stop, index) => ({
      label: index === 0 ? 'top gradient stop' : 'bottom gradient stop',
      layers: [`color-mix(in srgb, var(--error) ${stop}, ${mix[index]!})`],
    })),
    threshold: 4.5,
  })),
  {
    label: 'Primary button / busy loader',
    foreground: 'var(--primary-action-text)',
    backgrounds: [
      { label: 'top gradient stop', layers: ['color-mix(in srgb, var(--primary-action) 93%, var(--highlight-solid))'] },
      { label: 'bottom gradient stop', layers: ['color-mix(in srgb, var(--primary-action) 94%, var(--ink-solid))'] },
    ],
    threshold: 3,
  },
  {
    label: 'Secondary button / busy loader',
    foreground: 'var(--text)',
    backgrounds: [{ label: 'rest fill', layers: ['color-mix(in srgb, var(--text) 6%, var(--surface))'] }],
    threshold: 3,
  },
  {
    label: 'Ghost button / busy loader',
    foreground: 'var(--text)',
    backgrounds: [{ label: 'rest fill', layers: ['var(--surface-translucent)'] }],
    threshold: 3,
  },
  {
    label: 'Danger button / busy loader',
    foreground: 'var(--error)',
    backgrounds: [{ label: 'rest fill', layers: [
      'color-mix(in srgb, var(--error-surface) 72%, var(--surface))',
    ] }],
    threshold: 3,
  },
  {
    label: 'Filled danger button / busy loader',
    foreground: 'var(--danger-action-text)',
    backgrounds: [
      { label: 'top gradient stop', layers: ['color-mix(in srgb, var(--error) 93%, var(--highlight-solid))'] },
      { label: 'bottom gradient stop', layers: ['color-mix(in srgb, var(--error) 94%, var(--ink-solid))'] },
    ],
    threshold: 3,
  },
  ...(['Secondary', 'Ghost', 'Danger', 'Filled danger'] as const).map((variant) => ({
    label: `${variant} button / disabled`,
    foreground: 'var(--disabled-text)',
    backgrounds: [{ label: 'disabled surface', layers: tokens('--disabled-surface') }],
    threshold: 3,
  })),
  {
    label: 'Primary button / disabled',
    foreground: 'var(--primary-action-disabled-text)',
    backgrounds: [{ label: 'disabled accent', layers: tokens('--primary-action-disabled') }],
    threshold: 3,
  },
];

function semanticPairings(): Pairing[] {
  const pairings: Pairing[] = [
    ...([
      { label: 'Kanban page helper and link text', foreground: 'var(--text)', surface: '--surface-translucent', sample: 'body' },
      { label: 'Kanban board strip connection notice', foreground: 'var(--error)', surface: '--board-slab', sample: 'body' },
      { label: 'Kanban empty-state copy', foreground: 'var(--text)', surface: '--board-slab', sample: 'body' },
      { label: 'Kanban empty-state detail and caption', foreground: 'var(--text-muted)', surface: '--board-slab', sample: 'muted' },
    ] as const).map(({ label, foreground, surface, sample }) => ({
      label,
      foreground,
      backgrounds: [{ label: `${surface} over sampled hero pixels`, layers: tokens(surface) }],
      threshold: 4.5,
      beforeLayers: [],
      heroSample: sample,
    })),
    { label: 'Body text', foreground: 'var(--text)', backgrounds: surfaces.map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Links (inherit body text)', foreground: 'var(--text)', backgrounds: ['--page', '--surface', '--surface-translucent', '--stage-slab', '--shell-slab', '--board-slab', '--stage-glass'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Muted, caption and placeholder text', foreground: 'var(--text-muted)', backgrounds: surfaces.map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Error text and badge', foreground: 'var(--error)', backgrounds: ['--page', '--surface', '--surface-translucent', '--stage-slab', '--board-slab', '--error-surface', '--error-wash'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Success text and badge', foreground: 'var(--success)', backgrounds: ['--page', '--surface', '--surface-translucent', '--stage-slab', '--board-slab', '--success-surface', '--success-wash'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Warning text and badge', foreground: 'var(--warning)', backgrounds: ['--page', '--surface', '--surface-translucent', '--stage-slab', '--board-slab', '--warning-surface'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Warning-label text', foreground: 'var(--warning-text)', backgrounds: ['--page', '--surface', '--surface-translucent', '--stage-slab', '--board-slab', '--warning-surface'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Pending status mark', foreground: 'var(--pending)', backgrounds: ['--page', '--surface', '--pending-surface'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Voice/listening, thinking, speaking, reconnecting and unavailable status', foreground: 'var(--state-listening)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Voice/thinking status', foreground: 'var(--state-thinking)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Voice/speaking status', foreground: 'var(--state-speaking)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Voice/reconnecting status', foreground: 'var(--state-reconnecting)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Voice/unavailable status', foreground: 'var(--state-unavailable)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Disabled text (legibility exception)', foreground: 'var(--disabled-text)', backgrounds: [{ label: '--disabled-surface', layers: tokens('--disabled-surface') }], threshold: 3 },
    { label: 'Field and select text', foreground: 'var(--text)', backgrounds: ['--surface', '--board-slab'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Field placeholder', foreground: 'var(--text-muted)', backgrounds: ['--surface', '--board-slab'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Field boundary', foreground: 'var(--control-rule)', backgrounds: ['--page', '--surface', '--board-slab'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Focus ring', foreground: 'var(--focus)', backgrounds: surfaces.map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Selected text', foreground: 'var(--state-selected-fg)', backgrounds: ['--page', '--surface', '--surface-muted', '--surface-translucent'].map((name) => ({ label: `${name} with selected fill`, layers: [`var(${name})`, 'var(--state-selected-bg)'] })), threshold: 4.5 },
    { label: 'Selected text / hover', foreground: 'var(--state-selected-fg)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: `${name} with selected hover`, layers: [`var(${name})`, 'var(--state-selected-hover)'] })), threshold: 4.5 },
    { label: 'Selected text / pressed', foreground: 'var(--state-selected-fg)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: `${name} with selected pressed`, layers: [`var(${name})`, 'var(--state-selected-pressed)'] })), threshold: 4.5 },
    { label: 'Daily stat tile values and deltas', foreground: 'var(--text)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 4.5 },
    { label: 'Daily/chart axes and target labels', foreground: 'var(--text-muted)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 4.5 },
    { label: 'Generated chart axes and table text', foreground: 'var(--text-muted)', backgrounds: ['--surface-translucent', '--report-surface'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 4.5 },
    { label: 'Daily/chart cool series line', foreground: 'var(--glass-edge-cool)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily/chart cool legend mark', foreground: 'var(--glass-edge-cool)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily/chart cool series bar (82% opacity)', foreground: 'color-mix(in srgb, var(--glass-edge-cool) 82%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily/chart warm series line', foreground: 'var(--chart-series-warm)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily/chart warm legend mark', foreground: 'var(--chart-series-warm)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily/chart warm series bar (82% opacity)', foreground: 'color-mix(in srgb, var(--chart-series-warm) 82%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Generated chart cool series bar (88% opacity)', foreground: 'color-mix(in srgb, var(--glass-edge-cool) 88%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Generated chart warm series bar (88% opacity)', foreground: 'color-mix(in srgb, var(--chart-series-warm) 88%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily sparkline trace', foreground: 'var(--focus)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3 },
    { label: 'Daily meter fill', foreground: 'var(--focus)', backgrounds: [{ label: '--surface', layers: tokens('--surface') }], threshold: 3 },
    { label: 'Daily legend range key (22% opacity)', foreground: 'color-mix(in srgb, var(--text-muted) 22%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3, allowlistReason: 'The range key is a secondary interval cue; the labeled range, chart series and accessible values table carry the data.' },
    { label: 'Daily/chart cool area fill (16% opacity)', foreground: 'color-mix(in srgb, var(--glass-edge-cool) 16%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3, allowlistReason: 'Secondary area fill is not the series mark: a 3:1 line, labelled legend, and data table carry the same values.' },
    { label: 'Daily/chart warm area fill (16% opacity)', foreground: 'color-mix(in srgb, var(--chart-series-warm) 16%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3, allowlistReason: 'Secondary area fill is not the series mark: a 3:1 line, labelled legend, and data table carry the same values.' },
    { label: 'Generated chart area fill (14% opacity)', foreground: 'color-mix(in srgb, var(--chart-series-warm) 14%, transparent)', backgrounds: [{ label: '--surface-translucent', layers: tokens('--surface-translucent') }], threshold: 3, allowlistReason: 'Secondary area fill is not the series mark: a 3:1 line, labelled legend, and values table carry the same values.' },
    { label: 'Structural rule (not a control boundary)', foreground: 'var(--rule)', backgrounds: ['--page', '--surface', '--surface-translucent'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3, allowlistReason: 'The token separates content only; interactive controls use the measured --control-rule boundary.' },
    { label: 'Knowledge graph People mark', foreground: 'var(--graph-people)', backgrounds: ['--stage-background', '--stage-floor'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Knowledge graph Work mark', foreground: 'var(--graph-work)', backgrounds: ['--stage-background', '--stage-floor'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Knowledge graph Personal mark', foreground: 'var(--graph-personal)', backgrounds: ['--stage-background', '--stage-floor'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
    { label: 'Knowledge graph General mark', foreground: 'var(--graph-general)', backgrounds: ['--stage-background', '--stage-floor'].map((name) => ({ label: name, layers: tokens(name) })), threshold: 3 },
  ];

  for (const pairing of buttonPairings) pairings.push(pairing);
  return pairings;
}

describe('app-wide theme contrast audit', () => {
  it('measures shared text, state, control, button and chart pairings against both stage extremes', () => {
    const report: Array<{
      pairing: string;
      theme: Theme;
      backdrop: string;
      ratio: number;
      threshold: number;
      result: string;
      allowlistReason?: string;
    }> = [];
    const pairings = semanticPairings();

    for (const theme of ['light', 'dark'] as const) {
      for (const pairing of pairings) {
        const samples = pairing.heroSample ? [heroSamples[theme][pairing.heroSample]] : stageSamples;
        measure(theme, pairing, report, samples);
      }
      for (const [name, token] of [
        ['Present', '--presence-present'], ['Away', '--presence-away'], ['On the move', '--presence-move'],
      ]) {
        measure(theme, {
          label: `Presence ${name} indicator`,
          foreground: theme === 'light'
            ? `color-mix(in srgb, var(${token}) 55%, var(--ink-solid))`
            : `var(${token})`,
          backgrounds: ['--page', '--surface', '--surface-muted', '--surface-translucent', '--stage-background', '--stage-floor']
            .map((name) => ({ label: name, layers: tokens(name) })),
          threshold: 3,
        }, report);
      }
    }

    if (process.env.P14_CONTRAST_REPORT === '1') {
      process.stdout.write(`${JSON.stringify(report.map(({ ratio, ...row }) => ({ ...row, ratio: Number(ratio.toFixed(2)) })), null, 2)}\n`);
    }
    expect(report.filter(({ theme }) => theme === 'light').map(({ pairing }) => pairing))
      .toEqual(report.filter(({ theme }) => theme === 'dark').map(({ pairing }) => pairing));
    const failures = report.filter(({ ratio, threshold, result }) => ratio < threshold && result !== 'Allow-listed');
    expect(failures, `Contrast failures:\n${JSON.stringify(failures, null, 2)}`).toEqual([]);
    expect(report.filter(({ result }) => result === 'Allow-listed')
      .every(({ allowlistReason }) => Boolean(allowlistReason?.trim()))).toBe(true);
  });

  it('keeps Kanban helper, board-strip and empty-state text on measured glass surfaces', () => {
    expect(declaration(source, '.kanban-page > .tasks-help', 'background'))
      .toBe('var(--surface-translucent)');
    expect(declaration(source, '.kanban-strip', 'background')).toBe('var(--board-slab)');
    expect(declaration(source, '.kanban-column', 'background')).toBe('var(--board-slab)');
    expect(declaration(source, '.kanban-connection-issue', 'color')).toBe('var(--error)');
    expect(declaration(source, '.kanban-refresh', 'color')).toBe('var(--text)');
    expect(declaration(source, '.kanban-column .task-column-empty', 'color')).toBe('var(--text-muted)');
    const tasksPage = readFileSync('src/factory/TasksPage.tsx', 'utf8');
    expect(tasksPage).toContain('className="kanban-strip"');
    expect(tasksPage).toContain('className="kanban-connection-issue"');
    expect(tasksPage).toContain('className="task-column-empty"');
  });

  it('keeps disabled controls legible and visibly distinct from enabled controls', () => {
    for (const theme of ['light', 'dark'] as const) {
      const disabledText = resolveColor('var(--disabled-text)', theme);
      const enabledText = resolveColor('var(--text)', theme);
      const disabledSurface = resolveColor('var(--disabled-surface)', theme);
      const enabledSurface = resolveColor('color-mix(in srgb, var(--text) 6%, var(--surface))', theme);
      const enabledPrimary = resolveColor('var(--primary-action)', theme);
      const disabledPrimary = resolveColor('var(--primary-action-disabled)', theme);
      expect(Math.abs(disabledPrimary.red - enabledPrimary.red) +
        Math.abs(disabledPrimary.green - enabledPrimary.green) +
        Math.abs(disabledPrimary.blue - enabledPrimary.blue), `${theme} disabled primary distinction`)
        .toBeGreaterThanOrEqual(45);
      expect(Math.abs(disabledText.red - enabledText.red) +
        Math.abs(disabledText.green - enabledText.green) +
        Math.abs(disabledText.blue - enabledText.blue), `${theme} disabled text distinction`)
        .toBeGreaterThanOrEqual(45);
      for (const stage of stageSamples) {
        const disabled = composite(disabledSurface, parseColor(stage.color));
        const enabled = composite(enabledSurface, parseColor(stage.color));
        expect(Math.abs(disabled.red - enabled.red) +
          Math.abs(disabled.green - enabled.green) +
          Math.abs(disabled.blue - enabled.blue), `${theme} disabled surface distinction`)
          .toBeGreaterThanOrEqual(18);
      }
    }
  });

  it('defines contrast-more and forced-colors coverage for shared fields and keyboard focus', () => {
    expect(source).toContain('@media (prefers-contrast: more)');
    expect(source).toContain('--focus: var(--text)');
    expect(source).toContain('--control-rule: var(--text)');
    expect(source).toContain('@media (forced-colors: active)');
    expect(source).toContain('border-color: FieldText;');
    expect(source).toContain('background-color: Field;');
    expect(source).toContain('outline: 3px solid Highlight;');
    expect(source).toContain('accent-color: Highlight;');
  });

  it('keeps theme-specific rules from changing layout or state coverage', () => {
    const colorProperties = new Set([
      'accent-color', 'background', 'background-color', 'background-image', 'border-color',
      'box-shadow', 'color', 'color-scheme', 'filter', 'fill', 'mix-blend-mode', 'opacity',
      'outline-color', 'stroke', 'text-decoration-color',
    ]);
    const structuralThemeRules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gs)]
      .flatMap(([, selectorText, body]) => {
        const selectors = selectorText!
          .replace(/\/\*[\s\S]*?\*\//gu, '')
          .split(',')
          .map((selector) => selector.trim())
          .filter((selector) => /:root\[data-theme="(?:light|dark)"\]/u.test(selector));
        const properties = [...body!.matchAll(/(?:^|;)\s*([-\w]+)\s*:/gu)]
          .map(([, property]) => property!.toLowerCase())
          .filter((property) => !property.startsWith('--') && !colorProperties.has(property) &&
            !(property === 'animation' && selectors.length === 1 &&
              selectors[0] === ':root[data-theme="dark"] .app-shell::before'));
        return properties.length ? selectors.map((selector) => `${selector}: ${properties.join(', ')}`) : [];
      });

    expect(structuralThemeRules).toEqual([]);
  });

  it('keeps state meaning available without hue', () => {
    const stateMessage = readFileSync('src/StateMessage.tsx', 'utf8');
    const proactive = readFileSync('src/ProactiveArea.tsx', 'utf8');
    const dailyChart = readFileSync('src/daily/ui/DailyChart.tsx', 'utf8');
    const chartView = readFileSync('src/ChartView.tsx', 'utf8');

    expect(stateMessage).toContain("variant === 'error' ? 'alert' : 'status'");
    expect(stateMessage).toContain('aria-hidden="true">{mark}');
    expect(proactive).toContain('className="proactive-new">New</span>');
    expect(proactive).toContain("item.state === 'new' ? 'New'");
    expect(dailyChart).toContain('aria-label={`${name} legend`}');
    expect(dailyChart).toContain('data-series-index={seriesIndex}');
    expect(dailyChart).toContain('<ScrollTable label={`${name} data`}>');
    expect(chartView).toContain('<ul className="chart-legend" aria-hidden="true">');
    expect(chartView).toContain('<summary>Show values</summary>');
    expect(chartView).toContain('<table aria-label={`${title} values`}>');
    expect(source).toContain('.mobile-menu-link[aria-current="page"]');
    expect(source).toContain('font-weight: 750');
  });

  it('disables active voice status animation for system reduced-motion users', () => {
    const conversationStyles = readFileSync('src/ConversationHistory.css', 'utf8');
    expect(conversationStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(conversationStyles).toContain('.voice-status-glyph * { animation: none !important; }');
  });
});

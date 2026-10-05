import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Color = [number, number, number];

function tokenValue(source: string, selector: string, name: string): string {
  const rule = source.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
  const value = rule?.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing ${name} in ${selector}`);
  return value;
}

function ruleDeclaration(source: string, selector: RegExp, name: string): string {
  const rule = source.match(selector)?.[1];
  const value = rule?.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing ${name} in ${selector}`);
  return value;
}

function parseColor(value: string): { color: Color; alpha: number } {
  const hex = value.match(/^#([a-f\d]{6})$/i)?.[1];
  if (hex) {
    return {
      color: [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as Color,
      alpha: 1,
    };
  }

  const rgb = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)%\)$/);
  if (!rgb) throw new Error(`Unsupported color token: ${value}`);
  return {
    color: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
    alpha: Number(rgb[4]) / 100,
  };
}

function composite(foreground: Color, alpha: number, background: Color): Color {
  const [red, green, blue] = foreground.map(
    (channel, index) => channel * alpha + background[index]! * (1 - alpha),
  ) as Color;
  return [red, green, blue];
}

function luminance([red, green, blue]: Color): number {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [redLinear, greenLinear, blueLinear] = linear as Color;
  return redLinear * 0.2126 + greenLinear * 0.7152 + blueLinear * 0.0722;
}

function contrast(first: Color, second: Color): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('shared glass tokens', () => {
  it('keeps text, muted text, and icon contrast on glass surfaces in both appearances', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const appSource = readFileSync('src/App.tsx', 'utf8');
    const appearances = [
      { selector: ':root' },
      { selector: ':root\\[data-theme="dark"\\]' },
    ];
    const shellIconColor = ruleDeclaration(
      source,
      /\.rail-button, \.rail-link, \.sidebar-close, \.topbar-icon-button\s*\{([^}]*)\}/,
      'color',
    );
    const sidebarTextColor = ruleDeclaration(
      source,
      /\.sidebar-link\s*\{([^}]*)\}/,
      'color',
    );
    const topbarTextColor = ruleDeclaration(
      source,
      /\.topbar-context\s*\{([^}]*)\}/,
      'color',
    );

    expect(shellIconColor).toBe('var(--text-muted)');
    expect(sidebarTextColor).toBe('var(--text-muted)');
    expect(topbarTextColor).toBe('var(--text-muted)');
    expect(appSource).toContain("stroke: 'currentColor'");

    for (const { selector } of appearances) {
      const text = parseColor(tokenValue(source, selector, '--text'));
      const mutedText = parseColor(tokenValue(source, selector, '--text-muted'));
      const icon = parseColor(tokenValue(source, selector, shellIconColor.slice(4, -1)));
      const focus = parseColor(tokenValue(source, selector, '--focus'));

      for (const surfaceName of ['--surface-translucent', '--surface-muted']) {
        const surface = parseColor(tokenValue(source, selector, surfaceName));
        expect(surface.alpha).toBeGreaterThanOrEqual(0.88);
        for (const backdrop of [[0, 0, 0], [255, 255, 255]] as Color[]) {
          const renderedSurface = composite(surface.color, surface.alpha, backdrop);
          expect(contrast(text.color, renderedSurface)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(mutedText.color, renderedSurface)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(icon.color, renderedSurface)).toBeGreaterThanOrEqual(3);
          expect(contrast(focus.color, renderedSurface)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('keeps rendered conversation paragraphs on the primary text role', () => {
    const source = readFileSync('src/ConversationHistory.css', 'utf8');

    expect(ruleDeclaration(source, /\.markdown-content p\s*\{([^}]*)\}/, 'color')).toBe('inherit');
  });

  it('uses the accepted sans typography for shared headings', () => {
    const source = readFileSync('src/styles.css', 'utf8');

    expect(tokenValue(source, ':root', '--font-heading')).toBe('var(--font-body)');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Color = [number, number, number];

function tokenValue(source: string, selector: string, name: string): string {
  const rule = source.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
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
  it('keeps text and focus contrast over both bright and dark scene areas', () => {
    const source = readFileSync('src/styles.css', 'utf8');
    const appearances = [
      { selector: ':root', background: [0, 0, 0] as Color },
      { selector: ':root\\[data-theme="dark"\\]', background: [255, 255, 255] as Color },
    ];

    for (const { selector, background } of appearances) {
      const surface = parseColor(tokenValue(source, selector, '--surface-translucent'));
      const text = parseColor(tokenValue(source, selector, '--text'));
      const mutedText = parseColor(tokenValue(source, selector, '--text-muted'));
      const focus = parseColor(tokenValue(source, selector, '--focus'));
      const renderedSurface = composite(surface.color, surface.alpha, background);

      expect(surface.alpha).toBeGreaterThanOrEqual(0.88);
      expect(contrast(text.color, renderedSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mutedText.color, renderedSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(focus.color, renderedSurface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses the accepted sans typography for shared headings', () => {
    const source = readFileSync('src/styles.css', 'utf8');

    expect(tokenValue(source, ':root', '--font-heading')).toBe('var(--font-body)');
  });
});

import { describe, expect, it } from 'vitest';
import { layoutOrder, layoutWindows, type WindowPlacement } from './window-layout';

const wide = { width: 1600, height: 900 };
const narrow = { width: 600, height: 700 };
const ids = (count: number) => Array.from({ length: count }, (_, index) => `w${index + 1}`);
const layout = (count: number, size = wide, placements: Record<string, WindowPlacement> = {}, kind: 'auto' | 'cascade' | 'grid' | 'side-by-side' = 'auto') =>
  layoutWindows({ ids: ids(count), placements, layout: kind, size });

describe('window layout', () => {
  it('fits one large centred window, two side by side, three as one big plus two, four as a grid', () => {
    const one = layout(1);
    expect(one.w1!.x).toBeCloseTo(0.13, 2);
    expect(one.w1!.width).toBeCloseTo(0.74, 2);

    const two = layout(2);
    expect(two.w1!.x).toBe(0);
    expect(two.w2!.x).toBeGreaterThan(0.5);
    expect(two.w1!.height).toBe(1);

    const three = layout(3);
    expect(three.w1!.width).toBeGreaterThan(0.55);
    expect(three.w2!.x).toBe(three.w3!.x);
    expect(three.w3!.y).toBeGreaterThan(0.5);

    const four = layout(4);
    expect(new Set(Object.values(four).map((value) => `${value.x},${value.y}`)).size).toBe(4);
    expect(four.w4!.x).toBeGreaterThan(0.5);
    expect(four.w4!.y).toBeGreaterThan(0.5);
  });

  it('cascades five or more, newest in front and stepped down and right, every window inside the area', () => {
    const five = layout(5);
    for (let index = 2; index <= 5; index += 1) {
      expect(five[`w${index}`]!.x).toBeGreaterThan(five[`w${index - 1}`]!.x);
      expect(five[`w${index}`]!.y).toBeGreaterThan(five[`w${index - 1}`]!.y);
    }
    for (const value of Object.values(layout(12))) {
      expect(value.x + value.width).toBeLessThanOrEqual(1.0001);
      expect(value.y + value.height).toBeLessThanOrEqual(1.0001);
    }
  });

  it('cascades instead of squeezing side-by-side windows under 480 px', () => {
    const squeezed = layout(2, { width: 900, height: 700 });
    expect(squeezed.w2!.x - squeezed.w1!.x).toBeLessThan(0.1);
    expect(layout(1, narrow).w1!.width).toBe(1);
  });

  it('checks the smaller column of the three-window smart fit against the minimum width', () => {
    const result = layout(3, { width: 1100, height: 900 });
    expect(result.w3!.x).toBeGreaterThan(result.w2!.x);
    expect(result.w3!.y).toBeGreaterThan(result.w2!.y);
    expect(result.w2!.width * 1100).toBeGreaterThanOrEqual(480);
  });

  it('uses a cascade, not a grid, when the requested side-by-side row cannot fit', () => {
    const result = layout(3, { width: 1200, height: 900 }, {}, 'side-by-side');
    expect(result.w2!.x - result.w1!.x).toBeLessThan(0.1);
    expect(result.w3!.y).toBeGreaterThan(result.w2!.y);
    const roomy = layout(4, { width: 2200, height: 900 }, {}, 'side-by-side');
    expect(Object.values(roomy).every((value) => value.y === 0 && value.height === 1 && value.width * 2200 >= 480)).toBe(true);
  });

  it('keeps crowded cascades distinct instead of wrapping windows onto identical positions', () => {
    for (const size of [wide, narrow, { width: 1200, height: 350 }]) {
      const result = Object.values(layout(20, size));
      expect(new Set(result.map((value) => `${value.x},${value.y}`)).size).toBe(20);
      result.forEach((value, index) => {
        expect(value.x + value.width).toBeLessThanOrEqual(1.001);
        expect(value.y + value.height).toBeLessThanOrEqual(1.001);
        if (index) {
          expect(value.x).toBeGreaterThanOrEqual(result[index - 1]!.x);
          expect(value.y).toBeGreaterThan(result[index - 1]!.y);
        }
      });
    }
  });

  it('keeps region windows in their region and fits auto windows into the rest, leaving manual windows out', () => {
    const result = layout(3, wide, { w1: { mode: 'region', region: 'right' }, w3: { mode: 'manual' } });
    expect(result.w1).toEqual({ x: 0.506, y: 0, width: 0.494, height: 1 });
    expect(result.w2!.x).toBe(0);
    expect(result.w2!.x + result.w2!.width).toBeLessThanOrEqual(0.5);
    expect(result.w3).toBeUndefined();
  });

  it('arranges named windows first in the order given', () => {
    expect(layoutOrder(['a', 'b', 'c'], ['c', 'a', 'x', 'c'])).toEqual(['c', 'a', 'b']);
    const sideBySide = layoutWindows({ ids: layoutOrder(['mancity', 'ignite'], ['ignite', 'mancity']), placements: {}, layout: 'side-by-side', size: wide });
    expect(sideBySide.ignite!.x).toBe(0);
    expect(sideBySide.mancity!.x).toBeGreaterThan(0.5);
  });
});

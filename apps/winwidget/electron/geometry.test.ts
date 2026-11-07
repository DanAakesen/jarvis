// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dockBounds, fitBounds, resizeBounds, snapBounds } from './geometry.js';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const bounds = { x: 700, y: 300, width: 352, height: 360 };

describe('native window edge geometry', () => {
  it('snaps at the inclusive 24 DIP threshold on either edge', () => {
    expect(snapBounds({ ...bounds, x: 24 }, area).x).toBe(0);
    expect(snapBounds({ ...bounds, x: 25 }, area).x).toBe(25);
    expect(snapBounds({ ...bounds, x: 1544 }, area).x).toBe(1568);
    expect(snapBounds({ ...bounds, x: 1543 }, area).x).toBe(1543);
  });
  it('leaves a floating window alone until it reaches an edge', () => {
    expect(snapBounds(bounds, area)).toEqual(bounds);
  });
  it('honors negative monitor coordinates and a top/left taskbar', () => {
    const second = { x: -1880, y: -500, width: 1880, height: 1000 };
    expect(dockBounds({ ...bounds, y: -700 }, second, 'left')).toEqual({ ...bounds, x: -1880, y: -500 });
    expect(dockBounds({ ...bounds, y: 800 }, second, 'right')).toEqual({ ...bounds, x: -352, y: 140 });
  });
  it('clamps offscreen windows after monitor removal without covering the taskbar', () => {
    expect(snapBounds({ ...bounds, x: 3000, y: 1500 }, area)).toEqual({ ...bounds, x: 1568, y: 680 });
    expect(snapBounds({ ...bounds, x: -500, y: -100 }, area)).toEqual({ ...bounds, x: 0, y: 0 });
  });
  it('keeps the right screen edge anchored through repeated expand/collapse', () => {
    const docked = dockBounds(bounds, area, 'right');
    const collapsed = resizeBounds(docked, area, false);
    expect(collapsed).toEqual({ ...docked, x: 1848, width: 72 });
    expect(resizeBounds(collapsed, area, true)).toEqual(docked);
    expect(resizeBounds(resizeBounds(docked, area, true), area, true)).toEqual(docked);
  });
  it('retains left and floating anchors, and fits unusually small work areas', () => {
    expect(resizeBounds(bounds, area, false).x).toBe(bounds.x);
    const tiny = { x: 30, y: 40, width: 280, height: 300 };
    expect(fitBounds(bounds, tiny)).toEqual(tiny);
    expect(resizeBounds(bounds, tiny, true)).toEqual(tiny);
  });
  it('uses DIP geometry on fractional-scale displays without pixel conversion', () => {
    const scaled = { x: 1536, y: 0, width: 1280, height: 680 };
    expect(dockBounds(bounds, scaled, 'right')).toEqual({ ...bounds, x: 2464 });
  });
});

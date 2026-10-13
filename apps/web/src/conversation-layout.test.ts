import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationLayoutKey, fitConversationLayout, readConversationLayout, resizeConversationLayout, saveConversationLayout } from './conversation-layout';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(conversationLayoutKey);
});

describe('conversation layout', () => {
  const rect = { x: .2, y: .3, width: .6, height: .5 };
  const size = { width: 1000, height: 800 };
  it('round trips only device-local geometry', () => {
    expect(readConversationLayout()).toEqual({ layout: null, error: '' });
    expect(saveConversationLayout(rect)).toBe('');
    expect(readConversationLayout()).toEqual({ layout: rect, error: '' });
    expect(Object.keys(JSON.parse(localStorage.getItem(conversationLayoutKey)!))).toEqual(['x', 'y', 'width', 'height']);
  });
  it.each(['{', 'null', '{"x":0,"y":0,"width":0,"height":1}', '{"x":0.9,"y":0,"width":0.8,"height":0.5}', '{"x":"0","y":0,"width":0.5,"height":0.5}'])('reports invalid saved geometry %s', value => {
    localStorage.setItem(conversationLayoutKey, value);
    expect(readConversationLayout().layout).toBeNull();
    expect(readConversationLayout().error).toContain('could not be read');
  });
  it('reports unavailable storage without blocking the window', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(readConversationLayout().error).toContain('could not be read');
    expect(saveConversationLayout(rect)).toContain('could not be saved');
  });
  it('fits a saved layout to a smaller viewport without mutating it', () => {
    const small = fitConversationLayout(rect, { width: 350, height: 200 });
    expect(small.width).toBeCloseTo(320 / 350);
    expect(small.height).toBe(.8);
    expect(small.x + small.width).toBeLessThanOrEqual(1);
    expect(small.y + small.height).toBeLessThanOrEqual(1);
    expect(rect).toEqual({ x: .2, y: .3, width: .6, height: .5 });
  });
  it('keeps preferred pixels stable when composer wrapping changes the canvas height', () => {
    expect(saveConversationLayout(rect, size)).toBe('');
    const stored = readConversationLayout();
    expect(stored.size).toEqual(size);
    const resizedCanvas = { width: 1000, height: 784 };
    const fitted = fitConversationLayout(rect, resizedCanvas, size);
    expect(fitted.y * resizedCanvas.height).toBeCloseTo(rect.y * size.height);
    expect(fitted.height * resizedCanvas.height).toBeCloseTo(rect.height * size.height);
    expect(fitted.width * resizedCanvas.width).toBeCloseTo(rect.width * size.width);
  });
  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('keeps the opposite corner fixed when resizing %s', edge => {
    const resized = resizeConversationLayout(rect, .05, -.1, edge, size);
    if (edge.endsWith('left')) expect(resized.x + resized.width).toBeCloseTo(rect.x + rect.width);
    else expect(resized.x).toBe(rect.x);
    if (edge.startsWith('top')) expect(resized.y + resized.height).toBeCloseTo(rect.y + rect.height);
    else expect(resized.y).toBe(rect.y);
  });
  it('bounds all corners to the workspace and usable minimums', () => {
    for (const edge of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      for (const delta of [-10, 10]) {
        const resized = resizeConversationLayout(rect, delta, delta, edge, size);
        expect(resized.x).toBeGreaterThanOrEqual(0);
        expect(resized.y).toBeGreaterThanOrEqual(0);
        expect(resized.width).toBeGreaterThanOrEqual(.32);
        expect(resized.height).toBeGreaterThanOrEqual(.2);
        expect(resized.x + resized.width).toBeLessThanOrEqual(1.000001);
        expect(resized.y + resized.height).toBeLessThanOrEqual(1.000001);
      }
    }
  });
  it.each(['top', 'right', 'bottom', 'left'] as const)('resizes only the intended axis at the %s border', edge => {
    const resized = resizeConversationLayout(rect, .05, -.1, edge, size);
    if (edge === 'top' || edge === 'bottom') {
      expect(resized.x).toBe(rect.x);
      expect(resized.width).toBe(rect.width);
      expect(resized.height).not.toBe(rect.height);
    } else {
      expect(resized.y).toBe(rect.y);
      expect(resized.height).toBe(rect.height);
      expect(resized.width).not.toBe(rect.width);
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { returnFocusAfterOutsidePress } from './overlay-focus';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('outside-press focus return', () => {
  it.each(['body', 'main'])('restores focus after a plain %s background press blurs the trigger', (background) => {
    vi.useFakeTimers();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    returnFocusAfterOutsidePress(trigger);
    expect(document.activeElement).toBe(trigger);
    trigger.blur();
    if (background === 'main') {
      const main = document.createElement('main');
      main.tabIndex = -1;
      document.body.append(main);
      main.focus();
    }
    vi.runAllTimers();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus from the control deliberately pressed next', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button');
    const next = document.createElement('input');
    document.body.append(trigger, next);
    returnFocusAfterOutsidePress(trigger);
    next.focus();
    vi.runAllTimers();
    expect(document.activeElement).toBe(next);
  });

  it('ignores triggers that disappear during dismissal', () => {
    vi.useFakeTimers();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    returnFocusAfterOutsidePress(trigger);
    trigger.remove();
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
    returnFocusAfterOutsidePress(null);
  });
});

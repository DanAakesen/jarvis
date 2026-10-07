import { afterEach, describe, expect, it, vi } from 'vitest';
import { flyWindowAway } from './window-fly-away';

function windowElement() {
  const element = document.createElement('article');
  element.id = 'view-1';
  element.innerHTML = '<h3 id="title-1">Notes</h3><iframe title="App"></iframe><p>Body</p>';
  element.getBoundingClientRect = () => ({ left: 100, top: 200, right: 500, bottom: 500, width: 400, height: 300, x: 100, y: 200, toJSON: () => ({}) });
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('flyWindowAway', () => {
  it('animates an inert copy toward the top right and removes it when finished', async () => {
    let finish!: () => void;
    const animate = vi.fn(() => ({ finished: new Promise<void>((resolve) => { finish = resolve; }) }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    const element = windowElement();

    flyWindowAway(element);

    const ghost = document.querySelector<HTMLElement>('.workspace-window-ghost')!;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.inert).toBe(true);
    expect(ghost.querySelector('iframe')).toBeNull();
    expect(ghost.querySelector('[id]')).toBeNull();
    expect(ghost.style.position).toBe('fixed');
    const frames = (animate.mock.calls[0] as unknown as [Keyframe[]])[0];
    expect(String(frames.at(-1)!.transform)).toMatch(/translate\(\d+(\.\d+)?px, -\d+(\.\d+)?px\) scale\(\.12\)/);
    expect(element.isConnected).toBe(true);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.workspace-window-ghost')).toBeNull();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  it('does nothing without animation support or for a hidden window', () => {
    const element = windowElement();
    flyWindowAway(element);
    expect(document.querySelector('.workspace-window-ghost')).toBeNull();

    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn() });
    element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    flyWindowAway(element);
    expect(document.querySelector('.workspace-window-ghost')).toBeNull();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });
});

import { useRef, type CSSProperties } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayMotion } from './overlay-motion';

const pending: (() => void)[] = [];
const cancel = vi.fn();
const animate = vi.fn(() => ({
  cancel,
  finished: new Promise<void>((resolve) => { pending.push(resolve); }),
}));
function Overlay({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const motionRef = useOverlayMotion(ref, 'menu');
  return open && <div ref={motionRef} id="synthetic-overlay" style={{ '--motion-state': '260ms', '--ease-enter': 'ease-out' } as CSSProperties}>
    <h2 id="synthetic-title">Synthetic overlay</h2><iframe title="Synthetic embed" />
  </div>;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100, toJSON: () => ({}) });
});
afterEach(async () => {
  cleanup();
  pending.splice(0).forEach((finish) => finish());
  await Promise.resolve();
  delete document.documentElement.dataset.motion;
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('overlay exit motion', () => {
  it('exits with token timing without retaining focusable content or duplicate IDs', async () => {
    const view = render(<Overlay open />);
    view.rerender(<Overlay open={false} />);
    const ghost = document.querySelector<HTMLElement>('[data-overlay-exit]')!;
    expect(ghost.inert).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelector('[id], iframe')).toBeNull();
    expect(ghost.id).toBe('');
    expect(ghost.style.pointerEvents).toBe('none');
    expect(ghost.style.zIndex).toBe('var(--z-menu)');
    expect(animate).toHaveBeenCalledWith([{ opacity: '1' }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    await act(async () => { pending.splice(0).forEach((finish) => finish()); });
    expect(ghost.isConnected).toBe(false);
  });

  it('cancels an interrupted exit when the same overlay reopens', () => {
    const view = render(<Overlay open />);
    view.rerender(<Overlay open={false} />);
    expect(document.querySelector('[data-overlay-exit]')).not.toBeNull();
    view.rerender(<Overlay open />);
    expect(cancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-overlay-exit]')).toBeNull();
    expect(document.querySelectorAll('#synthetic-overlay')).toHaveLength(1);
  });

  it.each(['app', 'system'])('removes exit motion with %s reduced motion', (preference) => {
    if (preference === 'app') document.documentElement.dataset.motion = 'reduced';
    else vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const view = render(<Overlay open />);
    view.rerender(<Overlay open={false} />);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-overlay-exit]')).toBeNull();
  });
});

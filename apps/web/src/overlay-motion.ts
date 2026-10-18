import { useCallback, type RefObject } from 'react';
import { createGhost } from './window-fly-away';

const exits = new Map<string, { ghost: HTMLElement; animation: Animation }>();

/** Visual-only exits reuse window ghosts; actions and focus never wait for motion. */
export function useOverlayMotion(ref: RefObject<HTMLElement | null>, layer: 'menu' | 'modal-backdrop') {
  return useCallback((element: HTMLElement | null) => {
    const source = element ?? ref.current;
    if (!source) return;
    const key = source.id || source.getAttribute('aria-labelledby') || source.className;
    const previous = exits.get(key);
    if (previous) {
      previous.animation.cancel();
      previous.ghost.remove();
      exits.delete(key);
    }
    if (element) {
      ref.current = element;
      return;
    }
    ref.current = null;
    if (document.documentElement.dataset.motion === 'reduced'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || typeof source.animate !== 'function') return;
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const style = getComputedStyle(source);
    const durationToken = style.getPropertyValue('--motion-state').trim();
    const duration = parseFloat(durationToken) * (durationToken.endsWith('ms') ? 1 : 1000);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const ghost = createGhost(source, rect);
    ghost.style.zIndex = `var(--z-${layer})`;
    ghost.dataset.overlayExit = '';
    ghost.classList.add('overlay-exit-ghost');
    const animation = ghost.animate([{ opacity: style.opacity || '1' }, { opacity: 0 }], {
      duration, easing: style.getPropertyValue('--ease-enter').trim() || 'ease-out',
    });
    const exit = { ghost, animation };
    exits.set(key, exit);
    const remove = () => {
      ghost.remove();
      if (exits.get(key) === exit) exits.delete(key);
    };
    void animation.finished.then(remove, remove);
  }, [layer, ref]);
}

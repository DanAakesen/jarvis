import { useEffect } from 'react';

const litSurfaces = [
  '.workspace-window', '.kanban-card', '.kanban-column', '.settings-section', '.settings-activity .panel',
  '.area-sidebar', '.context-panel', '.app-topbar', '.area-rail', '.conversation-input.luminous-glass', '.task-release-bar',
].join(', ');

/** Glass surfaces catch a soft light where the pointer is; only the innermost surface under the pointer is lit. */
export function useGlassLight() {
  useEffect(() => {
    if (typeof window.requestAnimationFrame !== 'function') return undefined;
    let lit: HTMLElement | null = null;
    let frame = 0;
    let latest: PointerEvent | null = null;
    const clear = () => {
      lit?.removeAttribute('data-lit');
      lit = null;
    };
    const update = () => {
      frame = 0;
      const event = latest;
      if (!event) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(litSurfaces) : null;
      if (lit !== target) clear();
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      target.style.setProperty('--light-x', `${Math.round(event.clientX - bounds.left)}px`);
      target.style.setProperty('--light-y', `${Math.round(event.clientY - bounds.top)}px`);
      target.setAttribute('data-lit', '');
      lit = target;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      latest = event;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const leave = () => {
      latest = null;
      clear();
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
      clear();
    };
  }, []);
}

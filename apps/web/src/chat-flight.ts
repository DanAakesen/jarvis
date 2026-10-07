const flightMs = 520;

/**
 * Visual-only flight between the chat bar (or its docked conversation sheet) and the rail orb. `in` shrinks the
 * element into the orb along a slight arc; `out` springs it back from the orb to its own place. Layout never
 * changes: CSS hides the docked bar after the flight, so the element's resting rectangle is always measurable.
 */
export function flyChat(element: HTMLElement | null, orb: HTMLElement | null, direction: 'in' | 'out') {
  if (!element || !orb || typeof element.animate !== 'function') return;
  const from = element.getBoundingClientRect();
  const to = orb.getBoundingClientRect();
  if (from.width < 1 || from.height < 1 || to.width < 1) return;
  const reduced = (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
    document.documentElement.dataset.motion === 'reduced';
  if (reduced) {
    element.animate(direction === 'in' ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: 160, easing: 'ease-out' });
    return;
  }
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scaleX = Math.max(0.02, to.width / from.width);
  const scaleY = Math.max(0.02, to.height / from.height);
  const docked = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
  const arc = `translate(${dx * 0.45}px, ${dy * 0.25 - 40}px) scale(${Math.max(scaleX, 0.3)}, ${Math.max(scaleY, 0.75)})`;
  const frames = [
    { transform: 'none', opacity: 1, offset: 0 },
    { transform: arc, opacity: 0.9, offset: 0.5 },
    { transform: docked, opacity: 0, offset: 1 },
  ];
  element.animate(direction === 'in' ? frames : [...frames].reverse().map((frame, index) => ({ ...frame, offset: index / 2 })), {
    duration: flightMs,
    easing: direction === 'in' ? 'cubic-bezier(.55, 0, .35, 1)' : 'cubic-bezier(.2, .9, .3, 1.08)',
  });
}

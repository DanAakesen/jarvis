/**
 * Visual-only exit for a closing workspace window: a copy dips as if minimising, then flies off the top-right
 * corner. The real window is removed immediately, so commands, focus and snapshots never wait for the animation.
 */
const prefersReducedMotion = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

/** An inert, fixed-position copy of a window at its current place, used only for exit animations. */
function createGhost(element: HTMLElement, rect: DOMRect) {
  const ghost = element.cloneNode(true) as HTMLElement;
  // Live media and embedded documents would restart inside the copy; the exit only needs the surface.
  ghost.querySelectorAll('iframe, video, audio, canvas').forEach((node) => node.remove());
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.removeAttribute('id');
  ghost.removeAttribute('aria-labelledby');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('workspace-window-ghost');
  Object.assign(ghost.style, {
    position: 'fixed',
    inset: 'auto',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    zIndex: '2000',
    pointerEvents: 'none',
    translate: 'none',
    scale: 'none',
    transform: 'none',
    transition: 'none',
  });
  document.body.appendChild(ghost);
  // Keep the reader's place in scrolled content for the length of the exit.
  const sources = element.querySelectorAll<HTMLElement>('*');
  const copies = ghost.querySelectorAll<HTMLElement>('*');
  sources.forEach((source, index) => {
    if (source.scrollTop && copies[index]) copies[index].scrollTop = source.scrollTop;
  });
  return ghost;
}

export function flyWindowAway(element: HTMLElement | undefined) {
  if (!element || typeof element.animate !== 'function') return;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const reduced = prefersReducedMotion();
  const ghost = createGhost(element, rect);

  const remove = () => ghost.remove();
  if (reduced) {
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' }).finished.then(remove, remove);
    return;
  }
  const dx = window.innerWidth + 80 - (rect.left + rect.width / 2);
  const dy = -80 - (rect.top + rect.height / 2);
  ghost.animate([
    { transform: 'none', opacity: 1, offset: 0 },
    { transform: 'translate(0, 10px) scale(.9)', opacity: 1, offset: .28 },
    { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0, offset: 1 },
  ], { duration: 560, easing: 'cubic-bezier(.5, 0, .75, .25)' }).finished.then(remove, remove);
}

/**
 * Visual-only minimise: a copy of the window shrinks and is thrown up into its new tab in the tab bar, which then
 * lands with a small glow. The tab is looked up after React has rendered it; without one the copy simply fades.
 */
export function flyWindowToTab(element: HTMLElement | undefined, findTab: () => Element | null) {
  if (!element || typeof element.animate !== 'function') return;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const ghost = createGhost(element, rect);
  ghost.style.transformOrigin = '0 0';
  const remove = () => ghost.remove();
  const land = (tab: Element | null) => {
    if (tab instanceof HTMLElement && typeof tab.animate === 'function' && !prefersReducedMotion()) {
      tab.animate([
        { scale: '1.12', boxShadow: '0 0 0 1px var(--glass-glow-warm), 0 0 22px var(--glass-glow-warm)' },
        { scale: '1', boxShadow: 'none' },
      ], { duration: 520, easing: 'cubic-bezier(.2, .9, .3, 1)' });
    }
  };
  requestAnimationFrame(() => {
    const tab = findTab();
    const target = tab?.getBoundingClientRect();
    if (prefersReducedMotion() || !target || target.width < 1) {
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' }).finished.then(remove, remove);
      land(tab ?? null);
      return;
    }
    const scaleX = target.width / rect.width;
    const scaleY = target.height / rect.height;
    const dx = target.left - rect.left;
    const dy = target.top - rect.top;
    ghost.animate([
      { transform: 'none', opacity: 1, borderRadius: '22px', offset: 0 },
      { transform: `translate(${dx * .25}px, ${dy * .1 + 12}px) scale(.82)`, opacity: 1, offset: .3 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`, opacity: .15, borderRadius: '999px', offset: 1 },
    ], { duration: 520, easing: 'cubic-bezier(.55, 0, .3, 1)' }).finished.then(() => { remove(); land(findTab()); }, remove);
  });
}
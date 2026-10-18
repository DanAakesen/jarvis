import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const focusSelector = 'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"], summary';
const layers: { element: HTMLElement; boundary: HTMLElement }[] = [];
const inertElements = new Map<HTMLElement, boolean>();
let unlockScroll: (() => void) | undefined;

function available(element: HTMLElement) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]') || element.matches(':disabled, input[type="hidden"]')) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function controls(element: HTMLElement) {
  return [...element.querySelectorAll<HTMLElement>(focusSelector)].filter((control) => control.tabIndex >= 0 && available(control));
}

function syncInert() {
  for (const [element, inert] of inertElements) element.toggleAttribute('inert', inert);
  inertElements.clear();
  const top = layers.at(-1);
  if (!top) return;
  for (let current = top.boundary; current.parentElement; current = current.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current || !(sibling instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
      inertElements.set(sibling, sibling.hasAttribute('inert'));
      sibling.setAttribute('inert', '');
    }
    if (current.parentElement === document.body) break;
  }
}

function lockScroll() {
  const body = document.body;
  const overflow = body.style.overflow;
  const padding = body.style.paddingRight;
  const gutter = document.documentElement.clientWidth > 0 ? window.innerWidth - document.documentElement.clientWidth : 0;
  body.style.overflow = 'hidden';
  if (gutter > 0) body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + gutter}px`;
  return () => { body.style.overflow = overflow; body.style.paddingRight = padding; };
}

export function isTopModal(element: HTMLElement | null) {
  return layers.at(-1)?.element === element;
}

/** Modal-only lifecycle; nonmodal menus retain their own keyboard and pointer behavior. */
export function useModalLifecycle({
  active = true, dialog, boundary = dialog, onDismiss,
}: {
  active?: boolean;
  dialog: RefObject<HTMLElement | null>;
  boundary?: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const dismiss = useRef(onDismiss);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const initialFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const element = dialog.current;
    if (!active || !element) return;
    const previous = element.contains(document.activeElement) ? initialFocus.current
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = { element, boundary: boundary.current ?? element };
    if (layers.length === 0) unlockScroll = lockScroll();
    layers.push(layer);
    syncInert();
    const focusInside = () => {
      const autofocus = [...element.querySelectorAll<HTMLElement>('[autofocus]')].find(available);
      (autofocus ?? controls(element)[0] ?? element).focus({ preventScroll: true });
    };
    if (!element.contains(document.activeElement)) focusInside();
    const onKey = (event: KeyboardEvent) => {
      if (!isTopModal(element) || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
      } else if (event.key === 'Tab') {
        const items = controls(element);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (items.length === 0 || index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) ?? element : items[0] ?? element).focus({ preventScroll: true });
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTopModal(element) && !element.contains(event.target as Node)) focusInside();
    };
    keyHandler.current = onKey;
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport) return;
      element.style.setProperty('--modal-viewport-height', `${viewport.height}px`);
      element.style.setProperty('--modal-viewport-top', `${viewport.offsetTop}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      keyHandler.current = () => {};
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      element.style.removeProperty('--modal-viewport-height');
      element.style.removeProperty('--modal-viewport-top');
      const wasTop = isTopModal(element);
      layers.splice(layers.indexOf(layer), 1);
      syncInert();
      if (layers.length === 0) { unlockScroll?.(); unlockScroll = undefined; }
      if (wasTop) {
        const parent = layers.at(-1)?.element;
        const target = previous?.isConnected && available(previous) ? previous
          : parent ? controls(parent)[0] ?? parent : null;
        target?.focus({ preventScroll: true });
      }
    };
  }, [active, boundary, dialog]);
  return {
    onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
      if (event.defaultPrevented) return;
      keyHandler.current(event.nativeEvent);
      if (event.nativeEvent.defaultPrevented) event.stopPropagation();
    },
  };
}

import { useCallback, useEffect, useState, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

type Tip = { label: string; top: number; left: number; open: boolean };

const closedTip: Tip = { label: '', top: 0, left: 0, open: false };
const onRail = '[data-rail-tip], .rail-tip';

function stillOnRail(target: EventTarget | null) {
  return target instanceof Element && target.closest(onRail) !== null;
}

function itemOf(target: EventTarget | null) {
  return target instanceof Element ? target.closest('[data-rail-tip]') : null;
}

function focusVisible(element: Element) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * A flat name label beside a rail control, shown on pointer hover and keyboard focus.
 * It is rendered outside the rail so the rail's 3D tilt and glass never skew or clip it.
 * The label repeats the control's accessible name, so it stays hidden from assistive technology.
 */
export function useRailTip() {
  const [tip, setTip] = useState(closedTip);

  const hide = useCallback(() => {
    setTip((current) => (current.open ? { ...current, open: false } : current));
  }, []);

  const show = useCallback((item: Element) => {
    const label = item.getAttribute('data-rail-tip');
    if (!label) return;
    const box = item.getBoundingClientRect();
    const next = { label, top: Math.round(box.top + box.height / 2), left: Math.round(box.right), open: true };
    setTip((current) => (current.open && current.label === next.label && current.top === next.top && current.left === next.left ? current : next));
  }, []);

  useEffect(() => {
    if (!tip.open) return undefined;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('keydown', dismiss);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('resize', hide);
    };
  }, [tip.open, hide]);

  const railTipProps = {
    onPointerOver: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      const item = itemOf(event.target);
      if (item) show(item);
    },
    onPointerOut: (event: PointerEvent<HTMLElement>) => {
      if (!stillOnRail(event.relatedTarget)) hide();
    },
    onPointerDown: hide,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const item = itemOf(event.target);
      if (!item) return;
      if (focusVisible(item)) show(item);
      else hide();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!stillOnRail(event.relatedTarget)) hide();
    },
  };

  // Always mounted so the label can fade out; the pointer may travel onto it without it closing.
  const railTip = createPortal(
    <div
      className="rail-tip"
      aria-hidden="true"
      data-open={tip.open}
      style={{ top: tip.top, left: tip.left }}
      onPointerLeave={(event) => { if (!stillOnRail(event.relatedTarget)) hide(); }}
    >
      {tip.label}
    </div>,
    document.body,
  );

  return { railTipProps, railTip };
}

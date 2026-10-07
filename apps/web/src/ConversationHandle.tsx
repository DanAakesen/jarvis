import { useRef, type PointerEvent } from 'react';
import type { ConversationWindowHost } from './conversation-window-state';
import { flyWindowAway } from './window-fly-away';

const openDistance = 24;
const dismissDistance = 64;

/** The grab handle on the composer: click, keys, or a vertical drag show and hide the docked conversation window. */
export function ConversationHandle({ host }: { host: ConversationWindowHost }) {
  const gesture = useRef<{ id: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  function dockedWindow() {
    return document.querySelector<HTMLElement>('.workspace-window-conversation');
  }

  function setDrag(offset: number) {
    const element = dockedWindow();
    if (!element) return;
    if (offset === 0) element.style.removeProperty('--sheet-drag');
    else element.style.setProperty('--sheet-drag', `${offset}px`);
    element.toggleAttribute('data-sheet-dragging', offset !== 0);
  }

  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    gesture.current = { id: event.pointerId, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const offset = event.clientY - current.startY;
    if (Math.abs(offset) > 4) current.moved = true;
    // An open window follows the pointer down; dragging up from closed only needs to pass the threshold.
    if (host.open) setDrag(Math.max(0, offset));
  }

  function hide() {
    // Hiding by handle leaves the same way as Close: the window flies off to the top right.
    const element = dockedWindow();
    if (element) {
      flyWindowAway(element);
      element.setAttribute('data-sheet-dragging', '');
      requestAnimationFrame(() => requestAnimationFrame(() => element.removeAttribute('data-sheet-dragging')));
    }
    host.setOpen(false);
    element?.style.removeProperty('--sheet-drag');
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    const offset = event.clientY - current.startY;
    if (current.moved && host.open && offset > dismissDistance) {
      suppressClick.current = true;
      hide();
      return;
    }
    setDrag(0);
    if (!current.moved) return;
    suppressClick.current = true;
    if (!host.open && offset < -openDistance) host.setOpen(true);
  }

  function cancel() {
    gesture.current = null;
    setDrag(0);
  }

  return (
    <button
      className="conversation-handle"
      type="button"
      aria-label={host.open ? 'Hide conversation' : 'Show conversation'}
      aria-expanded={host.open}
      title={host.open ? 'Hide conversation (drag down)' : 'Show conversation (drag up)'}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (host.open) hide();
        else host.setOpen(true);
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

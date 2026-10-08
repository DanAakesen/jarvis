import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * One modal for the app: rendered at the document root (so page transforms never move it), near the top of the
 * viewport, with a close button, Escape, a click outside to close, a focus trap, and focus returned on close.
 * `busy` blocks every way of closing while an action is in flight.
 */
export function Modal({ title, titleId, onClose, busy = false, className, children }: {
  title: string;
  titleId: string;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const pressStartedOutside = useRef(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.contains(document.activeElement)) {
      const autofocus = element.querySelector<HTMLElement>('[autofocus]');
      (autofocus ?? element).focus({ preventScroll: true });
    }
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  const close = () => { if (!busy) onClose(); };

  return createPortal(
    <div className="modal-backdrop"
      onPointerDown={(event) => { pressStartedOutside.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        // Only a press that starts and ends on the backdrop closes, so selecting text never dismisses the modal.
        if (event.target === event.currentTarget && pressStartedOutside.current) close();
        pressStartedOutside.current = false;
      }}>
      <section
        ref={dialog}
        className={`modal luminous-glass${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-close" type="button" aria-label={`Close ${title}`} title="Close" onClick={close} disabled={busy}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

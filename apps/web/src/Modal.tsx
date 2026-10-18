import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isTopModal, useModalLifecycle } from './useModalLifecycle';

/**
 * One modal for the app: rendered at the document root (so page transforms never move it), near the top of the
 * viewport, with a close button, Escape, a click outside to close, a focus trap, and focus returned on close.
 * `busy` blocks every way of closing while an action is in flight.
 */
export function Modal({ title, titleId, onClose, busy = false, dirty = false, className, children, footer }: {
  title: string;
  titleId: string;
  onClose: () => void;
  busy?: boolean;
  dirty?: boolean;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const pressStartedOutside = useRef(false);
  const edited = useRef(false);
  const close = () => { if (!busy) onClose(); };
  const dismiss = () => { if (!dirty && !edited.current && isTopModal(dialog.current)) close(); };
  const { onKeyDown } = useModalLifecycle({ dialog, boundary: backdrop, onDismiss: dismiss });

  return createPortal(
    <div ref={backdrop} className="modal-backdrop"
      onPointerDown={(event) => { pressStartedOutside.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        // Only a press that starts and ends on the backdrop closes, so selecting text never dismisses the modal.
        if (event.target === event.currentTarget && pressStartedOutside.current) dismiss();
        pressStartedOutside.current = false;
      }}>
      <section
        ref={dialog}
        className={`modal luminous-glass${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onChangeCapture={() => { edited.current = true; }}
        onInputCapture={() => { edited.current = true; }}
      >
        <header className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-close" type="button" aria-label={`Close ${title}`} title="Close" onClick={close} disabled={busy}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="modal-body">
          {children}
        </div>
        {footer && (
          <footer className="modal-footer">
            {footer}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

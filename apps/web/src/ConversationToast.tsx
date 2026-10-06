import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './ConversationToast.css';

export type ConversationNotification = { id: number; message: string; error: boolean };

/** Transient feedback lives outside the composer and its transformed scene ancestors. */
export function ConversationToast({ notification, onDismiss }: {
  notification: ConversationNotification;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss, paused]);

  return createPortal(
    <div className="conversation-toast luminous-glass" data-error={notification.error}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <p role={notification.error ? 'alert' : 'status'} aria-atomic="true">{notification.message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>, document.body,
  );
}

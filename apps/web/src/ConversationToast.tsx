import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ConversationToast.css';

export type ConversationNotification = { id: number; message: string; error: boolean };

/** Transient feedback lives outside the composer and its transformed scene ancestors. */
export function ConversationToast({ notification, onDismiss, voiceActive = false }: {
  notification: ConversationNotification;
  onDismiss: () => void;
  voiceActive?: boolean;
}) {
  const toast = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss, paused]);

  useLayoutEffect(() => {
    const controls = document.querySelector(voiceActive ? '.voice-bar' : '.conversation-input');
    const element = toast.current;
    if (!controls || !element) return;
    // Follow the real composer height, including multi-line drafts, and recalculate on mode changes.
    const position = () => {
      const bounds = controls.getBoundingClientRect();
      if (bounds.height > 0) element.style.bottom = `${Math.max(20, window.innerHeight - bounds.top + 12)}px`;
    };
    position();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null;
    observer?.observe(controls);
    window.addEventListener('resize', position);
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); };
  }, [voiceActive]);

  return createPortal(
    <div ref={toast} className="conversation-toast luminous-glass" data-error={notification.error}
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

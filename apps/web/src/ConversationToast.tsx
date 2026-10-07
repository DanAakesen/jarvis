import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import './ConversationToast.css';

export type ConversationNotification = { id: number; message: string; error: boolean };
export type ConversationToastAction = { label: string; onSelect: () => void };

/** One fixed stack for every toast, so several pieces of feedback never sit on top of each other. */
function toastStack(): HTMLElement {
  let stack = document.getElementById('jarvis-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'jarvis-toast-stack';
    stack.className = 'conversation-toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

// Identical messages from different sources (for example one expired sign-in seen by two loaders) show once.
const messageOwners = new Map<string, number>();
const ownerListeners = new Set<() => void>();
let nextToastId = 1;
const subscribeOwners = (listener: () => void) => {
  ownerListeners.add(listener);
  return () => { ownerListeners.delete(listener); };
};
const publishOwners = () => ownerListeners.forEach((listener) => listener());

function useMessageOwner(message: string): boolean {
  const [id] = useState(() => nextToastId++);
  const owner = useSyncExternalStore(subscribeOwners, () => messageOwners.get(message));
  useLayoutEffect(() => {
    if (!messageOwners.has(message)) {
      messageOwners.set(message, id);
      publishOwners();
    }
    return () => {
      if (messageOwners.get(message) !== id) return;
      messageOwners.delete(message);
      publishOwners();
    };
  }, [id, message]);
  return owner === undefined || owner === id;
}

/** Transient feedback lives outside the composer and its transformed scene ancestors. */
export function ConversationToast({ notification, onDismiss, voiceActive = false, action }: {
  notification: ConversationNotification;
  onDismiss: () => void;
  voiceActive?: boolean;
  action?: ConversationToastAction;
}) {
  const [stack] = useState(toastStack);
  const shown = useMessageOwner(notification.message);
  const toast = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss, paused]);

  useLayoutEffect(() => {
    const controls = document.querySelector(voiceActive ? '.voice-bar' : '.conversation-input');
    if (!controls) return;
    // Follow the real composer height, including multi-line drafts, and recalculate on mode changes.
    const position = () => {
      const bounds = controls.getBoundingClientRect();
      if (bounds.height > 0) toastStack().style.bottom = `${Math.max(20, window.innerHeight - bounds.top + 12)}px`;
    };
    position();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null;
    observer?.observe(controls);
    window.addEventListener('resize', position);
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); };
  }, [stack, voiceActive]);

  useEffect(() => () => {
    const element = document.getElementById('jarvis-toast-stack');
    if (element && !element.childElementCount) element.style.removeProperty('bottom');
  }, []);

  if (!shown) return null;
  return createPortal(
    <div ref={toast} className="conversation-toast luminous-glass" data-error={notification.error}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <p role={notification.error ? 'alert' : 'status'} aria-atomic="true">{notification.message}</p>
      {action && (
        <button className="conversation-toast-action" type="button" onClick={() => { action.onSelect(); onDismiss(); }}>
          {action.label}
        </button>
      )}
      <button className="conversation-toast-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss notification">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>, stack,
  );
}

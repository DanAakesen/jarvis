import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { presenceLabel, presenceModes, usePresence, useDevicePresence } from './presence-store';
import { StateMessage } from './StateMessage';
import { CollapsibleSection } from './CollapsibleSection';
import { ShellIcon } from './ShellIcon';
import { returnFocusAfterOutsidePress } from './overlay-focus';
import { useOverlayMotion } from './overlay-motion';
import { formatDateTime } from './format/date-time';

// Sources reported by GET /presence (P6-23): manual (Dan), jarvis (its tool) and browser (activity returns Dan to Present).
function sourceLabel(source: string) {
  return source === 'jarvis' ? 'Jarvis' : source === 'browser' ? 'browser activity' : source === 'manual' || source === 'dan' ? 'you' : source;
}

/** Top-bar presence chip: shows the live mode and switches it. Hidden until the presence service answers. */
export function PresenceChip({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const { presence, setMode } = usePresence(backendUrl, getAccessToken);
  useDevicePresence(backendUrl, getAccessToken, true);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuRef = useOverlayMotion(menu, 'menu');
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        if (root.current?.contains(document.activeElement)) returnFocusAfterOutsidePress(trigger.current);
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (presence.status !== 'ready') return null;
  const current = presenceModes.find((entry) => entry.mode === presence.mode)!;
  return (
    <div ref={root} className="presence-chip" style={{ '--tone': current.tone } as CSSProperties} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} className="presence-chip-trigger" type="button" aria-expanded={open} aria-controls={menuId}
        aria-label={`Presence: ${current.label}. Change mode`} title={`Presence: ${current.label}`} onClick={() => setOpen((value) => !value)}>
        <ShellIcon name={current.mode} />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} className="presence-menu luminous-glass" role="group" aria-label="Presence mode">
          {presenceModes.map(({ mode, label, tone }) => (
            <button key={mode} type="button" className="presence-option" aria-pressed={presence.mode === mode}
              disabled={presence.saving !== null} style={{ '--tone': tone } as CSSProperties}
              onClick={() => { void setMode(mode).then(() => { setOpen(false); trigger.current?.focus(); }); }}>
              <span className="presence-dot" aria-hidden="true" />
              <span>{presence.saving === mode ? `Switching to ${label}…` : label}</span>
            </button>
          ))}
          {presence.error && <p className="presence-error" role="alert">{presence.error}</p>}
        </div>
      )}
    </div>
  );
}

/** Presence switches remain here; all saved instruction scopes have one canonical editor. */
export function PresenceSettings({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const { presence, setMode, retry } = usePresence(backendUrl, getAccessToken);
  const ids = useId();
  return (
    <CollapsibleSection storageKey="settings.presence" className="presence-settings" id="presence" headingId={`${ids}-heading`} title="Presence"
      summary={presence.status === 'ready' ? presenceLabel(presence.mode) : undefined}>
      {presence.status === 'loading' || presence.status === 'idle'
        ? <StateMessage variant="loading" loaderVariant="rows" message="Loading presence" /> : null}
      {presence.status === 'unavailable' && (
        <p className="settings-unavailable" role="status">Presence modes unavailable.</p>
      )}
      {presence.status === 'error' && (
        <StateMessage variant="error" className="settings-feedback" message={presence.message}
          actionLabel="Retry" onAction={retry} />
      )}
      {presence.status === 'ready' && (
        <>
          <div className="presence-modes" role="group" aria-label="Presence mode">
            {presenceModes.map(({ mode, label, tone }) => (
              <button key={mode} type="button" className="presence-mode-card" aria-pressed={presence.mode === mode}
                disabled={presence.saving !== null} style={{ '--tone': tone } as CSSProperties} onClick={() => { void setMode(mode); }}>
                <span className="presence-dot" aria-hidden="true" />
                <span className="presence-mode-name">{presence.saving === mode ? `Switching to ${label}…` : label}</span>
              </button>
            ))}
          </div>
          <p className="settings-explanation" role="status">
            {presenceLabel(presence.mode)}{presence.changedAt ? ` since ${formatDateTime(presence.changedAt)}` : ''}
            {presence.source ? ` · set by ${sourceLabel(presence.source)}` : ''}
          </p>
          {presence.error && <p className="settings-validation-error" role="alert">{presence.error}</p>}
        </>
      )}
      <a className="secondary-button" href="#jarvis-instructions">Edit Jarvis instructions</a>
    </CollapsibleSection>
  );
}

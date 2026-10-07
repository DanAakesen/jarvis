import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { backendFetch } from './backend-request';
import { presenceLabel, presenceModes, usePresence, type PresenceMode } from './presence-store';

type ModeInstructions = Record<PresenceMode, string>;
const maxInstruction = 2_000;
const modeDescriptions: Record<PresenceMode, string> = {
  present: 'You are at the screen.',
  away: 'You are not at the screen.',
  on_the_move: 'You are out with your phone.',
};

// Sources reported by GET /presence (P6-23): manual (Dan), jarvis (its tool) and browser (activity returns Dan to Present).
function sourceLabel(source: string) {
  return source === 'jarvis' ? 'Jarvis' : source === 'browser' ? 'browser activity' : source === 'manual' || source === 'dan' ? 'you' : source;
}

/** Top-bar presence chip: shows the live mode and switches it. Hidden until the presence service answers. */
export function PresenceChip({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const { presence, setMode } = usePresence(backendUrl, getAccessToken);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} className="presence-chip-trigger" type="button" aria-expanded={open} aria-controls={menuId}
        aria-label={`Presence: ${current.label}. Change mode`} onClick={() => setOpen((value) => !value)}>
        <span className="presence-dot" aria-hidden="true" />
        <span className="presence-chip-label">{current.label}</span>
      </button>
      {open && (
        <div id={menuId} className="presence-menu luminous-glass" role="group" aria-label="Presence mode">
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

function readModeInstructions(value: unknown): ModeInstructions | null {
  if (typeof value !== 'object' || value === null) return null;
  const settings = (value as { settings?: { personality?: { modeInstructions?: unknown } } }).settings;
  const raw = settings?.personality?.modeInstructions;
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const text = (key: PresenceMode) => typeof record[key] === 'string' ? (record[key] as string).slice(0, maxInstruction) : '';
  return { present: text('present'), away: text('away'), on_the_move: text('on_the_move') };
}

/** Settings → Presence: the current mode with a switch, and one extra instruction per mode on top of the base one. */
export function PresenceSettings({ backendUrl, getAccessToken }: { backendUrl: string | null; getAccessToken: () => Promise<string> }) {
  const { presence, setMode, retry } = usePresence(backendUrl, getAccessToken);
  const ids = useId();
  const [saved, setSaved] = useState<ModeInstructions | null>(null);
  const [draft, setDraft] = useState<ModeInstructions | null>(null);
  const [instructionsState, setInstructionsState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!backendUrl) return () => { active = false; };
    void (async () => {
      try {
        const token = await getAccessToken();
        const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/settings`, {
          headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Settings could not be loaded.');
        const instructions = readModeInstructions(await response.json());
        if (!active) return;
        if (!instructions) { setInstructionsState('unavailable'); return; }
        setSaved(instructions);
        setDraft(instructions);
        setInstructionsState('ready');
      } catch {
        if (active) setInstructionsState('error');
      }
    })();
    return () => { active = false; };
  }, [backendUrl, getAccessToken]);

  const changed = Boolean(saved && draft && presenceModes.some(({ mode }) => saved[mode] !== draft[mode]));
  const tooLong = Boolean(draft && presenceModes.some(({ mode }) => draft[mode].length > maxInstruction));

  async function saveInstructions() {
    if (!backendUrl || !draft || !changed || tooLong || saving) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const token = await getAccessToken();
      const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/settings`, {
        method: 'PATCH',
        headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality: { modeInstructions: draft } }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Mode instructions could not be saved. Try again.');
      setSaved(draft);
      setMessage('Mode instructions saved. They apply from the next reply.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mode instructions could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section presence-settings" id="presence" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Presence</h2>
      <p className="settings-explanation">Jarvis adapts to where you are. You can switch here or in the top bar, and Jarvis can switch it too.</p>
      {presence.status === 'loading' || presence.status === 'idle' ? <p className="settings-feedback" role="status">Loading presence…</p> : null}
      {presence.status === 'unavailable' && (
        <p className="settings-unavailable" role="status">Presence modes are not available yet. They appear once the presence service is deployed.</p>
      )}
      {presence.status === 'error' && (
        <div className="settings-feedback" role="alert">
          <p>{presence.message}</p>
          <button className="secondary-button" type="button" onClick={retry}>Retry</button>
        </div>
      )}
      {presence.status === 'ready' && (
        <>
          <div className="presence-modes" role="group" aria-label="Presence mode">
            {presenceModes.map(({ mode, label, tone }) => (
              <button key={mode} type="button" className="presence-mode-card" aria-pressed={presence.mode === mode}
                disabled={presence.saving !== null} style={{ '--tone': tone } as CSSProperties} onClick={() => { void setMode(mode); }}>
                <span className="presence-dot" aria-hidden="true" />
                <span className="presence-mode-name">{presence.saving === mode ? `Switching to ${label}…` : label}</span>
                <span className="presence-mode-note">{modeDescriptions[mode]}</span>
              </button>
            ))}
          </div>
          <p className="settings-explanation" role="status">
            {presenceLabel(presence.mode)}{presence.changedAt ? ` since ${new Date(presence.changedAt).toLocaleString()}` : ''}
            {presence.source ? ` · set by ${sourceLabel(presence.source)}` : ''}
          </p>
          {presence.error && <p className="settings-validation-error" role="alert">{presence.error}</p>}
        </>
      )}
      <h3 className="presence-instructions-heading">Instructions per mode</h3>
      <p className="settings-explanation">Each mode adds its own instruction to the base instruction under Personality.</p>
      {instructionsState === 'loading' && <p className="settings-feedback" role="status">Loading mode instructions…</p>}
      {instructionsState === 'unavailable' && (
        <p className="settings-unavailable" role="status">Instructions per mode are not available yet. They appear once the backend supports them.</p>
      )}
      {instructionsState === 'error' && <p className="settings-validation-error" role="alert">Mode instructions could not be loaded. Reload Settings to try again.</p>}
      {instructionsState === 'ready' && draft && (
        <>
          <div className="presence-instructions">
            {presenceModes.map(({ mode, label, tone }) => (
              <div className="settings-field presence-instruction" key={mode} style={{ '--tone': tone } as CSSProperties}>
                <label htmlFor={`${ids}-${mode}`}><span className="presence-dot" aria-hidden="true" />{label}</label>
                <textarea id={`${ids}-${mode}`} rows={4} value={draft[mode]} disabled={saving} maxLength={maxInstruction + 200}
                  aria-describedby={`${ids}-${mode}-count`}
                  onChange={(event) => setDraft((current) => current ? { ...current, [mode]: event.target.value } : current)} />
                <p className="settings-explanation" id={`${ids}-${mode}-count`}>
                  {draft[mode].length.toLocaleString()} / 2,000 characters
                </p>
              </div>
            ))}
          </div>
          {tooLong && <p className="settings-validation-error" role="alert">Each mode instruction can be at most 2,000 characters.</p>}
          <div className="settings-actions">
            <button className="primary-button" type="button" disabled={!changed || tooLong || saving} onClick={() => { void saveInstructions(); }}>
              {saving ? 'Saving…' : 'Save mode instructions'}
            </button>
          </div>
          {message && <p className="settings-feedback" role="status">{message}</p>}
          {error && <p className="settings-validation-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}

import { useId, useRef, useState } from 'react';
import { Loader } from './Loader';
import { Modal } from './Modal';
import './RuntimeTestSelector.css';

export type TestRuntime = 'current' | 'copilot';
export type RuntimeAvailability = { available: boolean; reason?: string };
export type RuntimeTestAvailability = Partial<Record<TestRuntime, RuntimeAvailability>>;

/** Availability is supplied by the caller; missing information never enables a runtime. */
export function RuntimeTestSelector({ availability, disabledReason, onStart, onClose }: {
  availability: RuntimeTestAvailability;
  disabledReason?: string | undefined;
  onStart: (runtime: TestRuntime) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<TestRuntime | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const start = async () => {
    if (!selected || !availability[selected]?.available || disabledReason || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await onStart(selected);
      onClose();
    } catch {
      setError('Could not open the test conversation. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return <Modal title="Test agent runtime" titleId={`${id}-title`} onClose={onClose} busy={busy} allowDismissAfterEdit
    className="runtime-test-selector" footer={<div className="button-group">
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="primary-button" disabled={busy || !selected || !availability[selected]?.available || Boolean(disabledReason)}
        aria-busy={busy || undefined} onClick={() => { void start(); }}>
        {busy && <Loader variant="inline" label="Opening test conversation" />}
        {error ? 'Try again' : 'Open test conversation'}
      </button>
    </div>}>
    <p id={`${id}-description`}>Choose a runtime to open a new, separate test conversation. Your normal conversation stays unchanged. The runtime cannot change during a conversation.</p>
    <fieldset disabled={busy || Boolean(disabledReason)} aria-describedby={`${id}-description`}>
      <legend>Runtime</legend>
      {(['current', 'copilot'] as const).map(runtime => {
        const option = availability[runtime];
        const reason = option?.available ? '' : option?.reason || 'Availability has not been confirmed.';
        return <label key={runtime} className="runtime-test-option" data-disabled={!option?.available || undefined}>
          <input type="radio" name={`${id}-runtime`} value={runtime} checked={selected === runtime}
            disabled={!option?.available} aria-describedby={reason ? `${id}-${runtime}-reason` : undefined}
            onChange={() => { setSelected(runtime); setError(''); }} />
          <span>{runtime === 'current' ? 'Current' : 'Copilot'}
            {reason && <span id={`${id}-${runtime}-reason`} className="runtime-test-reason">{reason}</span>}
          </span>
        </label>;
      })}
    </fieldset>
    {disabledReason && <p role="status">{disabledReason}</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}

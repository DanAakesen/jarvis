import { useEffect, useRef, useState } from 'react';

export function AccountSettings({
  hasOwnerSession,
  signingOut,
  onSignOut,
  onSignOutAllDevices,
}: {
  hasOwnerSession: boolean;
  signingOut: boolean;
  onSignOut: () => Promise<void>;
  onSignOutAllDevices: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const signOutAllDevices = async () => {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      await onSignOutAllDevices();
      setMessage('All active devices have been signed out.');
      setConfirming(false);
    } catch {
      setMessage('Could not sign out other devices. This device is still signed in.');
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="button-group">
        <button className="secondary-button" type="button" onClick={() => { void onSignOut(); }}
          disabled={signingOut || busy} aria-busy={signingOut || undefined}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        {hasOwnerSession && !confirming && (
          <button ref={triggerRef} className="danger-button" type="button" onClick={() => {
            setMessage('');
            setError(false);
            setConfirming(true);
          }} disabled={signingOut || busy}>
            Sign out on all devices
          </button>
        )}
      </div>
      {confirming && (
        <div role="group" aria-label="Confirm sign out on all devices">
          <p>This signs out every active device, including this one.</p>
          <div className="button-group">
            <button ref={cancelRef} className="secondary-button" type="button" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button className="danger-button--filled" type="button" onClick={() => { void signOutAllDevices(); }}
              disabled={busy || signingOut} aria-busy={busy || undefined}>
              {busy ? 'Signing out all devices…' : 'Confirm sign out on all devices'}
            </button>
          </div>
        </div>
      )}
      {message && <p role={error ? 'alert' : 'status'} aria-live="polite">{message}</p>}
    </>
  );
}

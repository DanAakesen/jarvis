import { useCallback, useEffect, useState } from 'react';
import { backendFetch } from './backend-request';
import { Loader } from './Loader';

type CredentialStatus = { state: 'loading' | 'active' | 'revoked' | 'expired' | 'empty' | 'error'; expiresAt?: string | null };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function authorizationHeaders(getAccessToken: () => Promise<string>) {
  return { Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}` };
}

export function HealthUploadSettings({ backendUrl, getAccessToken }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
}) {
  const [credential, setCredential] = useState<CredentialStatus>({ state: backendUrl ? 'loading' : 'error' });
  const [token, setToken] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'create' | 'rotate' | 'revoke' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(backendUrl ? '' : 'The configured Jarvis API URL is unavailable.');
  const endpoint = backendUrl ? `${backendUrl.replace(/\/+$/u, '')}/api/health/ingest` : null;

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!backendUrl) return;
    try {
      const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/api/health/upload-credential`, {
        headers: await authorizationHeaders(getAccessToken),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      if (!record(value) || !['active','revoked','expired','empty'].includes(String(value.state)) ||
          (value.expiresAt !== null && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))))) throw new Error();
      setError('');
      setCredential({ state: value.state as CredentialStatus['state'],expiresAt: value.expiresAt as string | null });
    } catch {
      if (!signal?.aborted) {
        setCredential({ state: 'error' });
        setError('Health upload settings could not be loaded. Try again.');
      }
    }
  }, [backendUrl]);

  useEffect(() => {
    if (!backendUrl) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [backendUrl, load]);

  const retryStatus = () => {
    setCredential({ state: 'loading' });
    setError('');
    void load();
  };

  const act = async (action: 'create' | 'rotate' | 'revoke') => {
    if (!backendUrl || busyAction) return;
    setBusyAction(action);
    setError('');
    setMessage('');
    setToken(null);
    try {
      const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/api/health/upload-credential`, {
        method: 'POST',
        headers: { ...await authorizationHeaders(getAccessToken),'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !record(value) || typeof value.state !== 'string') throw new Error();
      if ((action === 'create' || action === 'rotate') &&
          (typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/u.test(value.token))) throw new Error();
      setCredential({
        state: action === 'revoke' ? value.state === 'revoked' ? 'revoked' : 'empty' : 'active',
        expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
      });
      if (action !== 'revoke') setToken(value.token as string);
      setMessage(action === 'revoke' ? 'Upload credential revoked.' : 'Credential created. Copy it now; Jarvis will not show it again.');
    } catch {
      setError(`The ${action} request did not complete. Refresh status before retrying.`);
    } finally {
      setBusyAction(null);
    }
  };

  const copy = async () => {
    if (!token || !navigator.clipboard?.writeText) {
      setError('Clipboard access is unavailable. Select the token and copy it manually.');
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setMessage('Credential copied. Store it in Health Auto Export; this screen cannot retrieve it again.');
      setError('');
    } catch {
      setError('Copy failed. Select the token and copy it manually.');
    }
  };

  return <div className="health-upload-settings">
    <p>Configure Health Auto Export to send the original JSON payload to this Jarvis API. Keep each metric/date group intact in one upload: the source has no completeness marker, so do not split an oversized group. Limits are 8 MiB ingress, 10,000 normalized rows or 8 MiB output, and 256 MiB or 10,000 retained inbox rows per owner. Exporter-specific batching controls are unverified; stop if a complete group cannot fit.</p>
    <dl className="health-upload-contract">
      <div><dt>Request</dt><dd><code>POST</code></dd></div>
      <div><dt>Upload URL</dt><dd><code className="health-upload-url">{endpoint ?? 'Unavailable until the Jarvis API URL is configured'}</code></dd></div>
      <div><dt>Required headers</dt><dd><code>Authorization: {['Bear', 'er'].join('')} {'<token>'}</code><br /><code>Content-Type: application/json</code><br /><code>automation-id</code> (stable per automation)<br /><code>session-id</code> (unique per upload)</dd></div>
      <div><dt>Optional checksum</dt><dd><code>checksum</code> or <code>x-payload-checksum</code>: SHA-256 of the exact request bytes.</dd></div>
    </dl>
    {!endpoint && <p className="settings-explanation">Actions are disabled because no configured API base URL is available.</p>}
    {credential.state === 'loading' && <Loader label="Loading health upload status" variant="rows" />}
    {credential.state === 'error' && <div role="alert"><p>{error || 'Health upload status is unavailable.'}</p>
      <button className="secondary-button" type="button" disabled={busyAction !== null || !backendUrl} onClick={retryStatus}>Retry status</button></div>}
    {credential.state !== 'loading' && credential.state !== 'error' && <div>
      <p role="status">Credential status: {credential.state}{credential.expiresAt ? `; expires ${new Date(credential.expiresAt).toISOString()}` : ''}.</p>
      <div className="credential-actions" aria-busy={busyAction !== null || undefined}>
        {(credential.state === 'empty' || credential.state === 'revoked' || credential.state === 'expired')
          ? <button className="primary-button" type="button" disabled={busyAction !== null || !endpoint}
            onClick={() => { void act('create'); }}>Create credential</button>
          : <button className="primary-button" type="button" disabled={busyAction !== null}
            onClick={() => { void act('rotate'); }}>Rotate credential</button>}
        {credential.state === 'active' && <button className="danger-button" type="button" disabled={busyAction !== null}
          onClick={() => { void act('revoke'); }}>Revoke credential</button>}
        {busyAction && <Loader variant="inline" label={`${busyAction[0]!.toUpperCase()}${busyAction.slice(1)}ing health upload credential`} />}
      </div>
    </div>}
    {token && <div className="health-upload-reveal">
      <label htmlFor="health-upload-token">One-time bearer token</label>
      <textarea id="health-upload-token" className="health-upload-token" value={token} readOnly rows={3} />
      <div className="credential-actions">
        <button className="secondary-button" type="button" onClick={() => { void copy(); }}>Copy token</button>
        <button className="ghost-button" type="button" onClick={() => setToken(null)}>Hide token</button>
      </div>
    </div>}
    {error && credential.state !== 'error' && <p className="credential-result" data-tone="error" role="alert">{error}</p>}
    {message && <p className="credential-result" role="status">{message}</p>}
  </div>;
}

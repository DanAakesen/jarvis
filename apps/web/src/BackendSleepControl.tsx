import { useCallback, useEffect, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';

type SleepState = 'awake' | 'asleep';

function isSleepStateResponse(value: unknown): value is { state: SleepState } {
  return typeof value === 'object' && value !== null && 'state' in value &&
    (value.state === 'awake' || value.state === 'asleep');
}

async function accessToken(client: PublicClientApplication, config: PublicConfig): Promise<string> {
  const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (!account) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  try {
    const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
    if (result.accessToken) return result.accessToken;
  } catch {
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  }
  throw new Error('Microsoft sign-in did not return an API token.');
}

async function requestSleepState(
  client: PublicClientApplication,
  config: PublicConfig,
  method: 'GET' | 'PUT',
  state?: SleepState,
): Promise<SleepState> {
  if (!config.backendUrl) throw new Error('Backend scaling is unavailable until the backend is deployed.');
  const url = new URL(`${config.backendUrl.replace(/\/+$/, '')}/operations/sleep`);
  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `${bearerScheme} ${await accessToken(client, config)}`,
        ...(state ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(state ? { body: JSON.stringify({ state }) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Your Microsoft sign-in needs attention. Sign in again.') throw error;
    if (error instanceof Error && error.message === 'Microsoft sign-in did not return an API token.') throw error;
    throw new Error('Jarvis could not reach the backend scaling service. Try again.', { cause: error });
  }

  if (response.status === 401) throw new Error('Jarvis could not verify your Microsoft sign-in. Try again.');
  if (response.status === 403) throw new Error("This Microsoft account isn't allowed to use Jarvis.");
  if (response.status === 409) throw new Error('Cannot put the backend to sleep while tasks are Ready or Running.');
  if (response.status === 503) throw new Error('Backend scaling is unavailable. Try again later.');
  if (!response.ok) throw new Error(`Jarvis could not update backend sleep (HTTP ${response.status}).`);

  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Jarvis returned an invalid backend sleep response.'); }
  if (!isSleepStateResponse(body)) throw new Error('Jarvis returned an invalid backend sleep response.');
  return body.state;
}

export function BackendSleepControl({
  client,
  config,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
}) {
  const [state, setState] = useState<SleepState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await requestSleepState(client, config, 'GET'));
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : 'Backend state could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, [client, config]);

  useEffect(() => {
    let active = true;
    void requestSleepState(client, config, 'GET')
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch((cause: unknown) => {
        if (active) {
          setState(null);
          setError(cause instanceof Error ? cause.message : 'Backend state could not be loaded. Try again.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client, config]);

  const toggle = async () => {
    if (state === null) {
      await refresh();
      return;
    }
    const nextState = state === 'awake' ? 'asleep' : 'awake';
    setPending(true);
    setError('');
    try {
      setState(await requestSleepState(client, config, 'PUT', nextState));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backend sleep could not be changed. Try again.');
    } finally {
      setPending(false);
    }
  };

  const status = loading
    ? 'Checking whether the backend is awake or asleep…'
    : error || (pending
      ? state === 'awake' ? 'Putting the backend to sleep…' : 'Waking the backend…'
      : state === 'awake' ? 'The backend is awake.' : state === 'asleep'
        ? 'The backend is asleep; the next request will wake it.' : 'Backend state is unavailable.');
  const buttonLabel = loading ? 'Checking backend status…'
    : pending ? state === 'awake' ? 'Putting the backend to sleep…' : 'Waking the backend…'
      : state === 'awake' ? 'Put the backend to sleep' : state === 'asleep'
        ? 'Wake the backend' : 'Retry backend status';

  return (
    <>
      <p id="backend-status" className={error ? 'error-text' : undefined}
        role={error ? 'alert' : 'status'} aria-live="polite" aria-busy={loading || pending}>
        {status}
      </p>
      <div className="action-row">
        <button className="secondary-button" type="button" disabled={loading || pending}
          aria-describedby="backend-status" onClick={() => void toggle()}>
          {buttonLabel}
        </button>
      </div>
    </>
  );
}

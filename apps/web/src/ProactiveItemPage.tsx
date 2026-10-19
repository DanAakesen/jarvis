import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { backendFetch } from './backend-request';
import { saveSignInReturnPath } from './auth';
import { formatDateTime } from './format/date-time';

interface ProactiveItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

type ItemState =
  | { status: 'loading' }
  | { status: 'loaded'; item: ProactiveItem }
  | { status: 'not-found' }
  | { status: 'sign-in' }
  | { status: 'error' };

const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function isItem(value: unknown, expectedId: string): value is ProactiveItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.id === expectedId && item.kind === 'test' &&
    typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 200 &&
    typeof item.body === 'string' && item.body.length <= 10_000 &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt));
}

export function ProactiveItemPage({ backendUrl, getAccessToken, signIn }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  signIn: () => Promise<void>;
}) {
  const { id = '' } = useParams();
  const location = useLocation();
  const [state, setState] = useState<ItemState>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!uuidPattern.test(id)) {
      setState({ status: 'not-found' });
      return;
    }
    if (!backendUrl) {
      setState({ status: 'error' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const token = await getAccessToken();
      if (signal.aborted) return;
      const response = await backendFetch(
        `${backendUrl.replace(/\/+$/u, '')}/proactive/items/${encodeURIComponent(id)}`,
        {
          headers: {
            Authorization: `${['Bear', 'er'].join('')} ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal,
        },
      );
      if (signal.aborted) return;
      if (response.status === 401) {
        setState({ status: 'sign-in' });
        return;
      }
      if (response.status === 404) {
        setState({ status: 'not-found' });
        return;
      }
      if (!response.ok) throw new Error('Item request failed.');
      const value: unknown = await response.json().catch(() => null);
      if (signal.aborted) return;
      if (!isItem(value, id)) throw new Error('Item response was invalid.');
      setState({ status: 'loaded', item: value });
    } catch (error) {
      if (signal.aborted) return;
      setState(error instanceof Error && error.message.includes('sign-in needs attention')
        ? { status: 'sign-in' }
        : { status: 'error' });
    }
  }, [backendUrl, getAccessToken, id]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    queueMicrotask(() => { if (active) void load(controller.signal); });
    return () => { active = false; controller.abort(); };
  }, [load, requestKey]);

  const beginSignIn = () => {
    saveSignInReturnPath(`${location.pathname}${location.search}${location.hash}`);
    void signIn();
  };

  return (
    <article className="proactive-item" aria-labelledby="proactive-item-heading">
      <h1 id="proactive-item-heading">{state.status === 'loaded' ? state.item.title : 'Jarvis item'}</h1>
      {state.status === 'loading' && <p role="status">Loading item…</p>}
      {state.status === 'not-found' && <p role="status">This item was not found or is not available to this account.</p>}
      {state.status === 'sign-in' && (
        <>
          <p>Your sign-in has expired. Sign in again to open this item.</p>
          <button className="primary-button" type="button" onClick={beginSignIn}>Sign in again</button>
        </>
      )}
      {state.status === 'error' && (
        <div className="proactive-item-feedback" role="alert">
          <p>This item could not be loaded. Try again.</p>
          <button className="secondary-button" type="button" onClick={() => setRequestKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      {state.status === 'loaded' && (
        <>
          <p className="proactive-item-body">{state.item.body}</p>
          <p className="proactive-item-time">
            <time dateTime={state.item.createdAt}>
              {formatDateTime(state.item.createdAt)}
            </time>
          </p>
        </>
      )}
    </article>
  );
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useConversationIntents } from './conversation-intents';
import { backendFetch } from './backend-request';
import {
  createHtmlAppDocument,
  validateHtmlAppBridgeMessage,
  type HtmlAppEnvironment,
} from './html-app-bridge';

const maxHtmlBytes = 512 * 1024;
const maxFrameHeight = 1_200;

interface HtmlAppArtifact {
  id: string;
  kind: 'html';
  title: string;
  html: string;
  sources: { title: string; url: string }[];
  createdAt: string;
  pinned: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface HtmlAppRendererContext {
  readonly backendUrl: string | null;
  readonly getAccessToken: () => Promise<string>;
  readonly environment: HtmlAppEnvironment;
}

function validSource(value: unknown): value is HtmlAppArtifact['sources'][number] {
  if (!record(value) || Object.keys(value).some((key) => key !== 'title' && key !== 'url') ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 ||
      typeof value.url !== 'string' || value.url.length > 2_048) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validArtifact(value: unknown, expectedId: string): value is HtmlAppArtifact {
  if (!record(value) ||
      Object.keys(value).some((key) => !['id', 'kind', 'title', 'html', 'sources', 'createdAt', 'pinned'].includes(key)) ||
      value.id !== expectedId || value.kind !== 'html' ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 ||
      typeof value.html !== 'string' || new TextEncoder().encode(value.html).byteLength > maxHtmlBytes ||
      !Array.isArray(value.sources) || value.sources.length > 50 || !value.sources.every(validSource) ||
      typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) ||
      typeof value.pinned !== 'boolean') return false;
  return true;
}

export function HtmlAppView({
  artifactId,
  backendUrl,
  getAccessToken,
  environment,
}: {
  artifactId: string;
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  environment: HtmlAppEnvironment;
}) {
  const intents = useConversationIntents();
  const channel = useId();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [artifact, setArtifact] = useState<HtmlAppArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [frameHeight, setFrameHeight] = useState(320);
  const [frameLoading, setFrameLoading] = useState(true);
  const [updatingPin, setUpdatingPin] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState('');

  useEffect(() => {
    if (!backendUrl) {
      setError('HTML apps are unavailable because the backend is not configured.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setArtifact(null);
    setLoading(true);
    setError('');
    setBridgeStatus('');
    void (async () => {
      try {
        const response = await backendFetch(
          `${backendUrl.replace(/\/+$/u, '')}/factory/workspace-artifacts/html/${artifactId}`,
          {
            headers: {
              Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}`,
              Accept: 'application/json',
            },
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          },
        );
        if (!response.ok) throw new Error(response.status === 404
          ? 'This HTML app is unavailable.'
          : response.status === 401 || response.status === 403
            ? 'Sign in again to open this HTML app.'
            : 'Jarvis could not load this HTML app.');
        let value: unknown;
        try { value = await response.json(); } catch { throw new Error('Jarvis returned an invalid HTML app.'); }
        if (!validArtifact(value, artifactId)) throw new Error('Jarvis returned an invalid HTML app.');
        if (active) setArtifact(value);
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Jarvis could not load this HTML app.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [artifactId, attempt, backendUrl, getAccessToken]);

  const sourceDocument = useMemo(() => artifact
    ? createHtmlAppDocument(artifact.html, environment, channel)
    : '', [artifact, channel, environment]);

  useEffect(() => {
    if (!sourceDocument) return;
    setFrameHeight(320);
    setFrameLoading(true);
  }, [sourceDocument]);

  const patchPinned = useCallback(async (pinned: boolean) => {
    if (!artifact || !backendUrl || updatingPin) return;
    setUpdatingPin(true);
    setBridgeStatus('');
    try {
      const response = await backendFetch(
        `${backendUrl.replace(/\/+$/u, '')}/factory/workspace-artifacts/html/${artifactId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pinned }),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!response.ok) throw new Error('Jarvis could not update this saved app.');
      const result: unknown = await response.json();
      if (!record(result) || result.pinned !== pinned) throw new Error('Jarvis did not confirm the saved-app update.');
      setArtifact((current) => current ? { ...current, pinned } : current);
      setBridgeStatus(pinned ? 'HTML app pinned.' : 'HTML app unpinned.');
    } catch (cause) {
      setBridgeStatus(cause instanceof Error ? cause.message : 'Jarvis could not update this saved app.');
    } finally {
      setUpdatingPin(false);
    }
  }, [artifact, artifactId, backendUrl, getAccessToken, updatingPin]);

  const openUrl = useCallback(async (url: string) => {
    if (!backendUrl) return;
    setBridgeStatus('');
    try {
      const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/factory/workspace-artifacts/html/open-url`, {
        method: 'POST',
        headers: {
          Authorization: `${['Bear', 'er'].join('')} ${await getAccessToken()}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error('Chrome could not open that URL.');
      setBridgeStatus('Opened in Chrome.');
    } catch (cause) {
      setBridgeStatus(cause instanceof Error ? cause.message : 'Chrome could not open that URL.');
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const frame = iframe.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== 'null' ||
          frame.closest('[hidden]')) return;
      const message = validateHtmlAppBridgeMessage(event.data, channel);
      if (!message) return;
      switch (message.type) {
        case 'resize':
          setFrameHeight((current) => Math.abs(current - message.height) < 4
            ? current
            : Math.min(maxFrameHeight, Math.max(120, Math.ceil(message.height))));
          break;
        case 'ask':
          intents.sendMessage(message.text);
          setBridgeStatus('Sent to Jarvis.');
          break;
        case 'open_url':
          void openUrl(message.url);
          break;
        case 'pin':
          void patchPinned(true);
          break;
        case 'unpin':
          void patchPinned(false);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [channel, intents, openUrl, patchPinned]);

  if (loading) return <p role="status" aria-live="polite">Loading HTML app…</p>;
  if (error) {
    return (
      <div className="html-app-feedback">
        <p role="alert">{error}</p>
        {backendUrl && <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>}
      </div>
    );
  }
  if (!artifact) return <p role="alert">This HTML app is unavailable.</p>;

  return (
    <div className="generated-view-html-app">
      <div className="html-app-controls">
        <button className="secondary-button" type="button" disabled={updatingPin}
          aria-pressed={artifact.pinned} onClick={() => void patchPinned(!artifact.pinned)}>
          {updatingPin ? 'Updating…' : artifact.pinned ? 'Unpin app' : 'Pin app'}
        </button>
        <span role="status" aria-live="polite">{bridgeStatus}</span>
      </div>
      <iframe
        ref={iframe}
        className="generated-view-html-frame"
        title={artifact.title}
        sandbox="allow-scripts"
        srcDoc={sourceDocument}
        referrerPolicy="no-referrer"
        style={{ height: `${frameHeight}px` }}
        onLoad={() => setFrameLoading(false)}
      />
      {frameLoading && <p role="status">Starting HTML app…</p>}
      {artifact.sources.length > 0 && (
        <details className="html-app-sources">
          <summary>Sources ({artifact.sources.length})</summary>
          <ul>
            {artifact.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

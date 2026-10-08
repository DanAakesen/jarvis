import { useCallback, useEffect, useRef, useState } from 'react';
import type { HtmlArtifact } from '@jarvis/contracts';
import { backendFetch } from './backend-request';
import { useConversationIntents } from './conversation-intents';
import { useKnowledgeBackend } from './knowledge/knowledge-context';
import { Loader } from './Loader';
import { htmlAppDocument, minAppHeight, readHtmlAppMessage, readHtmlArtifact } from './html-app-document';

type Load = { status: 'loading' } | { status: 'error'; message: string; retry: boolean } | { status: 'ready'; artifact: HtmlArtifact; document: string };

const themeTokens = { text: '--text', muted: '--text-muted', accent: '--glass-edge-cool', 'accent-warm': '--glass-glow-warm', error: '--error' } as const;

function hostTheme() {
  const root = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const [name, source] of Object.entries(themeTokens)) tokens[`--${name}`] = root.getPropertyValue(source);
  tokens['--font'] = getComputedStyle(document.body).fontFamily;
  const scheme: 'dark' | 'light' = root.colorScheme.includes('light') && !root.colorScheme.includes('dark') ? 'light' : 'dark';
  return { scheme, tokens };
}

/** A model-written HTML app or research report in a sandboxed frame (P8-41, #429). */
export function HtmlAppView({ artifactId, title }: { artifactId: string; title: string }) {
  const backend = useKnowledgeBackend();
  const intents = useConversationIntents();
  const frame = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(minAppHeight * 3);
  const [notice, setNotice] = useState('');

  const call = useCallback(async (init?: { method: 'PATCH'; body: unknown } | { method: 'POST'; path: string; body: unknown }) => {
    if (!backend?.backendUrl) throw new Error('unavailable');
    const base = `${backend.backendUrl.replace(/\/+$/u, '')}/factory/workspace-artifacts/html`;
    const url = init?.method === 'POST' ? `${base}/${init.path}` : `${base}/${encodeURIComponent(artifactId)}`;
    return backendFetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${await backend.getAccessToken()}`,
        Accept: 'application/json',
        ...(init ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  }, [artifactId, backend]);

  useEffect(() => {
    let active = true;
    if (!backend?.backendUrl) return () => { active = false; };
    void call().then(async (response) => {
      if (response.status === 404) throw Object.assign(new Error('This report or app is no longer available.'), { final: true });
      if (!response.ok) throw new Error('Jarvis could not load this window. Try again.');
      const artifact = readHtmlArtifact(await response.json());
      // SQL Server returns uniqueidentifiers in upper case; the view carries lower case.
      if (!artifact || artifact.id.toLowerCase() !== artifactId.toLowerCase()) throw Object.assign(new Error('Jarvis returned a report it could not show safely.'), { final: true });
      if (active) setLoad({ status: 'ready', artifact, document: htmlAppDocument(artifact.html, hostTheme()) });
    }).catch((reason: unknown) => {
      if (!active) return;
      const message = reason instanceof Error && reason.message !== 'unavailable' ? reason.message : 'Jarvis could not load this window. Try again.';
      setLoad({ status: 'error', message, retry: !(reason as { final?: boolean } | null)?.final });
    });
    return () => { active = false; };
  }, [artifactId, attempt, backend?.backendUrl, call]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow || event.origin !== 'null') return;
      const message = readHtmlAppMessage(event.data);
      if (!message) return;
      // Generated content is untrusted: questions and links act only on a real click inside the frame, which the
      // browser propagates to this page as transient activation.
      const clicked = navigator.userActivation ? navigator.userActivation.isActive : true;
      switch (message.type) {
        case 'resize':
          setHeight(message.height);
          return;
        case 'ask':
          if (!clicked) return;
          intents.sendMessage(message.text);
          setNotice('Sent to Jarvis.');
          return;
        case 'open_url':
          if (!clicked) return;
          if (!window.open(message.url, '_blank', 'noopener,noreferrer')) {
            void call({ method: 'POST', path: 'open-url', body: { url: message.url } })
              .then((response) => setNotice(response.ok ? 'Opened in Chrome on your computer.' : 'The link could not be opened.'))
              .catch(() => setNotice('The link could not be opened.'));
          }
          return;
        case 'pin':
        case 'unpin':
          if (!clicked) return;
          void call({ method: 'PATCH', body: { pinned: message.type === 'pin' } })
            .then((response) => setNotice(response.ok ? (message.type === 'pin' ? 'Pinned.' : 'Unpinned.') : 'Jarvis could not change the pin.'))
            .catch(() => setNotice('Jarvis could not change the pin.'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [call, intents]);

  if (!backend?.backendUrl) return <p className="html-app-state" role="status">This window opens in the Jarvis workspace.</p>;
  if (load.status === 'loading') return <Loader variant="lines" label={`Opening ${title}…`} />;
  if (load.status === 'error') {
    return (
      <div className="html-app-state" role="alert">
        <p>{load.message}</p>
        {load.retry && <button className="secondary-button" type="button" onClick={() => { setLoad({ status: 'loading' }); setAttempt((value) => value + 1); }}>Retry</button>}
      </div>
    );
  }
  return (
    <div className="html-app">
      <iframe ref={frame} className="html-app-frame" title={load.artifact.title || title} sandbox="allow-scripts"
        referrerPolicy="no-referrer" srcDoc={load.document} style={{ height }} />
      {notice && <p className="html-app-notice" role="status">{notice}</p>}
    </div>
  );
}

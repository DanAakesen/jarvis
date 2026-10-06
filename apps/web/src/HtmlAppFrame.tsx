import { useEffect, useRef, useState } from 'react';
import type { WorkspaceHtmlArtifact } from './workspace-html-artifacts';

const contentSecurityPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'";

export interface HtmlAppFrameProps {
  artifactId: string;
  title: string;
  loadArtifact: (artifactId: string, signal: AbortSignal) => Promise<WorkspaceHtmlArtifact>;
  onOpenUrl: (url: string) => void;
  onAsk: (text: string) => void;
  onPinChange: (pinned: boolean) => void | Promise<void>;
  onResize: (height: number) => void;
}

type ArtifactLoadState =
  | { key: string; status: 'loaded'; artifact: WorkspaceHtmlArtifact }
  | { key: string; status: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function contentFor(html: string): string {
  const policy = contentSecurityPolicy.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}

export function HtmlAppFrame({
  artifactId,
  title,
  loadArtifact,
  onOpenUrl,
  onAsk,
  onPinChange,
  onResize,
}: HtmlAppFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loadState, setLoadState] = useState<ArtifactLoadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${artifactId}:${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    void loadArtifact(artifactId, controller.signal).then((loaded) => {
      if (loaded.id !== artifactId || typeof loaded.html !== 'string') {
        throw new Error('The workspace HTML artifact was invalid.');
      }
      if (!controller.signal.aborted) setLoadState({ key: requestKey, status: 'loaded', artifact: loaded });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setLoadState({
          key: requestKey,
          status: 'error',
          message: reason instanceof Error ? reason.message : 'The workspace HTML app could not load.',
        });
      }
    });
    return () => controller.abort();
  }, [artifactId, loadArtifact, requestKey]);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || !isRecord(event.data) ||
          typeof event.data.type !== 'string') return;
      const keys = Object.keys(event.data);
      switch (event.data.type) {
        case 'open_url':
          if (keys.length === 2 && keys.every((key) => ['type', 'url'].includes(key)) && validHttpsUrl(event.data.url)) {
            onOpenUrl(event.data.url);
          }
          break;
        case 'ask':
          if (keys.length === 2 && keys.every((key) => ['type', 'text'].includes(key)) &&
              typeof event.data.text === 'string' && event.data.text.trim().length > 0 &&
              event.data.text.length <= 2_000 &&
              !Array.from(event.data.text).some((character) => {
                const code = character.charCodeAt(0);
                return code === 0 || code === 0x7f || (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code));
              })) {
            onAsk(event.data.text.trim());
          }
          break;
        case 'pin':
        case 'unpin':
          if (keys.length === 1) {
            void Promise.resolve(onPinChange(event.data.type === 'pin')).catch(() => {
              setLoadState({
                key: requestKey, status: 'error',
                message: 'The workspace HTML app could not be pinned. Try again.',
              });
            });
          }
          break;
        case 'resize':
          if (keys.length === 2 && keys.every((key) => ['type', 'height'].includes(key)) &&
              typeof event.data.height === 'number' && Number.isFinite(event.data.height) &&
              event.data.height >= 160 && event.data.height <= 2_000) {
            onResize(Math.round(event.data.height));
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onAsk, onOpenUrl, onPinChange, onResize, requestKey]);

  if (loadState?.key === requestKey && loadState.status === 'error') {
    return (
      <div className="html-app-feedback">
        <p role="alert">{loadState.message}</p>
        <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry HTML app
        </button>
      </div>
    );
  }
  if (!loadState || loadState.key !== requestKey || loadState.status !== 'loaded') {
    return <p role="status">Loading HTML app…</p>;
  }
  return (
    <iframe
      ref={frame}
      className="workspace-html-app"
      title={title}
      srcDoc={contentFor(loadState.artifact.html ?? '')}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />
  );
}

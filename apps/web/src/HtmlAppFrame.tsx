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
  const [artifact, setArtifact] = useState<WorkspaceHtmlArtifact | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setArtifact(null);
    setError('');
    void loadArtifact(artifactId, controller.signal).then((loaded) => {
      if (loaded.id !== artifactId || typeof loaded.html !== 'string') {
        throw new Error('The workspace HTML artifact was invalid.');
      }
      if (!controller.signal.aborted) setArtifact(loaded);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'The workspace HTML app could not load.');
      }
    });
    return () => controller.abort();
  }, [artifactId, attempt, loadArtifact]);

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
              setError('The workspace HTML app could not be pinned. Try again.');
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
  }, [onAsk, onOpenUrl, onPinChange, onResize]);

  if (error) {
    return (
      <div className="html-app-feedback">
        <p role="alert">{error}</p>
        <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry HTML app
        </button>
      </div>
    );
  }
  if (!artifact) return <p role="status">Loading HTML app…</p>;
  return (
    <iframe
      ref={frame}
      className="workspace-html-app"
      title={title}
      srcDoc={contentFor(artifact.html!)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />
  );
}

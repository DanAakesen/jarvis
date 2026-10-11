import { useEffect, useRef, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { Loader } from './Loader';
import {
  AttachmentExpiredError,
  formatBytes,
  isImageAttachment,
  loadAttachmentUrl,
  typeLabel,
  type ChatAttachment,
} from './chat-attachments';
import type { PendingAttachment } from './useChatAttachments';
import './ChatAttachments.css';

function FileGlyph({ image }: { image: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {image
        ? <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></>
        : <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></>}
    </svg>
  );
}

/** Chips for files waiting to be sent: name, type, size, upload progress, errors and removal. */
export function ComposerAttachments({
  items,
  problems,
  onRemove,
}: {
  items: PendingAttachment[];
  problems: string[];
  onRemove: (key: number) => void;
}) {
  const uploading = items.filter((item) => item.status === 'uploading').length;
  return (
    <div className="composer-attachments">
      {items.length > 0 && (
        <ul className="attachment-chips" aria-label="Files to send">
          {items.map((item) => (
            <li key={item.key} className="attachment-chip" data-status={item.status}>
              {item.previewUrl
                ? <img className="attachment-thumb" src={item.previewUrl} alt="" />
                : <span className="attachment-thumb"><FileGlyph image={isImageAttachment(item.contentType)} /></span>}
              <span className="attachment-text">
                <span className="attachment-name" title={item.name}>{item.name}</span>
                <span className="attachment-meta">
                  {typeLabel(item.contentType)} · {formatBytes(item.size)}
                  {item.status === 'uploading' && ` · Uploading ${Math.round(item.progress * 100)}%`}
                  {item.status === 'ready' && !item.unreadable && ' · Ready'}
                </span>
                {item.status === 'uploading' && (
                  <progress className="attachment-progress" max={1} value={item.progress} aria-label={`Uploading ${item.name}`} />
                )}
                {item.status === 'ready' && item.unreadable && (
                  <span className="attachment-note">Jarvis couldn’t read this file. It can still be sent, but Jarvis won’t see its contents.</span>
                )}
                {item.status === 'failed' && <span className="attachment-note" data-error role="alert">{item.error}</span>}
              </span>
              <button className="attachment-remove" type="button" aria-label={`Remove ${item.name}`} title="Remove"
                onClick={() => onRemove(item.key)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading > 0 && (
        <p className="attachment-hint" role="status">
          {`Uploading ${uploading} ${uploading === 1 ? 'file' : 'files'}. Send is available when uploads finish.`}
        </p>
      )}
      {problems.map((problem) => <p key={problem} className="composer-status chat-error" role="alert">{problem}</p>)}
    </div>
  );
}

type OpenState = { phase: 'idle' } | { phase: 'opening' } | { phase: 'expired' } | { phase: 'error'; message: string } | { phase: 'link'; url: string };

function AttachmentLink({ client, config, attachment }: { client: PublicClientApplication; config: PublicConfig; attachment: ChatAttachment }) {
  const [state, setState] = useState<OpenState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function open() {
    if (state.phase === 'opening') return;
    // Open the tab inside the click so phone browsers do not treat the later navigation as a blocked pop-up.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ phase: 'opening' });
    try {
      const url = await loadAttachmentUrl(client, config, attachment.id, request.signal);
      if (tab) { tab.location.href = url; setState({ phase: 'idle' }); } else setState({ phase: 'link', url });
    } catch (reason) {
      tab?.close();
      if (request.signal.aborted) return;
      setState(reason instanceof AttachmentExpiredError
        ? { phase: 'expired' }
        : { phase: 'error', message: reason instanceof Error ? reason.message : 'Jarvis could not open the file.' });
    }
  }

  return (
    <li className="message-attachment" data-state={state.phase === 'expired' ? 'expired' : undefined}>
      <button type="button" className="message-attachment-open" onClick={() => void open()}
        aria-label={`Open ${attachment.name}`} aria-busy={state.phase === 'opening' || undefined}
        disabled={state.phase === 'expired'}>
        <FileGlyph image={isImageAttachment(attachment.contentType)} />
        <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
        <span className="attachment-meta">{typeLabel(attachment.contentType)} · {formatBytes(attachment.size)}</span>
      </button>
      {state.phase === 'opening' && <span className="attachment-note" role="status">Opening…</span>}
      {state.phase === 'expired' && <span className="attachment-note" data-error role="status">Expired or removed. Jarvis keeps sent files for a limited time.</span>}
      {state.phase === 'error' && <span className="attachment-note" data-error role="alert">{state.message}</span>}
      {state.phase === 'link' && (
        <a className="attachment-note" href={state.url} target="_blank" rel="noopener noreferrer">Open {attachment.name}</a>
      )}
    </li>
  );
}

/** The files sent with a message; each opens through a short-lived signed URL requested on demand. */
export function MessageAttachments({ client, config, attachments }: {
  client: PublicClientApplication;
  config: PublicConfig;
  attachments: readonly ChatAttachment[];
}) {
  return (
    <ul className="message-attachments" aria-label="Attached files">
      {attachments.map((attachment) => <AttachmentLink key={attachment.id} client={client} config={config} attachment={attachment} />)}
    </ul>
  );
}

/** Shown next to Jarvis's question before a screenshot is committed to a public repository. */
export function PublicImageConfirmation({ client, config, attachment }: {
  client: PublicClientApplication;
  config: PublicConfig;
  attachment: ChatAttachment;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadAttachmentUrl(client, config, attachment.id, controller.signal)
      .then(setUrl)
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [attachment.id, client, config]);

  return (
    <figure className="public-image-confirmation">
      {unavailable
        ? <p className="attachment-note" data-error role="alert">The image preview is unavailable. Do not approve publication until you can review the image.</p>
        : url
          ? <img src={url} alt={`Image to publish: ${attachment.name}`} />
          : <Loader variant="image" label={`Loading ${attachment.name}…`} />}
      <figcaption>
        <strong>This repository is public.</strong> Approving makes {attachment.name} readable by anyone and keeps it in Git history.
      </figcaption>
    </figure>
  );
}

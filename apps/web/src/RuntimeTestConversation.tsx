import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { Loader } from './Loader';
import { MarkdownContent } from './MarkdownContent';
import { Modal } from './Modal';
import { cancelChatTurn, loadConversationHistory, sendChatTurn, type ChatMessage, type RuntimeTestSession } from './conversation-history';
import './RuntimeTestSelector.css';

/** A session-scoped test view; normal chat remains mounted with its own draft and session. */
export function RuntimeTestConversation({ session, config, getAccessToken, onClose }: {
  session: RuntimeTestSession;
  config: PublicConfig;
  getAccessToken: () => Promise<string>;
  onClose: () => void;
}) {
  const id = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const active = useRef<{ controller: AbortController; messageId: string | undefined } | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const append = useCallback((message: ChatMessage) => setMessages(current => [...current.filter(item => item.id !== message.id), message]), []);
  const load = useCallback((before?: string) => loadConversationHistory(getAccessToken, config, before, session.id).then(page => {
    setMessages(current => [...new Map([...page.messages, ...current].map(message => [message.id, message])).values()]
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })));
    setNextCursor(page.nextCursor);
    setPartial('');
    setError('');
  }).catch(() => {
    setError('Could not load this test conversation. Refresh history before sending again.');
  }).finally(() => setLoading(false)), [config, getAccessToken, session.id]);
  useEffect(() => { void load(); return () => { active.current?.controller.abort(); }; }, [load]);
  useEffect(() => { transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight }); }, [messages, partial]);
  const refresh = (before?: string) => { setLoading(true); setError(''); void load(before); };
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || active.current || loading || error) return;
    const turn = { controller: new AbortController(), messageId: undefined as string | undefined };
    active.current = turn;
    setBusy(true);
    setAccepted(false);
    setDraft('');
    setPartial('');
    try {
      const reply = await sendChatTurn(getAccessToken, config, session, text, message => {
        turn.messageId = message.id;
        setAccepted(true);
        append(message);
      }, delta => setPartial(current => current + delta), undefined, undefined, undefined, turn.controller.signal,
      message => append(message));
      append(reply);
      setPartial('');
    } catch {
      if (!turn.messageId) setDraft(text);
      setError('The reply was interrupted. It may have completed or performed an action. Refresh history and check action status before sending again.');
    } finally { active.current = null; setBusy(false); setStopping(false); }
  };
  const stop = async () => {
    const turn = active.current;
    if (!turn?.messageId || stopping) return;
    setStopping(true);
    try {
      await cancelChatTurn(getAccessToken, config, { sessionId: session.id, messageId: turn.messageId, language: session.language });
      turn.controller.abort();
    } catch { setError('Could not confirm that the reply stopped. Wait for the reply and check action status.'); }
    finally { setStopping(false); }
  };
  const label = session.runtimeTest === 'copilot' ? 'Copilot' : 'Current';
  return <Modal title={`${label} test conversation`} titleId={`${id}-title`} onClose={onClose} busy={busy}
    className="runtime-test-conversation" footer={<form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor={`${id}-message`}>Message {label}</label>
      <textarea className="form-control" id={`${id}-message`} value={draft} rows={3} disabled={busy || loading || Boolean(error)}
        onChange={event => setDraft(event.target.value)} />
      <div className="button-group">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Return to normal conversation</button>
        {busy ? <button type="button" className="secondary-button" disabled={!accepted || stopping} onClick={() => { void stop(); }}>Stop reply</button>
          : <button type="submit" className="primary-button" disabled={!draft.trim() || loading || Boolean(error)}>Send</button>}
      </div>
    </form>}>
    <p>This separate test uses {label}. Its messages stay out of normal conversation history.</p>
    <div ref={transcript} className="runtime-test-transcript" role="log" aria-label={`${label} test messages`} aria-busy={loading || busy}>
      {nextCursor && <button type="button" className="secondary-button" disabled={loading || busy} onClick={() => { refresh(nextCursor); }}>Load older messages</button>}
      {loading && <Loader variant="text" label="Loading test history" />}
      {!loading && !messages.length && <p>No test messages yet.</p>}
      {messages.map(message => <article key={message.id} className="runtime-test-message">
        <strong>{message.role === 'dan' ? 'You' : 'Jarvis'}</strong>
        <MarkdownContent source={message.text} />
      </article>)}
      {partial && <article className="runtime-test-message"><strong>Jarvis</strong><MarkdownContent source={partial} streaming /></article>}
      {busy && <Loader variant="text" label="Waiting for test reply" text="Replying" />}
    </div>
    {error && <div role="alert"><p>{error}</p><button className="secondary-button" type="button" disabled={busy || loading}
      onClick={() => { refresh(); }}>Refresh history</button></div>}
  </Modal>;
}

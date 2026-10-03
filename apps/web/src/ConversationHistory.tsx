import { useEffect, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import {
  loadConversationHistory,
  type ConversationHistoryMessage,
} from './conversation-history';

export function ConversationHistory({
  client,
  config,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
}) {
  const [messages, setMessages] = useState<ConversationHistoryMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void loadConversationHistory(client, config).then((page) => {
      if (!active) return;
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Jarvis could not load conversation history.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, config, reload]);

  function retry() {
    setLoading(true);
    setError('');
    setMessages([]);
    setNextCursor(null);
    setReload((value) => value + 1);
  }

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setError('');
    try {
      const page = await loadConversationHistory(client, config, nextCursor);
      setMessages((current) => [...page.messages, ...current]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Jarvis could not load older conversation history.');
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section className="conversation-history" aria-labelledby="conversation-history-heading">
      <h2 id="conversation-history-heading">Conversation history</h2>
      {loading ? (
        <p role="status" aria-live="polite">Loading conversation history…</p>
      ) : error && messages.length === 0 ? (
        <div className="history-feedback">
          <p role="alert">{error}</p>
          <button className="history-button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : messages.length === 0 ? (
        <p>No conversation history yet.</p>
      ) : (
        <>
          {nextCursor && (
            <button className="history-button" type="button" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? 'Loading older history…' : 'Load older history'}
            </button>
          )}
          {error && <p role="alert" className="history-error">{error}</p>}
          <ol className="conversation-messages" aria-label="Messages between Dan and Jarvis">
            {messages.map((message) => (
              <li className="conversation-message" key={message.id}>
                <div className="message-heading">
                  <strong>{message.role === 'dan' ? 'Dan' : 'Jarvis'}</strong>
                  <time dateTime={message.at}>{new Date(message.at).toLocaleString()}</time>
                </div>
                <p className="message-language">
                  {message.channel === 'voice' ? 'Voice' : 'Chat'} · {message.language === 'da' ? 'Danish' : 'English'}
                </p>
                <p>{message.text}</p>
                {message.toolCalls.length > 0 && (
                  <ul className="message-tools" aria-label="Tool calls">
                    {message.toolCalls.map((call) => (
                      <li key={call.id}>
                        <span className="tool-call">
                          {call.tool} · {call.outcome}{call.taskId ? ` · Task #${call.taskId}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

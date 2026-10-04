import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { Link } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import { VoiceControls } from './VoiceControls';
import { useJarvisActivity } from './activity-context';
import type { ScreenShareController } from './screen-sharing';
import {
  createChatSession,
  loadConversationHistory,
  sendChatTurn,
  type ChatMessage,
  type ChatSession,
  type ConversationHistoryMessage,
} from './conversation-history';

const maxTaskId = 9_223_372_036_854_775_807n;

function asHistoryMessage(message: ChatMessage, language: 'da' | 'en'): ConversationHistoryMessage {
  return {
    ...message,
    channel: 'chat',
    language,
    voiceMinutes: null,
    toolCalls: [],
  };
}

function validTaskId(value: string | null): value is string {
  return value !== null && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxTaskId;
}

export function ConversationHistory({
  client,
  config,
  historyRefresh = 0,
  children,
  screenShare,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  historyRefresh?: number;
  children?: ReactNode;
  screenShare?: ScreenShareController;
}) {
  const { beginWorking } = useJarvisActivity();
  const [messages, setMessages] = useState<ConversationHistoryMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [reload, setReload] = useState(0);
  const [language, setLanguage] = useState<'da' | 'en'>('da');
  const [session, setSession] = useState<ChatSession | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [interruptedText, setInterruptedText] = useState('');
  const [turnError, setTurnError] = useState('');
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const replyEnd = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);
  const lastMessageId = messages.at(-1)?.id;

  useEffect(() => {
    if (!voiceActive) replyEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [lastMessageId, streamedText, sending, voiceActive]);

  useEffect(() => {
    const busy = voiceActive || sending;
    if (wasBusy.current && !busy) input.current?.focus();
    wasBusy.current = busy;
  }, [voiceActive, sending]);
  const [screenContext, setScreenContext] = useState<{ sessionId: string; description: string } | null>(null);

  useEffect(() => {
    let active = true;
    void loadConversationHistory(client, config).then((page) => {
      if (!active) return;
      setHistoryError('');
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
    }).catch((reason: unknown) => {
      if (!active) return;
      setHistoryError(reason instanceof Error ? reason.message : 'Jarvis could not load conversation history.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, config, historyRefresh, voiceRefresh, reload]);

  function retry() {
    setLoading(true);
    setHistoryError('');
    setMessages([]);
    setNextCursor(null);
    setReload((value) => value + 1);
  }

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setHistoryError('');
    try {
      const page = await loadConversationHistory(client, config, nextCursor);
      setMessages((current) => [...page.messages, ...current]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : 'Jarvis could not load older conversation history.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || voiceActive) return;
    const finishWorking = beginWorking('chat-turn');
    setSending(true);
    setTurnError('');
    setHistoryError('');
    setStreamedText('');
    setInterruptedText('');
    let userMessageSaved = false;
    let partialReply = '';
    let contextForTurn: string | undefined;
    try {
      const activeSession = session?.language === language
        ? session
        : await createChatSession(client, config, language);
      setSession(activeSession);
      contextForTurn = screenContext?.sessionId === activeSession.id ? screenContext.description : undefined;
      setScreenContext(null);
      if (/what(?:'s| is) on (?:my|the) screen|look at (?:my|the) screen/iu.test(text) &&
          screenShare?.sharing && contextForTurn === undefined) {
        contextForTurn = await screenShare.inspect(activeSession.id);
      }
      const assistant = await sendChatTurn(
        client,
        config,
        activeSession,
        text,
        (message) => {
          userMessageSaved = true;
          setMessages((current) => [...current, asHistoryMessage(message, activeSession.language)]);
        },
        (delta) => {
          partialReply += delta;
          setStreamedText(partialReply);
        },
        () => { userMessageSaved = true; },
        contextForTurn,
      );
      setMessages((current) => [...current, asHistoryMessage(assistant, activeSession.language)]);
      setDraft('');
      setStreamedText('');
      setReload((value) => value + 1);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Jarvis could not finish the reply.';
      setTurnError(message);
      if (userMessageSaved) {
        setDraft('');
        setInterruptedText(partialReply);
        setStreamedText('');
        setReload((value) => value + 1);
      }

    } finally {
      finishWorking();
      setSending(false);
    }
  }

  async function inspectScreen() {
    if (!screenShare?.sharing || sending) return;
    setTurnError('');
    try {
      const activeSession = session?.language === language
        ? session
        : await createChatSession(client, config, language);
      setSession(activeSession);
      const description = await screenShare.inspect(activeSession.id);
      setScreenContext({ sessionId: activeSession.id, description });
    } catch (reason) {
      setTurnError(reason instanceof Error ? reason.message : 'Jarvis could not inspect the shared screen.');
    }
  }

  const displayedVoiceUsage = new Set<string>();

  return (
    <section className="conversation-history" data-turn-active={sending || undefined} aria-label="Conversation">
      <div className="conversation-transcript" hidden={voiceActive} tabIndex={0} aria-label="Conversation history">
      {loading ? (
        <p role="status" aria-live="polite">Loading conversation history…</p>
      ) : historyError && messages.length === 0 ? (
        <div className="history-feedback">
          <p role="alert">{historyError}</p>
          <button className="history-button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : messages.length === 0 ? (
        <p>No messages yet. Send a message to begin the conversation.</p>
      ) : (
        <>
          {nextCursor && (
            <button className="history-button" type="button" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? 'Loading older history…' : 'Load older history'}
            </button>
          )}
          {historyError && <p role="alert" className="history-error">{historyError}</p>}
          <ol className="conversation-messages" aria-label="Messages between Dan and Jarvis">
            {messages.map((message) => {
              const voiceUsageText = message.channel === 'voice' && message.voiceMinutes != null &&
                !displayedVoiceUsage.has(message.sessionId)
                ? ` · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(message.voiceMinutes)} voice minutes`
                : '';
              if (voiceUsageText) displayedVoiceUsage.add(message.sessionId);
              return (
                <li className="conversation-message" key={message.id}>
                  <div className="message-heading">
                    <strong>{message.role === 'dan' ? 'Dan' : 'Jarvis'}</strong>
                    <time dateTime={message.at}>{new Date(message.at).toLocaleString()}</time>
                  </div>
                  <p className="message-language">
                    {message.channel === 'voice' ? 'Voice' : 'Chat'} · {message.language === 'da' ? 'Danish' : 'English'}
                    {voiceUsageText}
                  </p>
                  <p>{message.text}</p>
                  {message.toolCalls.length > 0 && (
                    <ul className="message-tools" aria-label="Tool calls">
                      {message.toolCalls.map((call) => (
                        <li key={call.id}>
                          <span className="tool-call">{call.tool} · {call.outcome}</span>
                          {validTaskId(call.taskId) && (
                            <Link className="task-reference" to={`/factory/tasks/${call.taskId}`}>
                              Task #{call.taskId}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {streamedText && (
        <p className="streaming-reply" aria-label="Jarvis reply in progress">{streamedText}</p>
      )}
      {interruptedText && (
        <p className="interrupted-reply">
          Partial reply, interrupted: {interruptedText}
        </p>
      )}
      {turnError && (
        <div>
          <p className="chat-error" role="alert">{turnError}</p>
          <p className="chat-guidance">If a reply is interrupted, check the conversation and task status before sending again.</p>
        </div>
      )}
      {sending && <p className="chat-status" role="status" aria-live="polite">Jarvis is replying…</p>}
      <div ref={replyEnd} />
      {children}
      </div>

      <div className="conversation-input" data-voice-active={voiceActive}>
      <form id="conversation-composer" className="composer" hidden={voiceActive} onSubmit={(event) => void sendMessage(event)}>
        <fieldset className="choice-group" disabled={sending}>
          <legend>Reply language</legend>
          <label className="choice">
            <input
              type="radio"
              name="language"
              value="da"
              checked={language === 'da'}
              onChange={() => setLanguage('da')}
            /> Danish
          </label>
          <label className="choice">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === 'en'}
              onChange={() => setLanguage('en')}
            /> English
          </label>
        </fieldset>
        <label htmlFor="message">Message Jarvis</label>
        <textarea
          ref={input}
          id="message"
          name="message"
          rows={2}
          maxLength={20_000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={sending}
          aria-describedby="chat-guidance"
        />
        <p id="chat-guidance" className="chat-guidance">
          Enter to send; Shift+Enter for a new line.
        </p>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={() => void inspectScreen()}
            disabled={sending || !screenShare?.sharing}>
            Look at screen
          </button>
        </div>
        {screenContext && screenContext.sessionId === session?.id &&
          <p role="status">Screen context is ready for the next message; it will not be saved in conversation history.</p>}
      </form>
      <div className="conversation-actions">
      <VoiceControls
        client={client}
        config={config}
        {...(screenShare ? { screenShare } : {})}
        language={language}
        disabled={sending}
        onActiveChange={setVoiceActive}
        onSessionEnded={() => {
          screenShare?.stop();
          setVoiceRefresh((value) => value + 1);
        }}
      />
      {!voiceActive && (
        <button className="primary-button" type="submit" form="conversation-composer" disabled={sending || !draft.trim()}>
          Send
        </button>
      )}
      </div>
      </div>
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { Link } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import type { CameraController, ScreenShareController } from './screen-sharing';
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
  screenShare,
  camera,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  historyRefresh?: number;
  screenShare?: ScreenShareController;
  camera?: CameraController;
}) {
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
  const [visionContext, setVisionContext] = useState<{
    sessionId: string;
    description: string;
    source: 'camera' | 'screen';
  } | null>(null);

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
  }, [client, config, historyRefresh, reload]);

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
    if (!text || sending) return;
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
      contextForTurn = visionContext?.sessionId === activeSession.id ? visionContext.description : undefined;
      setVisionContext(null);
      if (isCameraRequest(text) && camera?.sharing && contextForTurn === undefined) {
        contextForTurn = await camera.inspect(activeSession.id);
      } else if (isScreenRequest(text) && screenShare?.sharing && contextForTurn === undefined) {
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
      setSending(false);
    }
  }

  async function inspectVision(source: 'camera' | 'screen') {
    const capture = source === 'camera' ? camera : screenShare;
    if (!capture?.sharing || sending || capture.inspecting) return;
    setTurnError('');
    try {
      const activeSession = session?.language === language
        ? session
        : await createChatSession(client, config, language);
      setSession(activeSession);
      const description = await capture.inspect(activeSession.id);
      setVisionContext({ sessionId: activeSession.id, description, source });
    } catch (reason) {
      setTurnError(reason instanceof Error ? reason.message : 'Jarvis could not inspect the visual frame.');
    }
  }

  function isCameraRequest(text: string) {
    return /\b(?:what am i holding|what(?:'s| is) in my hand|look at (?:my|the) camera|what can you see)\b/iu.test(text);
  }

  function isScreenRequest(text: string) {
    return /\b(?:look at (?:my|the) screen|what(?:'s| is) on (?:my|the) screen)\b/iu.test(text);
  }

  const displayedVoiceUsage = new Set<string>();

  return (
    <section className="conversation-history" aria-label="Conversation messages and controls">
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
      {turnError && <p className="chat-error" role="alert">{turnError}</p>}
      {sending && <p className="chat-status" role="status" aria-live="polite">Jarvis is replying…</p>}

      <form className="composer" onSubmit={(event) => void sendMessage(event)}>
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
          id="message"
          name="message"
          rows={3}
          maxLength={20_000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={sending}
          aria-describedby="chat-guidance"
        />
        <p id="chat-guidance" className="chat-guidance">
          If a reply is interrupted, check the conversation and task status before sending again.
        </p>
        <div className="action-row">
          <button className="primary-button" type="submit" disabled={sending || !draft.trim()}>
            Send
          </button>
          <button className="secondary-button" type="button" onClick={() => void inspectVision('screen')}
            disabled={sending || !screenShare?.sharing || screenShare.inspecting}>
            {screenShare?.inspecting ? 'Looking at screen…' : 'Look at screen'}
          </button>
          <button className="secondary-button" type="button" onClick={() => void inspectVision('camera')}
            disabled={sending || !camera?.sharing || camera.inspecting}
            aria-describedby="camera-inspection-guidance">
            {camera?.inspecting ? 'Looking at camera…' : 'Look at camera'}
          </button>
        </div>
        <span id="camera-inspection-guidance" className="visually-hidden">
          Turn on the camera from the top bar before asking Jarvis to inspect a frame.
        </span>
        {visionContext && visionContext.sessionId === session?.id &&
          <p role="status">{visionContext.source === 'camera' ? 'Camera' : 'Screen'} context is ready for the next message; it will not be saved in conversation history.</p>}
      </form>
    </section>
  );
}

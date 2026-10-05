import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { Link } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import type { CameraController, ScreenShareController } from './screen-sharing';
import { VoiceControls } from './VoiceControls';
import { useVoiceWorkspace } from './voice-workspace-state';
import {
  createChatSession,
  loadConversationHistory,
  sendChatTurn,
  type ChatMessage,
  type ChatSession,
  type ConversationHistoryMessage,
} from './conversation-history';

const maxTaskId = 9_223_372_036_854_775_807n;

function relativeTime(at: string, now: number): string {
  const seconds = Math.round((Date.parse(at) - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}

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
  camera,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  historyRefresh?: number;
  children?: ReactNode;
  screenShare?: ScreenShareController;
  camera?: CameraController;
}) {
  const { onVoiceActiveChange } = useVoiceWorkspace();
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
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLTextAreaElement>(null);
  const replyEnd = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);
  const lastMessageId = messages.at(-1)?.id;
  const updateVoiceActive = useCallback((active: boolean) => {
    const update = () => {
      setVoiceActive(active);
      onVoiceActiveChange(active);
    };
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduceMotion) {
      document.startViewTransition(update);
    } else {
      update();
    }
  }, [onVoiceActiveChange]);

  useLayoutEffect(() => {
    const textarea = input.current;
    if (!textarea || voiceActive) return;
    const grow = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    };
    grow();
    if (typeof ResizeObserver !== 'function') return;
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      grow();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [draft, voiceActive]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') setNow(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!voiceActive) replyEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [lastMessageId, streamedText, sending, voiceActive]);

  useEffect(() => {
    const busy = voiceActive || sending;
    if (wasBusy.current && !busy) input.current?.focus();
    wasBusy.current = busy;
  }, [voiceActive, sending]);

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
    const currentCameraContext = session !== null && visionContext?.source === 'camera' &&
      visionContext.sessionId === session.id && session.language === language;
    if (isCameraRequest(text) && !camera?.sharing && !currentCameraContext) {
      setTurnError('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
      return;
    }
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
      const currentVisionContext = visionContext?.sessionId === activeSession.id ? visionContext : null;
      contextForTurn = currentVisionContext?.description;
      setVisionContext(null);
      if (isCameraRequest(text) && camera?.sharing && currentVisionContext?.source !== 'camera') {
        contextForTurn = await camera.inspect(activeSession.id);
      } else if (isScreenRequest(text) && screenShare?.sharing && currentVisionContext?.source !== 'screen') {
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
        <div className="conversation-greeting">
          <h2>What’s on your mind?</h2>
          <p>Make a plan, explore an idea, or pick up where you left off.</p>
        </div>
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
                <li className="conversation-message" data-speaker={message.role} key={message.id} tabIndex={0}>
                  <div className="message-heading">
                    <strong>{message.role === 'dan' ? 'Dan' : 'Jarvis'}</strong>
                  </div>
                  <p>{message.text}</p>
                  <div className="message-metadata">
                    <p className="message-language">
                      {message.channel === 'voice' ? 'Voice' : 'Chat'} · {message.language === 'da' ? 'Danish' : 'English'}
                      {voiceUsageText}
                    </p>
                    <time dateTime={message.at} title={new Date(message.at).toLocaleString()}>{relativeTime(message.at, now)}</time>
                  </div>
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

      {sending && (
        <div className="streaming-message">
          <strong>Jarvis</strong>
          <p className="streaming-reply" aria-label="Jarvis reply in progress">{streamedText}<span className="streaming-caret" aria-hidden="true" /></p>
        </div>
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
      <div className="conversation-actions">
      <VoiceControls
        client={client}
        config={config}
        {...(screenShare ? { screenShare } : {})}
        {...(camera ? { camera } : {})}
        language={language}
        disabled={sending}
        onActiveChange={updateVoiceActive}
        onSessionEnded={() => {
          screenShare?.stop();
          camera?.stop();
          setVoiceRefresh((value) => value + 1);
        }}
      />
      </div>
      <form id="conversation-composer" className="composer" hidden={voiceActive} onSubmit={(event) => void sendMessage(event)}>
        <label className="visually-hidden" htmlFor="message">Message Jarvis</label>
        <textarea
          ref={input}
          id="message"
          name="message"
          rows={1}
          placeholder="Ask Jarvis"
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
        <div className="composer-language" role="group" aria-label="Reply language">
          <button type="button" aria-label="Danish" aria-pressed={language === 'da'} disabled={sending} onClick={() => setLanguage('da')}>DA</button>
          <button type="button" aria-label="English" aria-pressed={language === 'en'} disabled={sending} onClick={() => setLanguage('en')}>EN</button>
        </div>
        <button className="primary-button composer-send" type="submit" disabled={sending || !draft.trim()} aria-label="Send" title="Send message">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 7-7 7 7M12 5v15" />
          </svg>
        </button>
        <p id="chat-guidance" className="visually-hidden">
          Enter to send; Shift+Enter for a new line.
        </p>
        {(screenShare?.sharing || camera?.sharing) && <div className="action-row composer-vision">
          <button className="secondary-button" type="button" onClick={() => void inspectVision('screen')}
            disabled={sending || !screenShare?.sharing || screenShare.inspecting}>
            {screenShare?.inspecting ? 'Looking at screen…' : 'Look at screen'}
          </button>
          <button className="secondary-button" type="button" onClick={() => void inspectVision('camera')}
            disabled={sending || !camera?.sharing || camera.inspecting}
            aria-describedby="camera-inspection-guidance">
            {camera?.inspecting ? 'Looking at camera…' : 'Look at camera'}
          </button>
        </div>}
        <span id="camera-inspection-guidance" className="visually-hidden">
          Turn on the camera from the top bar before asking Jarvis to inspect a frame.
        </span>
        {visionContext && visionContext.sessionId === session?.id &&
          <p role="status">{visionContext.source === 'camera' ? 'Camera' : 'Screen'} context is ready for the next message; it will not be saved in conversation history.</p>}
      </form>
      </div>
    </section>
  );
}

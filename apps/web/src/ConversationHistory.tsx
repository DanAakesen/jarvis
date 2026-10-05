import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { Link } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import { sharedScreenContext, type CameraController, type ScreenShareController } from './screen-sharing';
import { VoiceControls } from './VoiceControls';
import { useVoiceWorkspace } from './voice-workspace-state';
import { MarkdownContent } from './MarkdownContent';
import { useConversationIntents } from './conversation-intents';
import {
  createChatSession,
  loadImageArtifactUrl,
  loadConversationHistory,
  sendChatTurn,
  waitForChatSetup,
  type ChatMessage,
  type ChatSession,
  type ConversationHistoryMessage,
} from './conversation-history';

const maxTaskId = 9_223_372_036_854_775_807n;

type QueuedMessage = { id: number; text: string; language: 'da' | 'en' };
type FailedTurn = QueuedMessage & { messageId?: string; error: string; partialReply: string };

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

function mergeMessages(current: ConversationHistoryMessage[], incoming: ConversationHistoryMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function validTaskId(value: string | null): value is string {
  return value !== null && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxTaskId;
}

function ConversationImageArtifact({
  client,
  config,
  artifactId,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  artifactId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadImageArtifactUrl(client, config, artifactId, controller.signal)
      .then((imageUrl) => {
        if (active) setUrl(imageUrl);
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setUnavailable(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [artifactId, client, config]);

  if (unavailable) return <span role="status">Generated image is unavailable.</span>;
  if (!url) return <span role="status">Loading generated image…</span>;
  return (
    <figure className="message-artifact">
      <img src={url} alt="Generated image" loading="lazy" />
      <figcaption>Generated image</figcaption>
    </figure>
  );
}

function isCameraRequest(text: string) {
  return /\b(?:what am i holding|what(?:'s| is) in my hand|look at (?:my|the) camera|what can you see)\b/iu.test(text);
}

function isScreenRequest(text: string) {
  return /\b(?:look at (?:my|the) screen|what(?:'s| is) on (?:my|the) screen)\b/iu.test(text);
}

function isSharedBrowserRequest(text: string) {
  return /\b(?:do|act|use|fill|complete|submit|book|buy|purchase|send|delete|choose|select|find|search|compare|open|click|type|enter|apply)\b.{0,80}\b(?:here|this|that|it|these|those)\b|\b(?:here|this|that|it|these|those)\b.{0,80}\b(?:do|act|use|fill|complete|submit|book|buy|purchase|send|delete|choose|select|find|search|compare|open|click|type|enter|apply)\b/iu.test(text);

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
  const conversationIntents = useConversationIntents();
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
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [activeMessage, setActiveMessage] = useState<QueuedMessage | null>(null);
  const [failedTurns, setFailedTurns] = useState<FailedTurn[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [turnError, setTurnError] = useState('');
  const [visionContext, setVisionContext] = useState<{
    sessionId: string;
    description: string;
    sharedWindowTitle?: string;
    source: 'camera' | 'screen';
  } | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);
  const hasFocusedInput = useRef(false);
  const hasLoadedOlder = useRef(false);
  const nextQueueId = useRef(0);
  const turnInFlight = useRef(false);
  const draftValue = useRef('');
  const turnController = useRef<AbortController | null>(null);

  useEffect(() => () => { turnController.current?.abort(); }, []);
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
    if (!voiceActive && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [lastMessageId, streamedText, sending, queue.length, failedTurns.length, voiceActive, loading]);

  useEffect(() => {
    const busy = voiceActive || sending;
    if (!busy && (!hasFocusedInput.current || wasBusy.current)) {
      input.current?.focus({ preventScroll: true });
      hasFocusedInput.current = true;
    }
    wasBusy.current = busy;
  }, [voiceActive, sending]);

  useEffect(() => {
    let active = true;
    void loadConversationHistory(client, config).then((page) => {
      if (!active) return;
      setHistoryError('');
      setMessages((current) => mergeMessages(current, page.messages));
      if (!hasLoadedOlder.current) setNextCursor(page.nextCursor);
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
    setReload((value) => value + 1);
  }

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setHistoryError('');
    try {
      const page = await loadConversationHistory(client, config, nextCursor);
      hasLoadedOlder.current = true;
      setMessages((current) => mergeMessages(current, page.messages));
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : 'Jarvis could not load older conversation history.');
    } finally {
      setLoadingOlder(false);
    }
  }

  const submitText = useCallback((value: string) => {
    const text = value.trim();
    if (!text || voiceActive) return;
    if (isSharedBrowserRequest(text) && !screenShare?.sharing) {
      setTurnError('Share the Chrome tab you want Jarvis to use, then ask again.');
      return;
    }
    const currentCameraContext = session !== null && visionContext?.source === 'camera' &&
      visionContext.sessionId === session.id && session.language === language;
    if (isCameraRequest(text) && !camera?.sharing && !currentCameraContext) {
      setTurnError('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
      return;
    }
    draftValue.current = '';
    setDraft('');
    setTurnError('');
    const queued = { id: ++nextQueueId.current, text, language };
    setQueue((current) => [...current, queued]);
  }, [camera?.sharing, language, screenShare?.sharing, session, visionContext, voiceActive]);

  useEffect(() => {
    const intent = conversationIntents.pending[0];
    if (!intent) return;
    const timer = window.setTimeout(() => {
      if (intent.type === 'message') submitText(intent.text);
      else document.querySelector<HTMLButtonElement>('[aria-label="Start voice"]')?.focus({ preventScroll: true });
      conversationIntents.consume(intent.id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [conversationIntents, submitText]);

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitText(draftValue.current);
  }

  const runTurn = useCallback(async (queued: QueuedMessage) => {
    const { text, language } = queued;
    const controller = new AbortController();
    turnController.current = controller;
    turnInFlight.current = true;
    setSending(true);
    setActiveMessage(queued);
    setHistoryError('');
    setStreamedText('');
    let userMessageSaved = false;
    let messageId: string | undefined;
    let partialReply = '';
    let contextForTurn: string | undefined;
    let sharedContextForTurn: { screenDescription: string; sharedWindowTitle?: string } | undefined;
    try {
      if (isSharedBrowserRequest(text) && !screenShare?.sharing) {
        throw new Error('Share the Chrome tab you want Jarvis to use, then ask again.');
      }
      const cameraContextReady = session?.language === language && visionContext?.source === 'camera' &&
        visionContext.sessionId === session.id;
      if (isCameraRequest(text) && !camera?.sharing && !cameraContextReady) {
        throw new Error('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
      }
      const activeSession = session?.language === language
        ? session
        : await waitForChatSetup(() => createChatSession(client, config, language, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      setSession(activeSession);
      const currentVisionContext = visionContext?.sessionId === activeSession.id ? visionContext : null;
      contextForTurn = currentVisionContext
        ? currentVisionContext.source === 'screen'
          ? sharedScreenContext(currentVisionContext.description, currentVisionContext.sharedWindowTitle)
          : currentVisionContext.description
        : undefined;
      if (isSharedBrowserRequest(text) && currentVisionContext?.source === 'screen') {
        sharedContextForTurn = {
          screenDescription: currentVisionContext.description,
          ...(currentVisionContext.sharedWindowTitle === undefined
            ? {}
            : { sharedWindowTitle: currentVisionContext.sharedWindowTitle }),
        };
      }
      setVisionContext(null);
      if (isCameraRequest(text) && camera?.sharing && currentVisionContext?.source !== 'camera') {
        contextForTurn = (await waitForChatSetup(() => camera.inspect(activeSession.id), controller.signal)).description;
      } else if ((isScreenRequest(text) || isSharedBrowserRequest(text)) && screenShare?.sharing &&
          (isSharedBrowserRequest(text) || currentVisionContext?.source !== 'screen')) {
        const context = await waitForChatSetup(() => screenShare.inspect(activeSession.id), controller.signal);
        contextForTurn = sharedScreenContext(context.description, context.sharedWindowTitle);
        if (isSharedBrowserRequest(text)) {
          sharedContextForTurn = {
            screenDescription: context.description,
            ...(context.sharedWindowTitle === undefined ? {} : { sharedWindowTitle: context.sharedWindowTitle }),
          };
        }
      }
      const assistant = await sendChatTurn(
        client,
        config,
        activeSession,
        text,
        (message) => {
          userMessageSaved = true;
          messageId = message.id;
          setActiveMessage(null);
          setMessages((current) => mergeMessages(current, [asHistoryMessage(message, activeSession.language)]));
        },
        (delta) => {
          partialReply += delta;
          setStreamedText(partialReply);
        },
        () => {
          userMessageSaved = true;
        },
        contextForTurn,
        sharedContextForTurn,
        controller.signal,
      );
      setMessages((current) => mergeMessages(current, [asHistoryMessage(assistant, activeSession.language)]));
      setStreamedText('');
      setReload((value) => value + 1);
    } catch (reason) {
      const message = controller.signal.aborted
        ? 'Reply stopped. A task action may still have completed; check its status before trying again.'
        : reason instanceof Error ? reason.message : 'Jarvis could not finish the reply.';
      setFailedTurns((current) => [...current, {
        ...queued,
        ...(messageId ? { messageId } : {}),
        error: message,
        partialReply,
      }]);
      if (userMessageSaved) {
        setStreamedText('');
        setReload((value) => value + 1);
      } else if (!draftValue.current) {
        draftValue.current = text;
        setDraft(text);
      }

    } finally {
      turnController.current = null;
      setActiveMessage(null);
      turnInFlight.current = false;
      setSending(false);
    }
  }, [session, visionContext, client, config, camera, screenShare]);

  useEffect(() => {
    if (sending || voiceActive || turnInFlight.current || queue.length === 0) return;
    const next = queue[0]!;
    setQueue((current) => current.filter((message) => message.id !== next.id));
    void runTurn(next);
  }, [queue, sending, voiceActive, runTurn]);

  function failedTurnFeedback(turn: FailedTurn) {
    return (
      <div key={turn.id}>
        {turn.partialReply && <div className="interrupted-reply">
          <p>Partial reply, interrupted:</p>
          <MarkdownContent source={turn.partialReply} />
        </div>}
        <p className="chat-error" role="alert">{turn.error}</p>
        <p className="chat-guidance">If a reply is interrupted, check the conversation and task status before sending again.</p>
      </div>
    );
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
      const context = await capture.inspect(activeSession.id);
      setVisionContext({
        sessionId: activeSession.id,
        description: context.description,
        ...(context.sharedWindowTitle ? { sharedWindowTitle: context.sharedWindowTitle } : {}),
        source,
      });
    } catch (reason) {
      setTurnError(reason instanceof Error ? reason.message : 'Jarvis could not inspect the visual frame.');
    }
  }

  const displayedVoiceUsage = new Set<string>();

  return (
    <section className="conversation-history" data-turn-active={sending || undefined} aria-label="Conversation">
      <div ref={transcript} className="conversation-transcript" hidden={voiceActive} tabIndex={0} aria-label="Conversation history">
      {loading ? (
        <p role="status" aria-live="polite">Loading conversation history…</p>
      ) : historyError && messages.length === 0 ? (
        <div className="history-feedback">
          <p role="alert">{historyError}</p>
          <button className="history-button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : messages.length === 0 && !sending && queue.length === 0 && failedTurns.length === 0 ? (
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
                  {message.role === 'jarvis' && message.channel === 'chat'
                    ? <MarkdownContent source={message.text} />
                    : <p>{message.text}</p>}
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
                          {call.tool === 'image_generation' && call.outcome === 'ok' && call.artifactId && (
                            <ConversationImageArtifact client={client} config={config} artifactId={call.artifactId} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {failedTurns.filter((turn) => turn.messageId === message.id).map(failedTurnFeedback)}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {failedTurns.filter((turn) => !turn.messageId).map((turn) => (
        <div className="conversation-message" data-speaker="dan" key={turn.id}>
          <div className="message-heading"><strong>Dan</strong></div>
          <p>{turn.text}</p>
          {failedTurnFeedback(turn)}
        </div>
      ))}
      {activeMessage && <div className="conversation-message" data-speaker="dan">
        <div className="message-heading"><strong>Dan</strong></div>
        <p>{activeMessage.text}</p>
        <p className="queued-state">Sending · {activeMessage.language === 'da' ? 'Danish' : 'English'}</p>
      </div>}
      {sending && (
        <div className="streaming-message">
          <button className="history-button stop-reply" type="button" onClick={() => turnController.current?.abort()}>
            Stop reply
          </button>
          {streamedText ? (
            <>
              <strong>Jarvis</strong>
              <div className="streaming-reply" aria-label="Jarvis reply in progress">
                <MarkdownContent source={streamedText} streaming />
                <span className="streaming-caret" aria-hidden="true" />
              </div>
            </>
          ) : (
            <p className="chat-thinking" role="status" aria-live="polite">
              <span className="thinking-dot" aria-hidden="true" />
              Jarvis is thinking…
            </p>
          )}
        </div>
      )}
      {turnError && (
        <div>
          <p className="chat-error" role="alert">{turnError}</p>
          <p className="chat-guidance">If a reply is interrupted, check the conversation and task status before sending again.</p>
        </div>
      )}
      {sending && streamedText && <p className="chat-status" role="status" aria-live="polite">Jarvis is replying…</p>}
      <p className={`queue-count${queue.length === 0 ? ' visually-hidden' : ''}`} aria-live="polite" aria-atomic="true">
        {`${queue.length} ${queue.length === 1 ? 'message' : 'messages'} queued`}
      </p>
      {queue.length > 0 && <ol className="conversation-messages queued-messages" aria-label="Queued messages">
        {queue.map((message) => (
          <li className="conversation-message" data-speaker="dan" key={message.id}>
            <div className="message-heading queued-heading">
              <strong>Dan</strong>
              <button className="queue-remove" type="button"
                aria-label={`Remove queued message: ${message.text}`}
                onClick={() => setQueue((current) => current.filter((item) => item.id !== message.id))}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <p>{message.text}</p>
            <p className="queued-state">Queued · {message.language === 'da' ? 'Danish' : 'English'}</p>
          </li>
        ))}
      </ol>}
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
          onChange={(event) => {
            draftValue.current = event.target.value;
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-describedby="chat-guidance"
        />
        <div className="composer-language" role="group" aria-label="Reply language">
          <button type="button" aria-label="Danish" aria-pressed={language === 'da'} onClick={() => setLanguage('da')}>DA</button>
          <button type="button" aria-label="English" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
        </div>
        <button className="primary-button composer-send" type="submit" disabled={!draft.trim()} aria-label="Send" title="Send message">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 7-7 7 7M12 5v15" />
          </svg>
        </button>
        <p id="chat-guidance" className="visually-hidden">
          Enter to send; Shift+Enter for a new line. Messages sent during a reply queue in order.
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

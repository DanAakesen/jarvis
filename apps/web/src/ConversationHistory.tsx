import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PublicClientApplication } from '@azure/msal-browser';
import { useLocation } from 'react-router-dom';
import { TaskWindowLink } from './TaskWindowLink';
import { LivePhrase, ToolCallChip, WorkingCore, type ToolState } from './ToolCallChip';
import { useJarvisActivity } from './activity-context';
import type { PublicConfig } from '../config/public-config';
import { sharedScreenContext, type CameraController, type ScreenShareController } from './screen-sharing';
import { ConversationHandle } from './ConversationHandle';
import { ConversationMoreMenu, type MoreMenuAction } from './ConversationMoreMenu';
import { ConversationToast } from './ConversationToast';
import { VoiceControls } from './VoiceControls';
import { useVoiceWorkspace } from './voice-workspace-state';
import { WorkspaceCommandContext } from './workspace-command-state';
import { conversationViewId, useConversationWindow } from './conversation-window-state';
import { MarkdownContent } from './MarkdownContent';
import { useConversationIntents } from './conversation-intents';
import { Loader } from './Loader';
import {
  createChatSession,
  loadImageArtifactUrl,
  loadConversationHistory,
  sendChatTurn,
  steerChatTurn,
  waitForChatSetup,
  type ChatMessage,
  type ChatSession,
  type ConversationHistoryMessage,
  type ConversationHistoryToolCall,
} from './conversation-history';

const maxTaskId = 9_223_372_036_854_775_807n;

type QueuedMessage = { id: number; text: string; language: 'da' | 'en' };
const followThreshold = 32;
const draftKey = 'jarvis.chat.draft';

/** The unsent message survives moving between pages in this tab; it is never sent anywhere. */
function readDraft(): string {
  try { return sessionStorage.getItem(draftKey) ?? ''; } catch { return ''; }
}

function writeDraft(value: string) {
  try {
    if (value) sessionStorage.setItem(draftKey, value);
    else sessionStorage.removeItem(draftKey);
  } catch { /* The draft then lasts only while the page is open. */ }
}

function ConversationIcon({ name }: { name: 'screen' | 'camera' | 'send' | 'latest' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'screen':
      return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>;
    case 'camera':
      return <svg {...common}><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'send':
      return <svg {...common}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>;
    case 'latest':
      return <svg {...common}><path d="M12 5v14m-6-6 6 6 6-6" /></svg>;
  }
}

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
    interrupted: false,
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
  if (!url) return <Loader variant="image" label="Loading generated image…" />;
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
  const [historyErrorId, setHistoryErrorId] = useState(0);
  const [reload, setReload] = useState(0);
  const [language, setLanguage] = useState<'da' | 'en'>('en');
  const [session, setSession] = useState<ChatSession | null>(null);
  const { latestActivity } = useJarvisActivity();
  // Tools used in the current chat turn, collected from runtime activity as they start and finish.
  const [liveTools, setLiveTools] = useState<{ id: string; tool: string; state: ToolState }[]>([]);
  const [seenActivity, setSeenActivity] = useState(latestActivity);
  if (latestActivity !== seenActivity) {
    setSeenActivity(latestActivity);
    if (latestActivity?.source === 'chat' &&
        (latestActivity.type === 'tool-call-started' || latestActivity.type === 'tool-call-finished')) {
      const event = latestActivity;
      setLiveTools((current) => {
        const state: ToolState = event.type === 'tool-call-started' ? 'running' : event.outcome;
        return current.some((tool) => tool.id === event.activityId)
          ? current.map((tool) => tool.id === event.activityId ? { ...tool, state } : tool)
          : [...current, { id: event.activityId, tool: event.toolName, state }].slice(-12);
      });
    }
  }
  const [draft, setDraft] = useState(readDraft);
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [activeMessage, setActiveMessage] = useState<QueuedMessage | null>(null);
  const [failedTurns, setFailedTurns] = useState<FailedTurn[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [turnError, setTurnError] = useState('');
  const [steering, setSteering] = useState(false);
  const [visionContext, setVisionContext] = useState<{
    sessionId: string;
    description: string;
    sharedWindowTitle?: string;
    source: 'camera' | 'screen';
  } | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [atLatest, setAtLatest] = useState(true);
  const conversationWindow = useConversationWindow();
  const workspaceCommands = useContext(WorkspaceCommandContext);
  const { key: locationKey } = useLocation();
  const seenLocationKey = useRef(locationKey);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followedTranscript = useRef<HTMLDivElement | null>(null);
  const inputBar = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const wasBusy = useRef(false);
  const hasFocusedInput = useRef(false);
  const hasLoadedOlder = useRef(false);
  const nextQueueId = useRef(0);
  const turnInFlight = useRef(false);
  const draftValue = useRef(draft);
  useEffect(() => { writeDraft(draft); }, [draft]);
  const dismissHistoryError = useCallback(() => setHistoryError(''), []);
  const turnController = useRef<AbortController | null>(null);
  const turnSession = useRef<ChatSession | null>(null);

  useEffect(() => () => { turnController.current?.abort(); }, []);
  const lastMessageId = messages.at(-1)?.id;
  const windowed = messages.length > 0 || sending || queue.length > 0 || failedTurns.length > 0 || activeMessage !== null || Boolean(turnError);
  const hosted = windowed && conversationWindow !== null;
  const setConversationAvailable = conversationWindow?.setAvailable;
  useLayoutEffect(() => { setConversationAvailable?.(windowed); }, [setConversationAvailable, windowed]);
  useLayoutEffect(() => () => { setConversationAvailable?.(false); }, [setConversationAvailable]);
  const updateVoiceActive = useCallback((active: boolean) => {
    setVoiceActive(active);
    onVoiceActiveChange(active);
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
    // Follow new content only while Dan is reading the latest message; scrolling up keeps his place.
    // A newly mounted window (first history or reopened after Close) starts at the latest message.
    const element = transcript.current;
    if (!element || (!followLatest.current && element === followedTranscript.current)) return;
    followedTranscript.current = element;
    followLatest.current = true;
    element.scrollTop = element.scrollHeight;
  }, [lastMessageId, streamedText, sending, queue.length, failedTurns.length, voiceActive, loading, conversationWindow?.element]);

  function updateFollow() {
    const element = transcript.current;
    if (!element) return;
    const latest = element.scrollHeight - element.scrollTop - element.clientHeight <= followThreshold;
    followLatest.current = latest;
    setAtLatest(latest);
  }

  function jumpToLatest() {
    const element = transcript.current;
    followLatest.current = true;
    setAtLatest(true);
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    element.focus({ preventScroll: true });
  }

  useEffect(() => {
    // Closing the history window must leave typing usable: focus returns to the composer, not the page.
    // The workspace may first focus its own heading, which only blurs once the empty workspace hides
    // during the next rendering update, so check after that update.
    if (!hosted || conversationWindow?.element) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) input.current?.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [conversationWindow?.element, hosted]);

  const revealHistory = useCallback(() => {
    // History is a shared workspace view, so it returns through the same restore command Jarvis uses.
    if (!workspaceCommands || workspaceCommands.isViewVisible?.(conversationViewId)) return;
    workspaceCommands.dispatch({ commandId: 'conversation-reveal', operation: 'restore', viewId: conversationViewId });
  }, [workspaceCommands]);

  const shownFailure = useRef('');
  useEffect(() => {
    // Turn errors are shown in the history, so a new failure brings a closed or minimised window back.
    const failure = turnError || (failedTurns.length > 0 ? `failed-${failedTurns.at(-1)!.id}` : '');
    if (failure === shownFailure.current) return;
    shownFailure.current = failure;
    if (failure) revealHistory();
  }, [failedTurns, revealHistory, turnError]);

  useEffect(() => {
    // Choosing Conversation in the navigation brings a closed or minimised history back.
    if (seenLocationKey.current === locationKey) return;
    seenLocationKey.current = locationKey;
    revealHistory();
  }, [locationKey, revealHistory]);

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
      setHistoryErrorId((value) => value + 1);
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
      setHistoryErrorId((value) => value + 1);
    } finally {
      setLoadingOlder(false);
    }
  }

  const submitText = useCallback((value: string, queueOnly = false) => {
    const text = value.trim();
    if (!text || voiceActive) return;
    const currentCameraContext = session !== null && visionContext?.source === 'camera' &&
      visionContext.sessionId === session.id && session.language === language;
    if (isCameraRequest(text) && !camera?.sharing && !currentCameraContext) {
      setTurnError('Turn on the camera from the top bar before asking Jarvis to inspect a frame.');
      return;
    }
    draftValue.current = '';
    setDraft('');
    setTurnError('');
    // A new message needs its reply visible: bring history back and follow the latest content.
    followLatest.current = true;
    setAtLatest(true);
    revealHistory();
    const queued = { id: ++nextQueueId.current, text, language };
    const activeSession = turnSession.current;
    if (sending && !queueOnly && activeSession) {
      setSteering(true);
      void steerChatTurn(client, config, activeSession, text, language).then((message) => {
        setMessages((current) => mergeMessages(current, [asHistoryMessage(message, message.language)]));
      }).catch((reason: unknown) => {
        setSteering(false);
        const error = reason instanceof Error ? reason.message : 'Jarvis could not steer the active reply.';
        if (error.includes('No active chat turn to steer')) {
          setQueue((current) => [...current, queued]);
        } else {
          setTurnError(error);
          if (!draftValue.current) {
            draftValue.current = text;
            setDraft(text);
          }
        }
      });
      return;
    }
    setQueue((current) => [...current, queued]);
  }, [camera?.sharing, client, config, language, revealHistory, sending, session, visionContext, voiceActive]);

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
    turnSession.current = null;
    turnInFlight.current = true;
    setSending(true);
    setLiveTools([]);
    setActiveMessage(queued);
    setHistoryError('');
    setStreamedText('');
    let userMessageSaved = false;
    let messageId: string | undefined;
    let partialReply = '';
    let contextForTurn: string | undefined;
    let sharedContextForTurn: { screenDescription: string; sharedWindowTitle?: string } | undefined;
    try {
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
      turnSession.current = activeSession;
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
        (message) => {
          partialReply = '';
          setMessages((current) => mergeMessages(current, [{
            ...asHistoryMessage(message, activeSession.language),
            interrupted: true,
          }]));
          setStreamedText('');
          setSteering(false);
        },
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
      turnSession.current = null;
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

  const displayedVoiceUsage = new Set<string>();
  // Only Jarvis's newest reply carries the settled rim glow; while a turn runs, the live bubble has the running light.
  const latestJarvisId = [...messages].reverse().find((message) => message.role === 'jarvis')?.id;
  // Tool calls are recorded on Dan's turn, but they are Jarvis's work: show them on Jarvis's reply. A turn without a
  // reply (yet) gets a small Jarvis-side row of its own.
  const toolPlacement = (() => {
    const reply = new Map<string, ConversationHistoryToolCall[]>();
    const unanswered = new Map<string, ConversationHistoryToolCall[]>();
    let pending: ConversationHistoryToolCall[] = [];
    let pendingFrom: string | null = null;
    for (const message of messages) {
      if (message.role === 'dan') {
        if (pending.length && pendingFrom) unanswered.set(pendingFrom, pending);
        pending = [...message.toolCalls];
        pendingFrom = message.id;
      } else {
        const calls = [...pending, ...message.toolCalls];
        if (calls.length) reply.set(message.id, calls);
        pending = [];
        pendingFrom = null;
      }
    }
    if (pending.length && pendingFrom) unanswered.set(pendingFrom, pending);
    return { reply, unanswered };
  })();
  const renderToolCalls = (calls: ConversationHistoryToolCall[]) => (
    <ul className="message-tools" aria-label="Tool calls">
      {calls.map((call) => (
        <li key={call.id}>
          <ToolCallChip tool={call.tool} state={call.outcome === 'ok' || call.outcome === 'refused' ? call.outcome : 'error'} />
          {validTaskId(call.taskId) && (
            <TaskWindowLink className="task-reference" taskId={call.taskId}>
              Task #{call.taskId}
            </TaskWindowLink>
          )}
          {call.tool === 'image_generation' && call.outcome === 'ok' && call.artifactId && (
            <ConversationImageArtifact client={client} config={config} artifactId={call.artifactId} />
          )}
        </li>
      ))}
    </ul>
  );

  // Sharing lives in the More menu (not the top bar); a live line above the composer shows what Jarvis can see.
  const captureActions: MoreMenuAction[] = [
    ...(screenShare ? [{
      id: 'share-screen',
      label: screenShare.sharing ? 'Stop sharing screen' : screenShare.starting ? 'Starting screen share…' : 'Share screen',
      icon: <ConversationIcon name="screen" />,
      onSelect: () => { if (screenShare.sharing) screenShare.stop(); else void screenShare.start(); },
      disabled: screenShare.starting,
    }] : []),
    ...(camera ? [{
      id: 'share-camera',
      label: camera.sharing ? 'Turn camera off' : camera.starting ? 'Starting camera…' : 'Turn camera on',
      icon: <ConversationIcon name="camera" />,
      onSelect: () => { if (camera.sharing) camera.stop(); else void camera.start(); },
      disabled: camera.starting,
    }] : []),
  ];
  // Sharing is the only visual control; to have Jarvis look, Dan simply asks in the conversation.
  const attachActions: MoreMenuAction[] = captureActions;

  const latestButton = !atLatest && (
    <button className="conversation-latest" type="button" onClick={jumpToLatest}>
      <ConversationIcon name="latest" />
      <span>Jump to latest</span>
    </button>
  );
  const transcriptContent = (
    <>
        {loading ? (
          <Loader variant="core" label="Loading conversation history…" />
        ) : historyError && messages.length === 0 ? null : messages.length === 0 && !sending && queue.length === 0 && failedTurns.length === 0 ? (
          <div className="conversation-greeting visually-hidden">
            {/* Dan, 8 October: no greeting card; screen readers still hear that the conversation is empty. */}
            <h2>What’s on your mind?</h2>
            <p>Make a plan, explore an idea, or pick up where you left off.</p>
          </div>
        ) : (
          <>
            {nextCursor && (
              <button className="history-button" type="button" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder ? <Loader variant="inline" announce={false} label="Loading older history…" /> : 'Load older history'}
              </button>
            )}
            <ol className="conversation-messages" aria-label="Messages between Dan and Jarvis">
              {messages.map((message) => {
                const voiceUsageText = message.channel === 'voice' && message.voiceMinutes != null &&
                  !displayedVoiceUsage.has(message.sessionId)
                  ? ` · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(message.voiceMinutes)} voice minutes`
                  : '';
                if (voiceUsageText) displayedVoiceUsage.add(message.sessionId);
                return (
                  <Fragment key={message.id}>
                  <li className="conversation-message" data-speaker={message.role} data-latest={message.id === latestJarvisId && !sending || undefined} tabIndex={0}>
                    <strong className="message-author visually-hidden">{message.role === 'dan' ? 'Dan' : 'Jarvis'}</strong>
                    {message.role === 'jarvis' && message.channel === 'chat'
                      ? <MarkdownContent source={message.text} />
                      : <p>{message.text}</p>}
                    {message.interrupted && <p className="interrupted-label">Interrupted</p>}
                    {/* Only the time, tucked onto the bubble's top-right edge and shown on hover; voice usage is read out to screen readers. */}
                    <div className="message-metadata">
                      <time dateTime={message.at} title={new Date(message.at).toLocaleString()}>
                        {relativeTime(message.at, now)}
                      </time>
                      {voiceUsageText && <span className="visually-hidden">{`Voice${voiceUsageText}`}</span>}
                    </div>
                    {message.role === 'jarvis' && toolPlacement.reply.get(message.id) && renderToolCalls(toolPlacement.reply.get(message.id)!)}
                    {failedTurns.filter((turn) => turn.messageId === message.id).map(failedTurnFeedback)}
                  </li>
                  {toolPlacement.unanswered.get(message.id) && (
                    <li className="conversation-message conversation-tools-only" data-speaker="jarvis">
                      <strong className="message-author visually-hidden">Jarvis</strong>
                      {renderToolCalls(toolPlacement.unanswered.get(message.id)!)}
                    </li>
                  )}
                  </Fragment>
                );
              })}
            </ol>
          </>
        )}

        {failedTurns.filter((turn) => !turn.messageId).map((turn) => (
          <div className="conversation-message" data-speaker="dan" key={turn.id}>
            <strong className="message-author visually-hidden">Dan</strong>
            <p>{turn.text}</p>
            {failedTurnFeedback(turn)}
          </div>
        ))}
        {activeMessage && <div className="conversation-message" data-speaker="dan">
          <strong className="message-author visually-hidden">Dan</strong>
          <p>{activeMessage.text}</p>
          <p className="queued-state">Sending · {activeMessage.language === 'da' ? 'Danish' : 'English'}</p>
        </div>}
        {sending && (
          // The live turn: Jarvis's bubble shows its working core while it thinks, each tool it uses as a line on a
          // trail, and then the streamed answer in the same bubble.
          <div className="conversation-message streaming-message live-turn" data-speaker="jarvis">
            <strong className="message-author visually-hidden">Jarvis</strong>
            {!streamedText && (
              <p className="live-turn-status">
                <WorkingCore />
                <LivePhrase key={liveTools.some((tool) => tool.state === 'running') ? 'working' : liveTools.length ? 'composing' : 'thinking'}
                  phase={liveTools.some((tool) => tool.state === 'running') ? 'working' : liveTools.length ? 'composing' : 'thinking'} />
                <span className="visually-hidden" role="status" aria-live="polite">Jarvis is thinking…</span>
              </p>
            )}
            {liveTools.length > 0 && (
              <ol className="live-turn-tools" aria-label="Tools Jarvis is using">
                {liveTools.map((tool) => (
                  <li key={tool.id} data-state={tool.state}><ToolCallChip tool={tool.tool} state={tool.state} /></li>
                ))}
              </ol>
            )}
            {streamedText && (
              <div className="streaming-reply" aria-label="Jarvis reply in progress">
                <MarkdownContent source={streamedText} streaming />
                <span className="streaming-caret" aria-hidden="true" />
              </div>
            )}
            {steering && <p className="chat-status" role="status" aria-live="polite">Steering…</p>}
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
                <strong className="message-author visually-hidden">Dan</strong>
                <p className="queued-state">Queued · {message.language === 'da' ? 'Danish' : 'English'}</p>
                <button className="queue-remove" type="button"
                  aria-label={`Remove queued message: ${message.text}`}
                  onClick={() => setQueue((current) => current.filter((item) => item.id !== message.id))}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <p>{message.text}</p>
            </li>
          ))}
        </ol>}
    </>
  );

  return (
    <section className="conversation-history" data-turn-active={sending || undefined} aria-label="Conversation"
      data-history-hosted={hosted || undefined}>
      {/* Hosted history lives in the shared workspace window; this element keeps the overview mounted in place. */}
      <div ref={hosted ? undefined : transcript} className={hosted ? 'conversation-dock' : 'conversation-transcript'}
        hidden={voiceActive} tabIndex={hosted ? undefined : 0} aria-label={hosted ? undefined : 'Conversation history'}
        onScroll={hosted ? undefined : updateFollow}>
      {hosted ? null : transcriptContent}
      {children}
      </div>
      {!hosted && windowed && latestButton}
      {hosted && conversationWindow.element && createPortal(
        <>
          <div ref={transcript} className="conversation-transcript" tabIndex={0} aria-label="Conversation history"
            onScroll={updateFollow}>
            {transcriptContent}
          </div>
          {latestButton}
        </>,
        conversationWindow.element,
      )}

      <div ref={inputBar} className={`conversation-input${voiceActive ? '' : ' luminous-glass'}`} data-voice-active={voiceActive}>
      {hosted && conversationWindow && !voiceActive && <ConversationHandle host={conversationWindow} />}
      <div className="conversation-actions">
      <VoiceControls
        client={client}
        config={config}
        {...(screenShare ? { screenShare } : {})}
        {...(camera ? { camera } : {})}
        language={language}
        onLanguageChange={setLanguage}
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
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitText(draftValue.current, true);
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitText(draftValue.current);
            }
          }}
          aria-describedby="chat-guidance"
        />
        <ConversationMoreMenu className="composer-more" language={language} onLanguageChange={setLanguage} actions={attachActions} align="end" />
        <button className="composer-send" type="submit" disabled={!draft.trim()} aria-label="Send" title="Send message">
          <ConversationIcon name="send" />
        </button>
        <p id="chat-guidance" className="visually-hidden">
          Enter to send or steer the active reply; Ctrl+Enter queues. Shift+Enter adds a new line.
        </p>
        {(screenShare?.sharing || camera?.sharing) && (
          <p className="composer-live" role="status">
            <span className="composer-live-dot" aria-hidden="true" />
            <span>{screenShare?.sharing && camera?.sharing ? 'Screen and camera shared with Jarvis' : screenShare?.sharing ? 'Screen shared with Jarvis' : 'Camera on for Jarvis'}</span>
            {screenShare?.sharing && <button type="button" className="composer-live-stop" onClick={() => screenShare.stop()}>Stop screen</button>}
            {camera?.sharing && <button type="button" className="composer-live-stop" onClick={() => camera.stop()}>Camera off</button>}
          </p>
        )}
        {screenShare?.error && <p className="composer-status chat-error" role="alert">{screenShare.error}</p>}
        {camera?.error && <p className="composer-status chat-error" role="alert">{camera.error}</p>}
        {(screenShare?.inspecting || camera?.inspecting) &&
          <p className="composer-status" role="status">{camera?.inspecting ? 'Looking at camera…' : 'Looking at screen…'}</p>}
        {visionContext && visionContext.sessionId === session?.id &&
          <p className="composer-status" role="status">{visionContext.source === 'camera' ? 'Camera' : 'Screen'} context is ready for the next message; it will not be saved in conversation history.</p>}
      </form>
      </div>
      {historyError && (
        <ConversationToast notification={{ id: historyErrorId, message: historyError, error: true }}
          onDismiss={dismissHistoryError} voiceActive={voiceActive}
          action={{ label: 'Retry', onSelect: messages.length === 0 ? retry : () => void loadOlder() }} />
      )}
    </section>
  );
}

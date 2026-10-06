import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { Link, useLocation } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import { sharedScreenContext, type CameraController, type ScreenShareController } from './screen-sharing';
import { ConversationMoreMenu, type MoreMenuAction } from './ConversationMoreMenu';
import { VoiceControls } from './VoiceControls';
import { useVoiceWorkspace } from './voice-workspace-state';
import { MarkdownContent } from './MarkdownContent';
import { useConversationIntents } from './conversation-intents';
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
} from './conversation-history';

const maxTaskId = 9_223_372_036_854_775_807n;

type QueuedMessage = { id: number; text: string; language: 'da' | 'en' };
type HistoryWindowState = 'open' | 'minimised' | 'closed';
type WindowOffset = { x: number; y: number };
type WindowDrag = { pointerId: number; x: number; y: number; origin: WindowOffset; bounds: { minX: number; maxX: number; minY: number; maxY: number } };

const followThreshold = 32;
const keyboardMoveStep = 24;

function ConversationIcon({ name }: { name: 'minimise' | 'maximise' | 'restore' | 'close' | 'screen' | 'camera' | 'send' | 'latest' | 'history' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'minimise':
      return <svg {...common}><path d="M5 17h14" /></svg>;
    case 'maximise':
      return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>;
    case 'restore':
      return <svg {...common}><path d="M8 5h11v11M5 8v11h11" /></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'screen':
      return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>;
    case 'camera':
      return <svg {...common}><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'send':
      return <svg {...common}><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5Z" /></svg>;
    case 'latest':
      return <svg {...common}><path d="M12 5v14m-6-6 6 6 6-6" /></svg>;
    case 'history':
      return <svg {...common}><path d="M5 5h14v10H9l-4 4Z" /></svg>;
  }
}

const clampOffset = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
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
  const [windowState, setWindowState] = useState<HistoryWindowState>('open');
  const [maximised, setMaximised] = useState(false);
  const [offset, setOffset] = useState<WindowOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  const { key: locationKey } = useLocation();
  const [seenLocationKey, setSeenLocationKey] = useState(locationKey);
  if (seenLocationKey !== locationKey) {
    // Choosing Conversation in the navigation brings a closed or minimised history back.
    setSeenLocationKey(locationKey);
    setWindowState('open');
  }
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const historyWindow = useRef<HTMLDivElement>(null);
  const inputBar = useRef<HTMLDivElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const followLatest = useRef(true);
  const windowDrag = useRef<WindowDrag | null>(null);
  const pendingWindowFocus = useRef<'restore' | 'input' | 'transcript' | null>(null);
  const wasBusy = useRef(false);
  const hasFocusedInput = useRef(false);
  const hasLoadedOlder = useRef(false);
  const nextQueueId = useRef(0);
  const turnInFlight = useRef(false);
  const draftValue = useRef('');
  const turnController = useRef<AbortController | null>(null);
  const turnSession = useRef<ChatSession | null>(null);

  useEffect(() => () => { turnController.current?.abort(); }, []);
  const lastMessageId = messages.at(-1)?.id;
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
    const element = transcript.current;
    if (voiceActive || !element || !followLatest.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lastMessageId, streamedText, sending, queue.length, failedTurns.length, voiceActive, loading, windowState, maximised]);

  useEffect(() => {
    const target = pendingWindowFocus.current;
    if (!target) return;
    pendingWindowFocus.current = null;
    if (target === 'restore') restoreButton.current?.focus({ preventScroll: true });
    else if (target === 'transcript') transcript.current?.focus({ preventScroll: true });
    else input.current?.focus({ preventScroll: true });
  }, [windowState, maximised]);

  useEffect(() => {
    const reset = () => setOffset((current) => current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 });
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, []);

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

  function changeWindow(next: HistoryWindowState) {
    pendingWindowFocus.current = next === 'minimised' ? 'restore' : next === 'closed' ? 'input' : 'transcript';
    setWindowState(next);
  }

  function toggleMaximised() {
    setOffset({ x: 0, y: 0 });
    setMaximised((current) => !current);
  }

  function moveBounds() {
    const win = historyWindow.current?.getBoundingClientRect();
    const area = section.current?.getBoundingClientRect();
    const bar = inputBar.current?.getBoundingClientRect();
    if (!win || !area) return null;
    const bottom = bar && bar.height > 0 ? bar.top - 8 : area.bottom;
    const bound = (low: number, high: number, current: number) => low <= high ? [low, high] : [current, current];
    const [minX, maxX] = bound(offset.x + area.left - win.left, offset.x + area.right - win.right, offset.x);
    const [minY, maxY] = bound(offset.y + area.top - win.top, offset.y + bottom - win.bottom, offset.y);
    return { minX: minX!, maxX: maxX!, minY: minY!, maxY: maxY! };
  }

  function beginWindowDrag(event: PointerEvent<HTMLButtonElement>) {
    if (maximised || (event.button !== 0 && event.pointerType !== 'touch')) return;
    const bounds = moveBounds();
    if (!bounds) return;
    windowDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: offset, bounds };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }

  function updateWindowDrag(event: PointerEvent<HTMLButtonElement>) {
    const gesture = windowDrag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setOffset({
      x: clampOffset(gesture.origin.x + event.clientX - gesture.x, gesture.bounds.minX, gesture.bounds.maxX),
      y: clampOffset(gesture.origin.y + event.clientY - gesture.y, gesture.bounds.minY, gesture.bounds.maxY),
    });
  }

  function endWindowDrag(event: PointerEvent<HTMLButtonElement>) {
    if (windowDrag.current?.pointerId !== event.pointerId) return;
    windowDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }

  function moveWindowByKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Home') {
      event.preventDefault();
      setOffset({ x: 0, y: 0 });
      return;
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step || maximised) return;
    event.preventDefault();
    const bounds = moveBounds();
    if (!bounds) return;
    setOffset({
      x: clampOffset(offset.x + step[0]! * keyboardMoveStep, bounds.minX, bounds.maxX),
      y: clampOffset(offset.y + step[1]! * keyboardMoveStep, bounds.minY, bounds.maxY),
    });
  }

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
    setWindowState('open');
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
  }, [camera?.sharing, client, config, language, sending, session, visionContext, voiceActive]);

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

  async function inspectVision(source: 'camera' | 'screen') {
    const capture = source === 'camera' ? camera : screenShare;
    if (!capture?.sharing || capture.inspecting) return;
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
  const windowed = messages.length > 0 || sending || queue.length > 0 || failedTurns.length > 0 || activeMessage !== null || Boolean(turnError);
  const historyVisible = !windowed || windowState === 'open';
  const moved = windowed && !maximised && (offset.x !== 0 || offset.y !== 0);
  const attachActions: MoreMenuAction[] = [
    {
      id: 'screen',
      label: screenShare?.inspecting ? 'Looking at screen…' : 'Look at screen',
      icon: <ConversationIcon name="screen" />,
      onSelect: () => void inspectVision('screen'),
      disabled: !screenShare?.sharing || screenShare.inspecting,
      ...(!screenShare?.sharing ? { description: 'Share your screen from Activity, sharing and backend first.' } : {}),
    },
    {
      id: 'camera',
      label: camera?.inspecting ? 'Looking at camera…' : 'Look at camera',
      icon: <ConversationIcon name="camera" />,
      onSelect: () => void inspectVision('camera'),
      disabled: !camera?.sharing || camera.inspecting,
      ...(!camera?.sharing ? { description: 'Turn on the camera from the top bar before asking Jarvis to inspect a frame.' } : {}),
    },
  ];

  return (
    <section ref={section} className="conversation-history" data-turn-active={sending || undefined} aria-label="Conversation"
      data-history-window={windowed ? windowState : undefined} data-history-maximised={(windowed && maximised) || undefined}>
      <div
        ref={historyWindow}
        className={`conversation-window${windowed ? ' luminous-glass' : ''}`}
        data-windowed={windowed}
        data-dragging={dragging || undefined}
        hidden={voiceActive || !historyVisible}
        style={moved ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      >
      {windowed && (
        <div className="conversation-window-bar">
          <button
            className="conversation-window-drag"
            type="button"
            aria-label={maximised ? 'Conversation window is maximised' : 'Move conversation window. Use arrow keys to move; Home resets its position.'}
            title={maximised ? undefined : 'Drag to move'}
            disabled={maximised}
            onPointerDown={beginWindowDrag}
            onPointerMove={updateWindowDrag}
            onPointerUp={endWindowDrag}
            onPointerCancel={endWindowDrag}
            onKeyDown={moveWindowByKey}
            onDoubleClick={() => setOffset({ x: 0, y: 0 })}
          >
            <span className="conversation-window-grip" aria-hidden="true" />
          </button>
          <div className="conversation-window-actions">
            <button className="conversation-window-control" type="button" aria-label="Minimise conversation history" title="Minimise"
              onClick={() => changeWindow('minimised')}>
              <ConversationIcon name="minimise" />
            </button>
            <button className="conversation-window-control" type="button"
              aria-label={maximised ? 'Restore size of conversation history' : 'Maximise conversation history'}
              title={maximised ? 'Restore size' : 'Maximise'} onClick={toggleMaximised}>
              <ConversationIcon name={maximised ? 'restore' : 'maximise'} />
            </button>
            <button className="conversation-window-control" type="button" aria-label="Close conversation history" title="Close"
              onClick={() => changeWindow('closed')}>
              <ConversationIcon name="close" />
            </button>
          </div>
        </div>
      )}
      <div ref={transcript} className="conversation-transcript" hidden={voiceActive} tabIndex={0} aria-label="Conversation history"
        onScroll={updateFollow}>
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
                  <strong className="message-author visually-hidden">{message.role === 'dan' ? 'Dan' : 'Jarvis'}</strong>
                  {message.role === 'jarvis' && message.channel === 'chat'
                    ? <MarkdownContent source={message.text} />
                    : <p>{message.text}</p>}
                  {message.interrupted && <p className="interrupted-label">Interrupted</p>}
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
        <div className="streaming-message">
          {streamedText ? (
            <>
              <strong className="message-author visually-hidden">Jarvis</strong>
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
      {children}
      </div>
      {windowed && !atLatest && (
        <button className="conversation-latest" type="button" onClick={jumpToLatest}>
          <ConversationIcon name="latest" />
          <span>Jump to latest</span>
        </button>
      )}
      </div>
      {windowed && windowState === 'minimised' && !voiceActive && (
        <button ref={restoreButton} className="conversation-restore luminous-glass" type="button"
          aria-label="Restore conversation history" onClick={() => changeWindow('open')}>
          <ConversationIcon name="history" />
          <span>Conversation</span>
        </button>
      )}

      <div ref={inputBar} className={`conversation-input${voiceActive ? '' : ' luminous-glass'}`} data-voice-active={voiceActive}>
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
        <ConversationMoreMenu className="composer-attach" icon="attach" label="Attach visual context" actions={attachActions} />
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
        <ConversationMoreMenu className="composer-more" language={language} onLanguageChange={setLanguage} align="end" />
        <button className="primary-button composer-send" type="submit" disabled={!draft.trim()} aria-label="Send" title="Send message">
          <ConversationIcon name="send" />
        </button>
        <p id="chat-guidance" className="visually-hidden">
          Enter to send or steer the active reply; Ctrl+Enter queues. Shift+Enter adds a new line.
        </p>
        {(screenShare?.inspecting || camera?.inspecting) &&
          <p className="composer-status" role="status">{camera?.inspecting ? 'Looking at camera…' : 'Looking at screen…'}</p>}
        {visionContext && visionContext.sessionId === session?.id &&
          <p className="composer-status" role="status">{visionContext.source === 'camera' ? 'Camera' : 'Screen'} context is ready for the next message; it will not be saved in conversation history.</p>}
      </form>
      </div>
    </section>
  );
}

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import type { BackendModule } from '../modules.js';
import type { ConversationMessage } from '../core/conversation-store.js';
import type { VisionWatchService } from '../vision/watch.js';
import { createVoiceDiagnostics, VOICE_STARTUP_CLOSE_CODE } from './diagnostics.js';
import { createVoiceCredentialCache } from './credential-cache.js';
import { createSessionLimits, SESSION_LIMIT_CHECK_MS, type SessionEndReason } from './session-limits.js';
import { createVoiceStatusAnnouncer } from './status-updates.js';
import { createPiVoiceTurns, type PiVoiceAgent } from './pi-voice.js';
import {
  commentaryParts, dataSize, FOUNDRY_VOICE_SCOPE, GPT_LIVE_DEPLOYMENT, isCompatibleLiveSessionFormat,
  endLateVoiceSession, LiveVoiceUsageTracker, parseVoiceEvent,
  settleVoiceSessionCreation, VoiceTerminationStateMachine,
  validPcm24Base64, VOICE_INPUT_QUIET_MS, VOICE_SAMPLE_RATE, VOICE_TRANSCRIPT_MAX_WAIT_MS,
  type VoiceConnectionFactory, type VoiceFailureCloseCode, type VoiceTerminationEffect,
} from './live-protocol.js';
export { VOICE_SUBPROTOCOL } from '../websocket.js';

const MAX_CLIENT_MESSAGE_BYTES = 1_048_576;
const MAX_QUEUED_AUDIO_BYTES = 512_000;
const MAX_TRANSCRIPT_CHARACTERS = 20_000;
const MAX_TRANSCRIPTS_PER_SESSION = 1_000;
const OUTPUT_QUIET_MS = VOICE_INPUT_QUIET_MS;
const OUTPUT_PERSIST_BOUND_MS = VOICE_TRANSCRIPT_MAX_WAIT_MS;
const TOKEN_TIMEOUT_MS = 10_000;
const CLEAN_END_TIMEOUT_MS = 5_000;
const VALID_ITEM_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

interface InputGroup {
  readonly id: string;
  text: string;
  lastDeltaAt: number;
  lastTimelineEndMs?: number;
  quietSent: boolean;
  locked: boolean;
  delegationId?: string;
  delegationOffsetMs?: number;
  persisted?: ConversationMessage;
}

interface OutputGroup {
  readonly id: string;
  delegationId: string | null;
  text: string;
  readonly startedAt: number;
  lastDeltaAt: number;
  messageId?: string;
  persistedTextLength: number;
  quietTimer?: ReturnType<typeof setTimeout>;
  persistenceTimer?: ReturnType<typeof setTimeout>;
  completed: boolean;
}

export interface VoiceRelayOptions {
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly connect?: VoiceConnectionFactory;
  readonly visionWatch?: Pick<VisionWatchService, 'registerVoice'>;
  readonly drainTimeoutMs?: number;
}

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
  else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
}

function safeFailure(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/[^A-Za-z0-9 .:,'()_-]/gu, ' ').slice(0, 120) || 'unknown'
    : 'unknown';
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, Math.max(0, milliseconds));
    timer.unref();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function credential(
  getToken: VoiceRelayOptions['getToken'],
  signal: AbortSignal,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      getToken(FOUNDRY_VOICE_SCOPE, signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Voice authentication timed out')), TOKEN_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) {
      throw new Error('Invalid voice authentication');
    }
    return token;
  } finally {
    clearTimeout(timer);
  }
}

function registerVoiceRoute(
  app: Parameters<BackendModule['registerRoutes']>[0],
  connect: VoiceConnectionFactory,
  getToken: VoiceRelayOptions['getToken'],
  visionWatch?: VoiceRelayOptions['visionWatch'],
  drainTimeoutMs = CLEAN_END_TIMEOUT_MS,
): void {
  app.get('/voice', { websocket: true }, (browser, request) => {
    const controller = new AbortController();
    const language = 'en' as const;
    const log = request.log as FastifyBaseLogger;
    const diagnostics = createVoiceDiagnostics(log, language, controller.signal, request.requestStartedAt);

    if (app.isStopping) {
      diagnostics.summary('shutdown', 1012);
      closeSocket(browser, 1012, 'Service restarting; reconnect');
      return;
    }
    if (request.principal === null) {
      diagnostics.summary('relay', 1008);
      closeSocket(browser, 1008, 'Unauthorized');
      return;
    }
    if (Object.keys(request.query as Record<string, unknown>).length > 0) {
      diagnostics.summary('relay', 1008);
      closeSocket(browser, 1008, 'Voice selection is not supported');
      return;
    }
    const store = app.conversationStore;
    if (!store) {
      diagnostics.summary('relay', 1011);
      closeSocket(browser, 1011, 'Conversation storage unavailable');
      return;
    }
    const piAgent = app.piAgent as PiVoiceAgent | null;
    if (!piAgent) {
      diagnostics.summary('relay', 1011);
      closeSocket(browser, 1011, 'PI is not set up on this backend yet. No other engine was used.');
      return;
    }
    if (request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      diagnostics.summary('relay', 1008);
      closeSocket(browser, 1008, 'Forbidden');
      return;
    }

    const unregisterSessionConnection = request.ownerSession
      ? app.ownerSessionConnections?.register(request.ownerSession.id, () => {
        closeSession(1008, 'Session ended');
      }) ?? (() => {})
      : () => {};
    const limits = createSessionLimits();
    const activityId = randomUUID();
    let upstream: WebSocket | undefined;
    let providerReady = false;
    let sessionId: string | undefined;
    let microphoneActive = false;
    let microphoneMuted = true;
    let piBusy = false;
    let outputActive = false;
    let finalization: Promise<void> | undefined;
    let proactiveContext: string | undefined;
    let currentInput: InputGroup | undefined;
    let activeOutput: OutputGroup | undefined;
    let pendingDelegation: AbortController | undefined;
    let pendingDelegationGroup: InputGroup | undefined;
    let lastCommentaryDelegation: string | null = null;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let persistenceQueue = Promise.resolve();
    const delegationTasks = new Set<Promise<void>>();
    const seenInputEventIds = new Set<string>();
    let persistedOutputGroups = 0;
    let persistenceFailed = false;
    const seenDelegations = new Set<string>();
    let queuedAudioBytes = 0;
    const queuedProviderEvents: Record<string, unknown>[] = [];
    const seenEventTypes = new Set<string>();
    const providerUsage = new LiveVoiceUsageTracker();
    let unregisterVisionVoice: (() => void) | undefined;
    let activityFinished = false;
    let activityState: 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | null = null;
    const termination = new VoiceTerminationStateMachine();
    let terminalTeardownStarted = false;

    const publishActivity = (
      type: 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | 'failed' | 'ended',
    ) => {
      if (activityFinished && type !== 'reconnecting') return;
      if (type === 'failed' || type === 'ended' || type === 'reconnecting') activityFinished = type !== 'reconnecting';
      if (type === activityState) return;
      activityState = type === 'failed' || type === 'ended' ? null : type;
      app.jarvisActivityHub.publish({ type, activityId, source: 'voice' });
    };

    const sendClient = (event: Record<string, unknown>, callback?: (error?: Error) => void) => {
      if (browser.readyState !== WebSocket.OPEN) return;
      const serialized = JSON.stringify(event);
      if (Buffer.byteLength(serialized) > MAX_CLIENT_MESSAGE_BYTES) {
        closeSession(1009, 'Voice event too large');
        return;
      }
      browser.send(serialized, (error) => callback?.(error));
    };

    const sendUpstream = (event: Record<string, unknown>): boolean => {
      if (upstream?.readyState !== WebSocket.OPEN || !providerReady) {
        if (!controller.signal.aborted && termination.isActive) closeSession(1011, 'Voice connection failed');
        return false;
      }
      const serialized = JSON.stringify(event);
      if (Buffer.byteLength(serialized) > MAX_CLIENT_MESSAGE_BYTES) {
        closeSession(1009, 'Voice event too large');
        return false;
      }
      try {
        upstream.send(serialized, (error) => {
          if (error && !controller.signal.aborted && !termination.isTerminal) {
            log.warn({ failure: 'upstream_send_failed', language }, 'voice.connection_failed');
            closeSession(1011, 'Voice connection failed');
          }
        });
        return true;
      } catch {
        if (!controller.signal.aborted && !termination.isEnding) {
          closeSession(1011, 'Voice connection failed');
        }
        return false;
      }
    };

    let sessionStartupAbandoned = false;
    const sessionCreation = settleVoiceSessionCreation(
      store.createSession({ channel: 'voice', language }),
      controller.signal,
      () => sessionStartupAbandoned,
      (session) => {
        sessionId = session.id;
        diagnostics.stage('session_created');
      },
      async (lateSessionId) => {
        try {
          await endLateVoiceSession(lateSessionId, async (sessionId) => await store.endSession(sessionId));
          log.warn('voice.late_session_ended');
        } catch {
          log.warn('voice.late_session_cleanup_failed');
          throw new Error('Late voice session could not be ended');
        }
      },
    );
    const sessionReady = diagnostics.bound('session_creation', 10_000, () => sessionCreation);
    // Startup work begins before the first awaited stage (proactive context). Consume a possible rejection now;
    // the original promise is still awaited below and its error remains a session failure.
    void sessionReady.catch(() => { sessionStartupAbandoned = true; });

    const finishOutputGroup = (group: OutputGroup, terminal: 'completed' | 'cancelled' = 'completed') => {
      if (group.completed) return;
      group.completed = true;
      if (group.quietTimer) clearTimeout(group.quietTimer);
      if (group.persistenceTimer) clearTimeout(group.persistenceTimer);
      if (activeOutput === group) activeOutput = undefined;
      outputActive = false;
      if (terminal === 'cancelled' && termination.isActive && !controller.signal.aborted) {
        sendClient({ type: 'jarvis.voice.response.cancelled', responseId: group.id });
      }
      void persistOutput(group).finally(() => {
        if (terminal === 'completed' && termination.isActive && !controller.signal.aborted) {
          sendClient({
            type: 'jarvis.voice.response.completed',
            responseId: group.id,
          });
          if (microphoneActive && !piBusy) publishActivity('listening');
        }
      });
    };

    const persistOutput = (group: OutputGroup): Promise<void> => {
      const text = group.text.trim();
      if (!text || group.persistedTextLength === text.length) return persistenceQueue;
      group.persistedTextLength = text.length;
      persistenceQueue = persistenceQueue.then(async () => {
        if (!sessionId) throw new Error('Voice session was not created');
        if (group.messageId && store.updateMessage) {
          const updated = await store.updateMessage({
            messageId: group.messageId,
            sessionId,
            role: 'jarvis',
            text,
          });
          if (!updated) throw new Error('Voice transcript was not updated');
        } else {
          if (persistedOutputGroups >= MAX_TRANSCRIPTS_PER_SESSION) {
            throw new Error('Voice transcript limit reached');
          }
          const message = await store.addMessage({
            sessionId,
            role: 'jarvis',
            text,
            model: GPT_LIVE_DEPLOYMENT,
          });
          if (!message) throw new Error('Voice transcript was not stored');
          persistedOutputGroups += 1;
          group.messageId = message.id;
        }
        app.nowEventHub.publish({ type: 'refresh' });
      }).catch((error: unknown) => {
        persistenceFailed = true;
        log.warn({ failure: safeFailure(error), language }, 'voice.transcript_persistence_failed');
        if (termination.isActive && !controller.signal.aborted) closeSession(1011, 'Voice transcript could not be saved');
      });
      return persistenceQueue;
    };

    const scheduleOutputPersistence = (group: OutputGroup) => {
      if (group.quietTimer) clearTimeout(group.quietTimer);
      group.quietTimer = setTimeout(() => finishOutputGroup(group), OUTPUT_QUIET_MS);
      group.quietTimer.unref();
      if (!group.persistenceTimer) {
        group.persistenceTimer = setTimeout(() => {
          delete group.persistenceTimer;
          void persistOutput(group);
          if (!group.completed && activeOutput === group) scheduleOutputPersistence(group);
        }, OUTPUT_PERSIST_BOUND_MS);
        group.persistenceTimer.unref();
      }
    };

    const ensureOutputGroup = (delegationId = lastCommentaryDelegation) => {
      if (activeOutput && !activeOutput.completed) return activeOutput;
      const group: OutputGroup = {
        id: `voice_${randomUUID().replaceAll('-', '')}`,
        delegationId,
        text: '',
        startedAt: performance.now(),
        lastDeltaAt: performance.now(),
        persistedTextLength: 0,
        completed: false,
      };
      activeOutput = group;
      outputActive = true;
      sendClient({
        type: 'jarvis.voice.response.started',
        responseId: group.id,
        ...(delegationId ? { delegationId } : {}),
      });
      scheduleOutputPersistence(group);
      return group;
    };

    const sendCommentary = (text: string, delegationId: string | null) => {
      if (!providerReady || controller.signal.aborted || !termination.isActive) return;
      const parts = commentaryParts(text);
      if (parts.length === 0) return;
      lastCommentaryDelegation = delegationId;
      for (const content of parts) {
        if (!sendUpstream({
          type: 'session.commentary.append',
          delegation_id: delegationId,
          content,
        })) return;
      }
    };

    const piTurns = createPiVoiceTurns({
      agent: piAgent,
      signal: controller.signal,
      speak: (text, delegationId) => sendCommentary(text, delegationId ?? null),
      busy: (active) => {
        piBusy = active;
        if (active && microphoneActive) publishActivity('thinking');
        else if (!active && microphoneActive && !outputActive) publishActivity('listening');
        if (!active) statusAnnouncer?.flush();
      },
      log: (turn) => {
        log.info({ ...turn, channel: 'voice' }, 'voice.pi_turn');
        app.systemStatusReader.recordEvidence('foundry.voice', {
          status: turn.outcome === 'ok' ? 'ok'
            : turn.outcome === 'failed' || turn.outcome === 'timeout' ? 'down' : 'unknown',
          checkedAt: new Date().toISOString(),
          details: {
            configured: true,
            engine: 'pi',
            agent: 'jarvis-pi-live',
            evidence: 'voice-turn',
            outcome: turn.outcome,
          },
        });
      },
    });

    const cancelPendingDelegation = () => {
      pendingDelegation?.abort();
      pendingDelegation = undefined;
      pendingDelegationGroup = undefined;
      piTurns.cancel();
    };

    const requestGracefulEnd = (reason: string, notifyClient = true) => {
      if (!termination.isActive) return;
      pendingDelegation?.abort();
      piTurns.cancel();
      statusAnnouncer?.close();
      handleTerminationEffect(termination.apply({
        type: 'end-requested',
        canSendClose: providerReady && upstream?.readyState === WebSocket.OPEN,
        reason,
        notifyClient,
      }));
    };

    const newInputGroup = (): InputGroup => {
      cancelPendingDelegation();
      if (activeOutput) finishOutputGroup(activeOutput, 'cancelled');
      if (seenDelegations.size >= MAX_TRANSCRIPTS_PER_SESSION) {
        closeSession(1008, 'Too many voice turns');
      }
      const group: InputGroup = {
        id: `input_${randomUUID().replaceAll('-', '')}`,
        text: '',
        lastDeltaAt: performance.now(),
        quietSent: false,
        locked: false,
      };
      currentInput = group;
      return group;
    };

    const sendInputCompletion = (group: InputGroup) => {
      if (group.quietSent || !group.text.trim()) return;
      group.quietSent = true;
      sendClient({
        type: 'jarvis.voice.input_transcript.completed',
        itemId: group.id,
        transcript: group.text,
      });
    };

    const receiveInputTranscript = (event: Record<string, unknown>) => {
      const delta = event.delta;
      if (typeof delta !== 'string' || delta.length > MAX_TRANSCRIPT_CHARACTERS) {
        closeSession(1008, 'Invalid voice transcript');
        return;
      }
      const eventId = typeof event.event_id === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/u.test(event.event_id) ? event.event_id : undefined;
      if (eventId && seenInputEventIds.has(eventId)) return;
      const startMs = typeof event.start_ms === 'number' && Number.isSafeInteger(event.start_ms) && event.start_ms >= 0
        ? event.start_ms : undefined;
      const endMs = typeof event.end_ms === 'number' && Number.isSafeInteger(event.end_ms) && event.end_ms >= 0
        ? event.end_ms : undefined;
      if ((event.start_ms !== undefined && startMs === undefined) ||
          (event.end_ms !== undefined && endMs === undefined) ||
          startMs !== undefined && endMs !== undefined && endMs < startMs) {
        closeSession(1008, 'Invalid voice transcript timeline');
        return;
      }
      if (eventId) {
        if (seenInputEventIds.size >= MAX_TRANSCRIPTS_PER_SESSION) {
          const oldest = seenInputEventIds.values().next().value;
          if (oldest) seenInputEventIds.delete(oldest);
        }
        seenInputEventIds.add(eventId);
      }
      let group = currentInput;
      const timelineEnd = endMs ?? startMs;
      const belongsToPending = pendingDelegationGroup && !pendingDelegationGroup.locked &&
        (timelineEnd === undefined || pendingDelegationGroup.delegationOffsetMs === undefined ||
          timelineEnd <= pendingDelegationGroup.delegationOffsetMs);
      if (belongsToPending) group = pendingDelegationGroup;
      else if (pendingDelegationGroup && timelineEnd !== undefined &&
          pendingDelegationGroup.delegationOffsetMs !== undefined &&
          timelineEnd > pendingDelegationGroup.delegationOffsetMs) {
        group = newInputGroup();
      } else if (!group || group.persisted || group.locked) group = newInputGroup();
      if (!group) group = newInputGroup();
      group.text += delta;
      if (group.text.length > MAX_TRANSCRIPT_CHARACTERS) {
        closeSession(1009, 'Voice transcript too large');
        return;
      }
      group.lastDeltaAt = performance.now();
      if (timelineEnd !== undefined) {
        group.lastTimelineEndMs = Math.max(group.lastTimelineEndMs ?? 0, timelineEnd);
      }
      limits.touch();
      if (group.text === delta) piTurns.cancel();
      sendClient({
        type: 'jarvis.voice.input_transcript.delta',
        itemId: group.id,
        delta,
      });
    };

    const persistDelegatedTurn = async (group: InputGroup, delegationId: string, signal: AbortSignal) => {
      const deadline = performance.now() + VOICE_TRANSCRIPT_MAX_WAIT_MS;
      for (;;) {
        signal.throwIfAborted();
        const now = performance.now();
        if (now >= deadline || now - group.lastDeltaAt >= VOICE_INPUT_QUIET_MS) break;
        await delay(Math.min(
          deadline - now,
          VOICE_INPUT_QUIET_MS - (now - group.lastDeltaAt),
        ), signal);
      }
      signal.throwIfAborted();
      if (!group.text.trim()) {
        sendCommentary('I did not catch that. Please say it again.', delegationId);
        return;
      }
      sendInputCompletion(group);
      group.locked = true;
      const turnText = group.text;
      await sessionReady;
      if (!sessionId) throw new Error('Voice session was not created');
      const message = await store.addMessage({
        sessionId,
        role: 'dan',
        text: turnText,
        model: null,
        sourceItemId: group.id,
      });
      if (!message) throw new Error('Voice owner message was not stored');
      group.persisted = message;
      app.nowEventHub.publish({ type: 'refresh' });
      if (signal.aborted || controller.signal.aborted || !termination.isActive ||
          pendingDelegationGroup !== group) return;
      piTurns.start({
        text: turnText,
        messageId: message.id,
        sessionId,
        delegationId,
        proactiveContext,
        startedAt: performance.now(),
      });
    };

    const receiveDelegation = (event: Record<string, unknown>) => {
      const delegation = event.delegation;
      if (typeof delegation !== 'object' || delegation === null || Array.isArray(delegation)) {
        closeSession(1011, 'Voice delegation was invalid');
        return;
      }
      const value = delegation as Record<string, unknown>;
      if (value.target !== 'client' || typeof value.id !== 'string' || !VALID_ITEM_PATTERN.test(value.id)) {
        closeSession(1011, 'Voice delegation target is unsupported');
        return;
      }
      if (seenDelegations.has(value.id)) return;
      seenDelegations.add(value.id);
      const group = currentInput && !currentInput.persisted ? currentInput : newInputGroup();
      group.delegationId = value.id;
      const offsetMs = typeof event.offset_ms === 'number' &&
        Number.isSafeInteger(event.offset_ms) && event.offset_ms >= 0
        ? event.offset_ms : undefined;
      if (offsetMs !== undefined) group.delegationOffsetMs = offsetMs;
      currentInput = undefined;
      const pending = new AbortController();
      pendingDelegation?.abort();
      pendingDelegation = pending;
      pendingDelegationGroup = group;
      const work = persistDelegatedTurn(group, value.id, AbortSignal.any([controller.signal, pending.signal]))
        .catch((error: unknown) => {
          if (controller.signal.aborted || pending.signal.aborted) return;
          log.warn({ failure: safeFailure(error), language }, 'voice.delegation_failed');
          closeSession(1011, 'Voice turn could not be saved');
        });
      delegationTasks.add(work);
      void work.finally(() => {
        delegationTasks.delete(work);
        if (pendingDelegation === pending) {
          pendingDelegation = undefined;
          pendingDelegationGroup = undefined;
        }
      });
    };

    const flushQueuedProviderEvents = () => {
      for (const event of queuedProviderEvents.splice(0)) {
        sendUpstream(event);
      }
      queuedAudioBytes = 0;
    };

    const receiveProvider = (data: RawData, isBinary: boolean) => {
      if (!termination.isActive && termination.phase !== 'awaiting-provider-close') return;
      const event = parseVoiceEvent(data, isBinary);
      if (!event || typeof event.type !== 'string') {
        log.warn({ failure: 'invalid_upstream_event', language }, 'voice.upstream_event_error');
        closeSession(1011, 'Voice connection failed');
        return;
      }
      const type = event.type;
      if (seenEventTypes.size < 40) seenEventTypes.add(type);
      diagnostics.event(type);
      if ((type === 'session.start' || type === 'session.started') &&
          !isCompatibleLiveSessionFormat(event)) {
        closeSession(1011, 'Voice audio format conflicted with the provisioned format');
        return;
      }
      if (type === 'session.start') return;
      if (type === 'session.started') {
        providerReady = true;
        diagnostics.clearWatchdog();
        diagnostics.stage('session_started');
        flushQueuedProviderEvents();
        sendClient({ type: 'jarvis.session.ready', sessionId, audio: { format: 'pcm16le', sampleRate: VOICE_SAMPLE_RATE, channels: 1 } });
        if (sessionId && statusAnnouncer) {
          unregisterVisionVoice = visionWatch?.registerVoice(
            sessionId,
            (text) => statusAnnouncer?.announce(text) ?? false,
          );
        }
        statusAnnouncer?.flush();
        piTurns.warm();
        return;
      }
      if (type === 'session.usage.updated' || type === 'session.closed') {
        try {
          providerUsage.accept(event);
        } catch {
          closeSession(1011, 'Voice provider usage was invalid');
          return;
        }
        if (type === 'session.usage.updated') return;
        handleTerminationEffect(termination.apply({ type: 'provider-closed' }));
        return;
      }
      if (!providerReady) {
        if (type === 'error') log.warn({ failure: 'startup_error', language }, 'voice.upstream_event_error');
        return;
      }
      if (type === 'session.input_transcript.delta') {
        receiveInputTranscript(event);
        return;
      }
      if (type === 'session.delegation.created') {
        receiveDelegation(event);
        return;
      }
      if (type === 'session.output_transcript.delta') {
        if (typeof event.delta !== 'string' || event.delta.length > MAX_TRANSCRIPT_CHARACTERS) {
          closeSession(1008, 'Invalid voice output transcript');
          return;
        }
        const group = ensureOutputGroup();
        group.text += event.delta;
        group.lastDeltaAt = performance.now();
        if (group.text.length > MAX_TRANSCRIPT_CHARACTERS) {
          closeSession(1009, 'Voice output transcript too large');
          return;
        }
        sendClient({
          type: 'jarvis.voice.output_transcript.delta',
          responseId: group.id,
          delta: event.delta,
        });
        scheduleOutputPersistence(group);
        return;
      }
      if (type === 'session.output_audio.delta') {
        if (!validPcm24Base64(event.delta)) {
          closeSession(1008, 'Invalid voice audio');
          return;
        }
        const group = ensureOutputGroup();
        group.lastDeltaAt = performance.now();
        sendClient({
          type: 'jarvis.voice.audio.delta',
          responseId: group.id,
          delta: event.delta,
          ...(typeof event.start_ms === 'number' ? { startMs: event.start_ms } : {}),
          ...(typeof event.end_ms === 'number' ? { endMs: event.end_ms } : {}),
        });
        if (microphoneActive) publishActivity('speaking');
        scheduleOutputPersistence(group);
        return;
      }
      if (type === 'error') {
        log.warn({ failure: 'provider_error', language }, 'voice.upstream_event_error');
        closeSession(1011, 'Voice connection failed');
      }
    };

    const finalizeSession = (allowWallClockFallback: boolean) => {
      finalization ??= (async () => {
        if (activeOutput && !activeOutput.completed) {
          clearTimeout(activeOutput.quietTimer);
          clearTimeout(activeOutput.persistenceTimer);
          activeOutput.completed = true;
          await persistOutput(activeOutput);
        }
        await sessionReady;
        await Promise.allSettled([...delegationTasks]);
        await persistenceQueue;
        const transcriptsPersisted = !persistenceFailed;
        if (!sessionId || !await store.endSession(
          sessionId,
          {
            allowWallClockFallback: allowWallClockFallback && transcriptsPersisted,
            ...(providerUsage.seconds === undefined ? {} : { providerVoiceSeconds: providerUsage.seconds }),
          },
        )) throw new Error('Voice session was not ended');
        if (!transcriptsPersisted) throw new Error('Voice transcripts were not fully stored');
      })();
      return finalization;
    };

    function beginTerminalTeardown(effect: Extract<VoiceTerminationEffect, { type: 'finalize' }>): void {
      if (terminalTeardownStarted) return;
      terminalTeardownStarted = true;
      clearTimeout(endTimer);
      endTimer = undefined;
      pendingDelegation?.abort();
      piTurns.cancel();
      statusAnnouncer?.close();
      unregisterVisionVoice?.();
      unregisterVisionVoice = undefined;
      if (activeOutput) {
        finishOutputGroup(activeOutput, effect.allowWallClockFallback ? 'completed' : 'cancelled');
      }
      controller.abort();
      unregisterSessionConnection();
      if (upstream) closeSocket(upstream, effect.closeCode, effect.reason);
    }

    function handleTerminationEffect(effect: VoiceTerminationEffect): void {
      switch (effect.type) {
        case 'none':
          return;
        case 'send-close': {
          if (!sendUpstream({ type: 'session.close' })) {
            closeSession(1011, 'Voice session close could not be sent', effect.notifyClient);
            return;
          }
          endTimer = setTimeout(
            () => closeSession(1011, 'Voice session close was not confirmed', effect.notifyClient),
            drainTimeoutMs,
          );
          endTimer.unref();
          return;
        }
        case 'finalize':
          beginTerminalTeardown(effect);
          void finalizeSession(effect.allowWallClockFallback).then(() => {
            handleTerminationEffect(termination.apply({ type: 'finalization-succeeded' }));
          }).catch(() => {
            log.warn('voice.session_persistence_failed');
            handleTerminationEffect(termination.apply({ type: 'finalization-failed' }));
          });
          return;
        case 'send-ack':
          clearTimeout(endTimer);
          if (browser.readyState !== WebSocket.OPEN) {
            handleTerminationEffect(termination.apply({ type: 'ack-failed' }));
            return;
          }
          endTimer = setTimeout(
            () => handleTerminationEffect(termination.apply({ type: 'ack-failed' })),
            drainTimeoutMs,
          );
          endTimer.unref();
          sendClient({ type: 'jarvis.session.ended' }, (error) => {
            handleTerminationEffect(termination.apply({
              type: error ? 'ack-failed' : 'ack-sent',
            }));
          });
          return;
        case 'close-ended':
          clearTimeout(endTimer);
          endTimer = undefined;
          diagnostics.summary('relay', effect.closeCode);
          if (!activityFinished) publishActivity('ended');
          closeSocket(browser, effect.closeCode, effect.reason);
          return;
        case 'close-failed': {
          clearTimeout(endTimer);
          endTimer = undefined;
          diagnostics.summary('relay', effect.closeCode);
          const retryable = effect.closeCode === VOICE_STARTUP_CLOSE_CODE ||
            effect.closeCode === 1011 || effect.closeCode === 1012;
          if (effect.notifyClient && browser.readyState === WebSocket.OPEN) {
            sendClient({
              type: 'jarvis.session.failed',
              closeCode: effect.closeCode,
              retryable,
            });
          }
          if (!activityFinished) publishActivity(retryable ? 'reconnecting' : 'failed');
          closeSocket(browser, effect.closeCode, effect.reason);
          return;
        }
        default:
          return;
      }
    }

    function closeSession(code: VoiceFailureCloseCode, reason: string, notifyClient = true): void {
      handleTerminationEffect(termination.apply({
        type: 'failed',
        closeCode: code,
        reason,
        notifyClient,
      }));
    }

    const statusAnnouncer = createVoiceStatusAnnouncer({
      taskEvents: app.eventHub,
      nowEvents: app.nowEventHub,
      canSpeak: () => providerReady && termination.isActive && !piBusy && !outputActive &&
        browser.readyState === WebSocket.OPEN && upstream?.readyState === WebSocket.OPEN,
      speak: (text) => sendCommentary(text, null),
    });

    request.announceResearchCompletion = (result) => {
      if (result.status === 'failed') sendCommentary('The research failed. Check the research window for details.', null);
      else if (typeof result.summary === 'string' && result.summary.trim()) {
        sendCommentary(result.summary.trim().slice(0, 1_800), null);
      }
    };

    const limitTimer = setInterval(() => {
      if (termination.isEnding) return;
      const reason: SessionEndReason | undefined = limits.due(piBusy || pendingDelegation !== undefined);
      if (reason) {
        diagnostics.endReason(reason);
        requestGracefulEnd('Voice session time limit reached');
      }
    }, SESSION_LIMIT_CHECK_MS);
    limitTimer.unref();
    controller.signal.addEventListener('abort', () => clearInterval(limitTimer), { once: true });

    const queueProviderEvent = (event: Record<string, unknown>, audioBytes = 0) => {
      queuedAudioBytes += audioBytes;
      if (queuedAudioBytes > MAX_QUEUED_AUDIO_BYTES ||
          queuedProviderEvents.length > 64) {
        closeSession(1009, 'Voice audio queue is full');
        return;
      }
      queuedProviderEvents.push(event);
    };

    browser.on('message', (data, binary) => {
      if (dataSize(data) > MAX_CLIENT_MESSAGE_BYTES) {
        closeSession(1009, 'Voice message too large');
        return;
      }
      const event = parseVoiceEvent(data, binary);
      if (!event || typeof event.type !== 'string') {
        closeSession(1008, 'Invalid voice event');
        return;
      }
      if (event.type === 'jarvis.session.end') {
        if (termination.isEnding) return;
        requestGracefulEnd('Voice session ended');
        return;
      }
      if (termination.isEnding) return;
      if (event.type === 'jarvis.microphone.active') {
        microphoneActive = true;
        microphoneMuted = false;
        limits.touch();
        const providerEvent = { type: 'session.input_audio.unmute' };
        if (providerReady) sendUpstream(providerEvent);
        else queueProviderEvent(providerEvent);
        return;
      }
      if (event.type === 'jarvis.microphone.muted') {
        microphoneMuted = true;
        microphoneActive = false;
        const providerEvent = { type: 'session.input_audio.mute' };
        if (providerReady) sendUpstream(providerEvent);
        else queueProviderEvent(providerEvent);
        if (activeOutput) publishActivity('speaking');
        return;
      }
      if (event.type === 'jarvis.voice.input_audio.append') {
        if (microphoneMuted || !validPcm24Base64(event.audio)) {
          closeSession(1008, 'Invalid voice audio');
          return;
        }
        const providerEvent = { type: 'session.input_audio.append', audio: event.audio };
        if (providerReady) sendUpstream(providerEvent);
        else queueProviderEvent(providerEvent, Buffer.byteLength(event.audio, 'base64'));
        if (microphoneActive && !outputActive) publishActivity('listening');
        return;
      }
      if (event.type === 'jarvis.voice.playback.completed') {
        if (typeof event.responseId !== 'string' || !VALID_ITEM_PATTERN.test(event.responseId) ||
            typeof event.audible !== 'boolean') {
          closeSession(1008, 'Invalid voice playback receipt');
          return;
        }
        return;
      }
      if (event.type === 'jarvis.camera.state' && event.on === true ||
          event.type === 'jarvis.screen.context') {
        sendClient({
          type: 'jarvis.screen.context.unavailable',
          reason: 'not_supported',
          ...(typeof event.itemId === 'string' && VALID_ITEM_PATTERN.test(event.itemId)
            ? { itemId: event.itemId } : {}),
        });
        return;
      }
      if (event.type === 'jarvis.camera.state' && event.on === false ||
          event.type === 'jarvis.screen.context.unavailable') return;
      closeSession(1008, 'Unsupported voice event');
    });

    browser.once('close', (code) => {
      diagnostics.summary('browser', code);
      if (!termination.isTerminal) closeSession(1011, 'Browser disconnected', false);
    });
    browser.once('error', () => {
      if (!termination.isTerminal) closeSession(1011, 'Browser disconnected', false);
    });

    const shutdown = async () => {
      closeSession(1012, 'Service restarting; reconnect');
      await finalization;
    };
    app.shutdownConnections.add(shutdown);
    browser.once('close', () => app.shutdownConnections.delete(shutdown));

    void (async () => {
      try {
        if (app.proactiveConversationContext) {
          proactiveContext = await diagnostics.bound(
            'proactive_context',
            1_500,
            () => app.proactiveConversationContext!.read(request.principal!.objectId),
          ).catch(() => {
            diagnostics.stage('proactive_context_unavailable');
            return undefined;
          });
        }
        const [, token] = await Promise.all([
          sessionReady,
          diagnostics.bound('credential', TOKEN_TIMEOUT_MS, () => credential(getToken, controller.signal)),
        ]);
        if (controller.signal.aborted || browser.readyState !== WebSocket.OPEN) return;
        diagnostics.stage('credential_loaded');
        diagnostics.stage('upstream_connecting');
        const socket = connect(token, controller.signal);
        upstream = socket;
        diagnostics.watchdog('upstream_connecting', () => closeSession(VOICE_STARTUP_CLOSE_CODE, 'Voice service did not become ready'));
        socket.once('open', () => {
          if (socket !== upstream || controller.signal.aborted) return;
          diagnostics.stage('upstream_open');
          diagnostics.watchdog('upstream_ready', () => closeSession(VOICE_STARTUP_CLOSE_CODE, 'Voice service did not become ready'));
        });
        socket.on('message', receiveProvider);
        socket.once('close', (code, reason) => {
          if (socket !== upstream || controller.signal.aborted || termination.isTerminal) return;
          log.warn({
            events: [...seenEventTypes].join(',').slice(0, 400),
            closeCode: code,
            failure: reason.toString('utf8').replace(/[^A-Za-z0-9 .:,'()_-]/gu, ' ').slice(0, 120) || 'none',
            language,
          }, 'voice.upstream_closed');
          closeSession(1011, termination.phase === 'awaiting-provider-close'
            ? 'Voice connection ended before session.closed'
            : 'Voice connection ended');
        });
        socket.once('error', (error) => {
          if (socket !== upstream || controller.signal.aborted || termination.isTerminal) return;
          log.warn({ failure: safeFailure(error), language }, 'voice.connection_failed');
          closeSession(1011, termination.phase === 'awaiting-provider-close'
            ? 'Voice connection failed before session.closed'
            : 'Voice connection failed');
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        log.warn({ failure: safeFailure(error), language }, 'voice.connection_failed');
        closeSession(1011, 'Voice connection failed');
      }
    })();
  });
}

export function createVoiceRelayModule(options: VoiceRelayOptions): BackendModule {
  return {
    id: 'voice',
    tools: [],
    registerRoutes: async (app) => {
      if (!options.connect) return;
      const credentialCache = createVoiceCredentialCache(options.getToken, FOUNDRY_VOICE_SCOPE, (error) => {
        app.log.warn({ failure: safeFailure(error) }, 'voice.credential_refresh_failed');
      });
      credentialCache.warm();
      registerVoiceRoute(
        app,
        options.connect,
        (_scope, signal) => credentialCache.get(signal),
        options.visionWatch,
        options.drainTimeoutMs,
      );
    },
  };
}

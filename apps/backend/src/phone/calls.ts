import { randomBytes } from 'node:crypto';
import {
  KnownCallRejectReason,
  type CallAutomationClient,
  type AnswerCallOptions,
} from '@azure/communication-call-automation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from 'ws';
import type { BackendModule } from '../modules.js';
import type { PhoneSessionStore } from '../database/phone-session-store.js';
import { bridgePhoneMedia } from './media.js';
import { teamsUserObjectId, trustedPhoneCaller, type PhoneAllowlist } from './caller.js';

const INCOMING_CALL_EVENT = 'Microsoft.Communication.IncomingCall';
const VALIDATION_EVENT = 'Microsoft.EventGrid.SubscriptionValidationEvent';
const MAX_EVENT_BATCH = 64;
const MAX_ACTIVE_CALLS = 50;
const MAX_CALL_CONTEXT_CHARACTERS = 64_000;
const MAX_CALL_LIFETIME_MS = 4 * 60 * 60 * 1_000;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CALL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

interface IncomingCall {
  readonly eventId: string;
  readonly callId: string;
  readonly context: string;
  readonly caller: unknown;
  readonly called: unknown;
}

interface PhoneCall {
  readonly sessionId: string;
  readonly mediaTicket: string;
  readonly callbackTicket: string;
  readonly expiresAt: number;
  readonly timer: NodeJS.Timeout;
  callConnectionId?: string;
}

interface Ticket {
  readonly sessionId: string;
  readonly expiresAt: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
}

function eventId(value: unknown): string | undefined {
  return CALL_ID_PATTERN.test(typeof value === 'string' ? value : '') ? value as string : undefined;
}

function incomingCall(value: unknown): IncomingCall | undefined {
  const event = record(value);
  const data = record(event?.data);
  if (event?.eventType !== INCOMING_CALL_EVENT || !data) return undefined;
  const id = eventId(event.id);
  const context = data.incomingCallContext;
  const callId = eventId(data.correlationId) ?? eventId(data.serverCallId) ??
    eventId(data.callConnectionId) ?? id;
  if (!id || !callId || !string(context, MAX_CALL_CONTEXT_CHARACTERS)) return undefined;
  return {
    eventId: id,
    callId,
    context,
    caller: data.caller ?? data.from ?? data.fromCommunicationIdentifier,
    called: data.called ?? data.to ?? data.toCommunicationIdentifier,
  };
}

function ticketFrom(request: FastifyRequest): string | undefined {
  const query = record(request.query);
  const ticket = query?.ticket;
  return typeof ticket === 'string' && TICKET_PATTERN.test(ticket) ? ticket : undefined;
}

function callbackUri(origin: string, ticket: string): string {
  const url = new URL('/phone/callback', origin);
  url.searchParams.set('ticket', ticket);
  return url.href;
}

function mediaUri(origin: string, ticket: string): string {
  const url = new URL('/phone/media', origin);
  url.protocol = 'wss:';
  url.searchParams.set('ticket', ticket);
  return url.href;
}

export interface PhoneCallModuleOptions {
  readonly client: CallAutomationClient;
  readonly store: PhoneSessionStore;
  readonly ownerObjectId: string;
  readonly teamsResourceAccountObjectId: string;
  readonly publicOrigin: string;
  readonly getAllowlist: () => Promise<PhoneAllowlist>;
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly connect: (token: string, signal: AbortSignal, agentSessionId?: string) => websocket;
}

export interface PhoneCallModule extends BackendModule {
  readonly registerMediaRoute: (app: FastifyInstance) => void;
}

export function createPhoneCallModule(options: PhoneCallModuleOptions): PhoneCallModule {
  const activeCalls = new Map<string, PhoneCall>();
  const callbackTickets = new Map<string, Ticket>();
  const mediaTickets = new Map<string, Ticket>();
  const mediaSockets = new Map<string, websocket>();

  function issueTicket(): string {
    return randomBytes(32).toString('base64url');
  }

  function ticketSession(
    tickets: Map<string, Ticket>,
    token: string,
    consume: boolean,
  ): string | undefined {
    const ticket = tickets.get(token);
    if (!ticket || ticket.expiresAt <= Date.now()) {
      tickets.delete(token);
      return undefined;
    }
    if (consume) tickets.delete(token);
    return ticket.sessionId;
  }

  async function finishCall(
    sessionId: string,
    status: 'ended' | 'failed',
    hangUp: boolean,
  ): Promise<void> {
    const call = activeCalls.get(sessionId);
    if (!call) return;
    if (hangUp && call.callConnectionId) {
      try { await options.client.getCallConnection(call.callConnectionId).hangUp(true); }
      catch { /* The call may already have ended. */ }
    }
    await options.store.finish(sessionId, status);
    clearTimeout(call.timer);
    activeCalls.delete(sessionId);
    callbackTickets.delete(call.callbackTicket);
    mediaTickets.delete(call.mediaTicket);
    const socket = mediaSockets.get(sessionId);
    mediaSockets.delete(sessionId);
    if (socket && socket.readyState === websocket.OPEN) socket.close(1000, 'Phone call ended');
  }

  async function rejectCall(context: string, reason: KnownCallRejectReason): Promise<void> {
    await options.client.rejectCall(context, { callRejectReason: reason });
  }

  async function handleIncomingCall(
    event: IncomingCall,
    request: FastifyRequest,
  ): Promise<void> {
    const allowlist = await options.getAllowlist();
    const caller = trustedPhoneCaller(event.caller, options.ownerObjectId, allowlist);
    const called = teamsUserObjectId(event.called);
    if (!caller || called !== options.teamsResourceAccountObjectId.toLowerCase()) {
      await rejectCall(event.context, KnownCallRejectReason.Forbidden);
      request.log.info({ caller: 'redacted' }, 'phone.incoming_call_rejected');
      return;
    }
    if (activeCalls.size >= MAX_ACTIVE_CALLS) {
      await rejectCall(event.context, KnownCallRejectReason.Busy);
      return;
    }

    const session = await options.store.create({
      eventId: event.eventId,
      callId: event.callId,
      callerId: caller.id,
    });
    if (!session) return;

    const mediaTicket = issueTicket();
    const callbackTicket = issueTicket();
    const expiresAt = Date.now() + MAX_CALL_LIFETIME_MS;
    const timer = setTimeout(() => {
      void finishCall(session.sessionId, 'failed', true)
        .catch(() => request.log.warn('phone.call_cleanup_failed'));
    }, MAX_CALL_LIFETIME_MS);
    timer.unref();
    const call: PhoneCall = {
      sessionId: session.sessionId,
      mediaTicket,
      callbackTicket,
      expiresAt,
      timer,
    };
    activeCalls.set(session.sessionId, call);
    mediaTickets.set(mediaTicket, { sessionId: session.sessionId, expiresAt });
    callbackTickets.set(callbackTicket, { sessionId: session.sessionId, expiresAt });

    const mediaStreamingOptions: NonNullable<AnswerCallOptions['mediaStreamingOptions']> = {
      transportType: 'websocket',
      transportUrl: mediaUri(options.publicOrigin, mediaTicket),
      contentType: 'audio',
      audioChannelType: 'mixed',
      startMediaStreaming: true,
      enableBidirectional: true,
      audioFormat: 'pcm24KMono',
    };
    try {
      const answered = await options.client.answerCall(
        event.context,
        callbackUri(options.publicOrigin, callbackTicket),
        { mediaStreamingOptions },
      );
      const connectionId = answered.callConnectionProperties.callConnectionId;
      if (!string(connectionId, 256) ||
          !await options.store.activate(session.sessionId, connectionId)) {
        try { await answered.callConnection.hangUp(true); } catch { /* The call may have ended. */ }
        await finishCall(session.sessionId, 'failed', false);
        return;
      }
      call.callConnectionId = connectionId;
      request.log.info({
        phoneSessionId: session.sessionId,
        caller: 'redacted',
      }, 'phone.session_started');
    } catch {
      try { await rejectCall(event.context, KnownCallRejectReason.Busy); } catch { /* The call may have ended. */ }
      await finishCall(session.sessionId, 'failed', false);
      request.log.warn('phone.call_answer_failed');
    }
  }

  async function handleCallback(
    sessionId: string,
    body: unknown,
    request: FastifyRequest,
  ): Promise<boolean> {
    const events = Array.isArray(body) ? body : [body];
    if (events.length > MAX_EVENT_BATCH) return false;
    const call = activeCalls.get(sessionId);
    if (!call) return true;
    for (const value of events) {
      const event = record(value);
      const data = record(event?.data);
      const type = event?.eventType ?? event?.type;
      if (!event || !data || typeof type !== 'string') return false;
      const connectionId = data.callConnectionId;
      if (connectionId !== undefined &&
          (!string(connectionId, 256) ||
           (call.callConnectionId !== undefined && call.callConnectionId !== connectionId))) {
        return false;
      }
      if (type.endsWith('.CallConnected') && typeof connectionId === 'string') {
        call.callConnectionId ??= connectionId;
        await options.store.activate(sessionId, connectionId);
      } else if (type.endsWith('.CallDisconnected')) {
        await finishCall(sessionId, 'ended', false);
      } else if (type.endsWith('.CallFailed') || type.endsWith('.AnswerFailed') ||
                 type.endsWith('.MediaStreamingFailed')) {
        await finishCall(sessionId, 'failed', false);
      }
    }
    request.log.info({ phoneSessionId: sessionId }, 'phone.call_callback_processed');
    return true;
  }

  const module: PhoneCallModule = {
    id: 'phone',
    tools: [],
    registerRoutes: async (app) => {
      app.post('/phone/events', { config: { jarvisPhoneEvents: true } }, async (request, reply) => {
        if (!request.phoneEventGridPrincipal) return reply.code(403).send({ error: 'Forbidden' });
        const events = Array.isArray(request.body) ? request.body : [request.body];
        if (events.length === 0 || events.length > MAX_EVENT_BATCH) {
          return reply.code(400).send({ error: 'Invalid Event Grid event batch' });
        }
        if (events.some((value) => record(value)?.eventType === VALIDATION_EVENT)) {
          const validation = record(events[0]);
          const data = record(validation?.data);
          if (events.length !== 1 || typeof data?.validationCode !== 'string' ||
              !data.validationCode || data.validationCode.length > 256) {
            return reply.code(400).send({ error: 'Invalid Event Grid validation event' });
          }
          return reply.send({ validationResponse: data.validationCode });
        }
        try {
          for (const value of events) {
            const event = record(value);
            if (event?.eventType !== INCOMING_CALL_EVENT) continue;
            const call = incomingCall(event);
            if (!call) return reply.code(400).send({ error: 'Invalid incoming call event' });
            await handleIncomingCall(call, request);
          }
          return reply.code(202).send();
        } catch {
          request.log.warn('phone.incoming_call_processing_failed');
          return reply.code(503).send({ error: 'Phone call processing unavailable' });
        }
      });

      app.post('/phone/callback', { config: { jarvisPhoneCallback: true } }, async (request, reply) => {
        const token = ticketFrom(request);
        const sessionId = token && ticketSession(callbackTickets, token, false);
        if (!sessionId) return reply.code(403).send({ error: 'Forbidden' });
        try {
          if (!await handleCallback(sessionId, request.body, request)) {
            return reply.code(400).send({ error: 'Invalid call callback' });
          }
          return reply.code(202).send();
        } catch {
          request.log.warn('phone.call_callback_processing_failed');
          return reply.code(503).send({ error: 'Phone callback unavailable' });
        }
      });

      app.addHook('onReady', async () => {
        for (const session of await options.store.active()) {
          if (session.callConnectionId) {
            try { await options.client.getCallConnection(session.callConnectionId).hangUp(true); }
            catch { /* Calls can already be disconnected. */ }
          }
          await options.store.finish(session.sessionId, 'failed');
        }
      });
      app.addHook('onClose', async () => {
        for (const sessionId of activeCalls.keys()) {
          try { await finishCall(sessionId, 'failed', true); }
          catch { app.log.warn('phone.call_shutdown_cleanup_failed'); }
        }
      });
    },
    registerMediaRoute: (app) => {
      app.get('/phone/media', { websocket: true, config: { jarvisPhoneMedia: true } }, (socket, request) => {
        const token = ticketFrom(request);
        const sessionId = token && ticketSession(mediaTickets, token, true);
        if (!sessionId || !activeCalls.has(sessionId)) {
          socket.close(1008, 'Phone media ticket is invalid');
          return;
        }
        mediaSockets.set(sessionId, socket);
        bridgePhoneMedia({
          access: { sessionId },
          browser: socket,
          request,
          getToken: options.getToken,
          connect: options.connect,
        });
        socket.once('close', (code) => {
          if (activeCalls.has(sessionId) && code !== 1000) {
            void finishCall(sessionId, 'failed', true)
              .catch(() => request.log.warn('phone.call_media_cleanup_failed'));
          }
        });
      });
    },
  };
  return module;
}

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import type { WatchTranscriber } from './watch-transcription.js';
import { watchCredentialPath, watchTranscriptionPath, type WatchCredentials } from '../auth/watch-credential.js';

const MAX_AUDIO_BYTES = 2_880_000;
const MAX_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const TRANSCRIPTION_TIMEOUT_MS = 20_000;
const MAX_ACTIVE_REQUESTS = 2;

const transcriptionRequests = new WeakMap<FastifyRequest, { controller: AbortController; reason?: string }>();

function logStage(request: FastifyRequest, stage: string, fields: { status?: string; reason?: string } = {}): void {
  request.log.info({ stage, durationMs: Math.round(performance.now() - request.requestStartedAt), ...fields }, 'watch_transcription.stage');
}

export function installWatchTranscriptionDeadline(app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST' || ![watchTranscriptionPath, '/watch/transcribe'].includes(request.routeOptions.url ?? '')) return;
    logStage(request, 'request_accepted');
    const controller = new AbortController();
    const state: { controller: AbortController; reason?: string } = { controller };
    transcriptionRequests.set(request, state);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      logStage(request, 'deadline_exceeded');
      if (!reply.sent && !reply.raw.destroyed) {
        reply.header('Cache-Control', 'no-store').code(504).send({ error: 'Transcription timed out' });
      }
      controller.abort();
    }, TRANSCRIPTION_TIMEOUT_MS);
    const close = () => {
      clearTimeout(timer);
      if (!reply.raw.writableFinished) {
        logStage(request, 'completed', { status: timedOut ? 'timeout' : 'failure',
          reason: timedOut ? 'deadline_exceeded' : 'client_disconnected' });
        controller.abort();
      }
    };
    reply.raw.once('close', close);
    reply.raw.once('finish', () => {
      clearTimeout(timer);
      reply.raw.removeListener('close', close);
      const status = timedOut ? 'timeout' : reply.statusCode < 400 ? 'success' : 'failure';
      logStage(request, 'completed', { status, reason: timedOut ? 'deadline_exceeded'
        : state.reason ?? (status === 'success' ? 'completed' : 'request_failed') });
    });
  });
}

export function registerWatchTranscriptionRoute(app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, transcribe?: WatchTranscriber, credentials?: WatchCredentials): void {
  for (const method of ['POST', 'DELETE'] as const) {
    app.route({
      method,
      url: watchCredentialPath,
      bodyLimit: 1024,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (request.principal?.objectId !== app.ownerObjectId) return reply.code(403).send({ error: 'Forbidden' });
        if (request.body !== undefined) return reply.code(400).send({ error: 'Invalid request' });
        if (!credentials) return reply.code(503).send({ error: 'Service unavailable' });
        try {
          if (method === 'POST') return reply.send(await credentials.issue());
          await credentials.revoke();
          return reply.code(204).send();
        } catch {
          return reply.code(503).send({ error: 'Service unavailable' });
        }
      },
    });
  }
  let activeRequests = 0;
  for (const path of [watchTranscriptionPath, '/watch/transcribe']) app.post(path, {
    bodyLimit: MAX_BASE64_LENGTH + 4096,
    onRequest: async (request, reply) => {
      if (!request.watchCredentialHash) logStage(request, 'owner_authenticated');
      if (activeRequests >= MAX_ACTIVE_REQUESTS) {
        return reply.code(429).send({ error: 'Transcription busy' });
      }
      activeRequests += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        activeRequests -= 1;
        request.raw.removeListener('aborted', release);
        reply.raw.removeListener('finish', release);
        reply.raw.removeListener('close', release);
      };
      request.raw.once('aborted', release);
      reply.raw.once('finish', release);
      reply.raw.once('close', release);
      if (request.raw.aborted || reply.raw.destroyed) release();
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, 'audio')) {
      return reply.code(400).send({ error: 'Invalid audio' });
    }
    const { audio } = body as { audio: unknown };
    if (typeof audio !== 'string' || audio.length === 0 || audio.length > MAX_BASE64_LENGTH ||
        audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(audio)) {
      return reply.code(400).send({ error: 'Invalid audio' });
    }
    const pcm = Buffer.from(audio, 'base64');
    if (pcm.length === 0 || pcm.length > MAX_AUDIO_BYTES || pcm.length % 2 !== 0 || pcm.toString('base64') !== audio) {
      return reply.code(400).send({ error: 'Invalid audio' });
    }
    if (!transcribe) return reply.code(503).send({ error: 'Transcription unavailable' });

    const state = transcriptionRequests.get(request);
    if (!state) return reply.code(503).send({ error: 'Transcription unavailable' });
    const { controller } = state;
    const abort = () => controller.abort();
    const onResponseClose = () => { if (!reply.raw.writableFinished) abort(); };
    let rejectOnAbort: (() => void) | undefined;
    request.raw.once('aborted', abort);
    reply.raw.once('close', onResponseClose);
    app.shutdownConnections.add(abort);
    try {
      if (request.raw.aborted || reply.raw.destroyed || app.isStopping) abort();
      const text = await Promise.race([
        transcribe(pcm, controller.signal, (stage, reason) => {
          if (reason) state.reason = reason;
          logStage(request, stage, reason ? { reason } : {});
        }),
        new Promise<never>((_resolve, reject) => {
          if (controller.signal.aborted) {
            reject(new Error('Transcription cancelled'));
            return;
          }
          rejectOnAbort = () => reject(new Error('Transcription cancelled'));
          controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
        }),
      ]);
      if (typeof text !== 'string') throw new Error('Invalid transcription result');
      if (!reply.sent) return reply.send({ text });
    } catch {
      if (!reply.sent) return reply.code(503).send({ error: 'Transcription unavailable' });
    } finally {
      request.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', onResponseClose);
      if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
      app.shutdownConnections.delete(abort);
    }
  });
}

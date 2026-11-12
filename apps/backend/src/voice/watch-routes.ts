import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { WatchTranscriber } from './watch-transcription.js';

const MAX_AUDIO_BYTES = 2_880_000;
const MAX_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const TRANSCRIPTION_TIMEOUT_MS = 90_000;
const MAX_ACTIVE_REQUESTS = 2;

export function registerWatchTranscriptionRoute(app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, transcribe?: WatchTranscriber): void {
  let activeRequests = 0;
  app.post('/watch/transcribe', {
    bodyLimit: MAX_BASE64_LENGTH + 4096,
    onRequest: async (request, reply) => {
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

    const controller = new AbortController();
    const abort = () => controller.abort();
    const onResponseClose = () => { if (!reply.raw.writableFinished) abort(); };
    const timer = setTimeout(abort, TRANSCRIPTION_TIMEOUT_MS);
    request.raw.once('aborted', abort);
    reply.raw.once('close', onResponseClose);
    app.shutdownConnections.add(abort);
    try {
      if (request.raw.aborted || reply.raw.destroyed || app.isStopping) abort();
      const text = await Promise.race([
        transcribe(pcm, controller.signal),
        new Promise<never>((_resolve, reject) => {
          if (controller.signal.aborted) {
            reject(new Error('Transcription cancelled'));
            return;
          }
          controller.signal.addEventListener('abort', () => reject(new Error('Transcription cancelled')), { once: true });
        }),
      ]);
      if (typeof text !== 'string') throw new Error('Invalid transcription result');
      return reply.send({ text });
    } catch {
      return reply.code(503).send({ error: 'Transcription unavailable' });
    } finally {
      clearTimeout(timer);
      request.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', onResponseClose);
      app.shutdownConnections.delete(abort);
    }
  });
}

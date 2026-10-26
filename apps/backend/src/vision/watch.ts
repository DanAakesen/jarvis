import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { BackendModule } from '../modules.js';
import type { ConversationStore } from '../core/conversation-store.js';
import { readSettings } from '../core/settings.js';
import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import { DKK_PER_USD } from '../core/usage-pricing.js';
import { VISION_MODEL_DEPLOYMENT } from './foundry-model.js';
import {
  decodeFrame, SCREEN_FRAME_BODY_LIMIT, ScreenVisionError, validSessionId,
  type ScreenFrameUsageStore, type ScreenVisionModel,
} from './screen.js';

export type WatchSource = 'screen' | 'camera';

export interface VisionWatchUsageStore {
  reserveWatchFrame(input: {
    readonly sessionId: string;
    readonly eventId: string;
    readonly source: WatchSource;
    readonly limitDkk: number;
    readonly at: Date;
  }): Promise<{ outcome: 'reserved' | 'rate-limited' | 'limit' | 'inactive'; usedDkk: number }>;
  readWatchBudget(at: Date): Promise<number>;
  recordTokens: ScreenFrameUsageStore['recordTokens'];
}

interface SourceState {
  summary: string;
  instructions: string[];
  continuousDescription: boolean;
  receivedAt: number | null;
  revision: number;
  feedId?: string;
}

interface WatchSession {
  screen: SourceState;
  camera: SourceState;
  comments: Map<string, { text: string; at: number }>;
  pendingComments: Set<string>;
}

export interface VisionWatchResult {
  readonly summary: string;
  readonly speak: string | null;
  readonly budget: { usedUsd: number; limitUsd: number };
}

const dedupeMs = 120_000;
const sourceSchema = { type: 'string', enum: ['screen', 'camera'] };
const errorSchema = {
  type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false,
};

function parseObservation(text: string): { summary: string; noteworthy: boolean; speak: string | null } {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid watch response');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== 3 ||
      typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 5_000 ||
      typeof result.noteworthy !== 'boolean' ||
      !(result.speak === null || (typeof result.speak === 'string' && result.speak.trim() &&
        result.speak.length <= 1_000)) ||
      (!result.noteworthy && result.speak !== null)) throw new Error('Invalid watch response');
  return { summary: result.summary.trim(), noteworthy: result.noteworthy,
    speak: typeof result.speak === 'string' ? result.speak.trim() : null };
}

function commentKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export class VisionWatchService {
  private readonly sessions = new Map<string, WatchSession>();
  private readonly voices = new Map<string, (text: string) => boolean>();
  private readonly busy = new Set<string>();

  constructor(
    private readonly model: ScreenVisionModel,
    private readonly usage: VisionWatchUsageStore,
    private readonly conversations: ConversationStore,
    private readonly now: () => number = Date.now,
  ) {}

  registerVoice(sessionId: string, speak: (text: string) => boolean): () => void {
    this.voices.set(sessionId, speak);
    return () => {
      if (this.voices.get(sessionId) === speak) this.forgetSession(sessionId);
    };
  }

  forgetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.voices.delete(sessionId);
  }

  close(): void {
    this.sessions.clear();
    this.voices.clear();
  }

  private state(sessionId: string): WatchSession {
    const now = this.now();
    let state = this.sessions.get(sessionId);
    if (!state) {
      if (this.sessions.size >= 128) throw new ScreenVisionError(429, 'Too many active watch sessions.');
      state = { screen: { summary: '', instructions: [], continuousDescription: false, receivedAt: null, revision: 0 },
        camera: { summary: '', instructions: [], continuousDescription: false, receivedAt: null, revision: 0 }, comments: new Map(), pendingComments: new Set() };
      this.sessions.set(sessionId, state);
    }
    for (const [key, comment] of state.comments) {
      if (now - comment.at >= dedupeMs) state.comments.delete(key);
    }
    return state;
  }

  async setInstruction(sessionId: string, source: WatchSource | undefined, what: string | null, continuousDescription?: boolean): Promise<void> {
    const session = await this.conversations.getSession(sessionId);
    if (!session || session.endedAt) {
      this.forgetSession(sessionId);
      throw new ToolRefusal('Active conversation session not found.');
    }
    const state = this.state(sessionId);
    const sources = source ? [source] : ['screen', 'camera'] as const;
    if (what !== null && sources.some((selected) =>
      !state[selected].instructions.includes(what) && state[selected].instructions.length >= 20)) {
      throw new ToolRefusal('Stop an existing watch before adding more instructions.');
    }
    for (const selected of sources) {
      state[selected].revision += 1;
      if (what === null) state[selected].continuousDescription = false;
      else if (continuousDescription !== undefined) state[selected].continuousDescription = continuousDescription;
      if (what === null) state[selected].instructions = [];
      else if (!state[selected].instructions.includes(what)) {
        state[selected].instructions.push(what);
      }
    }
  }

  stopFeed(sessionId: string, source: WatchSource, feedId: string): void {
    const state = this.sessions.get(sessionId)?.[source];
    if (!state || state.feedId !== feedId) return;
    state.receivedAt = null;
    state.summary = '';
    state.instructions = [];
    state.continuousDescription = false;
    state.revision += 1;
  }

  feedStatus(sessionId: string, source: WatchSource): 'receiving' | 'unconfirmed' {
    const receivedAt = this.sessions.get(sessionId)?.[source].receivedAt;
    return receivedAt != null && this.now() - receivedAt < 15_000 ? 'receiving' : 'unconfirmed';
  }

  async watch(input: {
    readonly sessionId: string;
    readonly source: WatchSource;
    readonly feedId?: string;
    readonly image: Buffer;
    readonly limitUsd: number;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly signal: AbortSignal;
    readonly log: (fields: { source: WatchSource; noteworthy: boolean; spoke: boolean; latencyMs: number; cost: number }) => void;
  }): Promise<VisionWatchResult> {
    const started = this.now();
    const key = `${input.sessionId}:${input.source}`;
    if (this.busy.has(key) || this.busy.size >= 8) {
      throw new ScreenVisionError(429, 'Please wait for the current vision watch to finish.');
    }
    if (!Number.isFinite(input.limitUsd) || input.limitUsd < 0 || input.limitUsd > 100) {
      throw new ScreenVisionError(503, 'Vision watch settings are unavailable.');
    }
    this.busy.add(key);
    try {
      const session = await this.conversations.getSession(input.sessionId);
      if (!session || session.endedAt) {
        this.forgetSession(input.sessionId);
        throw new ScreenVisionError(404, 'Active conversation session not found.');
      }
      const state = this.state(input.sessionId);
      const latestQuestion = await this.conversations.getLatestDanMessageText?.(input.sessionId) ?? null;
      const at = new Date(started);
      const eventId = `watch:${input.source}:${randomUUID()}`;
      const reservation = await this.usage.reserveWatchFrame({
        sessionId: input.sessionId, eventId, source: input.source,
        limitDkk: input.limitUsd * DKK_PER_USD, at,
      });
      if (reservation.outcome === 'inactive') {
        this.forgetSession(input.sessionId);
        throw new ScreenVisionError(404, 'Active conversation session not found.');
      }
      if (reservation.outcome === 'limit') {
        throw new ScreenVisionError(429, 'The per-day vision budget is exhausted or too little remains to safely watch another frame. Watching resumes on the next UTC day.');
      }
      if (reservation.outcome === 'rate-limited') {
        throw new ScreenVisionError(429, 'Please wait 2.5 seconds before watching another frame from this source.');
      }
      const sourceState = state[input.source];
      sourceState.receivedAt = started;
      if (input.feedId) sourceState.feedId = input.feedId;
      const revision = sourceState.revision;
      const result = await this.model.describe({
        image: input.image, model: input.model ?? VISION_MODEL_DEPLOYMENT,
        reasoningEffort: input.reasoningEffort ?? 'none', signal: input.signal,
        watch: { source: input.source, continuousDescription: sourceState.continuousDescription, previousSummary: state[input.source].summary,
          instructions: [...state[input.source].instructions], latestQuestion: latestQuestion?.slice(0, 5_000) ?? null,
          recentComments: [...state.comments.values()].map((comment) => comment.text) },
      });
      if (!Number.isSafeInteger(result.inputTokens) || result.inputTokens < 0 ||
          !Number.isSafeInteger(result.outputTokens) || result.outputTokens < 0 ||
          result.costDkk === undefined || !Number.isFinite(result.costDkk) || result.costDkk < 0) {
        throw new Error('Vision usage unavailable');
      }
      // Charge even an invalid observation; the provider has already processed the frame.
      await this.usage.recordTokens({
        sessionId: input.sessionId, eventId, inputTokens: result.inputTokens,
        outputTokens: result.outputTokens, costDkk: result.costDkk,
        costUsd: result.costUsd ?? null,
        costStatus: result.costUsd !== undefined ? 'estimated' : 'unverified',
        model: VISION_MODEL_DEPLOYMENT, at,
      });
      const observation = parseObservation(result.description);
      const usedDkk = await this.usage.readWatchBudget(new Date(this.now()));
      if (!Number.isFinite(usedDkk) || usedDkk < 0) throw new Error('Vision budget unavailable');
      state[input.source].summary = observation.summary;
      let speak: string | null = null;
      const candidate = observation.speak;
      // Never announce once the shared daily budget is exhausted, or across UTC rollover.
      if (candidate && revision === sourceState.revision && usedDkk < input.limitUsd * DKK_PER_USD &&
          at.toISOString().slice(0, 10) === new Date(this.now()).toISOString().slice(0, 10) &&
          !input.signal.aborted && (sourceState.continuousDescription || !state.comments.has(commentKey(candidate))) &&
          !state.pendingComments.has(commentKey(candidate))) {
        state.pendingComments.add(commentKey(candidate));
        try {
          const current = await this.conversations.getSession(input.sessionId);
          if (!current || current.endedAt) {
            this.forgetSession(input.sessionId);
            throw new ScreenVisionError(404, 'Active conversation session not found.');
          }
          if (!input.signal.aborted && revision === sourceState.revision) {
            const deliveredByVoice = this.voices.get(input.sessionId)?.(candidate) ?? false;
            if (!deliveredByVoice && sourceState.continuousDescription && this.voices.has(input.sessionId)) {
              // Busy voice turns drop this observation; never queue a stale narration backlog.
              return { summary: observation.summary, speak: null, budget: { usedUsd: usedDkk / DKK_PER_USD, limitUsd: input.limitUsd } };
            }
            if (!deliveredByVoice) {
              const message = await this.conversations.addMessage({
                sessionId: input.sessionId, role: 'jarvis', text: candidate,
                model: VISION_MODEL_DEPLOYMENT, language: current.language,
              });
              if (!message) throw new Error('Vision comment could not be delivered');
            }
            state.comments.set(commentKey(candidate), { text: candidate, at: this.now() });
            if (state.comments.size > 64) state.comments.delete(state.comments.keys().next().value!);
            speak = candidate;
          }
        } finally {
          state.pendingComments.delete(commentKey(candidate));
        }
      }
      input.log({ source: input.source, noteworthy: observation.noteworthy, spoke: speak !== null,
        latencyMs: this.now() - started, cost: result.costDkk });
      return { summary: observation.summary, speak, budget: { usedUsd: usedDkk / DKK_PER_USD, limitUsd: input.limitUsd } };
    } catch (error) {
      if (error instanceof ScreenVisionError) throw error;
      throw new ScreenVisionError(503, 'I could not watch the shared image.');
    } finally {
      this.busy.delete(key);
    }
  }
}

async function toolSession(request: FastifyRequest): Promise<string> {
  const voiceMessage = request.jarvisConversationMessage;
  if (voiceMessage?.role === 'dan' && validSessionId(voiceMessage.sessionId)) return voiceMessage.sessionId;
  const header = request.headers['x-jarvis-message-id'];
  const messageId = request.jarvisMemorySourceMessageId ?? (typeof header === 'string' ? header : undefined);
  if (!messageId || !validSessionId(messageId)) throw new ToolRefusal('Watch instructions require an active conversation.');
  const sessionId = await request.server.conversationStore?.getMessageSessionId?.(messageId);
  if (!sessionId) throw new ToolRefusal('Active conversation session not found.');
  return sessionId;
}

export function createVisionWatchModule(service: VisionWatchService): BackendModule {
  const tools: JarvisTool[] = [
    {
      name: 'watch_for',
      description: 'Set standing instructions for incoming sampled images. Enable video automatically delivers camera frames; screen watching is separately enabled by Dan. For requests to keep describing, set continuousDescription=true. This tool cannot enable capture. Only claim updates are arriving if feed status is receiving; instructionsSaved alone is pending. Budget and ten-minute user-inactivity limits still apply. Omit source for both.',
      sensitive: true,
      inputSchema: { type: 'object', properties: { source: sourceSchema, what: { type: 'string', minLength: 1, maxLength: 300 }, continuousDescription: { type: 'boolean' } },
        required: ['what'], additionalProperties: false },
      execute: async (input, request) => {
        const { source, what, continuousDescription } = input as { source?: WatchSource; what: string; continuousDescription?: boolean };
        if (!what.trim()) throw new ToolRefusal('Describe what Jarvis should watch for.');
        const sessionId = await toolSession(request);
        await service.setInstruction(sessionId, source, what.trim(), continuousDescription);
        return { instructionsSaved: true, source: source ?? 'both',
          cameraFeed: service.feedStatus(sessionId, 'camera'), screenFeed: service.feedStatus(sessionId, 'screen') };
      },
    },
    {
      name: 'stop_watching_for',
      description: 'Clear watch instructions for the shared screen, camera, or both when source is omitted. Does not change Dan’s sharing toggles.',
      sensitive: true,
      inputSchema: { type: 'object', properties: { source: sourceSchema }, additionalProperties: false },
      execute: async (input, request) => {
        const { source } = input as { source?: WatchSource };
        await service.setInstruction(await toolSession(request), source, null);
        return { stopped: source ?? 'both' };
      },
    },
  ];
  return {
    id: 'vision-watch', tools,
    registerRoutes: async (app) => {
      app.addHook('onClose', async () => { service.close(); });
      app.delete<{ Body: { sessionId: string; source: WatchSource; feedId: string } }>('/vision/watch', {
        schema: { body: { type: 'object', properties: {
          sessionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 },
          source: sourceSchema, feedId: { type: 'string', format: 'uuid' },
        }, required: ['sessionId', 'source', 'feedId'], additionalProperties: false } },
      }, async (request, reply) => {
        if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
        service.stopFeed(request.body.sessionId, request.body.source, request.body.feedId);
        return reply.code(204).send();
      });
      app.post<{ Body: { sessionId: string; source: WatchSource; frame: string; feedId?: string } }>('/vision/watch', {
        bodyLimit: SCREEN_FRAME_BODY_LIMIT,
        schema: {
          body: { type: 'object', properties: {
            sessionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 },
            source: sourceSchema, feedId: { type: 'string', format: 'uuid' }, frame: { type: 'string', minLength: 4, maxLength: SCREEN_FRAME_BODY_LIMIT - 1_024 },
          }, required: ['sessionId', 'source', 'frame'], additionalProperties: false },
          response: {
            200: { type: 'object', properties: {
              summary: { type: 'string', maxLength: 5_000 }, speak: { type: ['string', 'null'], maxLength: 1_000 },
              budget: { type: 'object', properties: { usedUsd: { type: 'number' }, limitUsd: { type: 'number' } },
                required: ['usedUsd', 'limitUsd'], additionalProperties: false },
            }, required: ['summary', 'speak', 'budget'], additionalProperties: false },
            400: errorSchema, 401: errorSchema, 404: errorSchema, 429: errorSchema, 503: errorSchema,
          },
        },
      }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
        const { sessionId, source, frame, feedId } = request.body;
        request.body.frame = '';
        if (!validSessionId(sessionId)) return reply.code(400).send({ error: 'Invalid conversation session ID.' });
        if (!app.settingsStore) return reply.code(503).send({ error: 'Vision watching is unavailable.' });
        let image: Buffer | undefined;
        const controller = new AbortController();
        const abort = () => controller.abort();
        const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
        request.raw.once('aborted', abort);
        reply.raw.once('close', close);
        try {
          image = decodeFrame(frame);
          const settings = await readSettings(app.settingsStore, await app.modelCatalogue.read());
          return reply.send(await service.watch({
            sessionId, source, image, ...(feedId ? { feedId } : {}), limitUsd: settings.global.visionDailyBudgetUsd,
            model: settings.roles.vision.model, reasoningEffort: settings.roles.vision.reasoningEffort,
            signal: controller.signal,
            log: (fields) => { request.log.info(fields, 'vision.watch'); },
          }));
        } catch (error) {
          if (error instanceof ScreenVisionError) return reply.code(error.statusCode).send({ error: error.message });
          return reply.code(503).send({ error: 'Vision watching is unavailable.' });
        } finally {
          image?.fill(0);
          request.raw.removeListener('aborted', abort);
          reply.raw.removeListener('close', close);
        }
      });
    },
  };
}

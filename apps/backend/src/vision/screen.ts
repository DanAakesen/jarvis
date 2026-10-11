import { randomUUID } from 'node:crypto';
import type { BackendModule } from '../modules.js';
import { readSettings } from '../core/settings.js';

export const MAX_SCREEN_FRAME_BYTES = 1_000_000;
const MAX_SCREEN_FRAME_BASE64_BYTES = Math.ceil(MAX_SCREEN_FRAME_BYTES / 3) * 4;
const MAX_SCREEN_DESCRIPTION_CHARACTERS = 5_000;
export const MAX_SCREEN_QUESTION_CHARACTERS = 500;
export const SCREEN_FRAME_BODY_LIMIT = MAX_SCREEN_FRAME_BASE64_BYTES + 1_024;
export const SCREEN_QUESTION_FRAME_BODY_LIMIT = SCREEN_FRAME_BODY_LIMIT + MAX_SCREEN_QUESTION_CHARACTERS * 12;

export interface ScreenVisionResult {
  readonly description: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costDkk?: number;
  readonly costUsd?: number;
}

export interface ScreenFrameVisionResult extends ScreenVisionResult {
  readonly capturedAt: string;
  readonly question: string | null;
  readonly turnId?: string;
}

export interface ScreenVisionModel {
  describe(input: {
    readonly image: Buffer;
    readonly contentType?: 'image/jpeg' | 'image/png' | 'image/webp';
    readonly model: string;
    readonly reasoningEffort?: string;
    readonly signal: AbortSignal;
    readonly question?: string;
    readonly watch?: {
      readonly source: 'screen' | 'camera';
      readonly previousSummary: string;
      readonly instructions: readonly string[];
      readonly latestQuestion: string | null;
      readonly recentComments: readonly string[];
    };
  }): Promise<ScreenVisionResult>;
}

export interface ScreenFrameUsageStore {
  reserveFrame(input: {
    readonly sessionId: string;
    readonly eventId: string;
    readonly dailyCap: number;
    readonly at: Date;
  }): Promise<'reserved' | 'rate-limited' | 'limit' | 'inactive'>;
  recordTokens(input: {
    readonly sessionId: string;
    readonly eventId: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costDkk: number | null;
    readonly costUsd: number | null;
    readonly costStatus: 'estimated' | 'unverified';
    readonly model: string;
    readonly at: Date;
  }): Promise<void>;
}

export class ScreenVisionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: 'frame_rate_limited' | 'daily_limit',
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ScreenVisionError';
  }
}

export function normalizeScreenQuestion(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || Array.from(value).length > MAX_SCREEN_QUESTION_CHARACTERS) {
    throw new ScreenVisionError(400, 'A screen question must be a string of at most 500 characters.');
  }
  return value.trim() || undefined;
}

export function normalizeScreenTurnId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new ScreenVisionError(400, 'A screen turn ID must contain 1–128 ASCII letters, numbers, underscores or hyphens.');
  }
  return value;
}

export class ScreenVisionService {
  constructor(
    private readonly model: ScreenVisionModel,
    private readonly usage: ScreenFrameUsageStore,
    private readonly now: () => number = Date.now,
  ) {}

  requestReceivedAt(): Date {
    return new Date(this.now());
  }

  async describe(input: {
    readonly sessionId: string;
    readonly image: Buffer;
    readonly model: string;
    readonly reasoningEffort?: string;
    readonly dailyCap: number;
    readonly signal: AbortSignal;
    readonly question?: string;
    readonly turnId?: string;
    readonly capturedAt?: Date;
  }): Promise<ScreenFrameVisionResult> {
    const question = normalizeScreenQuestion(input.question);
    const turnId = normalizeScreenTurnId(input.turnId);
    const capturedAt = input.capturedAt ?? this.requestReceivedAt();
    if (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > 300) {
      throw new ScreenVisionError(503, 'Screen inspection settings are unavailable.');
    }
    const now = this.now();
    const eventId = randomUUID();
    const at = new Date(now);
    const reservation = await this.usage.reserveFrame({
      sessionId: input.sessionId,
      eventId,
      dailyCap: input.dailyCap,
      at,
    });
    if (reservation === 'inactive') {
      throw new ScreenVisionError(404, 'Active conversation session not found.');
    }
    if (reservation === 'limit') {
      throw new ScreenVisionError(429, 'The daily screen-inspection limit has been reached.', 'daily_limit');
    }
    if (reservation === 'rate-limited') {
      throw new ScreenVisionError(429, 'Please wait before inspecting another screen frame.', 'frame_rate_limited', 3_000);
    }

    try {
      const result = await this.model.describe({
        image: input.image,
        model: input.model,
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        signal: input.signal,
        ...(question === undefined ? {} : { question }),
      });
      if (!result.description.trim() || result.description.length > MAX_SCREEN_DESCRIPTION_CHARACTERS ||
          !Number.isSafeInteger(result.inputTokens) || result.inputTokens < 0 ||
          !Number.isSafeInteger(result.outputTokens) || result.outputTokens < 0 ||
          (result.costDkk !== undefined &&
            (!Number.isFinite(result.costDkk) || result.costDkk < 0)) ||
          (result.costUsd !== undefined &&
            (!Number.isFinite(result.costUsd) || result.costUsd < 0))) {
        throw new Error('Invalid screen description response');
      }
      await this.usage.recordTokens({
        sessionId: input.sessionId,
        eventId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costDkk: result.costDkk ?? null,
        costUsd: result.costUsd ?? null,
        costStatus: result.costDkk !== undefined && result.costUsd !== undefined ? 'estimated' : 'unverified',
        model: input.model,
        at,
      });
      return {
        description: result.description.trim(),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        capturedAt: capturedAt.toISOString(),
        question: question ?? null,
        ...(turnId === undefined ? {} : { turnId }),
      };
    } catch {
      throw new ScreenVisionError(503, 'Jarvis could not inspect the shared screen.');
    }
  }

}

export function validSessionId(value: string): boolean {
  return /^[1-9]\d{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

export function decodeFrame(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SCREEN_FRAME_BASE64_BYTES ||
      value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new ScreenVisionError(400, 'A valid JPEG screen frame is required.');
  }
  const image = Buffer.from(value, 'base64');
  if (image.length === 0 || image.length > MAX_SCREEN_FRAME_BYTES || image.toString('base64') !== value ||
      image[0] !== 0xff || image[1] !== 0xd8 || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
    image.fill(0);
    throw new ScreenVisionError(400, 'A valid JPEG screen frame is required.');
  }
  return image;
}

export function createScreenVisionModule(service: ScreenVisionService): BackendModule {
  return {
    id: 'screen-vision',
    tools: [],
    registerRoutes: async (app) => {
      const frameRequests = new WeakMap<object, { capturedAt: Date; question?: string; turnId?: string }>();
      app.post<{
        Body: { sessionId: string; frame: string; question?: string; turnId?: string };
      }>('/screen/frames', {
        bodyLimit: SCREEN_QUESTION_FRAME_BODY_LIMIT,
        onRequest: async (request) => {
          frameRequests.set(request, { capturedAt: service.requestReceivedAt() });
        },
        preValidation: async (request, reply) => {
          const capturedAt = frameRequests.get(request)!.capturedAt;
          const body: unknown = request.body;
          if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
          // Validate before AJV can coerce values; keep question data out of the request body.
          const question = (body as Record<string, unknown>)['question'];
          const turnId = (body as Record<string, unknown>)['turnId'];
          delete (body as Record<string, unknown>)['question'];
          delete (body as Record<string, unknown>)['turnId'];
          try {
            const normalized = normalizeScreenQuestion(question);
            const correlation = normalizeScreenTurnId(turnId);
            frameRequests.set(request, {
              capturedAt,
              ...(normalized === undefined ? {} : { question: normalized }),
              ...(correlation === undefined ? {} : { turnId: correlation }),
            });
          } catch (error) {
            reply.header('Cache-Control', 'no-store');
            return reply.code(400).send({ error: error instanceof ScreenVisionError ? error.message : 'Invalid screen request.' });
          }
        },
        schema: {
          body: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 },
              frame: { type: 'string', minLength: 4, maxLength: MAX_SCREEN_FRAME_BASE64_BYTES },
              question: { type: 'string', maxLength: MAX_SCREEN_QUESTION_CHARACTERS },
              turnId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', maxLength: 128 },
            },
            required: ['sessionId', 'frame'],
            additionalProperties: false,
          },
          response: {
            200: {
              type: 'object',
              properties: {
                description: { type: 'string', minLength: 1, maxLength: MAX_SCREEN_DESCRIPTION_CHARACTERS },
                inputTokens: { type: 'integer', minimum: 0 },
                outputTokens: { type: 'integer', minimum: 0 },
                capturedAt: { type: 'string', format: 'date-time' },
                question: { type: ['string', 'null'], maxLength: MAX_SCREEN_QUESTION_CHARACTERS },
                turnId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', maxLength: 128 },
              },
              required: ['description', 'inputTokens', 'outputTokens', 'capturedAt', 'question'],
              additionalProperties: false,
            },
            400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
            401: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
            404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
            429: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                code: { type: 'string', enum: ['frame_rate_limited', 'daily_limit'] },
                retryAfterMs: { type: 'integer', minimum: 0 },
              },
              required: ['error', 'code'],
              additionalProperties: false,
            },
            503: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
          },
        },
      }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const frameRequest = frameRequests.get(request);
        frameRequests.delete(request);
        if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
        const { sessionId, frame: encodedFrame } = request.body;
        request.body.frame = '';
        if (!validSessionId(sessionId)) return reply.code(400).send({ error: 'Invalid conversation session ID.' });
        if (!app.settingsStore) return reply.code(503).send({ error: 'Screen inspection is unavailable.' });

        let image: Buffer;
        try {
          image = decodeFrame(encodedFrame);
        } catch (error) {
          if (error instanceof ScreenVisionError) return reply.code(error.statusCode).send({ error: error.message });
          return reply.code(400).send({ error: 'A valid JPEG screen frame is required.' });
        }

        const controller = new AbortController();
        const abortOnRequest = () => controller.abort();
        const abortOnClose = () => {
          if (!reply.raw.writableEnded) controller.abort();
        };
        request.raw.once('aborted', abortOnRequest);
        reply.raw.once('close', abortOnClose);
        try {
          const settings = await readSettings(app.settingsStore, await app.modelCatalogue.read());
          const result = await service.describe({
            sessionId,
            image,
            model: settings.roles.vision.model,
            reasoningEffort: settings.roles.vision.reasoningEffort,
            dailyCap: settings.global.screenShareDailyFrameCap,
            signal: controller.signal,
            ...frameRequest,
          });
          return reply.send(result);
        } catch (error) {
          if (error instanceof ScreenVisionError) {
            return reply.code(error.statusCode).send({
              error: error.message,
              ...(error.code === undefined ? {} : { code: error.code }),
              ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
            });
          }
          return reply.code(503).send({ error: 'Screen inspection is unavailable.' });
        } finally {
          image.fill(0);
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
      });
    },
  };
}

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  InboxCaptureCredentialLimit, InboxCaptureCredentialUnavailable, inboxCapturePath, inboxCredentialsPath,
  type InboxCaptureCredentials,
} from '../auth/inbox-capture-credential.js';
import { createInboxCapture, MAX_RAW_CAPTURE_CHARACTERS, captureSources } from './capture.js';
import { InboxError } from './note.js';

const apiError = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false };
const savedItems = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' } },
    required: ['id', 'title'],
    additionalProperties: false,
  },
};
const notSaved = 'Not saved. Try again with the same captureId; it will not be saved twice.';

function titleList(items: ReadonlyArray<{ title: string }>): string {
  return items.map(({ title }) => title).join('; ');
}

export function createInboxRoutes(options: {
  readonly capture: ReturnType<typeof createInboxCapture>;
  readonly credentials?: InboxCaptureCredentials | undefined;
  readonly ownerObjectId: string;
}): FastifyPluginAsync {
  const ownerOnly = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (request.principal?.objectId.toLowerCase() === options.ownerObjectId.toLowerCase()) return true;
    void reply.code(403).send({ error: 'Forbidden' });
    return false;
  };

  return async (app) => {
    app.post<{ Body: unknown }>(inboxCapturePath, {
      bodyLimit: 16 * 1024,
      schema: {
        body: {
          type: 'object',
          properties: {
            captureId: { type: 'string', minLength: 16, maxLength: 64 },
            text: { type: 'string', minLength: 1, maxLength: MAX_RAW_CAPTURE_CHARACTERS },
            source: { type: 'string', enum: [...captureSources] },
          },
          required: ['captureId', 'text'],
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              saved: savedItems,
              repeated: { type: 'boolean' },
              triaged: { type: 'boolean' },
              confirmation: { type: 'string' },
            },
            required: ['saved', 'repeated', 'triaged', 'confirmation'],
            additionalProperties: false,
          },
          400: apiError, 403: apiError, 409: apiError, 413: apiError, 429: apiError, 503: apiError,
        },
      },
    }, async (request, reply) => {
      // Owner session or the write-only capture credential; the auth hook already refused every other principal.
      if (request.inboxCaptureCredentialHash === null && !ownerOnly(request, reply)) return;
      const signal = AbortSignal.timeout(30_000);
      try {
        const result = await options.capture(request.body, signal);
        return {
          saved: result.items.map(({ id, title }) => ({ id, title })),
          repeated: result.repeated,
          triaged: result.repeated ? false : result.triaged,
          confirmation: `${result.repeated ? 'Already in the inbox' : 'Saved to the inbox'}: ${titleList(result.items)}.`,
        };
      } catch (error) {
        if (error instanceof InboxError) {
          if (error.code === 'invalid' || error.code === 'refused') return reply.code(400).send({ error: error.message });
          if (error.code === 'too_large') return reply.code(413).send({ error: error.message });
          if (error.code === 'conflict') return reply.code(409).send({ error: error.message });
        }
        request.log.warn({ msg: 'inbox.tool', tool: 'inbox_capture', outcome: 'error' }, 'inbox.tool');
        return reply.code(503).send({ error: notSaved });
      }
    });

    const credentials = options.credentials;
    if (!credentials) return;
    const credentialFailure = (error: unknown, reply: FastifyReply) => {
      if (error instanceof InboxCaptureCredentialLimit) return reply.code(409).send({ error: error.message });
      if (error instanceof RangeError) return reply.code(400).send({ error: error.message });
      if (error instanceof InboxCaptureCredentialUnavailable) return reply.code(503).send({ error: 'Capture credentials are unavailable.' });
      throw error;
    };
    const credentialInfo = {
      type: 'object',
      properties: {
        id: { type: 'string' }, label: { type: 'string' }, scope: { type: 'string' }, createdAt: { type: 'string' },
        lastUsedAt: { type: ['string', 'null'] },
      },
      required: ['id', 'label', 'scope', 'createdAt', 'lastUsedAt'],
      additionalProperties: false,
    };

    app.post<{ Body: { label: string; scope?: 'write' | 'read_write' } }>(inboxCredentialsPath, {
      bodyLimit: 1024,
      schema: {
        body: {
          type: 'object',
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 40 },
            scope: { type: 'string', enum: ['write', 'read_write'] },
          },
          required: ['label'],
          additionalProperties: false,
        },
        response: {
          201: {
            type: 'object',
            properties: { credential: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' }, scope: { type: 'string' } },
            required: ['credential', 'id', 'label', 'scope'],
            additionalProperties: false,
          },
          400: apiError, 403: apiError, 409: apiError, 429: apiError, 503: apiError,
        },
      },
    }, async (request, reply) => {
      if (!ownerOnly(request, reply)) return;
      try {
        // The only time the credential is shown; only its hash is stored.
        reply.header('Cache-Control', 'no-store');
        return reply.code(201).send(await credentials.issue(request.body.label, request.body.scope));
      } catch (error) { return credentialFailure(error, reply); }
    });

    app.get(inboxCredentialsPath, {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { credentials: { type: 'array', items: credentialInfo } },
            required: ['credentials'],
            additionalProperties: false,
          },
          403: apiError, 429: apiError, 503: apiError,
        },
      },
    }, async (request, reply) => {
      if (!ownerOnly(request, reply)) return;
      try { return { credentials: await credentials.list() }; } catch (error) { return credentialFailure(error, reply); }
    });

    app.delete<{ Params: { id: string } }>(`${inboxCredentialsPath}/:id`, {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9a-f]{12}$' } }, required: ['id'] },
        response: { 204: { type: 'null' }, 403: apiError, 404: apiError, 429: apiError, 503: apiError },
      },
    }, async (request, reply) => {
      if (!ownerOnly(request, reply)) return;
      try {
        if (!await credentials.revoke(request.params.id)) return reply.code(404).send({ error: 'No such capture credential.' });
        return reply.code(204).send();
      } catch (error) { return credentialFailure(error, reply); }
    });
  };
}

import type { FastifyInstance, FastifyReply } from 'fastify';
import { GoogleApiError, type GoogleApiClient } from './api-client.js';

interface Appointment {
  subject: string;
  start: string;
  end: string;
  allDay: boolean;
}

const date = { type: 'string', format: 'date' };
const instant = { type: 'string', format: 'date-time' };
const boundary = { anyOf: [date, instant] };
const fields = {
  subject: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
  start: boundary,
  end: boundary,
  allDay: { type: 'boolean' },
};
const collection = '/calendars/primary/events';
const params = {
  type: 'object', required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,1024}$' } },
};
const conditionalHeaders = {
  type: 'object', required: ['if-match'],
  properties: { 'if-match': { type: 'string', pattern: '^"[^"\\r\\n]{1,180}"$' } },
};

function eventBody(input: Appointment) {
  if (input.allDay) {
    if (input.start.length !== 10 || input.end.length !== 10 || input.start >= input.end) return undefined;
    return { summary: input.subject.trim(), start: { date: input.start }, end: { date: input.end } };
  }
  if (input.start.length <= 10 || input.end.length <= 10 || Date.parse(input.start) >= Date.parse(input.end)) return undefined;
  return { summary: input.subject.trim(), start: { dateTime: input.start }, end: { dateTime: input.end } };
}

function mutationError(error: unknown, reply: FastifyReply) {
  if (!(error instanceof GoogleApiError)) throw error;
  const status = error.statusCode;
  if (status === 409 || status === 412) return reply.code(409).send({ error: 'Refresh the calendar to see the current event.' });
  if (status === 404 || status === 410) return reply.code(404).send({ error: 'Event no longer exists.' });
  if (status === 403) return reply.code(403).send({ error: 'Calendar access was denied.' });
  if (status === 429) return reply.code(429).send({ error: 'Calendar is busy. Try again shortly.' });
  return reply.code(502).send({ error: 'Calendar could not confirm the change. Refresh before retrying.' });
}

/** Direct owner gestures edit the same Google resource as the conversational Calendar tools. */
export function registerCalendarEdits(app: FastifyInstance, google: GoogleApiClient) {
  app.post<{ Body: Appointment & { id: string } }>('/calendar/events', {
    schema: { body: {
      type: 'object', additionalProperties: false, required: [...Object.keys(fields), 'id'],
      properties: { ...fields, id: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
    } },
  }, async (request, reply) => {
    const body = eventBody(request.body);
    if (!body) return reply.code(400).send({ error: 'Choose a valid event interval.' });
    try {
      await google.request('calendar', collection, {
        method: 'POST', body: { ...body, id: request.body.id }, signal: AbortSignal.timeout(20_000),
      });
      app.nowEventHub.publish({ type: 'refresh' });
      return reply.code(201).send({ id: request.body.id });
    } catch (error) { return mutationError(error, reply); }
  });

  app.patch<{ Params: { id: string }; Body: Appointment }>('/calendar/events/:id', {
    schema: { params, headers: conditionalHeaders, body: {
      type: 'object', additionalProperties: false, required: Object.keys(fields), properties: fields,
    } },
  }, async (request, reply) => {
    const body = eventBody(request.body);
    if (!body) return reply.code(400).send({ error: 'Choose a valid event interval.' });
    try {
      await google.request('calendar', collection + '/' + request.params.id, {
        method: 'PATCH', body, ifMatch: String(request.headers['if-match']), signal: AbortSignal.timeout(20_000),
      });
      app.nowEventHub.publish({ type: 'refresh' });
      return reply.code(204).send();
    } catch (error) { return mutationError(error, reply); }
  });

  app.delete<{ Params: { id: string } }>('/calendar/events/:id', {
    schema: { params, headers: conditionalHeaders },
  }, async (request, reply) => {
    try {
      await google.request('calendar', collection + '/' + request.params.id, {
        method: 'DELETE', ifMatch: String(request.headers['if-match']), signal: AbortSignal.timeout(20_000),
      });
      app.nowEventHub.publish({ type: 'refresh' });
      return reply.code(204).send();
    } catch (error) { return mutationError(error, reply); }
  });
}

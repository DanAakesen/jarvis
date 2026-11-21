import { createGoogleApiClient, type GoogleApiClient } from '../../../google/api-client.js';
import { createGoogleTokenProvider } from '../../../google/oauth.js';

/**
 * An in-memory Google (Calendar v3, Gmail v1 and the OAuth token endpoint) behind a `fetch` stub. The REAL token provider and the
 * REAL API client run over it, so the production request building and response parsing are exercised with no network.
 * The fake answers like a healthy Google: unknown ids are 404, bad bodies are 400, a missing or wrong bearer token is 401.
 * While a token is in `down` it fails like Google would:
 *   google               the network is unreachable (every request, including the token refresh, rejects)
 *   google:503 / :429 / :403 / :401   the API answers with that status (the token refresh still works)
 *   google:invalid-grant the token endpoint says the refresh token was revoked
 *   google:garbage       the API answers 200 with a body that is not JSON
 */

type Json = Record<string, unknown>;

export interface FakeEventTime { dateTime?: string; date?: string; timeZone?: string }
export interface FakeAttendee { email: string; responseStatus: string; self?: boolean; organizer?: boolean; displayName?: string }
export interface FakeEvent {
  id: string;
  status: 'confirmed' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: FakeEventTime;
  end: FakeEventTime;
  transparency?: 'transparent' | 'opaque';
  attendees?: FakeAttendee[];
  recurringEventId?: string;
}
export interface FakeLabel { id: string; name: string; type: 'system' | 'user' }
export interface FakePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: { name: string; value: string }[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: FakePart[];
}
export interface FakeMessage { id: string; threadId: string; labelIds: string[]; snippet: string; internalDate: number; payload: FakePart }
export interface FakeMailbox {
  labels: FakeLabel[];
  messages: FakeMessage[];
  drafts: { id: string; messageId: string }[];
  /** Large text bodies Gmail serves through the attachments endpoint, keyed `messageId/attachmentId` (base64url data). */
  attachments: Record<string, string>;
}
export interface FakeGoogleSeed { events: FakeEvent[]; mailbox: FakeMailbox }

/** A message as a person reads it. */
export interface MailView {
  id: string;
  threadId: string;
  labelIds: string[];
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo: string;
  references: string;
}

export interface FakeGoogle {
  /** The real API client, over the fake. */
  readonly client: GoogleApiClient;
  events(): readonly FakeEvent[];
  event(id: string): FakeEvent | undefined;
  findEvents(summary: string): readonly FakeEvent[];
  messages(): readonly MailView[];
  message(id: string): MailView | undefined;
  drafts(): readonly (MailView & { draftId: string })[];
  sent(): readonly MailView[];
  /** How often the token endpoint was asked for a token, and how often it declared the refresh token revoked. */
  readonly tokenRequests: () => number;
  readonly revocations: () => number;
  readonly requests: () => readonly string[];
  /** Throws when something asked for a URL or feature the fake does not serve (so a gap in the fake is loud, never a silent pass). */
  assertServed(): void;
}

export interface FakeGoogleRuntime {
  readonly seed: FakeGoogleSeed;
  readonly down: ReadonlySet<string>;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly owner: { readonly name: string; readonly email: string };
}

const origins = {
  calendar: 'https://www.googleapis.com',
  gmail: 'https://gmail.googleapis.com',
  oauth: 'https://oauth2.googleapis.com',
} as const;

const credentials = {
  clientId: 'conformance-client-id.apps.example.invalid',
  clientSecret: 'conformance-client-secret',
  refreshToken: 'conformance-refresh-token',
} as const;
const accessToken = 'conformance-access-token';

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8' } });
}
const empty = () => new Response(null, { status: 204 });
function failure(status: number, message: string, reason: string, state: string): Response {
  return json(status, { error: { code: status, message, errors: [{ message, domain: 'global', reason }], status: state } });
}
const badRequest = (message: string, reason = 'invalid') => failure(400, message, reason, 'INVALID_ARGUMENT');
const notFound = () => failure(404, 'Not Found', 'notFound', 'NOT_FOUND');

// ---- Time ------------------------------------------------------------------------------------------------------------------

const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/u;

function offsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a local calendar date starts in a time zone. */
export function localMidnight(date: string, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return guess - offsetMinutes(new Date(first), timeZone) * 60_000;
}

// ---- Field masks (`fields=items(id,summary),nextPageToken`) -------------------------------------------------------------------

type Mask = Map<string, Mask | undefined>;

function parseMask(source: string): Mask {
  let index = 0;
  const parse = (): Mask => {
    const mask: Mask = new Map();
    while (index < source.length) {
      let name = '';
      while (index < source.length && !',()'.includes(source[index]!)) { name += source[index]; index += 1; }
      let nested: Mask | undefined;
      if (source[index] === '(') { index += 1; nested = parse(); }
      if (name) mask.set(name, nested);
      if (source[index] === ',') { index += 1; continue; }
      if (source[index] === ')') { index += 1; return mask; }
    }
    return mask;
  };
  return parse();
}

function project(value: unknown, mask: Mask): unknown {
  if (Array.isArray(value)) return value.map((item) => project(item, mask));
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [name, nested] of mask) if (name in value) out[name] = nested ? project(value[name], nested) : value[name];
  return out;
}

// ---- Mail text -------------------------------------------------------------------------------------------------------------

const encodeBody = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const decodeBody = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

function decodeEncodedWords(value: string): string {
  return value.replace(/(\?=)\s+(=\?)/gu, '$1$2').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/gu, (_match, charset: string, encoding: string, payload: string) => {
    const bytes = encoding.toUpperCase() === 'B'
      ? Buffer.from(payload, 'base64')
      : Buffer.from(payload.replace(/_/gu, ' ').replace(/=([0-9A-Fa-f]{2})/gu, (_hex, code: string) => String.fromCharCode(parseInt(code, 16))), 'latin1');
    return bytes.toString(/^utf-?8$/iu.test(charset) ? 'utf8' : 'latin1');
  });
}

function headerOf(part: FakePart, name: string): string {
  return part.headers.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function bodyText(part: FakePart, mime: string, attachments: Record<string, string>, messageId: string): string | undefined {
  if (part.mimeType === mime && !part.filename) {
    const data = part.body.data ?? (part.body.attachmentId ? attachments[`${messageId}/${part.body.attachmentId}`] : undefined);
    return data === undefined ? undefined : decodeBody(data);
  }
  for (const child of part.parts ?? []) {
    const found = bodyText(child, mime, attachments, messageId);
    if (found !== undefined) return found;
  }
  return undefined;
}

function hasAttachment(part: FakePart): boolean {
  return part.filename !== '' || (part.parts ?? []).some(hasAttachment);
}

interface ParsedMime { headers: { name: string; value: string }[]; body: string }

/** The RFC 2822 text of the `raw` field Gmail takes: headers, a blank line, then the (optionally base64) body. */
function parseRaw(raw: unknown): ParsedMime | string {
  if (typeof raw !== 'string' || raw.length === 0) return 'Invalid value for ByteString: the raw message is missing';
  if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(raw)) return 'Invalid value for ByteString: the raw message must be base64url';
  const source = Buffer.from(raw, 'base64url').toString('utf8');
  const split = /\r?\n\r?\n/u.exec(source);
  const head = split ? source.slice(0, split.index) : source;
  const bodyRaw = split ? source.slice(split.index + split[0].length) : '';
  const headers: { name: string; value: string }[] = [];
  for (const line of head.split(/\r?\n/u)) {
    if (/^[ \t]/u.test(line) && headers.length > 0) { headers[headers.length - 1]!.value += ` ${line.trim()}`; continue; }
    const colon = line.indexOf(':');
    if (colon <= 0) return 'Invalid message headers';
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  const transfer = headers.find((entry) => entry.name.toLowerCase() === 'content-transfer-encoding')?.value.toLowerCase();
  const body = transfer === 'base64' ? Buffer.from(bodyRaw.replace(/\s+/gu, ''), 'base64').toString('utf8') : bodyRaw;
  return { headers: headers.map((entry) => ({ ...entry, value: decodeEncodedWords(entry.value) })), body };
}

// ---- Gmail search ----------------------------------------------------------------------------------------------------------

function tokens(query: string): { negated: boolean; key: string | undefined; value: string }[] {
  const out: { negated: boolean; key: string | undefined; value: string }[] = [];
  for (const match of query.matchAll(/(-?)(?:([A-Za-z_]+):)?(?:"([^"]*)"|(\S+))/gu)) {
    out.push({ negated: match[1] === '-', key: match[2]?.toLowerCase(), value: (match[3] ?? match[4] ?? '').toLowerCase() });
  }
  return out;
}

const searchOperators = new Set(['from', 'to', 'cc', 'subject', 'label', 'in', 'is', 'has', 'newer_than', 'older_than', 'after', 'before']);

// ----------------------------------------------------------------------------------------------------------------------------

export function createFakeGoogle(runtime: FakeGoogleRuntime): FakeGoogle {
  const { down, now, timeZone, owner } = runtime;
  const events = new Map<string, FakeEvent>(runtime.seed.events.map((event) => [event.id, structuredClone(event)]));
  const labels = structuredClone(runtime.seed.mailbox.labels);
  const messages = new Map<string, FakeMessage>(runtime.seed.mailbox.messages.map((message) => [message.id, structuredClone(message)]));
  const drafts = new Map<string, string>(runtime.seed.mailbox.drafts.map((draft) => [draft.id, draft.messageId]));
  const attachments = structuredClone(runtime.seed.mailbox.attachments);
  const requests: string[] = [];
  const unserved: string[] = [];
  let tokenRequests = 0;
  let revocations = 0;
  let counter = 0;
  const next = (prefix: string, width: number) => { counter += 1; return `${prefix}${String(counter).padStart(width, '0')}`; };

  const unsupported = (what: string): Response => {
    unserved.push(what);
    console.warn(`The Google conformance fake does not serve: ${what}`);
    return failure(501, `The Google conformance fake does not serve: ${what}`, 'notImplemented', 'UNIMPLEMENTED');
  };

  // ---- Calendar -----------------------------------------------------------------------------------------------------------

  const instant = (value: FakeEventTime): number => value.dateTime !== undefined && hasOffset.test(value.dateTime)
    ? Date.parse(value.dateTime)
    : value.dateTime !== undefined ? Date.parse(`${value.dateTime}Z`) - offsetMinutes(new Date(Date.parse(`${value.dateTime}Z`)), value.timeZone ?? timeZone) * 60_000
      : localMidnight(value.date!, timeZone);

  const resource = (event: FakeEvent): Json => ({
    kind: 'calendar#event', etag: `"${event.id}"`, id: event.id, status: event.status,
    htmlLink: `https://www.google.com/calendar/event?eid=${event.id}`,
    ...(event.summary === undefined ? {} : { summary: event.summary }),
    ...(event.description === undefined ? {} : { description: event.description }),
    ...(event.location === undefined ? {} : { location: event.location }),
    creator: { email: owner.email, self: true }, organizer: { email: owner.email, self: true },
    start: event.start, end: event.end,
    ...(event.transparency === undefined ? {} : { transparency: event.transparency }),
    ...(event.recurringEventId === undefined ? {} : { recurringEventId: event.recurringEventId }),
    ...(event.attendees === undefined ? {} : { attendees: event.attendees }),
    iCalUID: `${event.id}@google.com`, sequence: 0, eventType: 'default',
  });

  /** A start/end object as Google accepts it: a timed value needs an offset or a time zone, a date is all day. */
  function eventTime(value: unknown, name: string): FakeEventTime | Response {
    if (!isObject(value)) return badRequest(`Missing ${name} time.`, 'required');
    const dateTime = text(value.dateTime);
    const date = text(value.date);
    const zone = text(value.timeZone);
    if ((dateTime === undefined) === (date === undefined)) return badRequest(`Missing ${name} time.`, 'required');
    if (zone !== undefined) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { return badRequest('Invalid time zone definition for ' + name + ' time.', 'timeZoneDefinition'); }
    }
    if (dateTime !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/u.test(dateTime) || Number.isNaN(Date.parse(hasOffset.test(dateTime) ? dateTime : `${dateTime}Z`))) {
        return badRequest(`Invalid value for: ${name} time.`, 'invalid');
      }
      if (!hasOffset.test(dateTime) && zone === undefined) return badRequest(`Missing time zone definition for ${name} time.`, 'required');
      return { dateTime, ...(zone === undefined ? {} : { timeZone: zone }) };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date!) || Number.isNaN(Date.parse(date!))) return badRequest(`Invalid value for: ${name} time.`, 'invalid');
    return { date: date! };
  }

  function attendeeList(value: unknown, organizer: boolean): FakeAttendee[] | Response {
    if (!Array.isArray(value)) return badRequest('Invalid value for: attendees.', 'invalid');
    const out: FakeAttendee[] = [];
    for (const item of value) {
      const email = isObject(item) ? text(item.email) : undefined;
      if (email === undefined || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return badRequest('Invalid attendee email.', 'invalid');
      out.push({ email, responseStatus: 'needsAction' });
    }
    return organizer && out.length > 0 ? [{ email: owner.email, responseStatus: 'accepted', self: true, organizer: true }, ...out] : out;
  }

  const searchable = (event: FakeEvent) => [event.summary, event.description, event.location, ...(event.attendees ?? []).flatMap((a) => [a.email, a.displayName])]
    .filter((part): part is string => typeof part === 'string').join('\n').toLowerCase();

  function listEvents(url: URL): Response {
    const params = url.searchParams;
    const bound = (name: string): number | undefined | Response => {
      const value = params.get(name);
      if (value === null) return undefined;
      return rfc3339.test(value) && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : badRequest(`Bad Request: invalid ${name}`, 'invalid');
    };
    const min = bound('timeMin');
    if (min instanceof Response) return min;
    const max = bound('timeMax');
    if (max instanceof Response) return max;
    if (min !== undefined && max !== undefined && max <= min) return badRequest('The specified time range is empty.', 'timeRangeEmpty');
    const pageSize = params.has('maxResults') ? Number(params.get('maxResults')) : 250;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 2500) return badRequest('Invalid value for: maxResults', 'invalid');
    if (params.get('orderBy') === 'startTime' && params.get('singleEvents') !== 'true') {
      return badRequest('The requested ordering is not available for the particular query.', 'invalid');
    }
    for (const name of params.keys()) {
      if (!['timeMin', 'timeMax', 'maxResults', 'singleEvents', 'orderBy', 'fields', 'q', 'pageToken'].includes(name)) return unsupported(`calendar events.list parameter ${name}`);
    }
    const terms = (params.get('q') ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
    const matching = [...events.values()]
      .filter((event) => event.status !== 'cancelled'
        && (max === undefined || instant(event.start) < max) && (min === undefined || instant(event.end) > min)
        && terms.every((term) => searchable(event).includes(term)))
      .sort((left, right) => instant(left.start) - instant(right.start) || left.id.localeCompare(right.id));
    const token = params.get('pageToken');
    const offset = token === null ? 0 : /^page-(\d+)$/u.exec(token)?.[1] === undefined ? Number.NaN : Number(/^page-(\d+)$/u.exec(token)![1]);
    if (Number.isNaN(offset)) return badRequest('Invalid page token.', 'invalid');
    const page = matching.slice(offset, offset + pageSize);
    const body = {
      kind: 'calendar#events', summary: owner.email, timeZone, accessRole: 'owner', items: page.map(resource),
      ...(offset + pageSize < matching.length ? { nextPageToken: `page-${offset + pageSize}` } : {}),
    };
    return json(200, params.has('fields') ? project(body, parseMask(params.get('fields')!)) : body);
  }

  function createEvent(body: unknown): Response {
    if (!isObject(body)) return badRequest('Invalid JSON payload received.');
    for (const key of Object.keys(body)) {
      if (!['summary', 'description', 'location', 'start', 'end', 'attendees', 'transparency'].includes(key)) return badRequest(`Invalid JSON payload received. Unknown name "${key}": Cannot find field.`);
    }
    const start = eventTime(body.start, 'start');
    if (start instanceof Response) return start;
    const end = eventTime(body.end, 'end');
    if (end instanceof Response) return end;
    if (instant(end) <= instant(start)) return badRequest('The specified time range is empty.', 'timeRangeEmpty');
    const attendees = body.attendees === undefined ? undefined : attendeeList(body.attendees, true);
    if (attendees instanceof Response) return attendees;
    const event: FakeEvent = {
      id: next('conformance', 4), status: 'confirmed', start, end,
      ...(text(body.summary) === undefined ? {} : { summary: text(body.summary)! }),
      ...(text(body.description) === undefined ? {} : { description: text(body.description)! }),
      ...(text(body.location) === undefined ? {} : { location: text(body.location)! }),
      ...(attendees === undefined || attendees.length === 0 ? {} : { attendees }),
    };
    events.set(event.id, event);
    return json(200, resource(event));
  }

  function patchEvent(event: FakeEvent, body: unknown): Response {
    if (!isObject(body)) return badRequest('Invalid JSON payload received.');
    const draft: FakeEvent = structuredClone(event);
    for (const [key, value] of Object.entries(body)) {
      if (key === 'summary' || key === 'description' || key === 'location') {
        if (typeof value !== 'string') return badRequest(`Invalid value for: ${key}`);
        draft[key] = value;
      } else if (key === 'start' || key === 'end') {
        const time = eventTime(value, key);
        if (time instanceof Response) return time;
        draft[key] = time;
      } else if (key === 'attendees') {
        const attendees = attendeeList(value, true);
        if (attendees instanceof Response) return attendees;
        if (attendees.length === 0) delete draft.attendees; else draft.attendees = attendees;
      } else return badRequest(`Invalid JSON payload received. Unknown name "${key}": Cannot find field.`);
    }
    if (instant(draft.end) <= instant(draft.start)) return badRequest('The specified time range is empty.', 'timeRangeEmpty');
    events.set(event.id, draft);
    return json(200, resource(draft));
  }

  function calendar(method: string, url: URL, body: unknown): Response {
    const collection = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/u.exec(url.pathname);
    const single = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/u.exec(url.pathname);
    const calendarId = decodeURIComponent((collection ?? single)?.[1] ?? '');
    if (!collection && !single) return unsupported(`${method} ${url.pathname}`);
    if (calendarId !== 'primary') return notFound();
    if (collection) {
      if (method === 'GET') return listEvents(url);
      if (method === 'POST') return createEvent(body);
      return unsupported(`${method} ${url.pathname}`);
    }
    const event = events.get(decodeURIComponent(single![2]!));
    if (!event) return notFound();
    if (method === 'GET') return json(200, resource(event));
    if (method === 'PATCH') return patchEvent(event, body);
    if (method === 'DELETE') { events.delete(event.id); return empty(); }
    return unsupported(`${method} ${url.pathname}`);
  }

  // ---- Gmail --------------------------------------------------------------------------------------------------------------

  const view = (message: FakeMessage): MailView => ({
    id: message.id, threadId: message.threadId, labelIds: [...message.labelIds],
    from: headerOf(message.payload, 'From'), to: headerOf(message.payload, 'To'), cc: headerOf(message.payload, 'Cc'),
    subject: headerOf(message.payload, 'Subject'),
    body: bodyText(message.payload, 'text/plain', attachments, message.id) ?? bodyText(message.payload, 'text/html', attachments, message.id) ?? '',
    messageId: headerOf(message.payload, 'Message-ID'), inReplyTo: headerOf(message.payload, 'In-Reply-To'), references: headerOf(message.payload, 'References'),
  });

  function formatted(message: FakeMessage, format: string | null): Json | Response {
    const base = { id: message.id, threadId: message.threadId, labelIds: message.labelIds, snippet: message.snippet, historyId: '1', internalDate: String(message.internalDate), sizeEstimate: 2048 };
    if (format === null || format === 'full') return { ...base, payload: message.payload };
    if (format === 'minimal') return base;
    if (format === 'metadata') {
      return { ...base, payload: { partId: '', mimeType: message.payload.mimeType, filename: '', headers: message.payload.headers, body: { size: 0 } } };
    }
    return unsupported(`gmail message format=${format}`);
  }

  const knownLabel = (id: string) => labels.some((label) => label.id === id);

  function matches(message: FakeMessage, query: string): boolean | Response {
    const details = view(message);
    const parts = tokens(query);
    const unknown = parts.find((part) => part.key !== undefined && !searchOperators.has(part.key));
    if (unknown) return unsupported(`gmail search operator ${unknown.key}:`);
    const inFilter = parts.find((part) => part.key === 'in' && !part.negated)?.value;
    const hidden = message.labelIds.includes('SPAM') || message.labelIds.includes('TRASH');
    if (hidden && inFilter !== 'anywhere' && inFilter !== 'spam' && inFilter !== 'trash') return false;
    const haystack = `${details.subject}\n${details.from}\n${details.to}\n${message.snippet}\n${details.body}`.toLowerCase();
    const labelNames = message.labelIds.flatMap((id) => [id.toLowerCase(), labels.find((label) => label.id === id)?.name.toLowerCase() ?? '']);
    return parts.every((part) => {
      let hit: boolean;
      switch (part.key) {
        case 'from': hit = details.from.toLowerCase().includes(part.value); break;
        case 'to': hit = details.to.toLowerCase().includes(part.value); break;
        case 'cc': hit = details.cc.toLowerCase().includes(part.value); break;
        case 'subject': hit = details.subject.toLowerCase().includes(part.value); break;
        case 'label': hit = labelNames.includes(part.value.replace(/-/gu, ' ')) || labelNames.includes(part.value); break;
        case 'in': hit = part.value === 'anywhere' || labelNames.includes(part.value === 'drafts' ? 'draft' : part.value); break;
        case 'is': hit = part.value === 'read' ? !message.labelIds.includes('UNREAD') : message.labelIds.includes(part.value.toUpperCase()); break;
        case 'has': hit = part.value === 'attachment' && hasAttachment(message.payload); break;
        case 'newer_than': case 'older_than': {
          const span = /^(\d+)([dhmy])$/u.exec(part.value);
          const unit = { h: 3_600_000, d: 86_400_000, m: 2_592_000_000, y: 31_536_000_000 }[span?.[2] as 'h' | 'd' | 'm' | 'y'] ?? Number.NaN;
          const age = now().getTime() - message.internalDate;
          hit = part.key === 'newer_than' ? age <= Number(span?.[1]) * unit : age >= Number(span?.[1]) * unit;
          break;
        }
        case 'after': case 'before': {
          const cutoff = Date.parse(part.value.replace(/\//gu, '-'));
          hit = part.key === 'after' ? message.internalDate >= cutoff : message.internalDate < cutoff;
          break;
        }
        default: hit = haystack.includes(part.value);
      }
      return part.negated ? !hit : hit;
    });
  }

  function page<T>(all: readonly T[], url: URL): { items: T[]; nextPageToken?: string } | Response {
    const size = url.searchParams.has('maxResults') ? Number(url.searchParams.get('maxResults')) : 100;
    if (!Number.isInteger(size) || size < 1 || size > 500) return badRequest('Invalid value for: maxResults');
    const token = url.searchParams.get('pageToken');
    const offset = token === null ? 0 : Number(/^page-(\d+)$/u.exec(token)?.[1] ?? Number.NaN);
    if (Number.isNaN(offset)) return badRequest('Invalid pageToken.');
    return { items: all.slice(offset, offset + size), ...(offset + size < all.length ? { nextPageToken: `page-${offset + size}` } : {}) };
  }

  const newestFirst = (left: FakeMessage, right: FakeMessage) => right.internalDate - left.internalDate;

  function listMessages(url: URL): Response {
    for (const name of url.searchParams.keys()) {
      if (!['q', 'maxResults', 'pageToken'].includes(name)) return unsupported(`gmail messages.list parameter ${name}`);
    }
    const found: FakeMessage[] = [];
    for (const message of [...messages.values()].sort(newestFirst)) {
      const hit = matches(message, url.searchParams.get('q') ?? '');
      if (hit instanceof Response) return hit;
      if (hit) found.push(message);
    }
    const paged = page(found, url);
    if (paged instanceof Response) return paged;
    return json(200, {
      ...(paged.items.length > 0 ? { messages: paged.items.map(({ id, threadId }) => ({ id, threadId })) } : {}),
      ...(paged.nextPageToken === undefined ? {} : { nextPageToken: paged.nextPageToken }), resultSizeEstimate: found.length,
    });
  }

  /** A stored message made from a `raw` MIME message, as Gmail keeps it: decoded headers, the account's From, a Message-ID, a text body. */
  function storeRaw(body: unknown, label: 'DRAFT' | 'SENT', existing?: { id: string; threadId: string }): { message: FakeMessage } | Response {
    if (!isObject(body)) return badRequest('Invalid JSON payload received.');
    const raw = isObject(body.message) ? body.message : body;
    const parsed = parseRaw(raw.raw);
    if (typeof parsed === 'string') return badRequest(parsed);
    const to = parsed.headers.find((entry) => entry.name.toLowerCase() === 'to')?.value ?? '';
    if (label === 'SENT' && !/@/u.test(to)) return badRequest('Invalid To header', 'invalidArgument');
    const requestedThread = text(raw.threadId);
    if (requestedThread !== undefined && ![...messages.values()].some((message) => message.threadId === requestedThread)) return notFound();
    const id = next('18f', 13);
    const keep = ['to', 'cc', 'bcc', 'subject', 'in-reply-to', 'references'];
    const headers = [
      { name: 'From', value: `${owner.name} <${owner.email}>` },
      ...parsed.headers.filter((entry) => keep.includes(entry.name.toLowerCase())),
      { name: 'Date', value: now().toUTCString() },
      { name: 'Message-ID', value: `<${id}@mail.gmail.com>` },
      { name: 'MIME-Version', value: '1.0' },
      { name: 'Content-Type', value: 'text/plain; charset="UTF-8"' },
    ];
    const message: FakeMessage = {
      id: existing?.id ?? id, threadId: existing?.threadId ?? requestedThread ?? next('thr-', 6), labelIds: [label], snippet: parsed.body.slice(0, 100),
      internalDate: now().getTime(),
      payload: { partId: '', mimeType: 'text/plain', filename: '', headers, body: { size: Buffer.byteLength(parsed.body), data: encodeBody(parsed.body) } },
    };
    return { message };
  }

  function gmail(method: string, url: URL, body: unknown): Response {
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    const id = (match: RegExpExecArray | null, group = 1) => decodeURIComponent(match?.[group] ?? '');
    let match: RegExpExecArray | null;

    if (path === '/labels' && method === 'GET') return json(200, { labels: labels.map((label) => ({ ...label, messageListVisibility: 'show', labelListVisibility: 'labelShow' })) });
    if (path === '/messages' && method === 'GET') return listMessages(url);
    if (path === '/messages/send' && method === 'POST') {
      const stored = storeRaw(body, 'SENT');
      if (stored instanceof Response) return stored;
      messages.set(stored.message.id, stored.message);
      return json(200, { id: stored.message.id, threadId: stored.message.threadId, labelIds: ['SENT'] });
    }
    if ((match = /^\/messages\/([^/]+)\/modify$/u.exec(path)) && method === 'POST') {
      const message = messages.get(id(match));
      if (!message) return failure(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND');
      if (!isObject(body)) return badRequest('Invalid JSON payload received.');
      const add = Array.isArray(body.addLabelIds) ? body.addLabelIds : [];
      const remove = Array.isArray(body.removeLabelIds) ? body.removeLabelIds : [];
      for (const label of [...add, ...remove]) if (typeof label !== 'string' || !knownLabel(label)) return badRequest(`Invalid label: ${String(label)}`);
      message.labelIds = [...new Set([...message.labelIds.filter((label) => !remove.includes(label)), ...add as string[]])];
      return json(200, { id: message.id, threadId: message.threadId, labelIds: message.labelIds });
    }
    if ((match = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/u.exec(path)) && method === 'GET') {
      const data = attachments[`${id(match)}/${id(match, 2)}`];
      return data === undefined ? failure(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND') : json(200, { size: Buffer.byteLength(decodeBody(data)), data });
    }
    if ((match = /^\/messages\/([^/]+)$/u.exec(path)) && method === 'GET') {
      const message = messages.get(id(match));
      if (!message) return failure(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND');
      const answer = formatted(message, url.searchParams.get('format'));
      return answer instanceof Response ? answer : json(200, answer);
    }
    if (path === '/drafts' && method === 'GET') {
      const listed = [...drafts].map(([draftId, messageId]) => ({ draftId, message: messages.get(messageId)! })).sort((left, right) => newestFirst(left.message, right.message));
      const paged = page(listed, url);
      if (paged instanceof Response) return paged;
      return json(200, {
        ...(paged.items.length > 0 ? { drafts: paged.items.map(({ draftId, message }) => ({ id: draftId, message: { id: message.id, threadId: message.threadId } })) } : {}),
        ...(paged.nextPageToken === undefined ? {} : { nextPageToken: paged.nextPageToken }), resultSizeEstimate: listed.length,
      });
    }
    if (path === '/drafts' && method === 'POST') {
      const stored = storeRaw(body, 'DRAFT');
      if (stored instanceof Response) return stored;
      const draftId = `r${next('', 12)}`;
      messages.set(stored.message.id, stored.message);
      drafts.set(draftId, stored.message.id);
      return json(200, { id: draftId, message: { id: stored.message.id, threadId: stored.message.threadId, labelIds: ['DRAFT'] } });
    }
    if ((match = /^\/drafts\/([^/]+)$/u.exec(path))) {
      const draftId = id(match);
      const messageId = drafts.get(draftId);
      const current = messageId === undefined ? undefined : messages.get(messageId);
      if (!current) return failure(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND');
      if (method === 'GET') {
        const answer = formatted(current, url.searchParams.get('format'));
        return answer instanceof Response ? answer : json(200, { id: draftId, message: answer });
      }
      if (method === 'DELETE') { messages.delete(current.id); drafts.delete(draftId); return empty(); }
      if (method === 'PUT') {
        const stored = storeRaw(body, 'DRAFT', { id: next('18f', 13), threadId: current.threadId });
        if (stored instanceof Response) return stored;
        messages.delete(current.id);
        messages.set(stored.message.id, stored.message);
        drafts.set(draftId, stored.message.id);
        return json(200, { id: draftId, message: { id: stored.message.id, threadId: stored.message.threadId, labelIds: ['DRAFT'] } });
      }
    }
    return unsupported(`${method} ${url.pathname}`);
  }

  // ---- OAuth and routing --------------------------------------------------------------------------------------------------

  function token(body: unknown): Response {
    if (down.has('google:invalid-grant')) {
      revocations += 1;
      return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    }
    const form = body instanceof URLSearchParams ? body : new URLSearchParams();
    if (form.get('grant_type') !== 'refresh_token' || form.get('client_id') !== credentials.clientId
      || form.get('client_secret') !== credentials.clientSecret || form.get('refresh_token') !== credentials.refreshToken) {
      return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
    }
    tokenRequests += 1;
    return json(200, { access_token: accessToken, expires_in: 3599, scope: 'calendar gmail', token_type: 'Bearer' });
  }

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    init?.signal?.throwIfAborted();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    requests.push(`${method} ${url.origin}${url.pathname}`);
    if (down.has('google')) throw new TypeError('fetch failed');
    if (url.origin === origins.oauth) return url.pathname === '/token' && method === 'POST' ? token(init?.body) : unsupported(`${method} ${url.origin}${url.pathname}`);
    if (url.origin !== origins.calendar && url.origin !== origins.gmail) {
      unserved.push(`${method} ${url.origin}${url.pathname}`);
      console.warn(`The Google conformance fake refuses a request outside the Google APIs: ${method} ${url.origin}${url.pathname}`);
      throw new TypeError('fetch failed');
    }
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${accessToken}` || down.has('google:401')) {
      return failure(401, 'Request had invalid authentication credentials.', 'authError', 'UNAUTHENTICATED');
    }
    if (down.has('google:403')) return failure(403, 'The caller does not have permission', 'forbidden', 'PERMISSION_DENIED');
    if (down.has('google:429')) return failure(429, 'Rate Limit Exceeded', 'rateLimitExceeded', 'RESOURCE_EXHAUSTED');
    if (down.has('google:503')) return failure(503, 'The service is currently unavailable.', 'backendError', 'UNAVAILABLE');
    if (down.has('google:garbage')) return new Response('<html><body>Bad gateway</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    let body: unknown;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { return badRequest('Invalid JSON payload received.'); }
    }
    return url.origin === origins.calendar ? calendar(method, url, body) : gmail(method, url, body);
  };

  const tokenProvider = createGoogleTokenProvider({
    getCredentials: async () => ({ ...credentials }), onInvalidGrant: async () => {}, fetch: fakeFetch as typeof fetch,
  });
  const drafted = () => [...drafts].map(([draftId, messageId]) => ({ ...view(messages.get(messageId)!), draftId }));

  return {
    client: createGoogleApiClient({ tokens: tokenProvider, fetch: fakeFetch as typeof fetch }),
    events: () => [...events.values()],
    event: (id) => events.get(id),
    findEvents: (summary) => [...events.values()].filter((event) => event.summary === summary),
    messages: () => [...messages.values()].map(view),
    message: (id) => { const message = messages.get(id); return message ? view(message) : undefined; },
    drafts: drafted,
    sent: () => [...messages.values()].filter((message) => message.labelIds.includes('SENT')).map(view),
    tokenRequests: () => tokenRequests,
    revocations: () => revocations,
    requests: () => requests,
    assertServed() {
      if (unserved.length > 0) throw new Error(`The Google conformance fake could not serve: ${unserved.join('; ')}`);
    },
  };
}

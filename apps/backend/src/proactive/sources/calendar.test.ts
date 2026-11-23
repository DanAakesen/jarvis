import { expect, it } from 'vitest';
import { createGoogleApiClient } from '../../google/api-client.js';
import { createFakeGoogle, type FakeEvent } from '../../pi/conformance/groups/google-fake.testkit.js';
import { googleSeed, NOW, OWNER, TIME_ZONE } from '../../pi/conformance/groups/google-seed.testkit.js';
import { defaultProactiveSettings } from '../store.js';
import { createCalendarSource } from './calendar.js';
import { createTravelSource } from './travel.js';

const context = () => ({ now: NOW, signal: AbortSignal.timeout(5_000), settings: defaultProactiveSettings() });
const hour = 3_600_000;

function event(id: string, summary: string, start: number, end: number): FakeEvent {
  const time = (offset: number) => ({ dateTime: new Date(NOW.getTime() + offset * hour).toISOString() });
  return { id, summary, start: time(start), end: time(end), status: 'confirmed' };
}

it('reads the busy agenda and later trips in two requests without losing a trip at the 48-hour boundary', async () => {
  const seed = googleSeed();
  seed.events = [
    ...Array.from({ length: 50 }, (_, i) => event('meeting-' + i, 'Meeting', i / 2, i / 2 + 0.5)),
    event('already-started', 'Train', 47, 49),
    event('departure', 'Flight', 48, 50),
    event('outside-week', 'Flight', 168, 170),
  ];
  const google = createFakeGoogle({ seed, down: new Set(), now: () => NOW, timeZone: TIME_ZONE, owner: OWNER });
  const agenda = await createCalendarSource(google.client).read(context());
  const travelSource = createTravelSource(google.client);
  const travel = await travelSource.read(context());
  expect(agenda.facts).toHaveLength(40);
  expect.soft(google.requests().filter(call => call.endsWith('/calendars/primary/events'))).toHaveLength(2);
  expect(travel.facts.map(fact => fact.ref)).toEqual(['travel-event:departure']);
  const nextPoll = await travelSource.read({ ...context(), now: new Date(NOW.getTime() + hour / 4) });
  expect(nextPoll.facts.map(fact => fact.ref)).toEqual(['travel-event:outside-week']);
  google.assertServed();
});

it('finishes a short provider page within the same authorization and the remaining event limit', async () => {
  let token = 'first';
  const calls: [string | null, string | null][] = [];
  const google = createGoogleApiClient({ tokens: { getToken: async () => token }, fetch: async (input, options) => {
    const url = new URL(String(input));
    calls.push([new Headers(options?.headers).get('Authorization'), url.searchParams.get('maxResults')]);
    if (url.searchParams.get('pageToken')) return Response.json({ items: [event('b', 'B', 2, 3)] });
    token = 'second';
    return Response.json({ items: [event('a', 'A', 0, 1)], nextPageToken: 'second-page' });
  } });
  const source = createCalendarSource(google);
  expect((await source.read(context())).facts.map(fact => fact.ref)).toEqual(['calendar-event:a', 'calendar-event:b']);
  expect(calls.splice(0)).toEqual([['Bearer first', '50'], ['Bearer first', '49']]);
  await source.read(context());
  expect(calls[0]?.[0]).toBe('Bearer second');
});

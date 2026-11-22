import { describe, expect, it } from 'vitest';
import { createGoogleModule } from '../../../google/tools.js';
import { createFakeGoogle } from './google-fake.testkit.js';
import { NOW, OWNER, TIME_ZONE, googleSeed } from './google-seed.testkit.js';

const wake = { agentPrincipal: { objectId: 'conformance-pi' }, jarvisPi: 'wake', headers: { 'x-jarvis-brain': 'google-edges' }, log: { error() {} } } as never;

/** Google leaves `summary` out of an event nobody titled; its own calendar shows that event as "(No title)". */
describe('google calendar events without a title', () => {
  it('are read, moved and deleted instead of failing the whole calendar call', async () => {
    const seed = googleSeed();
    seed.events.push({
      id: 'evt-untitled', status: 'confirmed',
      start: { dateTime: '2026-11-23T14:00:00+01:00', timeZone: TIME_ZONE },
      end: { dateTime: '2026-11-23T15:00:00+01:00', timeZone: TIME_ZONE },
    });
    const fake = createFakeGoogle({ seed, down: new Set(), now: () => NOW, timeZone: TIME_ZONE, owner: OWNER });
    const tools = new Map(createGoogleModule(fake.client, { timeZone: TIME_ZONE, now: () => NOW }).tools.map((tool) => [tool.name, tool]));
    const run = (name: string, args: unknown) => tools.get(name)!.execute(args, wake, new AbortController().signal) as Promise<Record<string, unknown>>;

    const agenda = await run('calendar_today_agenda', {});
    expect((agenda.events as { id: string; subject: string }[]).find((event) => event.id === 'evt-untitled')).toMatchObject({ subject: '(No title)' });

    await expect(run('calendar_move_event', { eventId: 'evt-untitled', startDateTime: '2026-11-23T16:00:00+01:00', endDateTime: '2026-11-23T17:00:00+01:00' }))
      .resolves.toMatchObject({ status: 'completed' });
    await expect(run('calendar_delete_event', { eventId: 'evt-untitled' })).resolves.toMatchObject({ status: 'completed' });
    expect(fake.event('evt-untitled')).toBeUndefined();
  });
});

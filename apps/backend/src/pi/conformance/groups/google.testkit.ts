import { expect } from 'vitest';
import { createGoogleModule } from '../../../google/tools.js';
import type { GroupFactory, ToolCase } from '../types.testkit.js';
import { createFakeGoogle, type FakeEvent } from './google-fake.testkit.js';
import { NOW, OWNER, TIME_ZONE, draftIds, eventIds, googleSeed, labelIds, mailIds } from './google-seed.testkit.js';

type Json = Record<string, unknown>;
type Outcome = NonNullable<ToolCase['expect']>;

const object = (value: unknown): Json => {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value), 'the result is a structured object').toBe(true);
  return value as Json;
};
const list = (value: unknown): Json[] => { expect(Array.isArray(value), 'the field is a list').toBe(true); return value as Json[]; };
const subjects = (result: unknown): string[] => list(object(result).events).map((event) => String(event.subject));
const startsAt = (event: FakeEvent | undefined): number => Date.parse(event?.start.dateTime ?? '');
const endsAt = (event: FakeEvent | undefined): number => Date.parse(event?.end.dateTime ?? '');
const completed = (result: unknown) => expect(object(result).status, 'the write finished').toBe('completed');

/**
 * Calendar and Gmail tools over the REAL Google API client and token provider, with `fetch` answered by an in-memory Google
 * (see google-fake.testkit.ts). Every tool of the module runs against healthy Google; with `google` in `context.down` the fake
 * fails like Google would (see the fake for the variants). The clock is fixed: Monday 23 November 2026, 09:30 in Copenhagen.
 * The write tools run directly (no approval step); the stored Dan message only has to exist, so each case carries what he said.
 */
export const googleGroup: GroupFactory = (context) => {
  const fake = createFakeGoogle({ seed: googleSeed(), down: context.down, now: () => NOW, timeZone: TIME_ZONE, owner: OWNER });

  const named = (label: string, args: Json, said: string, verify?: (result: unknown) => void, outcome?: Outcome): ToolCase => ({
    label, arguments: args, ownerMessage: said, ...(outcome ? { expect: outcome } : {}),
    check: (result) => { fake.assertServed(); verify?.(result); },
  });
  const mail = (id: string) => fake.message(id);

  return {
    id: 'google',
    covers: ['google'],
    modules: [createGoogleModule(fake.client, { timeZone: TIME_ZONE, now: () => NOW })],
    cases: {
      calendar_today_agenda: [
        named('the whole day', {}, 'what is on my calendar today?', (result) => {
          expect(object(result).timeZone).toBe(TIME_ZONE);
          expect(subjects(result)).toEqual(['Team standup', 'Vendor demo', 'Sync with Anna', 'Lunch with Mette', 'Gym (optional)']);
          expect(object(result).truncated).toBe(false);
          // 08:00 UTC is 09:00 in Copenhagen in November.
          expect(String(list(object(result).events)[0]?.startLocal)).toContain('09:00');
        }),
      ],
      calendar_list_events: [
        named('this week', { start: '2026-11-23', end: '2026-11-29' }, 'what is on my calendar this week?', (result) => {
          // calendar_update_event renames the quarterly review ("Quarterly review (room 4)"), so it is matched by its start.
          expect(subjects(result)).toEqual(expect.arrayContaining(['Sync with Anna', 'Lunch with Mette', 'Team offsite']));
          expect(subjects(result).some((subject) => subject.startsWith('Quarterly review'))).toBe(true);
          expect(list(object(result).events).find((event) => event.subject === 'Team offsite')).toMatchObject({ allDay: true, start: '2026-11-25', end: '2026-11-27' });
        }),
        // The range reaches Monday 30 November: the calendar_move_event case moves the dentist there, whichever case ran first.
        named('by event text', { start: '2026-11-23', end: '2026-12-06', query: 'dentist' }, 'when is my dentist appointment?', (result) => {
          expect(subjects(result)).toEqual(['Dentist appointment']);
        }),
        named('two months, more than one page', { start: '2026-11-01', end: '2026-12-31', maxResults: 100 }, 'what is on my calendar in November and December?', (result) => {
          expect(list(object(result).events).length).toBeGreaterThan(50);
          expect(object(result).truncated).toBe(false);
        }),
        named('a date-time range', { start: '2026-11-23T00:00:00+01:00', end: '2026-11-24T00:00:00+01:00' }, 'what do I have on Monday?', (result) => {
          expect(subjects(result)).toContain('Lunch with Mette');
        }),
        named('a short page of a busy week', { start: '2026-11-23', end: '2026-11-29', maxResults: 3 }, 'show me the first three things this week', (result) => {
          expect(list(object(result).events)).toHaveLength(3);
          expect(object(result).truncated).toBe(true);
        }),
        named('a range that is too long', { start: '2026-01-01', end: '2026-12-31' }, 'show me everything this year', undefined, 'refused'),
      ],
      calendar_next_event: [
        named('after now', {}, 'when is my next meeting?', (result) => {
          // The 10:00 vendor demo is declined, so the next event is the 11:00 sync.
          expect(object(object(result).event)).toMatchObject({ subject: 'Sync with Anna' });
        }),
        named('after a given time', { after: '2026-11-23T13:30:00+01:00' }, 'what is my next event after lunch?', (result) => {
          expect(object(object(result).event)).toMatchObject({ subject: 'Gym (optional)' });
        }),
        named('nothing ahead', { after: '2027-06-01T00:00:00+02:00' }, 'what is my next event after the summer holiday?', (result) => {
          expect(object(result).event).toBeNull();
          expect(object(result).truncated).toBe(false);
        }),
      ],
      calendar_find_free_slots: [
        named('a working day', { startDateTime: '2026-11-23T08:00:00+01:00', endDateTime: '2026-11-23T18:00:00+01:00', durationMinutes: 60 }, 'when am I free for an hour today?', (result) => {
          const slots = list(object(result).slots).map((slot) => `${String(slot.start)}/${String(slot.end)}`);
          // 13:00-18:00 local is free (the optional gym block is marked free); the lunch hour is not.
          expect(slots).toContain('2026-11-23T12:00:00.000Z/2026-11-23T17:00:00.000Z');
          expect(slots.some((slot) => slot.startsWith('2026-11-23T11:00:00.000Z'))).toBe(false);
        }),
        named('a day taken by an all-day event', { startDateTime: '2026-11-25T08:00:00+01:00', endDateTime: '2026-11-25T18:00:00+01:00', durationMinutes: 30 }, 'am I free on Wednesday?', (result) => {
          expect(list(object(result).slots)).toEqual([]);
        }),
        named('an end before the start', { startDateTime: '2026-11-23T18:00:00+01:00', endDateTime: '2026-11-23T08:00:00+01:00', durationMinutes: 60 }, 'when am I free?', undefined, 'refused'),
      ],
      calendar_create_event: [
        named('a meeting with an attendee', {
          subject: 'Meeting with Anna', startDateTime: '2026-11-24T10:00:00+01:00', endDateTime: '2026-11-24T10:30:00+01:00', attendees: ['anna@example.com'],
        }, 'add a meeting with Anna tomorrow at 10 to my calendar', (result) => {
          completed(result);
          const created = fake.findEvents('Meeting with Anna')[0];
          expect(startsAt(created)).toBe(Date.parse('2026-11-24T10:00:00+01:00'));
          expect(endsAt(created)).toBe(Date.parse('2026-11-24T10:30:00+01:00'));
          expect(created?.attendees?.map((attendee) => attendee.email)).toContain('anna@example.com');
        }),
        named('a Danish title without attendees', {
          subject: 'Tandlæge: kontrol', startDateTime: '2026-11-30T08:00:00+01:00', endDateTime: '2026-11-30T08:45:00+01:00',
        }, 'opret en aftale hos tandlægen mandag klokken 8', (result) => {
          completed(result);
          expect(startsAt(fake.findEvents('Tandlæge: kontrol')[0])).toBe(Date.parse('2026-11-30T08:00:00+01:00'));
        }),
        named('an end before the start', {
          subject: 'Backwards meeting', startDateTime: '2026-11-24T11:00:00+01:00', endDateTime: '2026-11-24T10:00:00+01:00',
        }, 'add a meeting tomorrow from 11 to 10', () => expect(fake.findEvents('Backwards meeting')).toEqual([]), 'refused'),
      ],
      calendar_create_events: [
        named('two bookings in one request', {
          events: [
            { subject: 'Møde med Mette', startDateTime: '2026-11-24T15:00:00+01:00', endDateTime: '2026-11-24T16:00:00+01:00', attendees: ['mette@example.com'] },
            { subject: 'Træning', startDateTime: '2026-11-24T17:30:00+01:00', endDateTime: '2026-11-24T18:30:00+01:00' },
          ],
        }, 'book både mødet med Mette og træning i morgen', (result) => {
          completed(result);
          expect(list(object(result).items).map((item) => item.status)).toEqual(['completed', 'completed']);
          expect(fake.findEvents('Møde med Mette')).toHaveLength(1);
          expect(fake.findEvents('Træning')).toHaveLength(1);
        }),
        named('the same event twice', {
          events: [
            { subject: 'Duplicate booking', startDateTime: '2026-11-25T09:00:00+01:00', endDateTime: '2026-11-25T10:00:00+01:00' },
            { subject: 'Duplicate booking', startDateTime: '2026-11-25T09:00:00+01:00', endDateTime: '2026-11-25T10:00:00+01:00' },
          ],
        }, 'book the duplicate booking twice on Wednesday at 9', () => expect(fake.findEvents('Duplicate booking')).toEqual([]), 'refused'),
      ],
      calendar_update_event: [
        named('title, place, description and guests', {
          eventId: eventIds.review, title: 'Quarterly review (room 4)', location: 'Room 4, Aarhus', description: 'Agenda: results, budget, hiring.', attendees: ['anna@example.com', 'bob@example.com'],
        }, 'rename the quarterly review and say that it is in room 4', (result) => {
          completed(result);
          expect(fake.event(eventIds.review)).toMatchObject({ summary: 'Quarterly review (room 4)', location: 'Room 4, Aarhus', description: 'Agenda: results, budget, hiring.' });
          expect(fake.event(eventIds.review)?.attendees?.map((attendee) => attendee.email)).toEqual(expect.arrayContaining(['anna@example.com', 'bob@example.com']));
        }),
        named('a new time', { eventId: eventIds.review, startDateTime: '2026-11-26T13:00:00+01:00', endDateTime: '2026-11-26T14:00:00+01:00' }, 'push the quarterly review to 1 pm', (result) => {
          completed(result);
          expect(startsAt(fake.event(eventIds.review))).toBe(Date.parse('2026-11-26T13:00:00+01:00'));
        }),
        named('only a start time', { eventId: eventIds.review, startDateTime: '2026-11-26T15:00:00+01:00' }, 'start the quarterly review at 3 pm', () => {
          expect(startsAt(fake.event(eventIds.review))).toBe(Date.parse('2026-11-26T13:00:00+01:00'));
        }, 'refused'),
        named('an event that does not exist', { eventId: eventIds.missing, title: 'Renamed' }, 'rename my event', undefined, 'error'),
      ],
      calendar_move_event: [
        named('the dentist to Monday', { eventId: eventIds.dentist, startDateTime: '2026-11-30T14:00:00+01:00', endDateTime: '2026-11-30T14:45:00+01:00' }, 'flyt min tandlægetid til mandag', (result) => {
          completed(result);
          expect(startsAt(fake.event(eventIds.dentist))).toBe(Date.parse('2026-11-30T14:00:00+01:00'));
          expect(endsAt(fake.event(eventIds.dentist))).toBe(Date.parse('2026-11-30T14:45:00+01:00'));
        }),
        named('an event that does not exist', { eventId: eventIds.missing, startDateTime: '2026-11-30T14:00:00+01:00', endDateTime: '2026-11-30T14:45:00+01:00' }, 'move my appointment to Monday', undefined, 'error'),
      ],
      calendar_delete_event: [
        named('an old call', { eventId: eventIds.oldCall }, 'delete the old subscription call from my calendar', (result) => {
          completed(result);
          expect(fake.event(eventIds.oldCall)).toBeUndefined();
        }),
        named('an event that does not exist', { eventId: eventIds.missing }, 'delete that event', undefined, 'error'),
      ],
      mail_search: [
        named('from a person about a topic', { query: 'from:anna invoice' }, 'find the email from Anna about the invoice', (result) => {
          const found = list(object(result).messages);
          expect(found.map((message) => message.id)).toEqual([mailIds.invoice]);
          expect(found[0]).toMatchObject({ subject: 'Invoice 2026-114 for November', from: { name: 'Anna Jensen', address: 'anna@example.com' }, bodySource: 'plain-text' });
          expect(String(found[0]?.body)).toContain('DKK 12,450.00');
          expect(String(found[0]?.alternateBody)).toContain('Unsubscribe');
          expect(String(found[0]?.receivedDateTime)).toBe('2026-11-22T16:20:00.000Z');
        }),
        named('an html-only booking mail', { query: 'reservation 88231', maxResults: 3 }, 'find my hotel reservation', (result) => {
          const found = list(object(result).messages);
          expect(found.map((message) => message.id)).toEqual([mailIds.hotel]);
          expect(found[0]).toMatchObject({ bodySource: 'html-text' });
          expect(String(found[0]?.body)).toContain('Confirmation number: 88231');
          expect(String(found[0]?.body)).toContain('12 December 2026');
          expect(String(found[0]?.body)).not.toContain('track(');
          expect(String(found[0]?.body)).not.toContain('Your stay is confirmed');
        }),
        named('unread mail in the inbox', { query: 'is:unread in:inbox' }, 'check my email', (result) => {
          // Other cases may mark a message as read first, so only the stable part of the answer is pinned.
          const ids = list(object(result).messages).map((message) => message.id);
          expect(ids).toEqual(expect.arrayContaining([mailIds.invoice, mailIds.flight]));
          expect(ids).not.toContain(mailIds.shipped);
        }),
        named('a mail with an attachment', { query: 'from:bob has:attachment contract' }, 'find the contract Bob sent', (result) => {
          const found = list(object(result).messages);
          expect(found.map((message) => message.id)).toEqual([mailIds.contract]);
          expect(list(found[0]?.contentWarnings).join(' ')).toContain('File attachments are not read');
        }),
        named('a long body served as an attachment', { query: 'weekly digest' }, 'what was in the weekly digest?', (result) => {
          expect(String(list(object(result).messages)[0]?.body)).toContain('40. A story worth reading about topic 40.');
        }),
        named('nothing matches', { query: 'no such thing anywhere' }, 'find the mail about the moon landing', (result) => {
          expect(list(object(result).messages)).toEqual([]);
        }),
      ],
      mail_list_drafts: [
        named('the default list', {}, 'show my email drafts', (result) => {
          const drafts = list(object(result).drafts);
          expect(drafts.length).toBeGreaterThanOrEqual(3);
          expect(drafts.every((draft) => typeof draft.draftId === 'string' && typeof draft.to === 'string' && typeof draft.subject === 'string' && typeof draft.body === 'string')).toBe(true);
          expect(drafts.map((draft) => draft.draftId)).toContain(draftIds.withCc);
        }),
        named('a short list', { maxResults: 2 }, 'show my two latest drafts', (result) => {
          expect(list(object(result).drafts)).toHaveLength(2);
          expect(object(result).truncated).toBe(true);
        }),
      ],
      mail_draft_reply: [
        named('a reply to the invoice mail', { messageId: mailIds.invoice, replyBody: 'Hi Anna,\n\nThanks, I have received the invoice and will pay it on Friday.\n\nDan' }, 'reply to the email from Anna: say I got the invoice and will pay on Friday', (result) => {
          completed(result);
          const reply = fake.drafts().find((draft) => draft.body.includes('will pay it on Friday'));
          expect(reply).toMatchObject({ threadId: 'thr-invoice', to: 'anna@example.com', subject: 'Invoice 2026-114 for November', inReplyTo: '<inv114@example.com>' });
          expect(reply?.references).toContain('<inv114@example.com>');
        }),
        named('a message that does not exist', { messageId: mailIds.missing, replyBody: 'Thanks.' }, 'reply to that email', undefined, 'error'),
      ],
      mail_update_draft: [
        named('new text for a reply draft', {
          draftId: draftIds.invoiceReply, to: ['anna@example.com'], subject: 'Re: Invoice 2026-114 for November', body: 'Hi Anna,\n\nI will pay the invoice by Friday. Please send the receipt afterwards.\n\nDan',
        }, 'change my draft to Anna: I will pay by Friday and want a receipt', (result) => {
          completed(result);
          const updated = fake.drafts().find((draft) => draft.draftId === draftIds.invoiceReply);
          expect(updated).toMatchObject({ threadId: 'thr-invoice', to: 'anna@example.com' });
          expect(updated?.body).toContain('Please send the receipt afterwards.');
        }),
        named('a draft with a copy recipient', { draftId: draftIds.withCc, to: ['anna@example.com'], subject: 'Project plan', body: 'Hi Anna, here is the new plan.' }, 'rewrite my project plan draft', undefined, 'refused'),
        named('a draft with an attachment', { draftId: draftIds.withAttachment, to: ['bob@example.com'], subject: 'Signed contract', body: 'Hi Bob, see the attachment.' }, 'rewrite my signed contract draft', undefined, 'refused'),
        named('a draft that does not exist', { draftId: draftIds.missing, to: ['anna@example.com'], subject: 'Hello', body: 'Hello Anna.' }, 'change that draft', undefined, 'error'),
      ],
      mail_delete_draft: [
        named('the meeting notes draft', { draftId: draftIds.notes }, 'delete my meeting notes draft', (result) => {
          completed(result);
          expect(fake.drafts().map((draft) => draft.draftId)).not.toContain(draftIds.notes);
        }),
        named('a draft that does not exist', { draftId: draftIds.missing }, 'delete that draft', undefined, 'error'),
      ],
      mail_archive: [
        named('a club newsletter', { messageId: mailIds.archiveMe }, 'archive the club newsletter', (result) => {
          completed(result);
          expect(mail(mailIds.archiveMe)?.labelIds).not.toContain('INBOX');
        }),
        named('a message that does not exist', { messageId: mailIds.missing }, 'archive that email', undefined, 'error'),
      ],
      mail_label: [
        named('add a label and mark it read', { messageId: mailIds.labelMe, add: ['Receipts'], remove: ['UNREAD'] }, 'label the train receipt as Receipts and mark it as read', (result) => {
          completed(result);
          expect(mail(mailIds.labelMe)?.labelIds).toEqual(expect.arrayContaining([labelIds.receipts]));
          expect(mail(mailIds.labelMe)?.labelIds).not.toContain('UNREAD');
        }),
        named('a label by its id', { messageId: mailIds.flight, add: [labelIds.travel] }, 'file the flight mail under Travel', (result) => {
          completed(result);
          expect(mail(mailIds.flight)?.labelIds).toContain(labelIds.travel);
        }),
        named('a label that does not exist', { messageId: mailIds.invoice, add: ['No such label'] }, 'label the invoice as Urgent', () => {
          expect(mail(mailIds.invoice)?.labelIds).not.toContain('No such label');
        }, 'refused'),
      ],
      mail_send: [
        named('a Danish email to one person', {
          to: ['anna@example.com'], subject: 'Møde i morgen', body: 'Hej Anna,\n\njeg kan desværre ikke mødes i morgen klokken 10. Passer onsdag?\n\nVh Dan',
        }, 'send en mail til Anna om at jeg ikke kan mødes i morgen', (result) => {
          completed(result);
          const sent = fake.sent().find((message) => message.subject === 'Møde i morgen');
          expect(sent).toMatchObject({ to: 'anna@example.com', body: 'Hej Anna,\n\njeg kan desværre ikke mødes i morgen klokken 10. Passer onsdag?\n\nVh Dan' });
        }),
        named('an English email to two people', {
          to: ['anna@example.com', 'bob@example.com'], subject: 'Project status', body: 'Hi both, the project is on track and the next review is on Thursday.',
        }, 'send Anna and Bob a short project status', (result) => {
          completed(result);
          expect(fake.sent().find((message) => message.subject === 'Project status')?.to).toBe('anna@example.com, bob@example.com');
        }),
        // A retry of the same request under the same Dan message must not send the email twice.
        {
          ...named('the same email again', {
            to: ['anna@example.com', 'bob@example.com'], subject: 'Project status', body: 'Hi both, the project is on track and the next review is on Thursday.',
          }, 'send Anna and Bob a short project status', (result) => {
            completed(result);
            expect(fake.sent().filter((message) => message.subject === 'Project status')).toHaveLength(1);
          }),
          sameMessageAsPrevious: true,
        },
      ],
    },
  };
};

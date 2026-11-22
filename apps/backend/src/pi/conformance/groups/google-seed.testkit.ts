import type { FakeEvent, FakeGoogleSeed, FakeLabel, FakeMessage, FakePart } from './google-fake.testkit.js';

/**
 * What Dan's Google account holds in the conformance world. The clock is fixed so every case is reproducible:
 * Monday 23 November 2026, 09:30 in Copenhagen (UTC+1). Ids are readable on purpose; the cases refer to them.
 */
export const NOW = new Date('2026-11-23T08:30:00.000Z');
export const TIME_ZONE = 'Europe/Copenhagen';
export const OWNER = { name: 'Dan Aakesen', email: 'dan@example.com' } as const;

const local = (date: string, time: string) => ({ dateTime: `${date}T${time}:00+01:00`, timeZone: TIME_ZONE });
const danAccepted = { email: OWNER.email, responseStatus: 'accepted', self: true } as const;

function timed(id: string, summary: string, date: string, from: string, to: string, extra: Partial<FakeEvent> = {}): FakeEvent {
  return { id, status: 'confirmed', summary, start: local(date, from), end: local(date, to), ...extra };
}

/** A recurring weekday standup, expanded into single instances the way `singleEvents=true` returns it. */
function standups(): FakeEvent[] {
  const out: FakeEvent[] = [];
  for (let day = Date.UTC(2026, 10, 2); day <= Date.UTC(2026, 11, 31); day += 86_400_000) {
    const date = new Date(day);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const iso = date.toISOString().slice(0, 10);
    out.push(timed(`standup_${iso.replaceAll('-', '')}T080000Z`, 'Team standup', iso, '09:00', '09:15', { recurringEventId: 'standup', attendees: [danAccepted] }));
  }
  return out;
}

export const eventIds = {
  syncAnna: 'evt-sync-anna',
  lunch: 'evt-lunch-mette',
  gym: 'evt-gym',
  declinedDemo: 'evt-vendor-demo',
  dentist: 'evt-dentist',
  offsite: 'evt-offsite',
  review: 'evt-review',
  oldCall: 'evt-old-subscription-call',
  missing: 'evt-does-not-exist',
} as const;

function events(): FakeEvent[] {
  return [
    ...standups(),
    timed(eventIds.syncAnna, 'Sync with Anna', '2026-11-23', '11:00', '11:30', {
      location: 'Google Meet', attendees: [danAccepted, { email: 'anna@example.com', responseStatus: 'accepted', displayName: 'Anna Jensen' }],
    }),
    timed(eventIds.lunch, 'Lunch with Mette', '2026-11-23', '12:00', '13:00', { location: 'Café Norden, Aarhus' }),
    timed(eventIds.gym, 'Gym (optional)', '2026-11-23', '17:00', '18:00', { transparency: 'transparent' }),
    timed(eventIds.declinedDemo, 'Vendor demo', '2026-11-23', '10:00', '10:30', { attendees: [{ ...danAccepted, responseStatus: 'declined' }] }),
    timed(eventIds.dentist, 'Dentist appointment', '2026-11-24', '14:00', '14:45', { location: 'Tandlæge Hansen, Aarhus' }),
    { id: eventIds.offsite, status: 'confirmed', summary: 'Team offsite', start: { date: '2026-11-25' }, end: { date: '2026-11-27' }, location: 'Silkeborg' },
    timed(eventIds.review, 'Quarterly review', '2026-11-26', '10:00', '11:00', { description: 'Slides are in the shared drive.' }),
    timed(eventIds.oldCall, 'Old subscription call', '2026-11-27', '15:00', '16:00'),
  ];
}

// ---- Gmail -----------------------------------------------------------------------------------------------------------------

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

export const labelIds = { receipts: 'Label_1', travel: 'Label_2', followUp: 'Label_3' } as const;

function labels(): FakeLabel[] {
  return [
    ...['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT', 'CATEGORY_PROMOTIONS'].map((id) => ({ id, name: id, type: 'system' as const })),
    { id: labelIds.receipts, name: 'Receipts', type: 'user' },
    { id: labelIds.travel, name: 'Travel', type: 'user' },
    { id: labelIds.followUp, name: 'Follow up', type: 'user' },
  ];
}

const textPart = (partId: string, mimeType: string, value: string): FakePart => ({
  partId, mimeType, filename: '', headers: [{ name: 'Content-Type', value: `${mimeType}; charset="UTF-8"` }],
  body: { size: Buffer.byteLength(value), data: encode(value) },
});

interface MessageSpec {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly to?: string;
  readonly cc?: string;
  readonly subject: string;
  readonly sentAt: string;
  readonly labelIds: readonly string[];
  readonly plain?: string;
  readonly html?: string;
  /** Serve the plain text through the attachments endpoint, as Gmail does for large bodies. */
  readonly plainAttachmentId?: string;
  readonly files?: readonly { readonly name: string; readonly mimeType: string }[];
  readonly messageId?: string;
  readonly inReplyTo?: string;
  readonly references?: string;
}

function message(spec: MessageSpec, attachments: Record<string, string>): FakeMessage {
  const headers = [
    { name: 'From', value: spec.from },
    { name: 'To', value: spec.to ?? OWNER.email },
    ...(spec.cc ? [{ name: 'Cc', value: spec.cc }] : []),
    { name: 'Subject', value: spec.subject },
    { name: 'Date', value: new Date(spec.sentAt).toUTCString() },
    { name: 'Message-ID', value: spec.messageId ?? `<${spec.id}@mail.example>` },
    ...(spec.inReplyTo ? [{ name: 'In-Reply-To', value: spec.inReplyTo }] : []),
    ...(spec.references ? [{ name: 'References', value: spec.references }] : []),
    { name: 'MIME-Version', value: '1.0' },
  ];
  const plain = spec.plainAttachmentId
    ? ((): FakePart => {
      const text = spec.plain ?? '';
      attachments[`${spec.id}/${spec.plainAttachmentId}`] = encode(text);
      return { partId: '0', mimeType: 'text/plain', filename: '', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { size: Buffer.byteLength(text), attachmentId: spec.plainAttachmentId! } };
    })()
    : spec.plain === undefined ? undefined : textPart('0', 'text/plain', spec.plain);
  const html = spec.html === undefined ? undefined : textPart(plain ? '1' : '0', 'text/html', spec.html);
  const bodies = [plain, html].filter((part): part is FakePart => part !== undefined);
  const container = (mimeType: string, parts: FakePart[]): FakePart => ({
    partId: '', mimeType, filename: '', headers: [], body: { size: 0 }, parts,
  });
  let root: FakePart = bodies.length === 1 ? { ...bodies[0]!, partId: '' } : container('multipart/alternative', bodies);
  if (spec.files?.length) {
    root = container('multipart/mixed', [
      root,
      ...spec.files.map((file, index): FakePart => ({
        partId: String(index + 1), mimeType: file.mimeType, filename: file.name,
        headers: [{ name: 'Content-Type', value: `${file.mimeType}; name="${file.name}"` }], body: { size: 48_213, attachmentId: `att-${spec.id}-${index + 1}` },
      })),
    ]);
  }
  const rootType = root.mimeType.startsWith('multipart/') ? `${root.mimeType}; boundary="conformance-boundary"` : (root.headers.find((entry) => entry.name === 'Content-Type')?.value ?? root.mimeType);
  root = { ...root, headers: [...headers, { name: 'Content-Type', value: rootType }] };
  const snippet = (spec.plain ?? spec.html?.replace(/<[^>]*>/gu, ' ') ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120);
  return { id: spec.id, threadId: spec.threadId, labelIds: [...spec.labelIds], snippet, internalDate: new Date(spec.sentAt).getTime(), payload: root };
}

export const mailIds = {
  invoice: 'msg-anna-invoice',
  hotel: 'msg-hotel-booking',
  digest: 'msg-weekly-digest',
  contract: 'msg-bob-contract',
  shipped: 'msg-order-shipped',
  flight: 'msg-flight-offer',
  archiveMe: 'msg-archive-me',
  labelMe: 'msg-label-me',
  missing: 'msg-does-not-exist',
} as const;

export const draftIds = {
  invoiceReply: 'r-draft-invoice-reply',
  notes: 'r-draft-meeting-notes',
  withCc: 'r-draft-with-cc',
  withAttachment: 'r-draft-with-attachment',
  missing: 'r-draft-does-not-exist',
} as const;

const specs: readonly MessageSpec[] = [
  {
    id: mailIds.invoice, threadId: 'thr-invoice', from: 'Anna Jensen <anna@example.com>', subject: 'Invoice 2026-114 for November',
    sentAt: '2026-11-22T16:20:00Z', labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'], messageId: '<inv114@example.com>',
    plain: 'Hi Dan,\n\nAttached is invoice 2026-114 for November (DKK 12,450.00). Payment is due on 6 December 2026.\n\nCould you confirm that you have received it?\n\nBest regards,\nAnna Jensen\nNordlys Studio\n',
    html: '<html><body><p>Hi Dan,</p><p>Attached is <b>invoice 2026-114</b> for November (DKK 12,450.00). Payment is due on <b>6 December 2026</b>.</p><p>Could you confirm that you have received it?</p><p>Best regards,<br>Anna Jensen<br>Nordlys Studio</p><p><small>Nordlys Studio, Vestergade 12, Aarhus. Unsubscribe from invoice reminders.</small></p></body></html>',
  },
  {
    id: mailIds.hotel, threadId: 'thr-hotel', from: 'Hotel Nord <bookings@hotelnord.example>', subject: 'Your reservation 88231 is confirmed',
    sentAt: '2026-11-21T10:05:00Z', labelIds: ['INBOX'],
    html: '<!doctype html><html><head><title>Hotel Nord</title><style>.hide{display:none}</style></head><body>'
      + '<div style="display:none;max-height:0;overflow:hidden">Your stay is confirmed&nbsp;&zwnj;&nbsp;&zwnj;</div>'
      + '<table><tr><td><h1>Booking confirmed</h1></td></tr><tr><td>Confirmation number: <b>88231</b></td></tr>'
      + '<tr><td>Check-in: Saturday 12 December 2026 from 15:00</td></tr><tr><td>Check-out: Tuesday 15 December 2026 until 11:00</td></tr>'
      + '<tr><td>Guest: Dan Aakesen, 1 room, 3 nights</td></tr></table><script>track("open")</script></body></html>',
  },
  {
    id: mailIds.digest, threadId: 'thr-digest', from: 'Weekly Digest <news@digest.example>', subject: 'Weekly Digest: ten things worth reading',
    sentAt: '2026-11-20T06:00:00Z', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], plainAttachmentId: 'att-digest-body',
    plain: `This week in the digest.\n${Array.from({ length: 40 }, (_, index) => `${index + 1}. A story worth reading about topic ${index + 1}.`).join('\n')}\n`,
  },
  {
    id: mailIds.contract, threadId: 'thr-contract', from: 'Bob Larsen <bob@example.com>', subject: 'Contract draft v3',
    sentAt: '2026-11-19T13:45:00Z', labelIds: ['INBOX'], plain: 'Hi Dan, the contract draft is attached. Please send me your comments by Friday.\n\nBob',
    files: [{ name: 'contract-v3.pdf', mimeType: 'application/pdf' }],
  },
  {
    id: mailIds.shipped, threadId: 'thr-order', from: 'Shop <orders@shop.example>', subject: 'Your order has shipped',
    sentAt: '2026-11-18T09:12:00Z', labelIds: ['INBOX'], plain: 'Your order 5521 has shipped and arrives on Wednesday.\n',
  },
  {
    id: mailIds.flight, threadId: 'thr-flight', from: 'Travel Desk <travel@example.com>', subject: 'Flight to Copenhagen on 12 December',
    sentAt: '2026-11-17T17:30:00Z', labelIds: ['INBOX', 'UNREAD'], plain: 'Your flight leaves Aarhus at 07:40 on 12 December.\n',
  },
  {
    id: mailIds.archiveMe, threadId: 'thr-archive', from: 'Club Newsletter <club@example.com>', subject: 'Club news for November',
    sentAt: '2026-11-16T08:00:00Z', labelIds: ['INBOX'], plain: 'The club meets again on 5 December.\n',
  },
  {
    id: mailIds.labelMe, threadId: 'thr-label', from: 'Camilla Berg <camilla@example.com>', subject: 'Receipt for the train tickets',
    sentAt: '2026-11-15T12:00:00Z', labelIds: ['INBOX', 'UNREAD'], plain: 'Here is the receipt for the train tickets (DKK 298.00).\n',
  },
  {
    id: 'msg-sent-invoice', threadId: 'thr-invoice', from: `${OWNER.name} <${OWNER.email}>`, to: 'Anna Jensen <anna@example.com>', subject: 'Invoice question',
    sentAt: '2026-11-14T09:00:00Z', labelIds: ['SENT'], plain: 'Hi Anna, could you send the November invoice when it is ready?\n\nDan',
  },
];

const draftSpecs: readonly { readonly id: string; readonly spec: MessageSpec }[] = [
  {
    id: draftIds.invoiceReply,
    spec: {
      id: 'msg-draft-invoice-reply', threadId: 'thr-invoice', from: `${OWNER.name} <${OWNER.email}>`, to: 'anna@example.com', subject: 'Re: Invoice 2026-114 for November',
      sentAt: '2026-11-22T18:00:00Z', labelIds: ['DRAFT'], inReplyTo: '<inv114@example.com>', references: '<inv114@example.com>',
      messageId: '<draft-invoice-reply@mail.gmail.com>', plain: 'Hi Anna,\n\nThanks, I will look at it tomorrow.\n\nDan',
    },
  },
  {
    id: draftIds.notes,
    spec: {
      id: 'msg-draft-meeting-notes', threadId: 'thr-notes', from: `${OWNER.name} <${OWNER.email}>`, to: 'bob@example.com', subject: 'Meeting notes',
      sentAt: '2026-11-21T20:00:00Z', labelIds: ['DRAFT'], messageId: '<draft-meeting-notes@mail.gmail.com>', plain: 'Hi Bob, here are my notes from the meeting.\n',
    },
  },
  {
    id: draftIds.withCc,
    spec: {
      id: 'msg-draft-with-cc', threadId: 'thr-cc', from: `${OWNER.name} <${OWNER.email}>`, to: 'anna@example.com', cc: 'bob@example.com', subject: 'Project plan',
      sentAt: '2026-11-20T20:00:00Z', labelIds: ['DRAFT'], messageId: '<draft-with-cc@mail.gmail.com>', plain: 'Hi both, here is the plan.\n',
    },
  },
  {
    id: draftIds.withAttachment,
    spec: {
      id: 'msg-draft-with-attachment', threadId: 'thr-attachment', from: `${OWNER.name} <${OWNER.email}>`, to: 'bob@example.com', subject: 'Signed contract',
      sentAt: '2026-11-19T20:00:00Z', labelIds: ['DRAFT'], messageId: '<draft-with-attachment@mail.gmail.com>', plain: 'Hi Bob, the signed contract is attached.\n',
      files: [{ name: 'contract-signed.pdf', mimeType: 'application/pdf' }],
    },
  },
];

/** A fresh copy of the account every time the group is built. */
export function googleSeed(): FakeGoogleSeed {
  const attachments: Record<string, string> = {};
  const drafts = draftSpecs.map(({ id, spec }) => ({ id, message: message(spec, attachments) }));
  return {
    events: events(),
    mailbox: {
      labels: labels(),
      messages: [...specs.map((spec) => message(spec, attachments)), ...drafts.map((draft) => draft.message)],
      drafts: drafts.map((draft) => ({ id: draft.id, messageId: draft.message.id })),
      attachments,
    },
  };
}

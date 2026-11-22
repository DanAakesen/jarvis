import { isDeepStrictEqual } from 'node:util';
import { failureCopy } from '@jarvis/contracts';
import { voiceChannelNote } from '../pi/prompt.js';
import { messageRefs } from './parity-memory-store.testkit.js';
import type { ChatTurn, ParityWorld, VoiceCall } from './parity-world.testkit.js';

export type Channel = 'chat' | 'voice';

const collapse = (text: string) => text.replace(/\s+/gu, ' ').trim();
const without = (record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

/** What the owner got for one request, in terms both channels can be compared on. */
export interface TurnExperience {
  /** `reply` and `failure` are an answer; `stopped` is the chat notice for a cancelled turn; `silence` is a voice turn that said nothing. */
  readonly kind: 'reply' | 'failure' | 'stopped' | 'silence';
  readonly reply: string | null;
  readonly failure: string | null;
  readonly failureCode: string | null;
  /** Progress notes shown (chat: every one) or spoken (voice: the first only). */
  readonly progress: readonly string[];
}

export interface PiInputFacts {
  readonly kind: 'turn' | 'follow_up';
  readonly conversation: string;
  readonly persona: boolean;
  readonly situation: boolean;
  readonly capability: boolean;
  readonly voiceNote: boolean;
  /** The message without the three once-per-conversation blocks and the voice note; the turn reference is masked. */
  readonly body: string;
}

export interface Observation {
  readonly channel: Channel;
  readonly turns: readonly TurnExperience[];
  /** Messages a background wake stored in the conversation (a proactive push); they are no part of either channel's reply flow. */
  readonly backgroundStored: readonly string[];
  /** Voice only: transcripts of speech that gave no answer (a progress note before a stop, a spoken failure). Chat stores nothing for those. */
  readonly unansweredSpeech: readonly string[];
  readonly stored: ReadonlyArray<{
    readonly ref: string; readonly session: string; readonly role: string; readonly text: string; readonly model: string | null;
    readonly interrupted: boolean; readonly replyPush: boolean;
  }>;
  readonly inputs: readonly PiInputFacts[];
  /** How many Foundry requests, warm-up included, carried each once-per-conversation block. */
  readonly deliveries: { readonly persona: number; readonly situation: number; readonly capability: number };
  readonly foundry: { readonly warmups: number; readonly responses: number; readonly followUps: number; readonly conversations: number; readonly cancels: number };
  readonly mcp: ReadonlyArray<{ readonly tool: string; readonly name: string | null; readonly turn: string; readonly outcome: string | null }>;
  readonly recorded: ReadonlyArray<{ readonly message: string; readonly tool: string; readonly outcome: string }>;
  readonly grants: ReadonlyArray<{
    readonly boundToOwnerMessage: boolean; readonly inOwnerSession: boolean; readonly owner: boolean;
    readonly activation: { readonly type: string; readonly source: string | null } | null;
    readonly results: ReadonlyArray<{ readonly tool: string; readonly outcome: string }>;
    readonly requests: number; readonly actions: number; readonly discovered: readonly string[]; readonly aborted: boolean;
  }>;
  readonly ledger: ReadonlyArray<Record<string, unknown>>;
  readonly usage: ReadonlyArray<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number; readonly eventId: string }>;
  readonly piTurnLogs: ReadonlyArray<Record<string, unknown>>;
  readonly toolActivity: ReadonlyArray<{ readonly type: string; readonly source: unknown; readonly tool: unknown; readonly message: string; readonly outcome: unknown }>;
  readonly registryOpen: number;
  /** Voice only: the longest commentary part in UTF-8 bytes, and how many parts were sent. */
  readonly commentary: { readonly parts: number; readonly maxBytes: number };
}

const personaMarker = 'Trusted Jarvis context from the app.';
const capabilityMarker = '[Tools: find_tools then call_tool.';

export function describeInput(text: string | undefined, kind: 'turn' | 'follow_up', conversation: string, blocks: { persona: string; situation: string }): PiInputFacts {
  const raw = text ?? '';
  const persona = raw.includes(personaMarker);
  const situation = raw.includes(blocks.situation);
  const capability = raw.includes(capabilityMarker);
  const voiceNote = raw.includes(voiceChannelNote);
  let body = raw.replace(/jt-[A-Za-z0-9_-]{22}/gu, 'jt-<turn>');
  if (voiceNote) body = body.replace(`${voiceChannelNote}\n\n`, '');
  body = body.replace(`${blocks.persona}\n\n${blocks.situation}\n\n`, '');
  if (capability) {
    const start = body.indexOf(capabilityMarker);
    body = `${body.slice(0, start)}${body.slice(body.indexOf('\n\n', start) + 2)}`;
  }
  return { kind, conversation, persona, situation, capability, voiceNote, body };
}

export interface ObserveOptions { readonly background?: (text: string, role: string) => boolean }

type StoredFact = Observation['stored'][number];

/**
 * GPT-Live's transcript of one spoken turn is one stored message when PI answers within the output quiet window (0.6 s), and a message for
 * the progress note plus one for the answer when PI takes longer. Both are the same speech, so consecutive spoken replies are read as one.
 */
function mergeSpokenReplies(stored: readonly StoredFact[]): StoredFact[] {
  const merged: StoredFact[] = [];
  for (const message of stored) {
    const previous = merged.at(-1);
    if (previous && previous.role === 'jarvis' && message.role === 'jarvis') merged[merged.length - 1] = { ...previous, text: `${previous.text} ${message.text}` };
    else merged.push(message);
  }
  const counts = { dan: 0, jarvis: 0 } as Record<string, number>;
  return merged.map(message => { counts[message.role] = (counts[message.role] ?? 0) + 1; return { ...message, ref: `${message.role}#${counts[message.role]}` }; });
}

function commonFacts(world: ParityWorld, channel: Channel, ignoredIn: ReadonlySet<string>, options: ObserveOptions): Omit<Observation, 'turns' | 'commentary' | 'unansweredSpeech'> {
  const facts = commonFactsOf(world, channel, ignoredIn, options);
  return channel === 'voice' ? { ...facts, stored: mergeSpokenReplies(facts.stored) } : facts;
}

function commonFactsOf(world: ParityWorld, channel: Channel, ignoredIn: ReadonlySet<string>, options: ObserveOptions): Omit<Observation, 'turns' | 'commentary' | 'unansweredSpeech'> {
  const background = world.store.messages.filter(message => options.background?.(message.text, message.role) === true);
  const ignored = new Set([...ignoredIn, ...background.map(message => message.id)]);
  const refs = messageRefs(world.store, ignored);
  const ref = (id: string | null | undefined) => (id ? refs.get(id) ?? `unknown:${id}` : 'none');
  const sessionKind = (sessionId: string) => world.store.sessions.find(session => session.id === sessionId)?.channel ?? 'unknown';
  const owners = world.store.messages.filter(message => message.role === 'dan');
  // A brain wake works in a scratch conversation of its own; only the owner's conversation (the first one) is chat and voice's.
  const requests = world.foundry.requests.filter(request => request.conversation === 'conv_1');
  return {
    channel,
    backgroundStored: background.map(message => message.text),
    stored: world.store.messages.filter(message => !ignored.has(message.id)).map(message => ({
      ref: ref(message.id), session: sessionKind(message.sessionId), role: message.role, text: message.text, model: message.model,
      interrupted: message.interrupted, replyPush: message.replyNotification,
    })),
    inputs: requests.filter(request => request.kind !== 'warmup').map(request =>
      describeInput(request.text, request.kind as 'turn' | 'follow_up', request.conversation, { persona: world.persona, situation: world.situation })),
    deliveries: {
      persona: requests.filter(request => request.text?.includes(personaMarker)).length,
      situation: requests.filter(request => request.text?.includes(world.situation)).length,
      capability: requests.filter(request => request.text?.includes(capabilityMarker)).length,
    },
    foundry: {
      warmups: requests.filter(request => request.kind === 'warmup').length,
      responses: requests.filter(request => request.kind !== 'warmup').length,
      followUps: requests.filter(request => request.kind === 'follow_up').length,
      conversations: world.foundry.conversations(), cancels: world.foundry.cancels.length,
    },
    mcp: world.foundry.mcp.map(record => ({
      tool: record.tool, name: record.tool === 'call_tool' ? String(record.args.name) : null, turn: record.turn,
      outcome: typeof record.outcome.body?.outcome === 'string' ? record.outcome.body.outcome : null,
    })),
    recorded: world.store.toolCalls.map(call => ({ message: ref(call.messageId), tool: call.tool, outcome: call.outcome })),
    grants: world.grantFacts().filter(grant => grant.activation?.type === 'chat' || grant.activation?.type === 'voice').map((grant, index) => ({
      boundToOwnerMessage: owners.some(message => message.id === grant.messageId),
      inOwnerSession: owners.some(message => message.id === grant.messageId && message.sessionId === grant.sessionId),
      owner: grant.ownerObjectId === world.store.sessions.length.toString() ? false : true,
      activation: grant.activation, results: grant.results, requests: grant.requests, actions: grant.actions,
      discovered: grant.discovered,
      // Only a turn that did not finish cleanly is expected to have been aborted; a voice session ending aborts every grant of its turns.
      aborted: grant.aborted && world.piStore.turns.filter(turn => turn.kind === 'chat')[index]?.outcome !== 'ok',
    })),
    ledger: world.piStore.turns.map(turn => ({
      kind: turn.kind, outcome: turn.outcome, inputTokens: turn.inputTokens, cachedTokens: turn.cachedTokens, outputTokens: turn.outputTokens,
      costDkk: turn.costDkk, message: turn.messageId === null ? 'none' : ref(turn.messageId), sawText: turn.firstTextMs !== null,
      activationType: turn.activationType ?? null, activationSource: turn.activationSource ?? null, toolCount: turn.toolCount ?? null,
      actionCount: turn.actionCount ?? null, pushCount: turn.pushCount ?? null, activationResult: turn.activationResult ?? null,
    })),
    usage: world.usage.map(usage => ({
      model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      eventId: usage.eventId.replace(/^pi:(\d+):\d+$/u, (_all, id: string) => `pi:${ref(id)}`),
    })),
    // Timings differ on every run; that a timing was measured is what the log must show.
    piTurnLogs: world.piTurnLogs().map(record => ({
      ...without(record, 'time', 'firstTextMs', 'totalMs', 'reqId', 'level', 'service'),
      sawText: typeof record.firstTextMs === 'number', timed: typeof record.totalMs === 'number',
    })),
    toolActivity: world.activity.filter(event => event.type === 'tool-call-started' || event.type === 'tool-call-finished').map(event => ({
      type: String(event.type), source: event.source, tool: event.toolName, message: ref(String(event.messageId)), outcome: event.outcome ?? null,
    })),
    registryOpen: world.registrySize(),
  };
}

export function observeChat(world: ParityWorld, turns: readonly ChatTurn[], options: ObserveOptions = {}): Observation {
  const experience = turns.map((turn): TurnExperience => {
    const progress = turn.events.filter(event => event.name === 'acknowledgment' || event.name === 'commentary').map(event => collapse(String(event.data.text)));
    const done = turn.events.find(event => event.name === 'done');
    const error = turn.events.find(event => event.name === 'error');
    if (done) return { kind: 'reply', reply: collapse(String(done.data.text)), failure: null, failureCode: null, progress };
    const text = collapse(String(error?.data.error ?? ''));
    const stopped = text === failureCopy.stopped.chat;
    return {
      kind: stopped ? 'stopped' : 'failure', reply: null, failure: text,
      failureCode: typeof error?.data.code === 'string' ? error.data.code : null, progress,
    };
  });
  return { ...commonFacts(world, 'chat', new Set(), options), turns: experience, unansweredSpeech: [], commentary: { parts: 0, maxBytes: 0 } };
}

export function observeVoice(world: ParityWorld, calls: readonly VoiceCall[], options: ObserveOptions = {}): Observation {
  const commentary = calls.flatMap(call => call.commentary());
  const delegations = calls.flatMap(call => call.delegations());
  const voiceTaps = world.taps.filter(tap => tap.channel === 'voice');
  const outcomes = world.logs.filter(record => record.msg === 'voice.pi_turn').map(record => String(record.outcome));
  const experience = delegations.map((delegation, index): TurnExperience => {
    const parts = commentary.filter(part => part.delegationId === delegation).map(part => part.content);
    const spoken = collapse(parts.join(' '));
    const note = voiceTaps[index]?.chunks.find((chunk): chunk is { type: 'acknowledgment' | 'commentary'; text: string } => typeof chunk !== 'string' && chunk.type === 'acknowledgment')?.text;
    const progress = note && spoken.startsWith(collapse(note)) ? [collapse(note)] : [];
    const rest = progress.length > 0 ? spoken.slice(progress[0]!.length).trim() : spoken;
    const outcome = outcomes[index] ?? 'none';
    if (outcome === 'ok') return { kind: 'reply', reply: rest, failure: null, failureCode: null, progress };
    if (outcome === 'failed' || outcome === 'timeout') return { kind: 'failure', reply: null, failure: rest, failureCode: null, progress };
    return { kind: 'silence', reply: null, failure: null, failureCode: null, progress };
  });
  // A turn that gave no answer still leaves what was spoken for it (a progress note, a failure) as one or more stored transcripts.
  const ignored = new Set<string>();
  const unansweredSpeech: string[] = [];
  const spokenMessages = world.store.messages.filter(message => message.role === 'jarvis');
  for (const [index, turn] of experience.entries()) {
    if (turn.kind === 'reply') continue;
    const spoken = collapse(commentary.filter(part => part.delegationId === delegations[index]).map(part => part.content).join(' '));
    if (!spoken) continue;
    for (let start = 0; start < spokenMessages.length; start += 1) {
      let joined = '';
      const run: string[] = [];
      for (let end = start; end < spokenMessages.length && joined.length < spoken.length; end += 1) {
        const message = spokenMessages[end]!;
        if (ignored.has(message.id)) break;
        joined = collapse(`${joined} ${message.text}`);
        run.push(message.id);
        if (joined === spoken) {
          for (const id of run) ignored.add(id);
          unansweredSpeech.push(spoken);
          start = spokenMessages.length;
          break;
        }
      }
    }
  }
  const bytes = commentary.map(part => Buffer.byteLength(part.content));
  return { ...commonFacts(world, 'voice', ignored, options), turns: experience, unansweredSpeech, commentary: { parts: bytes.length, maxBytes: Math.max(0, ...bytes) } };
}

/** A facet whose two sides are allowed, and required, to differ; `holds` says exactly how. */
export interface IntentionalRule {
  readonly why: string;
  readonly holds: (chat: never, voice: never) => boolean;
  /** An allowance rather than a required difference: equal sides are then simply `same`. */
  readonly allowed?: true;
}
export type Rules = Readonly<Record<string, IntentionalRule>>;

export interface FacetRow { readonly facet: string; readonly chat: unknown; readonly voice: unknown; readonly verdict: 'same' | 'intentional' | 'DIFFERENT'; readonly why: string }

const turnInputs = (observation: Observation) => observation.inputs.filter(input => input.kind === 'turn');
const chatLedger = (observation: Observation) => observation.ledger.filter(row => row.kind === 'chat');
const dropActivation = (row: Record<string, unknown>) => without(row, 'activationType', 'activationSource');

const answered = (observation: Observation) => observation.turns.filter(turn => turn.kind === 'reply' || turn.kind === 'failure');

/** The stored assistant texts. A spoken transcript also holds the first progress note, which chat shows but never stores. */
function storedReplies(observation: Observation): string[] {
  return observation.stored.filter(message => message.role === 'jarvis').map((message, index) => {
    const text = collapse(message.text);
    const note = observation.channel === 'voice' ? answered(observation)[index]?.progress[0] : undefined;
    return note !== undefined && text.startsWith(note) ? text.slice(note.length).trim() : text;
  });
}

/** The facets of an observation. A scenario can add its own with `extra`. */
export function facetsOf(observation: Observation): Record<string, unknown> {
  const replies = observation.turns.map(turn => turn.reply ?? turn.failure ?? '');
  return {
    'what Dan gets: kind': observation.turns.map(turn => turn.kind),
    'what Dan gets: reply text': observation.turns.map(turn => turn.reply),
    'what Dan gets: failure text': observation.turns.map(turn => turn.failure),
    'what Dan gets: failure code': observation.turns.map(turn => turn.failureCode),
    'what Dan gets: progress notes': observation.turns.map(turn => turn.progress),
    'owner messages stored': observation.stored.filter(message => message.role === 'dan').map(message => message.text),
    'assistant messages stored: text (spoken progress note removed)': storedReplies(observation),
    'assistant messages stored: start with the spoken progress note': observation.stored.filter(message => message.role === 'jarvis')
      .map((message, index) => { const note = answered(observation)[index]?.progress[0]; return note !== undefined && collapse(message.text).startsWith(note); }),
    'speech stored for turns that gave no answer': observation.unansweredSpeech,
    'messages stored outside the reply flow (a proactive push, a spoken aside)': observation.backgroundStored,
    'stored order and refs': observation.stored.map(message => message.ref),
    'assistant stored model': observation.stored.filter(message => message.role === 'jarvis').map(message => message.model),
    'stored session channel': observation.stored.map(message => message.session),
    'stored reply push queued': observation.stored.filter(message => message.role === 'jarvis').map(message => message.replyPush),
    'stored interrupted flags': observation.stored.map(message => message.interrupted),
    'PI input message (blocks removed)': turnInputs(observation).map(input => input.body),
    'PI input has the [Channel: voice] note': turnInputs(observation).map(input => input.voiceNote),
    'PI input carries the persona block': turnInputs(observation).map(input => input.persona),
    'PI input carries the situation block': turnInputs(observation).map(input => input.situation),
    'PI input carries the capability note': turnInputs(observation).map(input => input.capability),
    'blocks delivered over the conversation (persona, situation, capability)': [observation.deliveries.persona, observation.deliveries.situation, observation.deliveries.capability],
    'Foundry: warm-up requests': observation.foundry.warmups,
    'Foundry: responses and follow-ups': [observation.foundry.responses, observation.foundry.followUps],
    'Foundry: conversations created': observation.foundry.conversations,
    'Foundry: cancels sent': observation.foundry.cancels,
    'tool calls over MCP': observation.mcp,
    'tool calls recorded for the owner message': observation.recorded,
    'grant: bound to the stored owner message in its session': observation.grants.map(grant => [grant.boundToOwnerMessage, grant.inOwnerSession]),
    'grant: activation type and source': observation.grants.map(grant => grant.activation),
    'grant: tool results, requests, actions, discovered': observation.grants.map(grant => [grant.results, grant.requests, grant.actions, grant.discovered]),
    'grant: ended with the turn': [observation.registryOpen, observation.grants.map(grant => grant.aborted)],
    'ledger: turn rows': chatLedger(observation).map(dropActivation),
    'ledger: activation type and source': chatLedger(observation).map(row => [row.activationType, row.activationSource]),
    'ledger: warm-up rows': observation.ledger.filter(row => row.kind === 'warm').length,
    'budget: usage records': observation.usage.filter(usage => usage.eventId.startsWith('pi:') && !usage.eventId.includes('warm') && !usage.eventId.includes('brain')),
    'pi.turn logs: one per turn': observation.piTurnLogs.length,
    'pi.turn logs: content': observation.piTurnLogs.map(record => without(record, 'channel')),
    'pi.turn logs: channel': observation.piTurnLogs.map(record => record.channel),
    'tool activity events': observation.toolActivity.map(event => [event.type, event.tool, event.message, event.outcome]),
    'tool activity event source': observation.toolActivity.map(event => event.source),
    'reply text, flattened': replies,
  };
}

/** The differences every scenario shares. Anything not listed here must be equal. */
const blockCarriedByTheFirstTurnOrTheWarmUp = (chat: boolean[], voice: boolean[]) =>
  isDeepStrictEqual(chat, voice) || (chat.length === voice.length && chat[0] === true && voice.every(value => !value));

export const channelDifferences: Rules = {
  'PI input carries the persona block': {
    why: 'a voice session opens its conversation with the warm-up, which carries the block once; chat carries it with the first turn',
    allowed: true, holds: blockCarriedByTheFirstTurnOrTheWarmUp as never,
  },
  'PI input carries the situation block': {
    why: 'a voice session opens its conversation with the warm-up, which carries the block once; chat carries it with the first turn',
    allowed: true, holds: blockCarriedByTheFirstTurnOrTheWarmUp as never,
  },
  'tool activity event source': {
    why: 'tool activity names the channel of the turn it belongs to, so the voice orb can show a tool in use',
    allowed: true,
    holds: ((chat: string[], voice: string[]) => chat.length === voice.length && chat.every(value => value === 'chat') && voice.every(value => value === 'voice')) as never,
  },
  'speech stored for turns that gave no answer': {
    why: 'a voice transcript keeps what was spoken for a stopped turn or a failure; chat stores no reply for either',
    allowed: true,
    holds: ((chat: string[]) => chat.length === 0) as never,
  },
  'what Dan gets: failure code': {
    why: 'chat carries a machine code with the error it shows; voice speaks the sentence only',
    allowed: true,
    holds: ((_chat: unknown[], voice: unknown[]) => voice.every(value => value === null)) as never,
  },
  'assistant messages stored: start with the spoken progress note': {
    why: 'a voice transcript holds what was spoken, including the first progress note; chat stores only the reply',
    allowed: true,
    holds: ((chat: boolean[], voice: boolean[]) => chat.every(value => !value) && chat.length === voice.length) as never,
  },
  'PI input has the [Channel: voice] note': {
    why: 'only a spoken turn carries the [Channel: voice] line',
    holds: ((chat: boolean[], voice: boolean[]) => chat.length === voice.length && chat.every(value => !value) && voice.every(Boolean)) as never,
  },
  'Foundry: warm-up requests': {
    why: 'the voice session primes PI when it opens; chat does it through POST /pi/warm',
    holds: ((chat: number, voice: number) => chat === 0 && voice === 1) as never,
  },
  'ledger: warm-up rows': {
    why: 'that voice warm-up is billed as one warm turn',
    holds: ((chat: number, voice: number) => chat === 0 && voice === 1) as never,
  },
  'assistant stored model': {
    why: 'chat stores PI\'s reply (model pi); voice stores GPT-Live\'s transcript of what it spoke (gpt-live-1)',
    holds: ((chat: string[], voice: string[]) => chat.length === voice.length && chat.every(model => model === 'pi') && voice.every(model => model === 'gpt-live-1')) as never,
  },
  'stored session channel': {
    why: 'chat turns live in a chat session, spoken turns in a voice session',
    holds: ((chat: string[], voice: string[]) => chat.length === voice.length && chat.every(value => value === 'chat') && voice.every(value => value === 'voice')) as never,
  },
  'stored reply push queued': {
    why: 'chat queues a durable reply push with the stored reply; a spoken reply is heard live, so none is queued',
    holds: ((chat: boolean[], voice: boolean[]) => chat.length === voice.length && chat.every(Boolean) && voice.every(value => !value)) as never,
  },
  'grant: activation type and source': {
    why: 'the grant names its channel',
    holds: ((chat: Array<{ type: string; source: string } | null>, voice: Array<{ type: string; source: string } | null>) =>
      chat.length === voice.length && chat.every(value => value?.type === 'chat' && value.source === 'chat') &&
      voice.every(value => value?.type === 'voice' && value.source === 'voice')) as never,
  },
  'ledger: activation type and source': {
    why: 'the ledger row names its channel',
    holds: ((chat: string[][], voice: string[][]) => chat.length === voice.length && chat.every(row => row[0] === 'chat' && row[1] === 'chat') &&
      voice.every(row => row[0] === 'voice' && row[1] === 'voice')) as never,
  },
  'pi.turn logs: channel': {
    why: 'the log record carries the channel of the turn',
    holds: ((chat: string[], voice: string[]) => chat.length === voice.length && chat.every(value => value === 'chat') && voice.every(value => value === 'voice')) as never,
  },
};

export function compare(chat: Observation, voice: Observation, scenario: Rules = {}, extra: Record<string, { chat: unknown; voice: unknown }> = {}): FacetRow[] {
  const rules = { ...channelDifferences, ...scenario };
  const chatFacets = { ...facetsOf(chat), ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name, value.chat])) };
  const voiceFacets = { ...facetsOf(voice), ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name, value.voice])) };
  return Object.keys(chatFacets).map((facet): FacetRow => {
    const left = chatFacets[facet];
    const right = voiceFacets[facet];
    const rule = rules[facet];
    if (rule) {
      const holds = (rule.holds as (chat: unknown, voice: unknown) => boolean)(left, right);
      if (holds && rule.allowed && isDeepStrictEqual(left, right)) return { facet, chat: left, voice: right, verdict: 'same', why: '' };
      return { facet, chat: left, voice: right, verdict: holds ? 'intentional' : 'DIFFERENT', why: holds ? rule.why : `expected the intentional difference (${rule.why})` };
    }
    const same = isDeepStrictEqual(left, right);
    return { facet, chat: left, voice: right, verdict: same ? 'same' : 'DIFFERENT', why: same ? '' : 'not an intentional channel difference' };
  });
}

const cell = (value: unknown, width: number) => {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? 'undefined';
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
};

/** The side-by-side table printed for one scenario. */
export function renderTable(title: string, rows: readonly FacetRow[], width = 46): string {
  const lines = [`\n${title}`, `${'facet'.padEnd(52)}| ${'chat'.padEnd(width)}| ${'voice'.padEnd(width)}| verdict`];
  lines.push('-'.repeat(52 + width * 2 + 16));
  for (const row of rows) {
    const mark = row.verdict === 'same' ? 'same' : row.verdict === 'intentional' ? `intentional: ${row.why}` : `DIFFERENT: ${row.why}`;
    lines.push(`${row.facet.padEnd(52)}| ${cell(row.chat, width - 1).padEnd(width)}| ${cell(row.voice, width - 1).padEnd(width)}| ${mark}`);
  }
  return lines.join('\n');
}

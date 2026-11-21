import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { GoogleApiError } from '../google/api-client.js';
import { answerClientTool } from '../pi/client-tools.js';
import { VOICE_TURN_QUIET_MS } from './live-protocol.js';
import type { McpRecord, ScriptedResponse } from './parity-foundry.testkit.js';
import {
  compare, facetsOf, observeChat, observeVoice, renderTable, type FacetRow, type IntentionalRule, type Observation, type Rules,
} from './parity-report.testkit.js';
import {
  closeParityWorlds, createParityWorld, parityOwner, sleep, until, type ChatTurn, type ParityWorld, type VoiceCall, type WorldOptions,
} from './parity-world.testkit.js';

/**
 * The same owner request and the same scripted model, through the chat route and through the voice relay, with the real PI gateway,
 * the real Jarvis MCP door and tool route, and a stub Foundry harness and stub GPT-Live. Every facet of the two outcomes must be equal,
 * unless the facet is an intentional channel difference that is declared and checked, here or in `channelDifferences`:
 *
 *   - Voice carries a [Channel: voice] line in the PI input and returns a short spoken text; chat streams markdown.
 *   - Voice speaks the first progress note and the answer; chat shows every progress note and streams the answer.
 *   - A spoken reply is stored as GPT-Live's transcript (model gpt-live-1, progress note included, no reply push); a chat reply is
 *     stored as PI's text (model pi, reply push queued).
 *   - The voice session warms PI when it opens; the chat clients call POST /pi/warm.
 *   - A stopped chat turn shows a notice; a stopped or superseded voice turn says nothing.
 */

const tables: Array<{ readonly key: readonly [number, string]; readonly text: string }> = [];
const keyOf = (title: string): readonly [number, string] => {
  const match = /^S(\d+)([a-z]?)/u.exec(title);
  return [Number(match?.[1] ?? 99), match?.[2] ?? ''];
};
afterAll(async () => {
  // The scenarios run side by side; the tables are printed once, in scenario order.
  console.log(tables.sort((left, right) => left.key[0] - right.key[0] || left.key[1].localeCompare(right.key[1])).map(entry => entry.text).join('\n'));
  await closeParityWorlds();
});

type Script = ScriptedResponse<ParityWorld>[];
type Tools = readonly McpRecord[];
type Extra = Record<string, { chat: unknown; voice: unknown }>;
/* eslint-disable @typescript-eslint/no-explicit-any */
const result = (tools: Tools, index = -1) => tools.at(index)!.outcome.body!.result as Record<string, any>;
const body = (tools: Tools, index = -1) => tools.at(index)!.outcome.body as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
const confirmation = (tools: Tools) => String(body(tools).confirmation ?? '');
type Args = Record<string, unknown> | ((tools: Tools) => Record<string, unknown>);
const call = (name: string, args: Args) => ({
  mcp: { tool: 'call_tool' as const, args: (tools: Tools) => ({ name, arguments: typeof args === 'function' ? args(tools) : args }) },
});
const find = (query: string) => ({ mcp: { tool: 'find_tools' as const, args: { query } } });

interface Drive {
  readonly title: string;
  readonly world?: WorldOptions;
  readonly script?: Script | ((world: ParityWorld) => Script);
  readonly setup?: (world: ParityWorld) => Promise<void> | void;
  readonly chat: (world: ParityWorld) => Promise<ChatTurn[]>;
  readonly voice: (world: ParityWorld, call: VoiceCall) => Promise<VoiceCall[] | void>;
  readonly rules?: Rules;
  readonly extra?: (chat: ParityWorld, voice: ParityWorld) => Promise<Extra> | Extra;
  /** Texts a background wake stored in the conversation; they are compared on their own, not as part of the reply flow. */
  readonly background?: (text: string, role: string) => boolean;
}

const collapse = (text: string) => text.replace(/\s+/gu, ' ').trim();

/**
 * The voice turn is over when PI finished and, when it spoke, everything that was said for it has been stored: GPT-Live's transcript
 * can be one message or two (progress note, answer), so the stored speech must hold the whole spoken text, and nothing more may be coming.
 */
async function voiceTurn(world: ParityWorld, voice: VoiceCall, turns: number, speech = true): Promise<void> {
  await until(() => world.logs.filter(record => record.msg === 'voice.pi_turn').length >= turns, `voice turn ${turns} to finish`, 60_000);
  if (!speech) return;
  // The relay speaks before it logs, so speech that is still on its way arrives within moments of the log.
  const finishedAt = Date.now();
  const delegation = voice.delegations().at(-1)!;
  const spoken = () => collapse(voice.commentary().filter(part => part.delegationId === delegation).map(part => part.content).join(' '));
  const stored = () => collapse(world.store.messages.filter(message => message.role === 'jarvis').map(message => message.text).join(' '));
  try {
    await until(() => Date.now() - Math.max(finishedAt, voice.lastCommentaryAt()) > 300 && spoken() !== '' && stored().includes(spoken()), `the speech of turn ${turns} to be stored`, 60_000);
  } catch (error) {
    const relayLogs = world.logs.filter(record => String(record.msg).startsWith('voice.')).map(record => `${record.level}:${record.msg}`).join(', ');
    throw new Error(`${(error as Error).message}. Spoken: ${JSON.stringify(spoken())}. Stored: ${JSON.stringify(stored())}. Relay logs: ${relayLogs}`, { cause: error });
  }
}

async function runBoth(drive: Drive): Promise<{ chat: Observation; voice: Observation; rows: FacetRow[]; chatWorld: ParityWorld; voiceWorld: ParityWorld }> {
  const chatWorld = await createParityWorld(drive.world);
  const voiceWorld = await createParityWorld(drive.world);
  try {
    for (const world of [chatWorld, voiceWorld]) {
      if (drive.script) world.foundry.enqueue(...(typeof drive.script === 'function' ? drive.script(world) : drive.script));
      await drive.setup?.(world);
    }
    const options = drive.background ? { background: drive.background } : {};
    const chat = observeChat(chatWorld, await drive.chat(chatWorld), options);
    const first = await voiceWorld.openVoice();
    const more = (await drive.voice(voiceWorld, first)) ?? [];
    const voice = observeVoice(voiceWorld, [first, ...more.filter(other => other !== first)], options);
    const extra = await drive.extra?.(chatWorld, voiceWorld);
    const rows = compare(chat, voice, drive.rules, extra);
    tables.push({ key: keyOf(drive.title), text: renderTable(drive.title, rows) });
    await first.end();
    return { chat, voice, rows, chatWorld, voiceWorld };
  } finally {
    await Promise.all([chatWorld.close(), voiceWorld.close()]);
  }
}

/** One owner request after another, each answered before the next is said. */
const sequence = (say: readonly string[]): Pick<Drive, 'chat' | 'voice'> => ({
  async chat(world) {
    const turns: ChatTurn[] = [];
    for (const text of say) turns.push(await world.chat.turn(text));
    return turns;
  },
  async voice(world, voice) {
    for (const [index, text] of say.entries()) { voice.say(text); await voiceTurn(world, voice, index + 1); }
  },
});

const expectParity = (rows: readonly FacetRow[]) => {
  expect(rows.filter(row => row.verdict === 'DIFFERENT').map(row => `${row.facet}: ${row.why}`)).toEqual([]);
};
const noTurnLedger: Rules = {
  'ledger: activation type and source': { why: 'the turn was refused before it began, so no ledger row of its own names a channel', allowed: true, holds: ((chat: unknown[][], voice: unknown[][]) => chat.every(row => row[0] === null) && voice.every(row => row[0] === null)) as never },
};
/** A conversation that is already warm, as it is when the app opened chat or an earlier voice call just ended. */
const prewarmed = (world: ParityWorld) => world.gateway.warm(new AbortController().signal).then(() => undefined);
const warmedBeforehand: Rules = {
  'Foundry: warm-up requests': { why: 'the conversation was warmed before either channel spoke, so the voice session finds it warm', allowed: true, holds: ((chat: number, voice: number) => chat === 1 && voice === 1) as never },
  'ledger: warm-up rows': { why: 'one warm-up was billed', allowed: true, holds: ((chat: number, voice: number) => chat === 1 && voice === 1) as never },
};
const rule = (why: string, holds: (chat: never, voice: never) => boolean, allowed?: true): IntentionalRule => ({ why, holds, ...(allowed ? { allowed } : {}) });

describe.concurrent('Chat and Voice behave the same for the same owner request', () => {
  describe('the daily-core requests', () => {
    it('S1 Jarvis work: status of my Jarvis work, then create an issue', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S1 Jarvis work: "status of my Jarvis work", then "create an issue for ..."',
        ...sequence(['What is the status of my Jarvis work?', 'Create an issue for the missing reply notifications on voice.']),
        script: [
          { steps: [
            { say: 'Checking your Jarvis work.' }, find('work status'), call('get_work_status', { query: 'Jarvis work' }),
            { say: tools => `One task is running: ${result(tools).tasks[0].title}. Pull request ${result(tools).pullRequests[0].number} is merged.` },
          ] },
          { steps: [
            { say: 'Creating that issue.' }, find('create issue'),
            call('create_issue', { title: 'Reply notifications on voice', body: 'Voice replies are heard live and queue no push.', executor: 'none' }),
            { say: tools => `Done: issue ${result(tools).issue} (${result(tools).taskCode}) is created.` },
          ] },
        ],
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply']);
      expect([chatWorld.daily.factory.issues.length, voiceWorld.daily.factory.issues.length]).toEqual([1, 1]);
      expectParity(rows);
    }, 90_000);

    it('S2 Notes: save a note, then find it', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S2 Notes: "save a note ...", then "find my note about ..."',
        ...sequence(['Save a note: the dentist is on Thursday at nine.', 'Find my note about the dentist.']),
        script: [
          { steps: [
            { say: 'Saving that note.' }, find('save note vault write'),
            call('vault_write', { path: 'Personal/Dentist.md', content: 'The dentist is on Thursday at nine.', reason: 'save owner note', automaticCapture: false }),
            { say: tools => `Saved to ${result(tools).path}.` },
          ] },
          { steps: [
            { say: 'Searching your notes.' }, find('vault search notes'), call('vault_search', { kind: 'notes', query: 'dentist' }),
            { say: tools => `I found ${result(tools).count} note: ${result(tools).results[0].path}.` },
          ] },
        ],
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply']);
      for (const world of [chatWorld, voiceWorld]) expect(world.daily.vault.files.get('Personal/Dentist.md')?.content).toBe('The dentist is on Thursday at nine.');
      expectParity(rows);
    }, 90_000);

    it('S3 Tasks: create one due tomorrow, complete it, then ask what is due today', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S3 Tasks: "create a task ... due tomorrow", "complete it", "what is due today"',
        ...sequence(['Create a task to call the dentist, due tomorrow.', 'Complete it.', 'What is due today?']),
        script: world => [
          { steps: [
            { say: 'Adding that task.' }, find('create task'), call('vault_task_create', { text: 'Call the dentist', due: world.tomorrow }),
            { say: tools => `${confirmation(tools)} It is due ${world.tomorrow}.` },
          ] },
          { steps: [
            { say: 'Completing it.' }, find('vault search task complete'), call('vault_search', { kind: 'tasks', query: 'dentist' }),
            call('vault_task_complete', tools => {
              const task = (result(tools).items as Array<Record<string, unknown>>).find(item => String(item.text).includes('dentist'))!;
              return { path: task.path, line: task.line, text: task.text, version: task.version, done: true };
            }),
            { say: tools => confirmation(tools) },
          ] },
          { steps: [
            { say: 'Looking at today.' }, find('vault search tasks'), call('vault_search', { kind: 'tasks', state: 'open', dueWindowDays: 0 }),
            { say: tools => `${result(tools).total} task is due today: ${(result(tools).items as Array<Record<string, unknown>>).map(item => item.text).join(', ')}.` },
          ] },
        ],
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply', 'reply']);
      for (const world of [chatWorld, voiceWorld]) {
        const inbox = world.daily.vault.files.get('Personal/Task inbox.md')!.content;
        expect(inbox).toMatch(/- \[x\] Call the dentist/u);
        expect(inbox).toContain('- [ ] Pay rent');
        expect(world.piTurnLogs().map(record => record.channel)).toEqual(world === chatWorld ? ['chat', 'chat', 'chat'] : ['voice', 'voice', 'voice']);
      }
      expectParity(rows);
    }, 120_000);

    it('S4 Workouts: log a bench press, then ask what was lifted last week', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S4 Workouts: "log a bench press 80 kg x 5", "what did I lift last week"',
        ...sequence(['Log a bench press, 80 kilos for 5 reps.', 'What did I lift last week?']),
        script: [
          { steps: [
            { say: 'Logging that lift.' }, find('gym lifts'),
            call('gym_lifts', { operation: 'create', values: { exerciseName: 'Bench press', weightKg: 80, reps: 5 } }),
            { say: tools => `Logged ${result(tools).entry.exerciseName}, ${result(tools).entry.weightKg} kilos for ${result(tools).entry.reps} reps.` },
          ] },
          { steps: [
            { say: 'Checking last week.' }, find('gym lifts'), call('gym_lifts', { operation: 'list', limit: 100 }),
            { say: tools => `Last week: ${(result(tools).items as Array<Record<string, unknown>>).filter(item => String(item.performedAt) < '2026-11-21')
              .map(item => `${item.exerciseName} ${item.weightKg} kilos for ${item.reps}`).join(' and ')}.` },
          ] },
        ],
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply']);
      for (const world of [chatWorld, voiceWorld]) expect(world.daily.gym.lifts.filter(entry => entry.exerciseName === 'Bench press')).toHaveLength(1);
      expectParity(rows);
    }, 90_000);

    it('S5 Nutrition: log a meal, ask for calories logged and left, then protein still needed', async () => {
      const nutritionList = rule(
        'chat shows the server\'s canonical nutrition list under a meal estimate (presentNutritionList in conversation.ts); a spoken reply stays PI\'s own sentence',
        ((chat: string[], voice: string[]) => chat.length === voice.length && chat.every((text, index) => index === 0
          ? text.startsWith(voice[index]!) && text.includes('Estimated nutrition (not measured):') : text === voice[index])) as never,
      );
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S5 Nutrition: "log 200 g chicken and rice", "calories logged and left", "protein still needed"',
        ...sequence(['Log 200 grams of chicken and rice.', 'How many calories have I logged and how many are left today?', 'How much protein do I still need today?']),
        script: [
          { steps: [
            { say: 'Logging that meal.' }, find('health food review log estimate'),
            call('health_food_review', { change: { operation: 'log_estimate', food: { mealName: 'Chicken and rice', referenceComponents: [{ name: 'chicken', grams: 100 }, { name: 'rice', grams: 100 }] } } }),
            { say: tools => `Logged chicken and rice: about ${result(tools).record.energyKcal} calories and ${result(tools).record.proteinGrams} grams of protein.` },
          ] },
          { steps: [
            { say: 'Checking your day.' }, find('health query nutrition targets'),
            call('health_query', { source: 'nutrition' }), call('health_nutrition_targets', { operation: 'read' }),
            { say: tools => `You have logged ${result(tools, -2).energyKcal} calories, so ${result(tools).targets.energyKcal - result(tools, -2).energyKcal} are left today.` },
          ] },
          { steps: [
            { say: 'Checking protein.' }, find('health query nutrition targets'),
            call('health_query', { source: 'nutrition' }), call('health_nutrition_targets', { operation: 'read' }),
            { say: tools => `You still need ${result(tools).targets.proteinGrams - result(tools, -2).proteinGrams} grams of protein today.` },
          ] },
        ],
        rules: {
          'what Dan gets: reply text': nutritionList,
          'assistant messages stored: text (spoken progress note removed)': nutritionList,
          'reply text, flattened': nutritionList,
          'meal capture method': rule('the meal records how it was captured: typed text in chat, voice when spoken', ((chat: string[], voice: string[]) => chat.length === 1 && chat[0] === 'text' && voice.length === 1 && voice[0] === 'voice') as never),
        },
        extra: (chatSide, voiceSide) => ({
          'meal capture method': { chat: chatSide.daily.nutrition.meals.map(meal => meal.captureMethod), voice: voiceSide.daily.nutrition.meals.map(meal => meal.captureMethod) },
        }),
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply', 'reply']);
      expect([chatWorld.daily.nutrition.meals.length, voiceWorld.daily.nutrition.meals.length]).toEqual([1, 1]);
      expectParity(rows);
    }, 120_000);
  });

  describe('failures, writes and the harness', () => {
    it('S6 a Jarvis tool fails with a plain cause: both say the same thing', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S6 Tool failure with a plain cause (Google sign-in expired)',
        world: { google: async () => { throw new GoogleApiError('credentials-expired'); } },
        ...sequence(['What is on my calendar tomorrow?']),
        script: world => [{ steps: [
          { say: 'Checking your calendar.' }, find('calendar list events'),
          call('calendar_list_events', { start: world.tomorrow, end: world.tomorrow }),
          { say: tools => `I could not read your calendar: ${result(tools).error}` },
        ] }],
      });
      const cause = 'Google credentials have expired. Dan must reconnect Google before using calendar or mail.';
      expect(chat.turns[0]?.reply).toContain(cause);
      for (const world of [chatWorld, voiceWorld]) {
        expect(world.grantFacts()[0]!.results).toEqual([{ tool: 'calendar_list_events', outcome: 'error' }]);
        expect(world.store.toolCalls.map(entry => entry.outcome)).toEqual(['error']);
      }
      expectParity(rows);
    }, 60_000);

    it('S7 a non-delete write finishes in one turn, with no confirmation round trip', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S7 Non-delete write (calendar event): one turn, no confirmation',
        ...sequence(['Book the dentist tomorrow at nine for half an hour.']),
        script: world => [{ steps: [
          { say: 'Booking that.' }, find('calendar create event'),
          call('calendar_create_event', { subject: 'Dentist', startDateTime: `${world.tomorrow}T09:00:00+01:00`, endDateTime: `${world.tomorrow}T09:30:00+01:00` }),
          { say: tools => `${confirmation(tools)}` },
        ] }],
        extra: (chatSide, voiceSide) => ({
          'Google writes': {
            chat: chatSide.googleCalls.filter(entry => entry.method === 'POST').map(entry => [entry.path, entry.body]),
            voice: voiceSide.googleCalls.filter(entry => entry.method === 'POST').map(entry => [entry.path, entry.body]),
          },
        }),
      });
      expect(chat.turns[0]?.reply).toBe('The calendar change is done.');
      for (const world of [chatWorld, voiceWorld]) {
        expect(result(world.foundry.mcp).status).toBe('completed');
        expect(JSON.stringify(world.foundry.mcp.filter(entry => entry.tool === 'call_tool').map(entry => entry.outcome.body))).not.toMatch(/awaiting_confirmation|confirmationCode|input_required/iu);
        expect(world.googleCalls.filter(entry => entry.method === 'POST')).toHaveLength(1);
        expect(world.foundry.requests.filter(request => request.kind !== 'warmup')).toHaveLength(1);
      }
      expectParity(rows);
    }, 60_000);

    it('S8 a native harness sub-agent call finishes in the same response: no follow-up, the same words', async () => {
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S8 Native harness call (function_call "task" with its result and later text)',
        ...sequence(['Ask a sub-agent to check my calendar.']),
        script: [{ steps: [
          { say: 'Asking a sub-agent.' }, { native: { name: 'task', callId: 'call_task_1', output: 'Two meetings tomorrow.' } },
          { say: 'The sub-agent found two meetings tomorrow.' },
        ] }],
      });
      for (const world of [chatWorld, voiceWorld]) {
        expect(world.foundry.requests.filter(request => request.kind !== 'warmup')).toHaveLength(1);
        expect(world.piTurnLogs()[0]).toMatchObject({ outcome: 'ok', rounds: 1, clientItems: 0, nativeCalls: 1 });
      }
      expectParity(rows);
    }, 60_000);

    it('S9 a genuinely client-owned function_call gets exactly one follow-up', async () => {
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S9 Client-owned function_call: exactly one follow-up',
        ...sequence(['Run my backup script.']),
        script: [
          { steps: [{ say: 'Let me run that.' }, { client: { name: 'shell', callId: 'call_c1' } }], usage: { input: 11_000, cached: 9_000, output: 40 } },
          { steps: [{ say: 'That tool is not available here, so I could not run it.' }], usage: { input: 11_200, cached: 11_000, output: 30 } },
        ],
      });
      for (const world of [chatWorld, voiceWorld]) {
        const requests = world.foundry.requests.filter(request => request.kind !== 'warmup');
        expect(requests.map(request => request.kind)).toEqual(['turn', 'follow_up']);
        expect(requests[1]!.input).toEqual([{ type: 'function_call_output', call_id: 'call_c1', output: answerClientTool('shell').output }]);
        expect(world.piTurnLogs()[0]).toMatchObject({ outcome: 'ok', rounds: 2, clientItems: 1, nativeCalls: 0, inputTokens: 22_200, outputTokens: 70 });
      }
      expectParity(rows);
    }, 60_000);

    it('S10 a very large tool result is cut at the same point and audited in full', async () => {
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S10 Very large tool results (300,000 and 1,200,000 characters)',
        ...sequence(['Pull the full report.', 'Pull the whole archive.']),
        script: [
          { steps: [
            { say: 'Pulling the report.' }, find('large result'), call('parity_large_result', { characters: 300_000 }),
            { say: tools => `The report was too long to read in full: ${body(tools).truncated ? 'I only have its start' : 'I have all of it'}.` },
          ] },
          { steps: [
            { say: 'Pulling the archive.' }, find('large result'), call('parity_large_result', { characters: 1_200_000 }),
            { say: tools => `The archive could not be read: ${result(tools).error}.` },
          ] },
        ],
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply']);
      for (const world of [chatWorld, voiceWorld]) {
        const [first, second] = world.foundry.mcp.filter(entry => (entry.args as { name?: string }).name === 'parity_large_result');
        expect(first!.outcome.body).toMatchObject({ outcome: 'ok', truncated: true });
        expect((first!.outcome.body!.result.preview as string).length).toBe(200_000);
        expect(second!.outcome.body).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
        expect(JSON.stringify(world.store.toolCalls[0]!.result).length).toBeGreaterThan(300_000);
      }
      expectParity(rows);
    }, 120_000);

    it('S11 Danish input reaches PI, the tools and the history unchanged', async () => {
      const note = 'Gem en note: tandlægen er torsdag klokken ni, og jeg skal huske søndagsfrokosten på Østerbro.';
      const task = 'Opret en opgave: ring til tandlægen i morgen.';
      const { rows, chat, chatWorld, voiceWorld, voice } = await runBoth({
        title: 'S11 Danish input (note, then task)',
        async chat(world) {
          await world.chat.session('da');
          return [await world.chat.turn(note), await world.chat.turn(task)];
        },
        voice: sequence([note, task]).voice,
        script: world => [
          { steps: [
            { say: 'Jeg gemmer den note.' }, find('noter gem note'),
            call('vault_write', { path: 'Personal/Tandlæge.md', content: 'Tandlægen er torsdag klokken ni.', reason: 'gem note', automaticCapture: false }),
            { say: tools => `Gemt i ${result(tools).path}.` },
          ] },
          { steps: [
            { say: 'Jeg opretter opgaven.' }, find('opgave'), call('vault_task_create', { text: 'Ring til tandlægen', due: world.tomorrow }),
            { say: 'Tilføjet: ring til tandlægen i morgen. Hav en dejlig dag, Dan – æøå.' },
          ] },
        ],
        rules: {
          'stored session language': rule('the voice relay cannot know the spoken language at session start, so every voice session is stored as en', ((chat: string[], voice: string[]) => chat.every(value => value === 'da') && voice.every(value => value === 'en')) as never),
        },
        extra: (chatSide, voiceSide) => ({
          'stored session language': { chat: chatSide.store.sessions.map(session => session.language), voice: voiceSide.store.sessions.map(session => session.language) },
        }),
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply']);
      for (const world of [chatWorld, voiceWorld]) {
        expect(world.store.messages.filter(message => message.role === 'dan').map(message => message.text)).toEqual([note, task]);
        expect(world.daily.vault.files.get('Personal/Tandlæge.md')?.content).toBe('Tandlægen er torsdag klokken ni.');
      }
      expect(voice.commentary.maxBytes).toBeLessThanOrEqual(256);
      expect(voice.turns[1]!.reply).toContain('æøå');
      expect(voice.turns[1]!.reply).not.toContain('\uFFFD');
      expectParity(rows);
    }, 120_000);
  });

  describe('stopping, binding, replay, context, budget and errors', () => {
    const stale = async (world: ParityWorld) => (await world.mcp('find_tools', { turn: world.foundry.turns[0]!, query: 'calendar' })).body?.outcome;
    const calendarTurn = (world: ParityWorld, hold?: string): Script[number] => ({
      steps: [
        { say: 'Checking your calendar.' }, find('calendar list events'),
        ...(hold ? [{ hold }] : [call('calendar_list_events', { start: world.tomorrow, end: world.tomorrow }), { say: 'You have two events tomorrow.' }]),
      ],
    });
    const stopped = (where: string, noteIfAny: string) => ({
      'what Dan gets: kind': rule(`${noteIfAny}: a stopped chat turn shows a notice, a stopped voice turn says nothing`, ((chat: string[], voice: string[]) => chat[0] === 'stopped' && voice[0] === 'silence') as never),
      'what Dan gets: failure text': rule(`${where}: the chat notice has no spoken counterpart`, ((chat: string[], voice: unknown[]) => String(chat[0]).startsWith('Reply stopped') && voice[0] === null) as never),
      'reply text, flattened': rule(`${where}: the chat notice has no spoken counterpart`, ((chat: string[], voice: string[]) => chat[0]!.startsWith('Reply stopped') && voice[0] === '') as never),
    });

    it('S12a stopping a turn: cancelled, billed at the same estimate, and the grant is closed', async () => {
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S12a Stopped turn (chat Stop / voice session end)',
        script: world => [calendarTurn(world, 'stop')],
        setup: prewarmed,
        async chat(world) {
          const started = await world.chat.start('What is on my calendar tomorrow?');
          await world.foundry.reached('stop');
          const owner = world.store.messages.find(message => message.role === 'dan')!;
          expect(await world.chat.cancel(started.sessionId, owner.id)).toBe(200);
          return [await started.ended];
        },
        async voice(world, voice) {
          voice.say('What is on my calendar tomorrow?');
          await world.foundry.reached('stop');
          await voice.end();
          await voiceTurn(world, voice, 1, false);
        },
        rules: { ...warmedBeforehand, ...stopped('explicit stop', 'chat Stop / voice session end') },
        extra: async (chatSide, voiceSide) => ({ 'turn reference replayed after the turn is refused': { chat: await stale(chatSide), voice: await stale(voiceSide) } }),
      });
      for (const world of [chatWorld, voiceWorld]) {
        expect(world.piStore.turns.filter(turn => turn.kind === 'chat').map(turn => turn.outcome)).toEqual(['cancelled']);
        expect(world.piTurnLogs()[0]).toMatchObject({ outcome: 'cancelled', estimated: true });
        expect(world.registrySize()).toBe(0);
        expect(world.grantFacts().map(grant => grant.aborted)).toEqual([true]);
        expect(world.foundry.cancels).toHaveLength(1);
      }
      expectParity(rows);
    }, 90_000);

    it('S12b the newest request wins: chat steering and a new voice delegation supersede the turn in flight', async () => {
      const finalOnly = (why: string) => rule(why, ((chat: unknown[], voice: unknown[]) => voice.length === chat.length + 1 && isDeepStrictEqual(chat.at(-1), voice.at(-1))) as never);
      const { rows, chat, voice, chatWorld, voiceWorld } = await runBoth({
        title: 'S12b Superseded turn (chat steer / second voice delegation)',
        setup: prewarmed,
        script: world => [
          calendarTurn(world, 'first'),
          { steps: [{ say: 'Sure, switching to Friday.' }, find('calendar list events'), call('calendar_list_events', { start: world.tomorrow, end: world.tomorrow }), { say: 'Friday is free.' }] },
        ],
        async chat(world) {
          const started = await world.chat.start('What is on my calendar tomorrow?');
          await world.foundry.reached('first');
          expect(await world.chat.steer(started.sessionId, 'Actually, check Friday instead.')).toBe(202);
          return [await started.ended];
        },
        async voice(world, voice) {
          voice.say('What is on my calendar tomorrow?');
          await world.foundry.reached('first');
          voice.say('Actually, check Friday instead.');
          await voiceTurn(world, voice, 2);
        },
        rules: {
          ...warmedBeforehand,
          'what Dan gets: kind': finalOnly('chat steering continues one stream; voice runs the second delegation as its own turn, and the first says nothing'),
          'what Dan gets: reply text': finalOnly('chat steering continues one stream; voice runs the second delegation as its own turn'),
          'what Dan gets: failure text': finalOnly('chat steering continues one stream; voice runs the second delegation as its own turn'),
          'what Dan gets: failure code': finalOnly('chat steering continues one stream; voice runs the second delegation as its own turn'),
          'reply text, flattened': finalOnly('chat steering continues one stream; voice runs the second delegation as its own turn'),
          'what Dan gets: progress notes': rule('chat shows both progress notes in its one stream; voice speaks the first note of each turn',
            ((chat: string[][], voice: string[][]) => chat.at(-1)!.at(-1) === voice.at(-1)![0]) as never),
        },
        extra: async (chatSide, voiceSide) => ({ 'turn reference replayed after the turn is refused': { chat: await stale(chatSide), voice: await stale(voiceSide) } }),
      });
      expect(chat.turns[0]?.reply).toBe('Friday is free.');
      for (const observation of [chat, voice]) expect(observation.grants.map(grant => grant.aborted)).toEqual([true, false]);
      for (const world of [chatWorld, voiceWorld]) {
        expect(world.piStore.turns.filter(turn => turn.kind === 'chat').map(turn => turn.outcome)).toEqual(['cancelled', 'ok']);
        expect(world.piTurnLogs().map(record => record.outcome)).toEqual(['cancelled', 'ok']);
        expect(world.foundry.cancels).toHaveLength(1);
        expect(world.registrySize()).toBe(0);
        const owners = world.store.messages.filter(message => message.role === 'dan');
        expect(world.grantFacts().map(grant => grant.messageId)).toEqual(owners.map(message => message.id));
      }
      expectParity(rows);
    }, 90_000);

    it('S12c more speech or a second typed message while PI works never cancels the turn in flight', async () => {
      const side = { second: 0 };
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S12c A second message while PI works (chat POST / voice speech without a delegation)',
        setup: prewarmed,
        script: world => [{ steps: [
          { say: 'Checking your calendar.' }, find('calendar list events'), { hold: 'working' },
          call('calendar_list_events', { start: world.tomorrow, end: world.tomorrow }), { say: 'You have two events tomorrow.' },
        ] }],
        async chat(world) {
          const started = await world.chat.start('What is on my calendar tomorrow?');
          await world.foundry.reached('working');
          side.second = (await world.chat.turn('Also, what about Friday?')).status;
          world.foundry.release('working');
          return [await started.ended];
        },
        async voice(world, voice) {
          voice.say('What is on my calendar tomorrow?');
          await world.foundry.reached('working');
          voice.say('Also, what about Friday?', { delegate: false });
          // Longer than the relay's quiet window, so the aside counts as a finished turn when the answer starts.
          await sleep(VOICE_TURN_QUIET_MS + 1_000);
          world.foundry.release('working');
          await voiceTurn(world, voice, 1);
        },
        background: (text, role) => role === 'dan' && text === 'Also, what about Friday?',
        rules: {
          ...warmedBeforehand,
          'messages stored outside the reply flow (a proactive push, a spoken aside)': rule(
            'a spoken aside is stored as Dan\'s next message; a second typed message is refused with 409 while a reply is in flight, and stores nothing',
            ((chat: string[], voice: string[]) => chat.length === 0 && voice.length === 1) as never),
        },
      });
      expect(side.second).toBe(409);
      for (const world of [chatWorld, voiceWorld]) {
        expect(world.piStore.turns.filter(turn => turn.kind === 'chat').map(turn => turn.outcome)).toEqual(['ok']);
        expect(world.foundry.cancels).toEqual([]);
      }
      expectParity(rows);
    }, 90_000);

    it('S17 a brain wake in the middle of a turn leaves both channels untouched', async () => {
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S17 Brain wake while a turn is in flight',
        ...sequence(['What is on my calendar tomorrow?']),
        script: world => [
          { steps: [
            { say: 'Checking your calendar.' }, find('calendar list events'),
            { run: async (w: ParityWorld) => { expect((await w.gateway.runBrain({ runId: 'wake-1', body: 'A timer fired.' }, new AbortController().signal)).ok).toBe(true); } },
            call('calendar_list_events', { start: world.tomorrow, end: world.tomorrow }), { say: 'You have two events tomorrow.' },
          ] },
          { steps: [{ say: 'Nothing for Dan.' }] },
        ],
        extra: async (chatSide, voiceSide) => ({
          'ledger kinds (the wake is billed apart from chat)': {
            chat: chatSide.piStore.turns.map(turn => turn.kind).filter(kind => kind !== 'warm'),
            voice: voiceSide.piStore.turns.map(turn => turn.kind).filter(kind => kind !== 'warm'),
          },
          'owner conversation kept, the wake used its own': {
            chat: [(await chatSide.piStore.getConversation(parityOwner, new AbortController().signal))?.conversationId, chatSide.foundry.conversations()],
            voice: [(await voiceSide.piStore.getConversation(parityOwner, new AbortController().signal))?.conversationId, voiceSide.foundry.conversations()],
          },
        }),
      });
      for (const world of [chatWorld, voiceWorld]) expect(world.piTurnLogs()).toHaveLength(1);
      expectParity(rows);
    }, 90_000);

    it('S13 a proactive message that arrives mid-turn never moves the owner message a tool is bound to', async () => {
      const first = 'Book the dentist tomorrow at nine for half an hour.';
      const { rows, chat, chatWorld, voiceWorld } = await runBoth({
        title: 'S13 Owner-message binding with an interleaved proactive message',
        ...sequence([first, 'Thanks. What was that heads-up?']),
        background: (text, role) => role === 'jarvis' && text.startsWith('Heads up'),
        script: world => [
          { steps: [
            { say: 'Booking that.' }, find('calendar create event probe owner'),
            // A background wake tells Dan something after his message is stored and before the tool runs.
            { run: async (w: ParityWorld) => {
              const session = await w.store.createSession({ channel: 'chat', language: 'en' });
              await w.store.addMessage({ sessionId: session.id, role: 'jarvis', text: 'Heads up: rain is coming tomorrow.', model: 'pi' });
              w.proactiveText = 'PROACTIVE: Heads up: rain is coming tomorrow.';
            } },
            call('parity_owner_probe', {}),
            call('calendar_create_event', { subject: 'Dentist', startDateTime: `${world.tomorrow}T09:00:00+01:00`, endDateTime: `${world.tomorrow}T09:30:00+01:00` }),
            { say: tools => `${confirmation(tools)} I answered: ${result(tools, -2).ownerText}` },
          ] },
          { steps: [{ say: 'That was the rain warning.' }] },
        ],
      });
      expect(chat.turns.map(turn => turn.kind)).toEqual(['reply', 'reply']);
      for (const world of [chatWorld, voiceWorld]) {
        const owner = world.store.messages.find(message => message.role === 'dan')!;
        const probe = result(world.foundry.mcp, -2);
        expect(probe).toMatchObject({ ownerMessageId: owner.id, ownerText: first, ownerSessionId: owner.sessionId, pi: 'turn', asAgent: true });
        expect(result(world.foundry.mcp).status).toBe('completed');
        expect(world.store.toolCalls.map(entry => entry.messageId)).toEqual([owner.id, owner.id]);
        expect(world.grantFacts()[0]).toMatchObject({ messageId: owner.id, sessionId: owner.sessionId });
        expect(world.store.messages.filter(message => message.text.startsWith('Heads up'))).toHaveLength(1);
        const second = world.foundry.requests.filter(request => request.kind === 'turn')[1]!;
        expect(second.text).toContain('[Jarvis recently told Dan this, and he may be replying to it]\nPROACTIVE: Heads up: rain is coming tomorrow.');
      }
      expectParity(rows);
    }, 120_000);

    it('S14 a replayed stream or a duplicated delivery stores nothing twice, and a reconnect keeps one conversation', async () => {
      const side = { chat: { equal: false, unchanged: false }, voice: { unchanged: false } };
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S14 Persistence: replay, duplicate delivery and reconnect',
        script: world => [calendarTurn(world), { steps: [{ say: 'Nothing on the day after.' }] }],
        async chat(world) {
          const first = await world.chat.turn('What is on my calendar tomorrow?');
          const owner = world.store.messages.find(message => message.role === 'dan')!;
          const stored = world.store.messages.map(message => message.id);
          const again = await world.chat.reattach(first.sessionId, owner.id);
          side.chat.equal = JSON.stringify(again.events) === JSON.stringify(first.events);
          await world.chat.reattach(first.sessionId, owner.id);
          side.chat.unchanged = isDeepStrictEqual(world.store.messages.map(message => message.id), stored) && world.foundry.requests.length === 1;
          return [first, await world.chat.turn('And the day after?')];
        },
        async voice(world, voice) {
          const said = voice.say('What is on my calendar tomorrow?');
          await voiceTurn(world, voice, 1);
          const stored = world.store.messages.map(message => message.id);
          const requests = world.foundry.requests.length;
          said.replay();
          await sleep(2_500);
          side.voice.unchanged = isDeepStrictEqual(world.store.messages.map(message => message.id), stored) && world.foundry.requests.length === requests;
          await voice.end();
          const reconnected = await world.openVoice();
          reconnected.say('And the day after?');
          await voiceTurn(world, reconnected, 2);
          return [voice, reconnected];
        },
        rules: {
          'Foundry: warm-up requests': rule('a voice session warms PI when it opens, and again when it reconnects',
            ((chat: number, voice: number) => chat === 0 && voice >= 1) as never),
          'ledger: warm-up rows': rule('the warm-ups are billed as warm turns', ((chat: number, voice: number) => chat === 0 && voice >= 1) as never),
          'stored session channel': rule('chat turns live in one chat session; a reconnect starts a second voice session',
            ((chat: string[], voice: string[]) => chat.every(value => value === 'chat') && voice.every(value => value === 'voice') && chat.length === voice.length) as never),
        },
        extra: () => ({
          'a replay or duplicate delivery changed nothing': { chat: side.chat.equal && side.chat.unchanged, voice: side.voice.unchanged },
        }),
      });
      for (const world of [chatWorld, voiceWorld]) {
        const stored = world.store.messages;
        expect(stored.map(message => message.role)).toEqual(['dan', 'jarvis', 'dan', 'jarvis']);
        expect(stored.map(message => BigInt(message.id))).toEqual([...stored.map(message => BigInt(message.id))].sort((a, b) => Number(a - b)));
        expect(new Set(stored.map(message => message.id)).size).toBe(4);
        expect(world.foundry.conversations()).toBe(1);
      }
      expectParity(rows);
    }, 120_000);

    it('S15 the persona, situation and capability blocks reach PI once per conversation, whichever channel speaks first', async () => {
      const runs: Record<string, Observation> = {};
      for (const order of ['chat first', 'voice first'] as const) {
        const world = await createParityWorld();
        try {
          world.foundry.enqueue(...[1, 2, 3].map(index => ({ steps: [{ say: `Answer ${index}.` }] }) as Script[number]));
          const turns: ChatTurn[] = [];
          let voice: VoiceCall | undefined;
          let spoken = 0;
          for (const [index, channel] of (order === 'chat first' ? ['chat', 'voice', 'chat'] : ['voice', 'chat', 'voice']).entries()) {
            if (channel === 'chat') turns.push(await world.chat.turn(`Question ${index + 1}`));
            else { voice ??= await world.openVoice(); voice.say(`Question ${index + 1}`); spoken += 1; await voiceTurn(world, voice, spoken); }
          }
          runs[order] = observeChat(world, turns);
          expect(world.foundry.conversations()).toBe(1);
        } finally { await world.close(); }
      }
      const first = runs['chat first']!;
      const second = runs['voice first']!;
      const carrier = (run: Observation) => (run.foundry.warmups > 0 && !run.inputs[0]!.persona ? 'the warm-up' : 'the first turn');
      const rows: FacetRow[] = [
        {
          facet: 'blocks delivered over the conversation (persona, situation, capability)', chat: facetsOf(first)['blocks delivered over the conversation (persona, situation, capability)'],
          voice: facetsOf(second)['blocks delivered over the conversation (persona, situation, capability)'],
          verdict: isDeepStrictEqual(first.deliveries, second.deliveries) ? 'same' : 'DIFFERENT', why: 'the blocks must arrive once whoever speaks first',
        },
        { facet: 'request that carried the persona and situation blocks', chat: carrier(first), voice: carrier(second), verdict: carrier(first) === 'the first turn' && carrier(second) === 'the warm-up' ? 'intentional' : 'DIFFERENT', why: 'a voice session opens with the warm-up; a chat conversation opens with its first turn' },
        { facet: 'Foundry conversations created', chat: first.foundry.conversations, voice: second.foundry.conversations, verdict: first.foundry.conversations === second.foundry.conversations ? 'same' : 'DIFFERENT', why: 'one conversation for both channels' },
      ];
      tables.push({ key: [15, ''], text: renderTable('S15 Persona, situation and capability blocks (left: chat, voice, chat; right: voice, chat, voice)', rows) });
      for (const run of Object.values(runs)) expect(run.deliveries).toEqual({ persona: 1, situation: 1, capability: 1 });
      expectParity(rows);
    }, 90_000);

    it('S16a the monthly cap stops a turn before anything is sent, with the same words', async () => {
      const cap = 'PI has used 5.00 of its 1 DKK monthly cap, so it stopped. Nothing was sent. No other engine was used.';
      const { rows, chat, voice, chatWorld, voiceWorld } = await runBoth({
        title: 'S16a Budget: the cap is reached',
        world: { monthlyCapDkk: 1 },
        setup: world => world.piStore.recordTurn({
          kind: 'chat', messageId: null, model: 'm', inputTokens: 0, cachedTokens: 0, outputTokens: 0, costDkk: 5, firstTextMs: 1, totalMs: 1, outcome: 'ok',
        }, new AbortController().signal),
        ...sequence(['What is on my calendar tomorrow?']),
        rules: {
          ...noTurnLedger,
          'Foundry: warm-up requests': rule('over the cap, neither channel sends anything, a voice warm-up included', ((chat: number, voice: number) => chat === 0 && voice === 0) as never, true),
          'ledger: warm-up rows': rule('nothing was billed', ((chat: number, voice: number) => chat === 0 && voice === 0) as never, true),
        },
      });
      expect(chat.turns[0]).toMatchObject({ kind: 'failure', failure: cap, failureCode: 'pi_budget_exhausted' });
      expect(voice.turns[0]).toMatchObject({ kind: 'failure', failure: cap });
      for (const world of [chatWorld, voiceWorld]) expect(world.foundry.requests).toEqual([]);
      expectParity(rows);
    }, 60_000);

    it('S16b an unreadable spend does not stop either channel, and both say so in the log', async () => {
      const { rows, chatWorld, voiceWorld } = await runBoth({
        title: 'S16b Budget: the spend cannot be read',
        world: { spendUnreadable: true },
        ...sequence(['What is on my calendar tomorrow?']),
        script: world => [calendarTurn(world)],
        rules: {
          'Foundry: warm-up requests': rule('the voice warm-up needs the spend too, so it is skipped', ((chat: number, voice: number) => chat === 0 && voice === 0) as never, true),
          'ledger: warm-up rows': rule('no warm-up was billed', ((chat: number, voice: number) => chat === 0 && voice === 0) as never, true),
        },
      });
      for (const world of [chatWorld, voiceWorld]) expect(world.piTurnLogs()[0]).toMatchObject({ outcome: 'ok', budgetRead: 'unavailable' });
      expectParity(rows);
    }, 60_000);

    it.each([
      { title: 'S18a Foundry rate limit', script: [{ steps: [], httpStatus: 429, retryAfter: '7' }] as Script },
      { title: 'S18b a response that fails', script: [{ steps: [{ say: 'Let me' }], failWith: 'content_filter' }] as Script },
      {
        title: 'S18c an unexpected error inside PI', script: [] as Script,
        setup: (world: ParityWorld) => { world.piStore.getConversation = async () => { throw new Error('SQL unavailable'); }; },
        rules: {
          ...noTurnLedger,
          'Foundry: warm-up requests': rule('PI cannot be reached, so the voice warm-up fails too', ((chat: number, voice: number) => chat === 0 && voice === 0) as never, true),
          'ledger: warm-up rows': rule('no warm-up was billed', ((chat: number, voice: number) => chat === 0 && voice === 0) as never, true),
        } as Rules,
      },
      { title: 'S18d PI sends no answer', script: [{ steps: [] }] as Script },
    ])('$title is told the same way in both channels', async ({ title, script, setup, rules }) => {
      const { rows, chat, voice } = await runBoth({
        title: `${title}: what Dan reads and what Dan hears`,
        ...sequence(['What is on my calendar tomorrow?']),
        script,
        ...(setup ? { setup } : {}),
        ...(rules ? { rules } : {}),
      });
      expect(chat.turns[0]!.kind).toBe('failure');
      expect(voice.turns[0]!.kind).toBe('failure');
      expect(voice.turns[0]!.failure).toBe(chat.turns[0]!.failure);
      expectParity(rows);
    }, 60_000);
  });
});

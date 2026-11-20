import { describe, expect, it } from 'vitest';
import type { ConversationAgentChunk, ConversationAgentInput } from '../core/chat-agent.js';
import { PiGatewayError } from '../pi/errors.js';
import { createRealtimeSessionUpdate } from './realtime.js';
import { createPiVoiceTurns, type PiVoiceAgent, type PiVoiceTurnLog } from './pi-voice.js';
import { createToolRegistry } from '../core/tool-registry.js';

const turn = { text: 'what is next', messageId: '42', sessionId: '7', startedAt: 0 };

function setup(agent: PiVoiceAgent, options: { deadlineMs?: number } = {}) {
  const spoken: string[] = [];
  const logs: PiVoiceTurnLog[] = [];
  const busy: boolean[] = [];
  const session = new AbortController();
  const turns = createPiVoiceTurns({
    agent, signal: session.signal, speak: text => spoken.push(text), busy: active => busy.push(active), log: entry => logs.push(entry),
    now: () => 100, ...options,
  });
  const settled = async () => { await new Promise(resolve => setTimeout(resolve, 10)); };
  return { turns, spoken, logs, busy, session, settled };
}

const replying = (...chunks: ConversationAgentChunk[]): PiVoiceAgent => ({
  async *stream() { for (const chunk of chunks) yield chunk; },
});

describe('PI voice turns', () => {
  it('sends the utterance to the PI agent as a voice turn and speaks its answer', async () => {
    const inputs: ConversationAgentInput[] = [];
    const agent: PiVoiceAgent = { async *stream(input) { inputs.push(input); yield 'Two meetings today.'; } };
    const { turns, spoken, logs, busy, settled } = setup(agent);
    turns.start({ ...turn, proactiveContext: 'Jarvis told Dan about a build.' });
    await settled();
    expect(inputs).toEqual([{ messageId: '42', sessionId: '7', text: 'what is next', channel: 'voice', proactiveContext: 'Jarvis told Dan about a build.' }]);
    expect(spoken).toEqual(['Two meetings today.']);
    expect(logs).toEqual([{ outcome: 'ok', transcriptToFirstTextMs: 100, transcriptToDoneMs: 100, acknowledged: false }]);
    expect(busy).toEqual([true, false]);
  });

  it('speaks only the first progress note and never removes matching final text', async () => {
    const { turns, spoken, logs, settled } = setup(replying(
      { type: 'progress', text: 'You have two meetings.' },
      { type: 'progress', text: 'Still checking.' },
      'You have two meetings.',
    ));
    turns.start(turn);
    await settled();
    expect(spoken).toEqual(['You have two meetings.', 'You have two meetings.']);
    expect(logs[0]).toMatchObject({ outcome: 'ok', acknowledged: true });
  });

  it('accepts quiet completion without an empty-reply error', async () => {
    const { turns, spoken, logs, settled } = setup(replying({ type: 'quiet' }));
    turns.start(turn);
    await settled();
    expect(logs[0]).toMatchObject({ outcome: 'ok', acknowledged: false });
    expect(spoken).toEqual([]);
  });

  it('says a failure plainly and never runs another engine', async () => {
    // eslint-disable-next-line require-yield
    const agent: PiVoiceAgent = { async *stream() { throw new PiGatewayError('pi_unavailable', 'PI could not reach Foundry. No other engine was used.'); } };
    const { turns, spoken, logs, settled } = setup(agent);
    turns.start(turn);
    await settled();
    expect(spoken).toEqual(['PI could not reach Foundry. No other engine was used.']);
    expect(logs[0]).toMatchObject({ outcome: 'failed' });
  });

  it('does not let a provider message reach the speaker', async () => {
    // eslint-disable-next-line require-yield
    const agent: PiVoiceAgent = { async *stream() { throw new Error('secret provider detail'); } };
    const { turns, spoken, settled } = setup(agent);
    turns.start(turn);
    await settled();
    expect(spoken).toEqual(['PI could not answer that. No other engine was used.']);
  });

  it('treats an empty answer as a failure instead of speaking silence', async () => {
    const { turns, spoken, logs, settled } = setup(replying('  '));
    turns.start(turn);
    await settled();
    expect(spoken).toEqual(['PI sent no answer. No other engine was used.']);
    expect(logs[0]).toMatchObject({ outcome: 'failed' });
  });

  it('stops a turn at the deadline and says an action may have completed', async () => {
    const agent: PiVoiceAgent = {
      async *stream(_input, _authorization, signal) {
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        yield '';
      },
    };
    const { turns, spoken, logs, settled } = setup(agent, { deadlineMs: 5 });
    turns.start(turn);
    await settled();
    expect(spoken[0]).toContain('An action may already have completed');
    expect(logs[0]).toMatchObject({ outcome: 'timeout' });
  });

  it('finishes the active turn before running a newer one and speaks only the newer answer', async () => {
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const events: string[] = [];
    const agent: PiVoiceAgent = {
      async *stream(input, _authorization, signal) {
        events.push(`start ${input.text}`);
        if (input.text === 'first') {
          firstStarted.resolve();
          await releaseFirst.promise;
          signal.throwIfAborted();
          events.push('first released');
          yield 'First answer.';
          return;
        }
        yield 'Second answer.';
      },
    };
    const { turns, spoken, logs, busy, settled } = setup(agent);
    turns.start({ ...turn, text: 'first' });
    await firstStarted.promise;
    turns.start({ ...turn, text: 'second' });
    releaseFirst.resolve();
    await settled();
    expect(events).toEqual(['start first', 'first released', 'start second']);
    expect(spoken).toEqual(['Second answer.']);
    expect(logs.map(entry => entry.outcome)).toEqual(['ok', 'ok']);
    expect(busy).toEqual([true, false]);
  });

  it('explicitly cancels active and queued turns', async () => {
    const started = Promise.withResolvers<void>();
    const inputs: string[] = [];
    const agent: PiVoiceAgent = {
      async *stream(input, _authorization, signal) {
        inputs.push(input.text);
        started.resolve();
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        yield 'Cancelled answer.';
      },
    };
    const { turns, spoken, logs, settled } = setup(agent);
    turns.start({ ...turn, text: 'first' });
    await started.promise;
    turns.start({ ...turn, text: 'second' });
    turns.cancel();
    await settled();
    expect(inputs).toEqual(['first']);
    expect(logs.map(entry => entry.outcome)).toEqual(['cancelled', 'cancelled']);
    expect(spoken).toEqual([]);
  });

  it('says nothing more when Dan starts speaking while PI is still working', async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const agent: PiVoiceAgent = {
      async *stream(_input, _authorization, signal) {
        started.resolve();
        await finish.promise;
        signal.throwIfAborted();
        yield { type: 'progress', text: 'Working on it.' };
        yield 'Too late.';
      },
    };
    const { turns, spoken, logs, settled } = setup(agent);
    turns.start(turn);
    await started.promise;
    turns.suppressSpeech();
    finish.resolve();
    await settled();
    expect(spoken).toEqual([]);
    expect(logs[0]).toMatchObject({ outcome: 'ok', acknowledged: false });
  });

  it('says nothing when the voice session ends mid-turn', async () => {
    const started = Promise.withResolvers<void>();
    const agent: PiVoiceAgent = {
      async *stream(_input, _authorization, signal) {
        started.resolve();
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        yield '';
      },
    };
    const { turns, spoken, logs, session, settled } = setup(agent);
    turns.start(turn);
    await started.promise;
    session.abort();
    await settled();
    expect(spoken).toEqual([]);
    expect(logs[0]).toMatchObject({ outcome: 'cancelled' });
  });

  it('warms the shared conversation when the agent can, and ignores a warm-up failure', async () => {
    let warmed = 0;
    const agent: PiVoiceAgent = { stream: replying().stream, warm: async () => { warmed += 1; throw new Error('cold'); } };
    const { turns, spoken, settled } = setup(agent);
    turns.warm();
    await settled();
    expect(warmed).toBe(1);
    expect(spoken).toEqual([]);
  });
});

describe('Voice Live session on the PI engine', () => {
  it('has no tools and no catalogue text, only the speech-layer instructions', () => {
    const update = createRealtimeSessionUpdate(createToolRegistry([]), undefined, undefined, [], undefined, undefined, undefined, 'full', undefined, 'pi');
    expect(update.session).not.toHaveProperty('tools');
    expect(update.session).not.toHaveProperty('tool_choice');
    expect(update.session.instructions).toContain('You are only the voice of Jarvis');
    expect(update.session.instructions).not.toContain('find_tools');
    expect(update.session.turn_detection.create_response).toBe(false);
  });
});

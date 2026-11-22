import { EventEmitter } from 'node:events';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import { createPcBridgeModule, PcBridgeConnection, type PcBridgeConnectionOptions } from './bridge.js';

const logger = { info: () => undefined };
const live = () => new AbortController().signal;
const mute = { name: 'media', arguments: { action: 'mute' } } as const;
const tab = { tabId: 'tab_1204118371', snapshotId: '2ed79a11-b638-5283-84d6-a362ee8fc50f' };
const pressEnter = { name: 'browser_act', arguments: { ...tab, action: 'keys', keys: ['Enter'], confirmed: false, closeIntent: false } } as never;
const typeText = { name: 'browser_act', arguments: { ...tab, action: 'type', elementIndex: 0, text: 'calendar' } } as never;

/** The server end of the PC's socket: it records what the backend sends, and the test plays the PC's answers. */
class PcSocket extends EventEmitter {
  readyState = 1;
  readonly sent: { id: string; command: string }[] = [];
  sendError: Error | undefined;

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(JSON.parse(data) as { id: string; command: string });
    callback?.(this.sendError);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', 1005, Buffer.alloc(0));
  }

  /** The PC answers the last command it was sent. */
  answer(message: Record<string, unknown>): void {
    this.emit('message', Buffer.from(JSON.stringify({ id: this.sent.at(-1)!.id, ...message })), false);
  }
}

function connect(options: PcBridgeConnectionOptions = {}) {
  const connection = new PcBridgeConnection(options);
  const socket = new PcSocket();
  connection.attach(socket as never);
  return { connection, socket };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try { await promise; } catch (error) { return error as Error; }
  throw new Error('The command did not fail');
}

describe('a command whose outcome the bridge cannot tell', () => {
  const outcomeUnknown = (error: Error) => error instanceof ToolFailure && error.outcomeUnknown;

  it('is a failure that says it may not have happened when the PC does not answer in time, drops the line or answers unreadably', async () => {
    const { connection: slow } = connect({ timeoutMs: 10 });
    const timedOut = await rejection(slow.execute(mute, live(), logger));
    expect(timedOut.message).toMatch(/may not have happened/u);
    expect(outcomeUnknown(timedOut)).toBe(true);

    const dropped = connect();
    const lost = rejection(dropped.connection.execute(mute, live(), logger));
    dropped.socket.close();
    const disconnected = await lost;
    expect(disconnected.message).toMatch(/may not have happened/u);
    expect(outcomeUnknown(disconnected)).toBe(true);

    const garbled = connect();
    const unreadable = rejection(garbled.connection.execute(mute, live(), logger));
    garbled.socket.answer({ type: 'result', result: { unexpected: true } });
    expect(outcomeUnknown(await unreadable)).toBe(true);
  });

  it('is not marked when the PC itself said the command failed', async () => {
    const { connection, socket } = connect();
    const failed = rejection(connection.execute(mute, live(), logger));
    socket.answer({ type: 'error', error: 'failed' });
    const error = await failed;
    expect(error).toBeInstanceOf(ToolFailure);
    expect(outcomeUnknown(error)).toBe(false);
  });
});

describe('a keystroke the PC refuses', () => {
  it('says what blocked it: Chrome not in front, not a password', async () => {
    const { connection, socket } = connect();
    const keys = rejection(connection.execute(pressEnter, live(), logger));
    socket.answer({ type: 'error', error: 'blocked' });
    const keysError = await keys;
    expect(keysError).toBeInstanceOf(ToolRefusal);
    expect(keysError.message).toBe('Nothing was typed or pressed: Chrome has to be the window in front, and the focused field must not be a sensitive one.');
    expect(keysError.message).not.toMatch(/password/iu);

    const field = rejection(connection.execute(typeText, live(), logger));
    socket.answer({ type: 'error', error: 'blocked' });
    expect((await field).message).toBe('Typing into a password, payment-card, one-time-code, or other sensitive field is blocked.');
  });
});

describe('codex_prompt', () => {
  const owner = '11111111-2222-4333-8444-555555555555';
  const request = { log: logger, agentPrincipal: null, principal: { objectId: owner }, server: { ownerObjectId: owner } } as unknown as FastifyRequest;

  function setup() {
    const module = createPcBridgeModule({ pcActPlanner: { decide: async () => { throw new Error('unused'); } } as never });
    const socket = new PcSocket();
    module.connection.attach(socket as never);
    return { codex: module.tools.find((tool) => tool.name === 'codex_prompt')!, connection: module.connection, socket };
  }

  it('refuses a prompt the PC goal rules refuse before it opens Codex', async () => {
    const { codex, connection, socket } = setup();
    expect(await rejection(codex.execute({ prompt: 'What are the key goals for 2026?' }, request, live()) as Promise<unknown>)).toBeInstanceOf(ToolRefusal);
    expect(socket.sent).toEqual([]);
    await connection.close();
  });

  it('opens Codex first for a prompt that passes', async () => {
    const { codex, connection, socket } = setup();
    const running = rejection(codex.execute({ prompt: 'Summarise the open pull requests in dan/jarvis' }, request, live()) as Promise<unknown>);
    await vi.waitFor(() => expect(socket.sent.map((sent) => sent.command)).toEqual(['open_app']));
    await connection.close();
    expect(await running).toBeInstanceOf(ToolFailure);
  });
});

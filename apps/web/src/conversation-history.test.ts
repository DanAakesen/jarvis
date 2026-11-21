// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientFailureCopy, failureCopy } from '@jarvis/contracts';

vi.mock('./backend-request', () => ({ backendFetch: vi.fn(), awaitWithSignal: vi.fn() }));

import { backendFetch } from './backend-request';
import { ChatTurnError, sendChatTurn } from './conversation-history';

const config = { tenantId: 't', webClientId: 'c', apiScope: 's', backendUrl: 'https://backend.example' };
const session = { id: '7' };
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const user = frame('user', { id: '42', sessionId: '7', role: 'dan', text: 'hi', model: null, at: '2026-11-21T10:00:00.000Z' });
const reply = frame('done', { id: '43', sessionId: '7', role: 'jarvis', text: 'Hello', model: 'pi', at: '2026-11-21T10:00:01.000Z' });

function stream(...frames: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) { for (const text of frames) controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

async function send(...frames: string[]) {
  vi.mocked(backendFetch).mockResolvedValueOnce(stream(...frames));
  return sendChatTurn(async () => 'token', config, session, 'hi', () => {}, () => {});
}

beforeEach(() => { vi.mocked(backendFetch).mockReset(); });

describe('a chat turn on the web', () => {
  it('stays a success when an error frame follows the saved reply', async () => {
    const message = await send(user, reply, frame('error', { error: failureCopy.stopped.chat }));
    expect(message).toMatchObject({ id: '43', text: 'Hello' });
  });

  it('shows the plain sentence of a PI failure and never its code', async () => {
    const failure = await send(user, frame('error', { error: failureCopy.service_busy.chat, code: 'pi_unavailable' })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatTurnError);
    expect((failure as ChatTurnError).message).toBe(failureCopy.service_busy.chat);
    expect((failure as ChatTurnError).code).toBeUndefined();
  });

  it('never shows words the server did not choose', async () => {
    const failure = await send(user, frame('error', { error: 'PI asked for an approval the gateway does not answer.', code: 'pi_failed' })).catch((error: unknown) => error);
    expect((failure as ChatTurnError).message).toBe(failureCopy.cut_off.chat);
  });

  it('says plainly that it could not read a broken stream', async () => {
    await expect(send(user, 'event: done\ndata: {broken\n\n')).rejects.toThrow(clientFailureCopy.unreadable_reply.chat);
  });

  it('says plainly that the connection was lost when the stream ends before anything arrives', async () => {
    await expect(send()).rejects.toThrow(clientFailureCopy.lost_connection.chat);
  });

  it('says plainly that the message could not be sent, without a status code', async () => {
    vi.mocked(backendFetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(sendChatTurn(async () => 'token', config, session, 'hi', () => {}, () => {})).rejects.toThrow(clientFailureCopy.not_sent.chat);
  });

  it('treats the busy answer as a message that was not accepted', async () => {
    vi.mocked(backendFetch).mockResolvedValueOnce(Response.json({ error: failureCopy.still_answering.chat }, { status: 409 }));
    const failure = await sendChatTurn(async () => 'token', config, session, 'hi', () => {}, () => {}).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: failureCopy.still_answering.chat, delivery: 'not_accepted' });
  });
});

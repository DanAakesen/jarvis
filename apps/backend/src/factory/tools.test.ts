import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ToolRefusal } from '../core/tool-registry.js';
import { factoryTools } from './tools.js';

const start = factoryTools.find(({ name }) => name === 'start_issue')!;
const caught = (work: Promise<unknown>) => work.then(() => undefined, (error: unknown) => error);
const dan = { id: '100', sessionId: 'session', role: 'dan', text: 'Start issue 12.', model: null, at: new Date() };

function startRequest(readIssue: () => Promise<unknown>): FastifyRequest {
  return {
    headers: {}, principal: {}, jarvisConversationMessage: dan,
    server: {
      projectStore: { list: async () => [{ id: '1', name: 'Jarvis', repo: 'DanAakesen/jarvis', active: true }] },
      taskStore: { findActiveByIssue: async () => null },
      githubIssueClient: { readIssue },
    },
  } as unknown as FastifyRequest;
}

describe('start_issue', () => {
  it('says what starting an issue needs when Dan’s message cannot be verified', async () => {
    const request = { headers: {}, server: {} } as unknown as FastifyRequest;
    const error = await caught(start.execute({ issue: 12 }, request, new AbortController().signal));
    expect(error).toBeInstanceOf(ToolRefusal);
    expect((error as Error).message).toBe('A verified Dan message is required to confirm this issue start.');
  });

  it('lets the caller’s own cancel through when the GitHub read is interrupted', async () => {
    const controller = new AbortController();
    const cancelled = new DOMException('This operation was aborted', 'AbortError');
    const request = startRequest(async () => { controller.abort(); throw cancelled; });
    expect(await caught(start.execute({ issue: 12 }, request, controller.signal))).toBe(cancelled);
  });

  it('says why an issue cannot be started, instead of calling it an outage', async () => {
    const request = startRequest(async () => ({ isPullRequest: false, state: 'open', title: 'Slow search', body: '' }));
    const error = await caught(start.execute({ issue: 12 }, request, new AbortController().signal));
    expect(error).toBeInstanceOf(ToolRefusal);
    expect((error as Error).message).toBe('I can’t use this issue; it needs a title of at most 200 characters and a text of at most 50,000 bytes, and neither may be empty. Nothing was written.');
  });
});

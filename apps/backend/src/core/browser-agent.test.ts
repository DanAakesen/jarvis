import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createBrowserAgent, createJevBrowserPlanner, type BrowserJevPlanner, type BrowserSnapshot, type BrowserTextModel } from './browser-agent.js';
import { ToolRefusal } from './tool-registry.js';

const live = () => new AbortController().signal;
const snapshot = { tabId: 'tab_1', snapshotId: '2ed79a11-b638-5283-84d6-a362ee8fc50f', title: 'Wikipedia', url: 'https://en.wikipedia.org/', elements: [] } as BrowserSnapshot;

async function refusal(promise: Promise<unknown>): Promise<ToolRefusal> {
  try { await promise; } catch (error) { if (error instanceof ToolRefusal) return error; throw error; }
  throw new Error('The call was not refused');
}

describe('the browser planner refuses a goal that mentions a password or a card, and says which word it found', () => {
  const planner = createJevBrowserPlanner(async () => undefined);
  const decide = (goal: string) => planner.decide({ goal, step: 1, previousActions: [], snapshot }, live());

  it('names the word', async () => {
    expect((await refusal(decide('Search Wikipedia for a memory card for my camera and click Search'))).message).toBe(
      'The goal mentions "card", and I do not work with passwords, payment cards or one-time codes, so I stopped before acting on the page.',
    );
    expect((await refusal(decide('Open the password manager'))).message).toContain('"password"');
  });

  it('still gives no decision for an empty goal or when no decision provider is available', async () => {
    await expect(decide('   ')).resolves.toBeNull();
    await expect(decide('Click the Search button')).resolves.toBeNull();
  });
});

describe('a browser task that cannot start says why and what to do', () => {
  const owner = '11111111-2222-4333-8444-555555555555';
  const idle: BrowserJevPlanner = { decide: async () => null };
  const text: BrowserTextModel = { generateText: async () => null, verifyCompletion: async () => false };

  function run(tools: Record<string, unknown>, input: { goal: string; url?: string }) {
    const request = {
      log: { info: () => undefined }, agentPrincipal: null, principal: { objectId: owner },
      server: { ownerObjectId: owner, workspaceCommands: {}, jarvisTools: { get: (name: string) => ({ execute: async () => tools[name] }) } },
    } as unknown as FastifyRequest;
    return createBrowserAgent(idle, text).runTask(input, request, live());
  }

  it('the page opened but the Chrome extension is not connected: a refusal, not something that reads like a success', async () => {
    const error = await refusal(run(
      { pc_open: { opened: true, note: 'Opened in Chrome directly because the Jarvis Chrome extension isn\'t connected.' } },
      { goal: 'Click the Search button', url: 'https://en.wikipedia.org/wiki/Main_Page' },
    ));
    expect(error.message).toBe('The page was opened, but the Jarvis Chrome extension is not connected, so I cannot read or control it.');
  });

  it('Chrome has no single focused tab: it says how to choose one', async () => {
    const tabs = ['tab_1', 'tab_2'].map((id) => ({ id, title: `Page ${id}`, url: `https://example.com/${id}`, focused: false }));
    const error = await refusal(run({ pc_browser_tabs: { tabs, nextOffset: null } }, { goal: 'Click the Search button' }));
    expect(error.message).toBe(
      'Chrome has no single focused tab, so I cannot tell which one to use. Give the url to open, or the tabId of a tab listed by pc_browser_tabs.',
    );
  });
});

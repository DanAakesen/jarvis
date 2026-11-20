import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createPiAuth } from '../../auth/pi-credential.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import { createPiArea } from '../area.js';
import { memoryVault } from '../brain/brain.testkit.js';
import { createPiRoutes } from '../routes.js';
import { createMemoryPiStore } from '../store.js';
import { createPiTurnRegistry } from '../turns.js';
import { createWatchTools } from './tools.js';
import { createWatches } from './store.js';
import { completionPlan } from '../completion.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const secret = 'A'.repeat(43);
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const live = () => new AbortController().signal;

function setup() {
  const now = () => new Date('2026-11-16T10:00:00Z');
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const vault = memoryVault();
  const store = createMemoryPiStore(now);
  const watches = createWatches({ area: createPiArea({ vault }), store, now });
  const memoryStore = { getSourceMessage: async (id: string) => id === '41' ? { id, text: 'Please keep me updated on the deploy of main, every half hour.', role: 'dan' } : null };
  const app = buildApp(config, undefined, {
    modules: [coreModule, { id: 'pi', tools: createWatchTools({ watches, registry, memoryStore: memoryStore as never }), registerRoutes: createPiRoutes({ gateway: { stream: async function* () {} } as never, registry, auth, monthlyCapDkk: 250 }) }],
    auth: async () => { throw new Error('rejected'); },
    toolCallStore: { record: async () => {} },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  async function tool(name: string, args: Record<string, unknown>) {
    id += 1;
    const response = await app.inject({
      method: 'POST', url: '/pi/mcp', remoteAddress: '10.0.0.9',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: bearer(`jp.${secret}`) },
      payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    });
    const line = response.body.split('\n').find((candidate) => candidate.startsWith('data:'))!;
    return JSON.parse(JSON.parse(line.slice(5)).result.content[0].text) as { outcome: string; result: Record<string, unknown> };
  }
  const chat = () => registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '41', signal: live() });
  const wake = () => registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', brain: { runId: 'run-1', sent: [], wrote: [], looked: [] }, signal: live() });
  const run = async (grant: ReturnType<typeof chat>, name: string, args: Record<string, unknown>) => {
    await tool('find_tools', { turn: grant.turn, query: name.replace('_', ' ') });
    return tool('call_tool', { turn: grant.turn, name, arguments: args });
  };
  return { run, chat, wake, vault, watches };
}

describe('watch tools: chat quotes Dan, a wake acts on its own', () => {
  it('opens a watch from Dan\'s stored message, quoting his words, and lists and changes it', async () => {
    const t = setup();
    const grant = t.chat();
    grant.completion = completionPlan('Please keep me updated on the deploy of main, every half hour.');
    const created = await t.run(grant, 'watch_create', { title: 'Deploy of main', text: 'Tell me when green. Look every half hour.', nextLook: '2026-11-16T10:30:00Z' });
    expect(created).toMatchObject({ outcome: 'ok', result: { created: true, name: 'Deploy of main' } });
    expect(t.vault.files.get('PI/Watches/Deploy of main.md')).toContain('keep me updated on the deploy of main');
    const listed = await t.run(grant, 'watch_list', {});
    expect((listed.result.watches as Array<{ name: string }>).map(({ name }) => name)).toEqual(['Deploy of main']);
    grant.completion = completionPlan('Update the Deploy of main watch to every hour.');
    expect(grant.completion.requirements).toEqual([
      expect.objectContaining({ domain: 'jobs', operation: 'update', kind: 'committed' }),
    ]);
    expect((await t.run(grant, 'watch_update', { name: 'Deploy of main', change: 'every hour instead', nextLook: '2026-11-16T11:00:00Z' })).outcome).toBe('ok');
    expect(t.vault.files.get('PI/Watches/Deploy of main.md')).toContain('changed: every hour instead');
    grant.completion = completionPlan('Stop the Deploy of main watch.');
    expect(grant.completion.requirements).toEqual([
      expect.objectContaining({ domain: 'jobs', operation: 'delete', kind: 'committed' }),
    ]);
    expect((await t.run(grant, 'watch_stop', { name: 'Deploy of main', reason: 'Dan said stop' })).outcome).toBe('ok');
    expect(t.vault.files.has('PI/Watches/Closed/Deploy of main.md')).toBe(true);
  });

  it('refuses a malformed time, and a chat message that is not Dan\'s stored message', async () => {
    const t = setup();
    expect((await t.run(t.chat(), 'watch_create', { title: 'A', text: 'x', nextLook: 'tomorrow' })).outcome).toBe('refused');
    const forged = t.chat();
    (forged as { messageId: string }).messageId = '99';
    expect((await t.run(forged, 'watch_create', { title: 'A', text: 'x' })).outcome).toBe('refused');
    expect([...t.vault.files.keys()]).toEqual([]);
  });

  it('lets a wake open, change, look at and stop a watch on its own', async () => {
    const t = setup();
    await t.watches.create({ title: 'Price', text: 'Watch the price.', nextLook: new Date('2026-11-16T10:30:00Z') }, live());
    const grant = t.wake();
    expect((await t.run(grant, 'watch_create', { title: 'Own idea', text: 'Watch the Friday deploy.' })).outcome).toBe('ok');
    expect((await t.run(grant, 'watch_update', { name: 'Price', change: 'every hour' })).outcome).toBe('ok');
    const look = await t.run(grant, 'watch_look', { name: 'Price', result: 'unchanged at 99', nextLook: '2026-11-16T14:00:00Z' });
    expect(look).toMatchObject({ outcome: 'ok', result: { recorded: true, nextLook: '2026-11-16T14:00:00.000Z' } });
    expect(grant.brain!.looked).toEqual(['Price']);
    expect((await t.run(grant, 'watch_look', { name: 'Price', result: 'x', nextLook: 'soon' })).outcome).toBe('refused');
    expect((await t.run(grant, 'watch_stop', { name: 'Price', reason: 'stop condition met' })).outcome).toBe('ok');
    expect(grant.brain!.wrote).toEqual(['PI/Watches/Closed/Price.md']);
    expect([...t.vault.files.keys()].sort()).toEqual(['PI/Watches/Closed/Price.md', 'PI/Watches/Own idea.md']);
    expect(t.vault.files.get('PI/Watches/Own idea.md')).not.toContain('> Dan,');
  });

  it('hides watch_look from chat and refuses it there', async () => {
    const t = setup();
    const grant = t.chat();
    grant.discovered.add('watch_look');
    expect((await t.run(grant, 'watch_look', { name: 'x', result: 'x', nextLook: 'none' })).outcome).toBe('refused');
  });
});

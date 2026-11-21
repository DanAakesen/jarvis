import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { coreModule } from '../../../core/index.js';
import { ToolFailure } from '../../../core/tool-registry.js';
import { createPcBridgeModule } from '../../../pc-bridge/bridge.js';
import { executeCase, turnKindFor } from '../callable.testkit.js';
import { buildConformanceWorld } from '../world.testkit.js';
import type { ToolCase } from '../types.testkit.js';
import { FakePc } from './pc-fake.testkit.js';
import { pcGroup, pcWorldOf } from './pc.testkit.js';

/**
 * Dan's PC is the one dependency the PC tools cannot do without, so every tool that reaches it must answer a typed,
 * plain-English refusal or failure (never the generic "Tool execution failed") when the PC is offline, drops mid-command,
 * sends its generic error, or sends something unreadable. The group's fake PC fails the way a real one does while the
 * matching token is in `context.down` (see pc.testkit.ts).
 */
const world = await buildConformanceWorld({ groups: [() => ({ id: 'core', covers: [], modules: [coreModule] }), pcGroup] });
afterAll(async () => { await world.close(); });

const group = world.groups.find((entry) => entry.id === 'pc')!;
const firstCase = (name: string): ToolCase => group.cases?.[name]?.[0] ?? { label: 'generated', arguments: name === 'pc_media' ? { action: 'play_pause' } : {} };

/** Every tool that talks to the PC; the camera watches do not. */
const pcTools = ['browser_do', 'browser_do_shared', 'codex_prompt', 'pc_act', 'pc_active_window', 'pc_browser_act', 'pc_browser_snapshot',
  'pc_browser_tabs', 'pc_clipboard_read', 'pc_clipboard_write', 'pc_close', 'pc_media', 'pc_open'];
const browserTools = ['browser_do', 'pc_browser_act', 'pc_browser_snapshot', 'pc_browser_tabs'];

/** `browser_do_shared` only reaches the PC in a chat turn that shares a tab; its second case is that turn. */
const caseFor = (name: string): ToolCase => name === 'browser_do_shared' ? group.cases!.browser_do_shared![1]! : firstCase(name);

async function failing(name: string, token: string) {
  const tool = world.app.jarvisTools.get(name)!;
  world.context.down.add(token);
  try {
    const { arguments: args, ownerMessage } = caseFor(name);
    return await executeCase(world, tool, turnKindFor(name), { label: token, arguments: args, ...(ownerMessage ? { ownerMessage } : {}) });
  } finally {
    world.context.down.delete(token);
  }
}

const asked = async (name: string, args: Record<string, unknown>, ownerMessage: string) =>
  executeCase(world, world.app.jarvisTools.get(name)!, turnKindFor(name), { label: 'asked', arguments: args, ownerMessage });

describe('the PC tools fail cleanly when Dan’s PC is not there', () => {
  it('knows every tool of the PC and browser modules', () => {
    const names = group.modules.filter((module) => module.id === 'pc-bridge' || module.id === 'browser-agent').flatMap((module) => module.tools.map((tool) => tool.name));
    expect(names.sort()).toEqual([...pcTools].sort());
  });

  it.each(pcTools)('%s refuses when the PC is offline', async (name) => {
    const done = await failing(name, 'pc-bridge');
    expect(done.outcome).toBe('refused');
    expect(done.message).toMatch(/offline/iu);
  });

  it.each(pcTools)('%s fails with a plain message when the PC drops mid-command', async (name) => {
    const done = await failing(name, 'pc-bridge-drops');
    expect(done.outcome).toBe('error');
    expect(done.message).toMatch(/disconnected/iu);
  });

  it.each(pcTools)('%s fails with a plain message when the PC answers its generic error', async (name) => {
    const done = await failing(name, 'pc-bridge-failing');
    expect(done.outcome).toBe('error');
    expect(done.message).toMatch(/could not complete/iu);
  });

  it.each(pcTools)('%s fails with a plain message when the PC answers something unreadable', async (name) => {
    const done = await failing(name, 'pc-bridge-garbled');
    expect(done.outcome).toBe('error');
    expect(done.message).toMatch(/could not read/iu);
  });

  it.each(browserTools)('%s says so when the Chrome extension is off in the bridge settings', async (name) => {
    const done = await failing(name, 'pc-chrome');
    expect(done.outcome).toBe('refused');
    expect(done.message).toMatch(/Chrome/u);
  });
});

describe('a PC that stops answering', () => {
  it('fails the command with a plain message once the bridge stops waiting', async () => {
    const bridge = createPcBridgeModule({ timeoutMs: 30 });
    const pc = new FakePc(bridge.connection);
    pc.mode = 'silent';
    pc.attach();
    const open = bridge.tools.find((tool) => tool.name === 'pc_open')!;
    const request = { log: { info: () => {} } } as unknown as FastifyRequest;
    const failure = await open.execute({ target: 'app', value: 'Spotify' }, request, new AbortController().signal).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as ToolFailure).message).toMatch(/did not answer in time/u);
    await bridge.connection.close();
  });
});

describe('the PC tools turn what the PC says no to into a plain refusal', () => {
  it.each([
    ['pc_close', { app: 'Fax Machine' }, 'Close the fax machine app.', /No open window of that app was found/u],
    ['pc_open', { target: 'app', value: 'Does Not Exist' }, 'Open Does Not Exist on my PC.', /No installed app matched/u],
    ['pc_open', { target: 'app', value: 'Code' }, 'Open Code on my PC.', /More than one installed app matches/u],
    ['pc_open', { target: 'folder', value: 'jarvis/missing' }, 'Open the missing folder.', /was not found/u],
    ['pc_browser_snapshot', { tabId: 'tab-999' }, 'What is on tab 999?', /Chrome target cannot be verified/u],
    ['pc_browser_act', { tabId: 'tab-101', snapshotId: '00000000-0000-4000-8000-000000000001', action: 'click', elementIndex: 0 }, 'Click the first link.', /stale/u],
  ] as const)('%s %j', async (name, args, ownerMessage, message) => {
    const done = await asked(name, { ...args }, ownerMessage);
    expect(done.outcome).toBe('refused');
    expect(done.message).toMatch(message);
  });
});

describe('pc_act on an app UI Automation cannot read', () => {
  it('clicks the control the vision model found', async () => {
    expect((await asked('pc_open', { target: 'app', value: 'Paint' }, 'Open Paint on my PC.')).outcome).toBe('ok');
    const done = await asked('pc_act', { goal: 'Click the Brush tool' }, 'Pick the brush tool in Paint.');
    expect(done.outcome).toBe('ok');
    expect(done.result).toMatchObject({ status: 'completed', steps: 2 });
    expect(pcWorldOf(world.context).pc.commands.map((entry) => entry.command)).toContain('click_point');
  });
});

describe('the camera watch tools reach the vision model', () => {
  it('watch_for sets what the next frame is judged against and stop_watching_for clears it', async () => {
    const { visionWatch, vision } = pcWorldOf(world.context);
    const watchFrame = () => visionWatch.watch({
      sessionId: world.context.ownerMessage.sessionId, source: 'camera', image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), limitUsd: 5,
      signal: new AbortController().signal, log: () => {},
    });
    const run = (name: string, args: Record<string, unknown>) =>
      executeCase(world, world.app.jarvisTools.get(name)!, 'chat', { label: name, arguments: args, ownerMessage: 'Watch my camera and tell me when a package arrives.' });

    expect((await run('watch_for', { source: 'camera', what: 'a parcel at the front door' })).outcome).toBe('ok');
    const seen = await watchFrame();
    expect(vision.calls.at(-1)?.watch?.instructions).toEqual(['a parcel at the front door']);
    expect(seen.speak).toBe('A parcel just arrived at the door.');

    expect((await run('stop_watching_for', { source: 'camera' })).outcome).toBe('ok');
    await watchFrame();
    expect(vision.calls.at(-1)?.watch?.instructions).toEqual([]);
  });
});


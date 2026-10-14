import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '../core/tool-registry.js';
import { GMAIL_DIRECT_ACCESS_REASON } from '../core/gmail-access-policy.js';
import { createPcBridgeModule } from './bridge.js';
import type { PcActPlanner } from './pc-act.js';

const snapshotId = '1730aa51-f380-4df9-a345-1feb862cb1c4';
const signal = () => new AbortController().signal;
const request = () => ({
  headers: { 'x-jarvis-message-id': '1' }, agentPrincipal: { objectId: 'fixture-agent' },
  server: { ownerObjectId: 'fixture-owner' }, log: { info: vi.fn() },
}) as unknown as FastifyRequest;

function fixture(options: Parameters<typeof createPcBridgeModule>[0] = {}) {
  let gmail = true;
  let gmailTitle = true;
  let application = 'chrome';
  let nativeTitle = '';
  const planner = { decide: vi.fn<PcActPlanner['decide']>(async () => ({ operation: 'done', confidence: 0.99 })) };
  const module = createPcBridgeModule({ pcActPlanner: planner, ...options });
  const execute = vi.spyOn(module.connection, 'execute').mockImplementation(async (command) => {
    if (command.name === 'browser_tabs') return { tabs: [{
      id: 'tab_1', title: gmail ? 'Inbox - Gmail' : 'Search',
      url: gmail ? 'https://mail.google.com/mail/u/0' : 'https://example.test/', focused: true,
    }], nextOffset: null };
    if (command.name === 'browser_snapshot') return {
      tabId: 'tab_1', snapshotId, title: gmail ? 'Inbox - Gmail' : 'Search',
      url: gmail ? 'https://mail.google.com/mail/u/0' : 'https://example.test/',
      elements: [{ index: 0, role: 'button', name: 'Synthetic control', value: '' }],
    };
    if (command.name === 'active_window') return { title: nativeTitle ||
      (gmail && gmailTitle ? 'Inbox - Gmail - Google Chrome' : 'Search - Google Chrome') };
    if (command.name === 'uia_snapshot') return {
      snapshotId, application, elements: [{ index: 0, role: 'button', name: 'Synthetic control' }],
    };
    if (command.name === 'browser_act') return { acted: true, action: command.arguments.action };
    if (command.name === 'uia_act') return { acted: true, action: command.arguments.action };
    if (command.name === 'open_app') return { opened: true, app: command.arguments.app };
    if (command.name === 'clipboard_read') return { text: 'Synthetic clipboard.' };
    throw new Error(`Unexpected fixture command ${command.name}`);
  });
  return { execute, planner, registry: createToolRegistry([module]),
    setGmail: (value: boolean) => { gmail = value; },
    setGmailTitle: (value: boolean) => { gmailTitle = value; },
    setNative: (process: string, title: string) => { application = process; nativeTitle = title; } };
}

describe('actual raw PC registry Gmail boundary', () => {
  it('guards real Chrome process identity before exporting a Windows tree to a planner', async () => {
    const f = fixture();
    await expect(f.registry.get('pc_act')!.execute({ goal: 'Find the booking dates' }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.map(([command]) => command.name)).toEqual(['uia_snapshot', 'active_window']);
    expect(f.planner.decide).not.toHaveBeenCalled();
  });

  it('preserves unrelated Chrome Windows control with observed non-Gmail metadata', async () => {
    const f = fixture();
    f.setGmail(false);
    await expect(f.registry.get('pc_act')!.execute({ goal: 'Find the answer' }, request(), signal()))
      .resolves.toMatchObject({ status: 'completed' });
    expect(f.planner.decide).toHaveBeenCalledOnce();
  });

  it.each(['index.ts', 'gmail-access-policy.ts'])('allows actual vscode tests with native title %s', async (file) => {
    const f = fixture();
    f.setNative('vscode', `${file} - jarvis - Visual Studio Code`);
    await expect(f.registry.get('pc_act')!.execute({ goal: 'Run the tests' }, request(), signal()))
      .resolves.toMatchObject({ status: 'completed' });
    expect(f.planner.decide).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'browser_tabs')).toHaveLength(0);
  });

  it('preserves native actions and clipboard/window metadata for a Gmail-named source file', async () => {
    const f = fixture();
    const title = 'gmail-access-policy.ts - jarvis - Visual Studio Code';
    f.setNative('vscode', title);
    f.planner.decide.mockResolvedValueOnce({ operation: 'click', confidence: 0.99, targetIndex: 0 });
    await f.registry.get('pc_act')!.execute({ goal: 'Run the tests' }, request(), signal());
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'uia_act')).toHaveLength(1);
    await expect(f.registry.get('pc_active_window')!.execute({}, request(), signal()))
      .resolves.toEqual({ title });
    await expect(f.registry.get('pc_clipboard_read')!.execute({}, request(), signal()))
      .resolves.toEqual({ text: 'Synthetic clipboard.' });
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'browser_tabs')).toHaveLength(0);
  });

  it('guards a Gmail URL behind a generic Chrome window title before planner or vision export', async () => {
    const vision = { locateElements: vi.fn(async () => []) };
    const f = fixture({ pcActVisionModel: vision });
    f.setGmailTitle(false);
    await expect(f.registry.get('pc_act')!.execute({ goal: 'Find the booking dates' }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.map(([command]) => command.name))
      .toEqual(['uia_snapshot', 'active_window', 'browser_tabs']);
    expect(f.planner.decide).not.toHaveBeenCalled();
    expect(vision.locateElements).not.toHaveBeenCalled();
  });

  it('rechecks site metadata before a Windows action if the site changes during planning', async () => {
    const f = fixture();
    f.setGmail(false);
    f.planner.decide.mockImplementation(async () => {
      f.setGmail(true);
      return { operation: 'click', confidence: 0.99, targetIndex: 0 };
    });
    await expect(f.registry.get('pc_act')!.execute({ goal: 'Click the control' }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'uia_act')).toHaveLength(0);
  });

  it('refuses a native-to-Chrome Gmail switch before dispatching a stale native action', async () => {
    const f = fixture();
    f.setNative('vscode', 'gmail-access-policy.ts - jarvis - Visual Studio Code');
    f.planner.decide.mockImplementation(async () => {
      f.setNative('chrome', 'Search - Google Chrome');
      return { operation: 'click', confidence: 0.99, targetIndex: 0 };
    });
    await expect(f.registry.get('pc_act')!.execute({ goal: 'Run the tests' }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'uia_act')).toHaveLength(0);
  });

  it('guards the Codex PC executor if opening Codex leaves the foreground on Gmail', async () => {
    const f = fixture();
    await expect(f.registry.get('codex_prompt')!.execute({ prompt: 'Write a unit test.' }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.map(([command]) => command.name)).toEqual(['open_app', 'uia_snapshot', 'active_window']);
    expect(f.planner.decide).not.toHaveBeenCalled();
  });
  it('refuses opaque Gmail snapshot IDs before reading private controls', async () => {
    const f = fixture();
    await expect(f.registry.get('pc_browser_snapshot')!.execute({ tabId: 'tab_1' }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.map(([command]) => command.name)).toEqual(['browser_tabs']);
  });

  it.each([
    { action: 'click', elementIndex: 0 }, { action: 'type', elementIndex: 0, text: 'Synthetic text' },
    { action: 'select', elementIndex: 0, value: 'Synthetic choice' },
    { action: 'scroll', elementIndex: 0, direction: 'down' },
    { action: 'wait', elementIndex: 0, waitMs: 1 },
    { action: 'type_focused', text: 'Synthetic text' },
    { action: 'keys', keys: ['Ctrl+L'], closeIntent: false, requiresConfirmation: false },
  ])('guards the observed opaque Gmail target before $action', async (action) => {
    const f = fixture();
    await expect(f.registry.get('pc_browser_act')!.execute({ tabId: 'tab_1', snapshotId, ...action }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.map(([command]) => command.name)).toEqual(['browser_tabs']);
  });

  it('permits unrelated raw snapshots/actions and rechecks a later Gmail navigation', async () => {
    const f = fixture();
    f.setGmail(false);
    await f.registry.get('pc_browser_snapshot')!.execute({ tabId: 'tab_1' }, request(), signal());
    await f.registry.get('pc_browser_act')!.execute({ tabId: 'tab_1', snapshotId, action: 'click', elementIndex: 0 }, request(), signal());
    f.setGmail(true);
    await expect(f.registry.get('pc_browser_act')!.execute({ tabId: 'tab_1', snapshotId, action: 'click', elementIndex: 0 }, request(), signal()))
      .rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'browser_act')).toHaveLength(1);
  });

  it('rechecks the actual site before confirmed dispatch without replacing the original snapshot', async () => {
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => {
      f.setGmail(true);
      return action();
    });
    const f = fixture({ runConfirmed });
    f.setGmail(false);
    const execute = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (command, commandSignal, logger) => command.name === 'browser_act'
      ? { confirmationRequired: true, actionKind: 'computer_use', summary: 'Synthetic irreversible action.' }
      : execute(command, commandSignal, logger));
    await f.registry.get('pc_browser_snapshot')!.execute({ tabId: 'tab_1' }, request(), signal());
    await expect(f.registry.get('pc_browser_act')!.execute({
      tabId: 'tab_1', snapshotId, action: 'click', elementIndex: 0,
    }, request(), signal())).rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(runConfirmed).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'browser_act')).toHaveLength(1);
    expect(f.execute.mock.calls.filter(([command]) => command.name === 'browser_snapshot')).toHaveLength(1);
  });

  it.each(['pc_active_window', 'pc_clipboard_read'])('does not export Gmail through %s', async (name) => {
    const f = fixture();
    await expect(f.registry.get(name)!.execute({}, request(), signal())).rejects.toThrow(GMAIL_DIRECT_ACCESS_REASON);
    expect(f.execute.mock.calls.map(([command]) => command.name)).toEqual(['active_window']);
  });
});

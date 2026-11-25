import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolFailure } from './tool-registry.js';
import { isWorkspaceReflexOperation, workspaceCommandTool, WorkspaceCommandBroker } from './workspace-commands.js';

describe('a workspace command that may already have been applied', () => {
  const owner = 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef';
  const layout = () => ({ commandId: randomUUID(), operation: 'layout', arrangement: 'tiled' }) as const;
  const failure = (work: Promise<void>) => work.then(() => undefined, (error: unknown) => error as Error);
  afterEach(() => { vi.useRealTimers(); });

  /** The broker with one signed-in tab; `received` holds what the tab was sent, and the tab answers only when the test says so. */
  function oneTab() {
    const received: { commandId: string }[] = [];
    const broker = new WorkspaceCommandBroker();
    const tab = broker.connect(owner, (...[, data]) => { received.push((data as { command: { commandId: string } }).command); return true; });
    return { broker, tab, received };
  }

  it('is marked when the caller cancels it: the tab may have applied it', async () => {
    const { broker } = oneTab();
    const controller = new AbortController();
    const pending = failure(broker.execute(owner, layout(), controller.signal));
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(ToolFailure);
    expect(error).toMatchObject({ outcomeUnknown: true });
    expect(error.message).toMatch(/may already have applied it/u);
  });

  it('is marked when the tab does not answer within 10 seconds', async () => {
    vi.useFakeTimers();
    const { broker } = oneTab();
    const pending = failure(broker.execute(owner, layout(), new AbortController().signal));
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await pending;
    expect(error).toMatchObject({ outcomeUnknown: true });
    expect(error.message).toMatch(/did not acknowledge the command within 10 seconds; it may already have been applied/u);
  });

  it('is marked when the tab goes away before it answers', async () => {
    const { broker, tab } = oneTab();
    const pending = failure(broker.execute(owner, layout(), new AbortController().signal));
    tab.close();
    const error = await pending;
    expect(error).toMatchObject({ outcomeUnknown: true });
    expect(error.message).toMatch(/disconnected before acknowledging the command; it may already have been applied/u);
  });

  it('is not marked when the tab says it could not apply the command: that is its own claim', async () => {
    const { broker, tab, received } = oneTab();
    const pending = failure(broker.execute(owner, layout(), new AbortController().signal));
    broker.acknowledge(owner, tab.sessionId, received[0]!.commandId, false, 'The workspace failed while applying the command.', 'error');
    const error = await pending;
    expect(error).toBeInstanceOf(ToolFailure);
    expect(error).toMatchObject({ outcomeUnknown: false });
    expect(error.message).toBe('The workspace failed while applying the command.');
  });
});

describe('session commands', () => {
  it('counts only voice and camera as session reflexes', () => {
    expect(isWorkspaceReflexOperation({ operation: 'session', action: 'language', value: 'da' })).toBe(false);
    for (const action of ['voice', 'camera']) expect(isWorkspaceReflexOperation({ operation: 'session', action })).toBe(true);
  });

  it('offers the model no language change in the schema it reads', () => {
    const { action, value } = (workspaceCommandTool.inputSchema as { properties: Record<string, { enum: string[] }> }).properties;
    expect(action!.enum).not.toContain('language');
    expect(value!.enum).not.toContain('da');
    expect(value!.enum).not.toContain('en');
  });
});

describe('relative Voice window commands', () => {
  it('uses the phone selection even when a desktop reported last and delivers a retried close only once', async () => {
    const broker = new WorkspaceCommandBroker();
    const received: string[] = [];
    const phone = broker.connect('owner', (event, data) => {
      if (event === 'workspace-command') received.push(data.command.commandId);
      return true;
    });
    const desktop = broker.connect('owner', () => { throw new Error('unexpected desktop delivery'); });
    const snapshot = { windows: [], contextPanelOpen: false };
    broker.updateSnapshot('owner', phone.sessionId, { ...snapshot, device: { kind: 'phone' } });
    broker.updateSnapshot('owner', desktop.sessionId, { ...snapshot, device: { kind: 'desktop' } });
    const command = { commandId: 'close-current', operation: 'voice-window', action: 'close' } as const;
    const signal = new AbortController().signal;
    const first = broker.execute('owner', command, signal);
    broker.acknowledge('owner', phone.sessionId, command.commandId, true);
    await first;
    await broker.execute('owner', command, signal);
    expect(received).toEqual(['close-current']);
    broker.dispose();
  });
});

describe('Apple Maps phone acknowledgements', () => {
  it('selects only a capable phone and accepts only its bounded receipt for the matching lookup', async () => {
    const broker = new WorkspaceCommandBroker();
    const received: string[] = [];
    const phone = broker.connect('owner', (event, data) => {
      if (event === 'workspace-command') {
        expect(data.expiresAt - Date.now()).toBeGreaterThan(25_000);
        received.push(data.command.commandId);
      }
      return true;
    });
    const other = broker.connect('owner', () => { throw new Error('sent to a non-capable phone'); });
    const snapshot = { windows: [], contextPanelOpen: false, device: { kind: 'phone' as const } };
    broker.updateSnapshot('owner', phone.sessionId, { ...snapshot, device: { kind: 'phone', appleMaps: true } });
    broker.updateSnapshot('owner', other.sessionId, snapshot);
    const answer = broker.appleMaps('owner', { query: 'station' }, false, new AbortController().signal);
    const id = received[0]!;
    expect(broker.acknowledge('owner', other.sessionId, id, true, undefined, undefined, { matches: 1 })).toEqual({ status: 'stale' });
    expect(broker.acknowledge('owner', phone.sessionId, id, true)).toEqual({ status: 'unknown' });
    const unbounded = { matches: 1, address: 'private provider content' };
    expect(broker.acknowledge('owner', phone.sessionId, id, true, undefined, undefined, unbounded)).toEqual({ status: 'unknown' });
    expect(broker.acknowledge('owner', phone.sessionId, id, true, undefined, undefined, { matches: 4 })).toEqual({ status: 'unknown' });
    expect(broker.acknowledge('owner', phone.sessionId, id, false, undefined, undefined, { matches: 1 })).toEqual({ status: 'unknown' });
    expect(broker.acknowledge('owner', phone.sessionId, id, true, undefined, undefined, { matches: 0, reason: 'needs_origin' })).toEqual({ status: 'accepted' });
    await expect(answer).resolves.toEqual({ lookupId: id, matches: 0, reason: 'needs_origin' });

    const failed = broker.appleMaps('owner', { query: 'station' }, false, new AbortController().signal);
    broker.acknowledge('owner', phone.sessionId, received[1]!, false, 'Private provider message.');
    await expect(failed).rejects.toThrow('Apple Maps was unavailable on the iPhone.');
    phone.close();
    broker.updateSnapshot('owner', other.sessionId, { ...snapshot, device: { kind: 'phone', appleMaps: true } });
    await expect(broker.appleMaps('owner', { lookupId: id, ordinal: 1 }, false, new AbortController().signal))
      .resolves.toMatchObject({ matches: 0, reason: 'expired_lookup' });
    broker.updateSnapshot('owner', other.sessionId, snapshot);
    await expect(broker.appleMaps('owner', { query: 'station' }, false, new AbortController().signal)).rejects.toThrow('Open Jarvis on an iPhone');
  });
});

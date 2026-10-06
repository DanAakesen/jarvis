import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const extensionWorker = readFileSync(
  new URL('../../../../pc-bridge/chrome-extension/service-worker.js', import.meta.url),
  'utf8',
);

describe('Chrome extension URL opening', () => {
  it('creates an active tab and focuses its window with attention requested', async () => {
    let receiveRequest!: (request: unknown) => void;
    const nativePort = {
      onMessage: { addListener: vi.fn((listener: typeof receiveRequest) => { receiveRequest = listener; }) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
    };
    const createTab = vi.fn(async () => ({ id: 17, windowId: 4 }));
    const updateWindow = vi.fn(async () => ({}));
    const chrome = {
      runtime: {
        connectNative: vi.fn(() => nativePort),
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      tabs: { create: createTab, onRemoved: { addListener: vi.fn() } },
      windows: { update: updateWindow },
      debugger: { onDetach: { addListener: vi.fn() } },
    };

    runInNewContext(extensionWorker, { chrome, TextEncoder, URL, setTimeout, clearTimeout });
    receiveRequest({
      id: '1730aa51-f380-4df9-a345-1feb862cb1c4',
      type: 'open_url',
      url: 'https://google.com/',
    });

    await vi.waitFor(() => expect(nativePort.postMessage).toHaveBeenCalledWith({
      id: '1730aa51-f380-4df9-a345-1feb862cb1c4',
      type: 'result',
      result: { opened: true, focused: true },
    }));

    expect(createTab).toHaveBeenCalledWith({ url: 'https://google.com/', active: true });
    expect(updateWindow).toHaveBeenCalledWith(4, { focused: true, drawAttention: true });
  });

  it('rejects non-HTTP(S) URLs before creating a tab', async () => {
    let receiveRequest!: (request: unknown) => void;
    const nativePort = {
      onMessage: { addListener: vi.fn((listener: typeof receiveRequest) => { receiveRequest = listener; }) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
    };
    const createTab = vi.fn(async () => ({ id: 17, windowId: 4 }));
    const chrome = {
      runtime: {
        connectNative: vi.fn(() => nativePort),
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      tabs: { create: createTab, onRemoved: { addListener: vi.fn() } },
      windows: { update: vi.fn(async () => ({})) },
      debugger: { onDetach: { addListener: vi.fn() } },
    };

    runInNewContext(extensionWorker, { chrome, TextEncoder, URL, setTimeout, clearTimeout });
    receiveRequest({
      id: '1730aa51-f380-4df9-a345-1feb862cb1c4',
      type: 'open_url',
      url: 'javascript:alert(1)',
    });

    await vi.waitFor(() => expect(nativePort.postMessage).toHaveBeenCalledWith({
      id: '1730aa51-f380-4df9-a345-1feb862cb1c4',
      type: 'error',
      error: 'not_allowed',
    }));
    expect(createTab).not.toHaveBeenCalled();
  });
});

describe('Chrome extension Jarvis tab focus', () => {
  function load(tabs: Array<Record<string, unknown>>) {
    let receiveRequest!: (request: unknown) => void;
    const nativePort = {
      onMessage: { addListener: vi.fn((listener: typeof receiveRequest) => { receiveRequest = listener; }) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
    };
    const createTab = vi.fn(async () => ({ id: 30, windowId: 9 }));
    const updateTab = vi.fn(async (id: number) => ({ id, windowId: tabs.find((tab) => tab.id === id)?.windowId }));
    const updateWindow = vi.fn(async () => ({}));
    const chrome = {
      runtime: {
        connectNative: vi.fn(() => nativePort),
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      tabs: {
        create: createTab, update: updateTab, query: vi.fn(async () => tabs), onRemoved: { addListener: vi.fn() },
      },
      windows: { update: updateWindow },
      debugger: { onDetach: { addListener: vi.fn() } },
    };
    runInNewContext(extensionWorker, { chrome, TextEncoder, URL, setTimeout, clearTimeout });
    return { receive: (request: unknown) => receiveRequest(request), nativePort, createTab, updateTab, updateWindow };
  }

  const id = '1730aa51-f380-4df9-a345-1feb862cb1c4';
  const jarvis = 'https://jarvis.example.test/';

  it('activates the existing Jarvis tab and focuses its window instead of opening another', async () => {
    const extension = load([
      { id: 3, windowId: 1, active: true, url: 'https://google.com/' },
      { id: 7, windowId: 2, active: false, url: 'https://jarvis.example.test/factory' },
    ]);
    extension.receive({ id, type: 'focus_jarvis_tab', url: jarvis });

    await vi.waitFor(() => expect(extension.nativePort.postMessage).toHaveBeenCalledWith({
      id, type: 'result', result: { opened: false, focused: true },
    }));
    expect(extension.updateTab).toHaveBeenCalledWith(7, { active: true });
    expect(extension.updateWindow).toHaveBeenCalledWith(2, { focused: true, drawAttention: true });
    expect(extension.createTab).not.toHaveBeenCalled();
  });

  it('opens the Jarvis URL in Chrome when no Jarvis tab exists', async () => {
    const extension = load([{ id: 3, windowId: 1, active: true, url: 'https://jarvis.example.test.evil.com/' }]);
    extension.receive({ id, type: 'focus_jarvis_tab', url: jarvis });

    await vi.waitFor(() => expect(extension.nativePort.postMessage).toHaveBeenCalledWith({
      id, type: 'result', result: { opened: true, focused: true },
    }));
    expect(extension.createTab).toHaveBeenCalledWith({ url: jarvis, active: true });
    expect(extension.updateWindow).toHaveBeenCalledWith(9, { focused: true, drawAttention: true });
  });

  it('refuses non-HTTPS Jarvis URLs', async () => {
    const extension = load([]);
    extension.receive({ id, type: 'focus_jarvis_tab', url: 'http://jarvis.example.test/' });

    await vi.waitFor(() => expect(extension.nativePort.postMessage).toHaveBeenCalledWith({
      id, type: 'error', error: 'not_allowed',
    }));
    expect(extension.createTab).not.toHaveBeenCalled();
  });
});

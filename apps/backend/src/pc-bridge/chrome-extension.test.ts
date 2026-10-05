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
      runtime: { connectNative: vi.fn(() => nativePort) },
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
      runtime: { connectNative: vi.fn(() => nativePort) },
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

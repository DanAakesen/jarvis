import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationIntentContext, type ConversationIntentController } from './conversation-intents';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';
import { KnowledgeBackendContext } from './knowledge/knowledge-context';
import type { SessionCommandResult } from './session-commands';

const artifactId = '12345678-1234-4234-8234-123456789abc';
const artifact = { id: artifactId.toUpperCase(), kind: 'html', title: 'Man City verdict', html: '<!doctype html><html><head><title>R</title></head><body><h1>Verdict</h1></body></html>',
  sources: [{ title: 'BBC', url: 'https://www.bbc.co.uk/sport' }], createdAt: '2026-10-08T16:40:00.000Z', pinned: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderView(fetchMock: ReturnType<typeof vi.fn>, updatedAt?: string, onPinChange?: (pinned: boolean) => Promise<SessionCommandResult>) {
  vi.stubGlobal('fetch', fetchMock);
  const intents: ConversationIntentController = { pending: [], sendMessage: vi.fn(), focusVoiceStart: vi.fn(), consume: vi.fn() };
  const backend = { backendUrl: 'https://api.example.com', getAccessToken: async () => 'token' };
  const view = (revision?: string) => (
    <KnowledgeBackendContext.Provider value={backend}>
      <ConversationIntentContext.Provider value={intents}>
        <GeneratedViewRenderer view={{ version: 1, renderer: 'html-app', title: 'Research: Man City verdict',
          source: { id: 'html_generation', status: 'complete', ...(revision ? { updatedAt: revision } : {}) }, data: { artifactId }, actions: [] }}
          {...(onPinChange ? { onPinChange } : {})} />
      </ConversationIntentContext.Provider>
    </KnowledgeBackendContext.Provider>
  );
  const rendered = render(view(updatedAt));
  return { intents, update: (revision?: string) => rendered.rerender(view(revision)), unmount: rendered.unmount };
}

function post(source: MessageEventSource | null, data: unknown) {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'userActivation');
  document.documentElement.style.removeProperty('--report-surface');
  document.documentElement.style.removeProperty('--primary-action');
  document.documentElement.style.removeProperty('color-scheme');
  delete document.documentElement.dataset.theme;
});

describe('HtmlAppView', () => {
  it('loads the artifact into a scripts-only sandbox with the CSP and handles validated bridge messages', async () => {
    const { intents } = renderView(vi.fn(async () => json(artifact)));
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Verdict</h1>');

    post(frame.contentWindow, { jarvisBridge: 1, type: 'resize', height: 900 });
    expect(frame.style.height).toBe('900px');
    post(window, { jarvisBridge: 1, type: 'resize', height: 300 });
    expect(frame.style.height).toBe('900px');

    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false, hasBeenActive: true } });
    post(frame.contentWindow, { jarvisBridge: 1, type: 'ask', text: 'Show this as a timeline' });
    expect(intents.sendMessage).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true, hasBeenActive: true } });
    post(frame.contentWindow, { jarvisBridge: 1, type: 'ask', text: 'Show this as a timeline' });
    expect(intents.sendMessage).toHaveBeenCalledWith('Show this as a timeline');
  });

  it('explains a missing report and offers retry for a failed load', async () => {
    renderView(vi.fn(async () => json({ error: 'not found' }, 404)));
    expect(await screen.findByText('This report or app is no longer available.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('routes iframe pins through the window owner and waits for its confirmed result', async () => {
    let finish!: (result: SessionCommandResult) => void;
    const onPinChange = vi.fn(() => new Promise<SessionCommandResult>((resolve) => { finish = resolve; }));
    const fetchMock = vi.fn(async () => json(artifact));
    renderView(fetchMock, undefined, onPinChange);
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    post(frame.contentWindow, { jarvisBridge: 1, type: 'pin' });
    expect(onPinChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Saving pin change...')).not.toBeNull();
    expect(screen.queryByText('Pinned.')).toBeNull();
    await act(async () => { finish({ applied: false, reason: 'The pin store is unavailable.' }); });
    expect(screen.getByText('The pin store is unavailable.')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('ignores untrusted or inactive iframe pin messages and confirms an owner unpin', async () => {
    const onPinChange = vi.fn().mockResolvedValue({ applied: true });
    renderView(vi.fn(async () => json(artifact)), undefined, onPinChange);
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    post(window, { jarvisBridge: 1, type: 'pin' });
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false, hasBeenActive: true } });
    post(frame.contentWindow, { jarvisBridge: 1, type: 'pin' });
    expect(onPinChange).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true, hasBeenActive: true } });
    post(frame.contentWindow, { jarvisBridge: 1, type: 'unpin' });
    expect(await screen.findByText('Unpinned.')).not.toBeNull();
    expect(onPinChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('preserves artifact pinning for standalone reports without a workspace owner', async () => {
    const fetchMock = vi.fn(async () => json(artifact));
    renderView(fetchMock);
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    post(frame.contentWindow, { jarvisBridge: 1, type: 'pin' });
    expect(await screen.findByText('Pinned.')).not.toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://api.example.com/factory/workspace-artifacts/html/${artifactId}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ pinned: true }) }),
    );
  });

  it('retries after a temporary failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: 'busy' }, 503)).mockResolvedValue(json(artifact));
    renderView(fetchMock);
    (await screen.findByRole('button', { name: 'Retry' })).click();
    await waitFor(() => expect(screen.getByTitle('Man City verdict')).not.toBeNull());
  });

  it('refreshes a same-ID revision, retains frame sizing and does not reload an unchanged revision', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(artifact)).mockResolvedValue(json({ ...artifact, html: '<h1>Revised verdict</h1>' }));
    const { update } = renderView(fetchMock, '2026-10-08T16:40:00.000Z');
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    post(frame.contentWindow, { jarvisBridge: 1, type: 'resize', height: 900 });

    update('2026-10-11T10:00:00.000Z');
    expect(screen.queryByTitle('Man City verdict')).toBeNull();
    const revised = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    expect(revised.srcdoc).toContain('Revised verdict');
    expect(revised.style.height).toBe('900px');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `https://api.example.com/factory/workspace-artifacts/html/${artifactId}`,
      `https://api.example.com/factory/workspace-artifacts/html/${artifactId}`,
    ]);

    update('2026-10-11T10:00:00.000Z');
    await act(async () => {});
    expect(screen.getByTitle('Man City verdict')).toBe(revised);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels obsolete loads and ignores their responses even if the transport still completes them', async () => {
    let oldResponse!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { oldResponse = resolve; }))
      .mockResolvedValue(json({ ...artifact, html: '<h1>Newest revision</h1>' }));
    const { update, unmount } = renderView(fetchMock, '2026-10-08T16:40:00.000Z');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const obsoleteSignal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    update('2026-10-11T10:00:00.000Z');
    expect(obsoleteSignal.aborted).toBe(true);
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    expect(frame.srcdoc).toContain('Newest revision');
    await act(async () => { oldResponse(json(artifact)); });
    expect(frame.srcdoc).toContain('Newest revision');
    expect(frame.srcdoc).not.toContain('<h1>Verdict</h1>');
    const latestSignal = fetchMock.mock.calls[1]![1].signal as AbortSignal;
    unmount();
    expect(latestSignal.aborted).toBe(true);
  });

  it('hides stale HTML after a failed revision load and retries the requested update', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(artifact))
      .mockResolvedValueOnce(json({ error: 'busy' }, 503))
      .mockResolvedValue(json({ ...artifact, html: '<h1>Updated after retry</h1>' }));
    const { update } = renderView(fetchMock);
    await screen.findByTitle('Man City verdict');
    update('2026-10-11T10:00:00.000Z');
    (await screen.findByRole('button', { name: 'Retry' })).click();
    expect(screen.queryByTitle('Man City verdict')).toBeNull();
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    expect(frame.srcdoc).toContain('Updated after retry');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('synchronises the solid surface after load and theme changes without reloading report state', async () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.setProperty('--report-surface', '#091018');
    document.documentElement.style.setProperty('--primary-action', '#ffb45c');
    document.documentElement.style.colorScheme = 'dark';
    const fetchMock = vi.fn(async () => json(artifact));
    renderView(fetchMock);
    const frame = await screen.findByTitle('Man City verdict') as HTMLIFrameElement;
    const originalDocument = frame.srcdoc;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');

    fireEvent.load(frame);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      jarvisHostTheme: 1, scheme: 'dark', tokens: expect.objectContaining({ '--background': '#091018', '--accent': '#ffb45c' }),
    }), '*');
    act(() => {
      document.documentElement.style.setProperty('--report-surface', '#f0f5f7');
      document.documentElement.style.setProperty('--primary-action', '#b45f06');
      document.documentElement.dataset.theme = 'light';
    });
    await waitFor(() => expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      jarvisHostTheme: 1, scheme: 'light', tokens: expect.objectContaining({ '--background': '#f0f5f7', '--accent': '#b45f06' }),
    }), '*'));
    expect(frame.srcdoc).toBe(originalDocument);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

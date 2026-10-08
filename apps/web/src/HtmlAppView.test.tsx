import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationIntentContext, type ConversationIntentController } from './conversation-intents';
import { HtmlAppView } from './HtmlAppView';
import { KnowledgeBackendContext } from './knowledge/knowledge-context';

const artifactId = '12345678-1234-4234-8234-123456789abc';
const artifact = { id: artifactId.toUpperCase(), kind: 'html', title: 'Man City verdict', html: '<!doctype html><html><head><title>R</title></head><body><h1>Verdict</h1></body></html>',
  sources: [{ title: 'BBC', url: 'https://www.bbc.co.uk/sport' }], createdAt: '2026-10-08T16:40:00.000Z', pinned: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderView(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const intents: ConversationIntentController = { pending: [], sendMessage: vi.fn(), focusVoiceStart: vi.fn(), consume: vi.fn() };
  render(
    <KnowledgeBackendContext.Provider value={{ backendUrl: 'https://api.example.com', getAccessToken: async () => 'token' }}>
      <ConversationIntentContext.Provider value={intents}>
        <HtmlAppView artifactId={artifactId} title="Research: Man City verdict" />
      </ConversationIntentContext.Provider>
    </KnowledgeBackendContext.Provider>,
  );
  return intents;
}

function post(source: MessageEventSource | null, data: unknown) {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source })); });
}

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'userActivation'); });

describe('HtmlAppView', () => {
  it('loads the artifact into a scripts-only sandbox with the CSP and handles validated bridge messages', async () => {
    const intents = renderView(vi.fn(async () => json(artifact)));
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

  it('retries after a temporary failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: 'busy' }, 503)).mockResolvedValue(json(artifact));
    renderView(fetchMock);
    (await screen.findByRole('button', { name: 'Retry' })).click();
    await waitFor(() => expect(screen.getByTitle('Man City verdict')).not.toBeNull());
  });
});
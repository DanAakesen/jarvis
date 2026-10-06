import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationIntentContext } from './conversation-intents';
import { HtmlAppView } from './HtmlAppView';
import type { HtmlAppEnvironment } from './html-app-bridge';

const { backendFetch } = vi.hoisted(() => ({ backendFetch: vi.fn() }));
vi.mock('./backend-request', () => ({ backendFetch }));

const artifactId = '11111111-1111-4111-8111-111111111111';
const artifact = {
  id: artifactId,
  kind: 'html',
  title: 'Generated app',
  html: '<h1>Hello</h1>',
  sources: [{ title: 'Example', url: 'https://example.com/' }],
  createdAt: '2026-10-06T10:00:00.000Z',
  pinned: false,
};
const environment: HtmlAppEnvironment = {
  theme: 'light',
  tokens: {},
};
const getAccessToken = vi.fn(async () => 'test-token');
const sendMessage = vi.fn();

function renderView() {
  return render(
    <ConversationIntentContext.Provider value={{
      pending: [], sendMessage, focusVoiceStart: vi.fn(), consume: vi.fn(),
    }}>
      <HtmlAppView
        artifactId={artifactId}
        backendUrl="https://api.example.com/"
        getAccessToken={getAccessToken}
        environment={environment}
      />
    </ConversationIntentContext.Provider>,
  );
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function channelFrom(frame: HTMLIFrameElement) {
  const serialized = frame.srcdoc.match(/const channel=(".*?");/u)?.[1];
  return serialized ? JSON.parse(serialized) as string : '';
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('HtmlAppView', () => {
  it('loads the owner-fetched artifact into a scripts-only sandbox and handles validated bridge messages', async () => {
    backendFetch.mockResolvedValueOnce(response(artifact));
    renderView();

    const frame = await screen.findByTitle('Generated app');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect((frame as HTMLIFrameElement).srcdoc).toContain("default-src 'none'");
    expect(backendFetch).toHaveBeenCalledWith(
      `https://api.example.com/factory/workspace-artifacts/html/${artifactId}`,
      expect.objectContaining({
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: expect.objectContaining({ Authorization: `${['Bear', 'er'].join('')} test-token` }),
      }),
    );

    const iframe = frame as HTMLIFrameElement;
    const channel = channelFrom(iframe);
    const message = { type: 'ask', channel, text: 'Summarize this app.' };
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: message, origin: 'null', source: window,
      }));
    });
    expect(sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: message, origin: 'null', source: iframe.contentWindow,
      }));
    });
    expect(sendMessage).toHaveBeenCalledWith('Summarize this app.');
    expect(screen.getByText('Sent to Jarvis.')).toBeTruthy();
  });

  it('pins the artifact only after the API confirms the update', async () => {
    backendFetch.mockResolvedValueOnce(response(artifact)).mockResolvedValueOnce(response({ pinned: true }));
    renderView();
    await screen.findByTitle('Generated app');

    fireEvent.click(screen.getByRole('button', { name: 'Pin app' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unpin app' })).toBeTruthy());
    expect(backendFetch).toHaveBeenLastCalledWith(
      `https://api.example.com/factory/workspace-artifacts/html/${artifactId}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ pinned: true }),
        credentials: 'omit',
      }),
    );
  });

  it('shows a recoverable error for an unavailable artifact', async () => {
    backendFetch.mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(artifact));
    renderView();

    expect((await screen.findByRole('alert')).textContent).toContain('Jarvis could not load this HTML app.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTitle('Generated app')).toBeTruthy();
  });
});

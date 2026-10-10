import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const {
  createAuthClient,
  restoreProfile,
  signIn,
  loadConversationHistory,
  createChatSession,
  sendChatTurn,
  makeAuthClient,
  voiceSessions,
} = vi.hoisted(() => {
  const account = { homeAccountId: 'dan' };
  const makeAuthClient = () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn(() => account),
    getAllAccounts: vi.fn(() => [account]),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'fixture-token' }),
  });
  return {
    createAuthClient: vi.fn(makeAuthClient),
    restoreProfile: vi.fn().mockResolvedValue(null),
    signIn: vi.fn(),
    loadConversationHistory: vi.fn().mockResolvedValue({ messages: [], nextCursor: null }),
    createChatSession: vi.fn(),
    sendChatTurn: vi.fn(),
    makeAuthClient,
    voiceSessions: [] as Array<{
      options: {
        onStatus: (status: string, message: string) => void;
        onSessionEnded?: () => void;
      };
    }>,
  };
});
vi.mock('./auth', () => ({ createAuthClient, restoreProfile, signIn }));
vi.mock('./conversation-history', () => ({
  loadConversationHistory,
  createChatSession,
  sendChatTurn,
  waitForChatSetup: <T,>(operation: () => Promise<T>) => operation(),
}));
vi.mock('./JarvisStage', () => ({
  JarvisStage: ({ children }: { children?: ReactNode }) => <div data-testid="jarvis-stage">{children}</div>,
}));
vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    constructor(private readonly options: {
      onStatus: (status: string, message: string) => void;
      onSessionEnded?: () => void;
    }) {
      voiceSessions.push({ options });
    }
    start() { this.options.onStatus('ready', 'Microphone is off.'); }
    stop() {
      this.options.onStatus('stopped', 'Voice is off.');
      this.options.onSessionEnded?.();
    }
    retryMicrophone = vi.fn(async () => {});
    playbackLevel = () => 0;
    inputLevel = () => 0;
    setMuted = vi.fn();
    sendScreenContext = vi.fn();
  },
}));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const fetchMock = vi.fn<typeof fetch>();
let activityStream: ReadableStreamDefaultController<Uint8Array> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  voiceSessions.length = 0;
  activityStream = null;
  localStorage.clear();
  createAuthClient.mockReturnValue(makeAuthClient());
  restoreProfile.mockResolvedValue(null);
  loadConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  createChatSession.mockResolvedValue({ id: '41', language: 'da' });
  sendChatTurn.mockResolvedValue({
    id: '52', sessionId: '41', role: 'jarvis', text: 'I am ready.', model: null,
    voiceMinutes: null, at: '2026-10-03T12:02:00.000Z',
  });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: 'awake' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
});

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('Jarvis routes', () => {
  it('opens existing context content idempotently when overlapping reflex opens arrive', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname === '/now/events') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { activityStream = controller; },
          cancel() { activityStream = null; },
        }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(null, { status: 204 });
    });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);
    await waitFor(() => expect(activityStream).not.toBeNull());
    const publish = (event: string, data: unknown) => activityStream!.enqueue(
      new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
    act(() => {
      publish('workspace-ready', { sessionId: '12345678-1234-4234-8234-123456789abc' });
      for (const commandId of ['open-first', 'open-second']) {
        publish('workspace-command', {
          command: { commandId, operation: 'context-panel', action: 'open' }, expiresAt: Date.now() + 5_000,
        });
      }
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/commands/') &&
      String(url).endsWith('/ack'))).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Context' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle contextual panel' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('disables sign-in until a backend is deployed', () => {
    render(<MemoryRouter><App config={{ ...__JARVIS_CONFIG__, backendUrl: null }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Jarvis is taking shape');
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Sign-in is unavailable until the backend is deployed.')).not.toBeNull();
  });

  it('syncs reduced-motion and visibility preferences for CSS behavior', async () => {
    const motionPreference = Object.assign(new EventTarget(), {
      media: '(prefers-reduced-motion: reduce)',
      matches: false,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => motionPreference));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const view = render(<MemoryRouter><App config={{ ...__JARVIS_CONFIG__, backendUrl: null }} /></MemoryRouter>);

    await waitFor(() => expect(document.documentElement.dataset.motionPreference).toBe('full'));
    expect(document.documentElement.dataset.documentVisibility).toBe('visible');

    Object.defineProperty(motionPreference, 'matches', { value: true });
    motionPreference.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.motionPreference).toBe('reduced');

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.dataset.documentVisibility).toBe('hidden');

    view.unmount();
    hidden.mockRestore();
    expect(document.documentElement.dataset.motionPreference).toBeUndefined();
    expect(document.documentElement.dataset.documentVisibility).toBeUndefined();
  });

  it('sends the page to Microsoft sign-in and waits while it navigates away', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(undefined);
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    const button = await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    await user.click(button);

    expect(signIn).toHaveBeenCalledWith(expect.anything(), config);
    expect((await screen.findByRole('button', { name: 'Signing in…' })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Opening Microsoft sign-in…');
  });

  it('shows the backend refusal and does not show a name for an unauthorized account', async () => {
    restoreProfile.mockRejectedValue(new Error("This Microsoft account isn't allowed to use Jarvis."));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect((await screen.findByRole('alert')).textContent).toBe("This Microsoft account isn't allowed to use Jarvis.");
    expect(screen.queryByRole('heading', { name: /Welcome,/ })).toBeNull();
  });

  it('shows a sign-in start failure', async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(new Error('Microsoft sign-in did not complete. Try again.'));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Microsoft sign-in did not complete. Try again.');
  });

  it('recovers from an unknown address through the home link', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/unknown/nested']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    await user.click(screen.getByRole('link', { name: 'Return to Jarvis' }));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Jarvis is taking shape');
  });

  it('restores the verified name from an existing sign-in', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    expect(restoreProfile).toHaveBeenCalledWith(expect.anything(), config);
  });

  it('shows saved conversation messages on the signed-in home page', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    loadConversationHistory.mockResolvedValue({
      messages: [{
        id: '42',
        sessionId: '41',
        channel: 'chat',
        language: 'da',
        role: 'dan',
        text: 'Please start the task.',
        model: null,
        voiceMinutes: null,
        at: '2026-10-03T12:00:00.000Z',
        toolCalls: [],
      }],
      nextCursor: null,
    });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(await screen.findByText('Please start the task.')).not.toBeNull();
  });

  it('marks browser presence from active use, not background feed requests', async () => {
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/now') {
        return new Response(JSON.stringify({
          awayMode: true, confirmations: [], updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [],
        }));
      }
      return new Response('{}');
    });
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });

    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/now/present')).toBe(false);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      new URL(String(url)).pathname === '/now/present' && init?.method === 'POST')).toBe(true));

    hasFocus.mockRestore();
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
    else Reflect.deleteProperty(document, 'visibilityState');
  });
});

describe('App shell', () => {
  async function renderSignedIn(path = '/') {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter initialEntries={[path]}><App config={config} /></MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });
  }

  it('keeps the workspace command stream connected when navigating away from conversation', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    const eventRequests = () => fetchMock.mock.calls.filter(([url]) => (
      new URL(String(url)).pathname === '/now/events'
    ));
    await waitFor(() => expect(eventRequests()).toHaveLength(1));

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    await waitFor(() => expect(eventRequests()).toHaveLength(2));
  });

  it('keeps one 3D stage behind every route without remounting it', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const stage = screen.getByTestId('jarvis-stage');
    await user.click(screen.getByRole('link', { name: 'Software Factory' }));
    await screen.findByRole('heading', { level: 1, name: 'Kanban' });
    expect(screen.getByTestId('jarvis-stage')).toBe(stage);

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.getByTestId('jarvis-stage')).toBe(stage);
  });

  it('renders backend-reported waking in the shared signed-in shell', async () => {
    let resolveFeed!: (response: Response) => void;
    const pendingFeed = new Promise<Response>((resolve) => { resolveFeed = resolve; });
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/database/status') return new Response(JSON.stringify({ waking: true }));
      if (path === '/now') return pendingFeed;
      return new Response(JSON.stringify({ state: 'awake' }));
    });

    await renderSignedIn();
    const wakeStatus = (await screen.findByText('Waking Jarvis…')).closest('[role="status"]');
    expect(wakeStatus).not.toBeNull();
    expect(wakeStatus!.closest('.topbar-actions')).not.toBeNull();
    expect(document.querySelector('.bottom-bar')).toBeNull();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    resolveFeed(new Response(JSON.stringify({
      awayMode: false, confirmations: [], updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [],
    })));
    await screen.findByText('No tasks are running.');
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
  });

  it('keeps phone voice on the current page and leaves header controls available through entry and exit', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    await renderSignedIn('/settings');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const shell = document.querySelector('.app-shell')!;
    expect(shell.getAttribute('data-phone')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(shell.getAttribute('data-voice-active')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBe(heading);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'End voice' }));
    expect(shell.getAttribute('data-voice-active')).toBe('false');
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBe(heading);
  });

  it('enters fullscreen voice immediately and restores the typing shell when voice ends', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const shell = screen.getByRole('navigation', { name: 'Areas' }).closest('.app-shell');
    expect(shell?.getAttribute('data-voice-active')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Start voice' }));

    expect(shell?.getAttribute('data-voice-active')).toBe('true');
    expect(shell?.getAttribute('data-voice-has-windows')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End voice' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'End voice' }));
    expect(shell?.getAttribute('data-voice-active')).toBe('false');
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
  });

  const historyPair = [
    {
      id: '43', sessionId: '41', channel: 'chat', language: 'en', role: 'dan', text: 'Hello Jarvis',
      model: null, voiceMinutes: null, at: '2026-10-03T12:00:00.000Z', toolCalls: [],
    },
    {
      id: '44', sessionId: '41', channel: 'chat', language: 'en', role: 'jarvis', text: 'I am ready.',
      model: null, voiceMinutes: null, at: '2026-10-03T12:01:00.000Z', toolCalls: [],
    },
  ];

  function streamWorkspaceCommands() {
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname === '/now/events') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { activityStream = controller; },
          cancel() { activityStream = null; },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ state: 'awake' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    const publish = (event: string, data: unknown) => activityStream!.enqueue(
      new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
    const ack = (commandId: string) => fetchMock.mock.calls.find(([url]) => (
      String(url).endsWith(`/now/workspace/commands/${commandId}/ack`)
    ));
    return {
      ready: () => act(() => { publish('workspace-ready', { sessionId: '12345678-1234-4234-8234-123456789abc' }); }),
      command: async (commandId: string, operation: string) => {
        act(() => {
          publish('workspace-command', {
            command: { commandId, operation, viewId: 'conversation' }, expiresAt: Date.now() + 5_000,
          });
        });
        await waitFor(() => expect(ack(commandId)).toBeTruthy());
        return JSON.parse(String(ack(commandId)![1]!.body)) as { applied: boolean };
      },
    };
  }

  it('hosts conversation history in a shared workspace window with tabs, maximise and close', async () => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      const user = {
        id: '59', sessionId: '41', channel: 'chat', language: 'en', role: 'dan', text: 'Still typing',
        model: null, voiceMinutes: null, at: '2026-10-03T12:02:00.000Z', toolCalls: [],
      };
      const reply = {
        id: '60', sessionId: '41', channel: 'chat', language: 'en', role: 'jarvis', text: 'Back again.',
        model: null, voiceMinutes: null, at: '2026-10-03T12:03:00.000Z', toolCalls: [],
      };
      (args[4] as (message: typeof user) => void)(user);
      loadConversationHistory.mockResolvedValue({ messages: [...historyPair, user, reply], nextCursor: null });
      return reply;
    });
    await renderSignedIn();

    const reply = await screen.findByText('I am ready.');
    const historyWindow = screen.getByRole('article', { name: 'Conversation' });
    const transcript = screen.getByLabelText('Conversation history');
    const composer = screen.getByRole('textbox', { name: 'Message Jarvis' });
    expect(historyWindow.contains(reply)).toBe(true);
    expect(historyWindow.contains(transcript)).toBe(true);
    expect(historyWindow.contains(composer)).toBe(false);
    expect(historyWindow.contains(screen.getByRole('button', { name: 'Start voice' }))).toBe(false);
    expect(historyWindow.className).toContain('luminous-glass');
    expect(document.querySelector('.conversation-window-bar, .conversation-restore')).toBeNull();

    await user.click(within(historyWindow).getByRole('button', { name: 'Minimise Conversation' }));
    // The conversation has no tab; the chat bar's handle brings it back.
    expect(screen.queryByRole('button', { name: 'Restore Conversation' })).toBeNull();
    expect(historyWindow.hasAttribute('inert')).toBe(true);
    expect(screen.getByLabelText('Conversation history')).toBe(transcript);
    await user.type(composer, 'Still typing');
    expect((composer as HTMLTextAreaElement).value).toBe('Still typing');
    await user.click(screen.getByRole('button', { name: 'Show conversation' }));
    expect(historyWindow.hasAttribute('inert')).toBe(false);
    expect(screen.getByLabelText('Conversation history')).toBe(transcript);

    await user.click(within(historyWindow).getByRole('button', { name: 'Maximise Conversation' }));
    expect(historyWindow.className).toContain('workspace-window-maximized');
    await user.click(within(historyWindow).getByRole('button', { name: 'Restore size of Conversation' }));
    await user.click(within(historyWindow).getByRole('button', { name: 'Close Conversation' }));
    expect(screen.queryByRole('article', { name: 'Conversation' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBe(composer);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const reopened = screen.getByRole('article', { name: 'Conversation' });
    expect(reopened.contains(await screen.findByText('Back again.'))).toBe(true);
    expect(reopened.contains(screen.getByText('Still typing'))).toBe(true);
  });

  it('lets Jarvis minimise, restore, close and focus the conversation window through workspace commands', async () => {
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    const workspace = streamWorkspaceCommands();
    await renderSignedIn();
    await screen.findByText('I am ready.');
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url).endsWith('/now/workspace/state') &&
      (JSON.parse(String(init?.body)) as { windows: unknown[] }).windows.some((window) => (
        JSON.stringify(window) === JSON.stringify({ viewId: 'conversation', title: 'Conversation' })
      ))
    ))).toBe(true));

    expect(await workspace.command('jarvis-minimise', 'minimise')).toMatchObject({ applied: true });
    expect(screen.getByRole('button', { name: 'Show conversation' })).not.toBeNull();
    expect(await workspace.command('jarvis-restore', 'restore')).toMatchObject({ applied: true });
    expect(screen.getByRole('button', { name: 'Hide conversation' })).not.toBeNull();
    expect(await workspace.command('jarvis-close', 'close')).toMatchObject({ applied: true });
    expect(screen.queryByRole('article', { name: 'Conversation' })).toBeNull();
    expect(await workspace.command('jarvis-reopen', 'restore')).toMatchObject({ applied: true });
    expect(await workspace.command('jarvis-focus', 'focus')).toMatchObject({ applied: true });
    const historyWindow = screen.getByRole('article', { name: 'Conversation' });
    expect(document.activeElement).toBe(within(historyWindow).getByRole('heading', { name: 'Conversation' }));
    expect(historyWindow.contains(screen.getByText('I am ready.'))).toBe(true);
  });

  it('keeps chat and voice outside the history window and lets Jarvis bring history forward during voice', async () => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    const workspace = streamWorkspaceCommands();
    await renderSignedIn();
    await screen.findByText('I am ready.');
    const transcript = screen.getByLabelText('Conversation history');
    const historyWindow = screen.getByRole('article', { name: 'Conversation' });
    const shell = historyWindow.closest('.app-shell')!;

    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(shell.getAttribute('data-voice-active')).toBe('true');
    expect(shell.getAttribute('data-voice-has-windows')).toBe('false');
    expect(historyWindow.className).toContain('workspace-window-minimized');
    expect(screen.getByLabelText('Conversation history')).toBe(transcript);

    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    expect(await workspace.command('voice-show-history', 'show')).toMatchObject({ applied: true });
    expect(shell.getAttribute('data-voice-has-windows')).toBe('true');
    expect(historyWindow.className).not.toContain('workspace-window-minimized');
    expect(screen.getByRole('button', { name: 'End voice' })).not.toBeNull();
    expect(screen.getByLabelText('Conversation history')).toBe(transcript);
    const voiceControls = screen.getByRole('button', { name: 'End voice' });
    expect(historyWindow.contains(voiceControls)).toBe(false);
    await user.click(within(historyWindow).getByRole('button', { name: 'Maximise Conversation' }));
    await user.click(within(historyWindow).getByRole('button', { name: 'Minimise Conversation' }));
    expect(await workspace.command('voice-close-history', 'close')).toMatchObject({ applied: true });
    expect(await workspace.command('voice-restore-history', 'restore')).toMatchObject({ applied: true });
    expect(screen.getByRole('article', { name: 'Conversation' }).contains(screen.getByText('I am ready.'))).toBe(true);
    expect(voiceSessions).toHaveLength(1);
    expect(shell.getAttribute('data-voice-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'End voice' })).toBe(voiceControls);

    await user.click(screen.getByRole('button', { name: 'End voice' }));
    expect(shell.getAttribute('data-voice-active')).toBe('false');
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    expect(screen.getByRole('article', { name: 'Conversation' }).hasAttribute('inert')).toBe(false);
    expect(screen.getByLabelText('Conversation history').contains(screen.getByText('I am ready.'))).toBe(true);
  });

  it('keeps an in-flight reply, draft and queue while history is minimised, closed and restored', async () => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    let finish = () => {};
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      (args[4] as (message: Record<string, unknown>) => void)({
        id: '70', sessionId: '41', channel: 'chat', language: 'en', role: 'dan', text: 'Long task',
        model: null, voiceMinutes: null, at: '2026-10-03T12:02:00.000Z', toolCalls: [],
      });
      (args[5] as (delta: string) => void)('Working on');
      return await new Promise((resolve) => {
        finish = () => resolve({
          id: '71', sessionId: '41', channel: 'chat', language: 'en', role: 'jarvis', text: 'Finished the task.',
          model: null, voiceMinutes: null, at: '2026-10-03T12:03:00.000Z', toolCalls: [],
        });
      });
    });
    await renderSignedIn();
    await screen.findByText('I am ready.');
    const composer = screen.getByRole('textbox', { name: 'Message Jarvis' }) as HTMLTextAreaElement;
    const historyWindow = screen.getByRole('article', { name: 'Conversation' });

    await user.type(composer, 'Long task');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(historyWindow.contains(await screen.findByText('Working on'))).toBe(true);
    await user.type(composer, 'Queued next');
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    expect(screen.getByText('1 message queued')).not.toBeNull();
    await user.type(composer, 'Unsent draft');

    await user.click(within(historyWindow).getByRole('button', { name: 'Minimise Conversation' }));
    await user.click(screen.getByRole('button', { name: 'Show conversation' }));
    await user.click(within(historyWindow).getByRole('button', { name: 'Close Conversation' }));
    expect(screen.queryByRole('article', { name: 'Conversation' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBe(composer);
    expect(composer.value).toBe('Unsent draft');
    expect(sendChatTurn).toHaveBeenCalledTimes(1);

    await user.click(screen.getAllByRole('link', { name: 'Conversation' })[0]!);
    const reopened = await screen.findByRole('article', { name: 'Conversation' });
    expect(reopened.contains(screen.getByText('Working on'))).toBe(true);
    expect(screen.getByText('1 message queued')).not.toBeNull();

    act(() => finish());
    expect(reopened.contains(await screen.findByText('Finished the task.'))).toBe(true);
    await waitFor(() => expect(sendChatTurn).toHaveBeenCalledTimes(2));
    expect(sendChatTurn.mock.calls[1]![3]).toBe('Queued next');
    expect(composer.value).toBe('Unsent draft');
  });

  it('shows voice failures in a toast and brings closed history back for a failed chat turn', async () => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    sendChatTurn.mockRejectedValue(new Error('Jarvis could not finish the reply. Try again.'));
    await renderSignedIn();
    await screen.findByText('I am ready.');

    await user.click(within(screen.getByRole('article', { name: 'Conversation' })).getByRole('button', { name: 'Close Conversation' }));
    await user.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Will this fail?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const turnAlert = await screen.findByText('Jarvis could not finish the reply. Try again.');
    expect(turnAlert.getAttribute('role')).toBe('alert');
    expect(screen.getByRole('article', { name: 'Conversation' }).contains(turnAlert)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    act(() => voiceSessions.at(-1)!.options.onStatus('error', 'Audio could not start. Check your browser audio settings and try again.'));
    const voiceAlert = screen.getByText('Audio could not start. Check your browser audio settings and try again.');
    expect(voiceAlert.getAttribute('role')).toBe('alert');
    expect(voiceAlert.closest('.conversation-input')).toBeNull();
    expect(screen.getByRole('article', { name: 'Conversation' }).contains(voiceAlert)).toBe(false);
  });

  it('keeps an unsent draft when moving to another page and back', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    await user.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Half a thought');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    await user.click(screen.getAllByRole('link', { name: 'Conversation' })[0]!);
    expect((await screen.findByRole('textbox', { name: 'Message Jarvis' }) as HTMLTextAreaElement).value).toBe('Half a thought');
  });

  it('docks history on the composer and lets the handle hide, show and reopen a closed window', async () => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    await renderSignedIn();
    await screen.findByText('I am ready.');
    const historyWindow = screen.getByRole('article', { name: 'Conversation' });
    const shell = historyWindow.closest('.app-shell')!;
    expect(within(historyWindow).queryByRole('button', { name: 'Arrange Conversation' })).toBeNull();
    expect(historyWindow.querySelector('.workspace-resize-edge')).toBeNull();
    expect(shell.getAttribute('data-conversation-open')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Hide conversation' }));
    expect(historyWindow.hasAttribute('inert')).toBe(true);
    expect(shell.getAttribute('data-conversation-open')).toBe('false');
    const show = screen.getByRole('button', { name: 'Show conversation' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await user.click(show);
    expect(historyWindow.hasAttribute('inert')).toBe(false);

    await user.click(within(historyWindow).getByRole('button', { name: 'Close Conversation' }));
    expect(screen.queryByRole('article', { name: 'Conversation' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show conversation' }));
    expect(screen.getByRole('article', { name: 'Conversation' }).contains(screen.getByText('I am ready.'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Hide conversation' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('restores history minimised for voice when voice ends', async () => {
    const user = userEvent.setup();
    loadConversationHistory.mockResolvedValue({ messages: historyPair, nextCursor: null });
    await renderSignedIn();
    await screen.findByText('I am ready.');
    const historyWindow = screen.getByRole('article', { name: 'Conversation' });

    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(historyWindow.hasAttribute('inert')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'End voice' }));
    expect(historyWindow.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Restore Conversation' })).toBeNull();
  });

  it('keeps camera and screen sharing out of the top bar and in the chat More menu', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() } });
    try {
      await renderSignedIn();
      const topbar = document.querySelector('.topbar-actions') as HTMLElement;
      expect(within(topbar).queryByRole('button', { name: /share screen|camera/i })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'More options' }));
      expect(screen.getByRole('menuitem', { name: 'Share screen' })).not.toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Turn camera on' })).not.toBeNull();
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
  it('offers no screen sharing where the browser cannot share the screen (phones)', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Share screen' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Turn camera on' })).not.toBeNull();
  });
  it('shows chat work only after a runtime event and clears it on the reported terminal event', async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/now/events') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { activityStream = controller; },
          cancel() { activityStream = null; },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ state: 'awake' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    sendChatTurn.mockImplementation(async (...args: unknown[]) => {
      const onUser = args[4] as (message: Record<string, unknown>) => void;
      onUser({
        id: '51', sessionId: '41', channel: 'chat', language: 'da', role: 'dan',
        text: 'Start the task.', model: null, voiceMinutes: null, at: '2026-10-03T12:01:00.000Z',
      });
      return await new Promise((resolve) => {
        finish = () => resolve({
          id: '52', sessionId: '41', channel: 'chat', language: 'da', role: 'jarvis',
          text: 'I am ready.', model: null, voiceMinutes: null, at: '2026-10-03T12:02:00.000Z',
        });
      });
    });
    await renderSignedIn();

    await user.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Start the task.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('status', { name: 'Jarvis is working' })).toBeNull();
    await waitFor(() => expect(activityStream).not.toBeNull());
    const publish = (event: { type: string; activityId: string; source: 'chat' }) => {
      activityStream?.enqueue(new TextEncoder().encode(`event: jarvis-activity\ndata: ${JSON.stringify(event)}\n\n`));
    };
    publish({ type: 'thinking', activityId: '22222222-2222-4222-8222-222222222222', source: 'chat' });
    expect(await screen.findByRole('status', { name: 'Jarvis is thinking' })).not.toBeNull();
    const tool = (type: string, outcome?: string) => activityStream?.enqueue(new TextEncoder().encode(`event: jarvis-activity\ndata: ${JSON.stringify({
      type, activityId: '33333333-3333-4333-8333-333333333333', source: 'chat', toolName: 'web_search', ...(outcome ? { outcome } : {}),
    })}\n\n`));
    tool('tool-call-started');
    const trail = await screen.findByRole('list', { name: 'Tools Jarvis is using' });
    expect(within(trail).getByTitle('web_search · running')).not.toBeNull();
    tool('tool-call-finished', 'ok');
    expect(await within(trail).findByTitle('web_search · done')).not.toBeNull();
    expect(within(trail).getAllByRole('listitem')).toHaveLength(1);

    finish?.();
    publish({ type: 'ended', activityId: '22222222-2222-4222-8222-222222222222', source: 'chat' });
    expect(await screen.findByRole('status', { name: 'Jarvis activity ended' })).not.toBeNull();
  });

  it('hides navigation and area pages until Dan is signed in', async () => {
    render(<MemoryRouter initialEntries={['/factory/tasks']}><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
  });

  it('offers the Software Factory, Knowledge and Usage areas with a settings entry', async () => {
    await renderSignedIn();

    const areas = screen.getByRole('navigation', { name: 'Areas' });
    expect(within(areas).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Conversation',
      'Software Factory',
      'Knowledge',
      'Usage',
    ]);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });

  it('shows only the brand in the top bar, with open windows as tabs beside it and no breadcrumb', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    const context = document.querySelector('.topbar-context')!;

    expect(context.textContent).toBe('Jarvis');
    expect(document.querySelector('.app-topbar .window-tabbar')).not.toBeNull();
    await user.click(screen.getByRole('link', { name: 'Software Factory' }));
    await screen.findByRole('heading', { level: 1, name: 'Kanban' });
    expect(context.textContent).toBe('Jarvis');
    expect(screen.queryByText('Open windows appear here.')).toBeNull();
  });

  it('restores the accepted appearance across signed-in app routes', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/settings') {
        return new Response(JSON.stringify({ settings: { appearance: { theme: 'dark' } } }));
      }
      if (path === '/now') {
        return new Response(JSON.stringify({
          awayMode: false, confirmations: [], updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [],
        }));
      }
      if (path === '/database/status') return new Response(JSON.stringify({ waking: false }));
      return new Response('{}');
    });
    await renderSignedIn();

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await user.click(screen.getByRole('link', { name: 'Software Factory' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).not.toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('offers no navigation panel for areas that have a single page', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    expect(screen.queryByRole('button', { name: /area navigation/ })).toBeNull();

    for (const [area, heading] of [['Software Factory', 'Kanban'], ['Usage', 'Usage']] as const) {
      await user.click(screen.getByRole('link', { name: area }));
      await screen.findByRole('heading', { level: 1, name: heading });
      expect(screen.queryByRole('button', { name: /area navigation/ })).toBeNull();
      expect(screen.queryByRole('navigation', { name: area })).toBeNull();
    }
  });

  it('turns the camera on from the chat More menu and off from the live line', async () => {
    const user = userEvent.setup();
    let stopped = false;
    const track = {
      get readyState() { return stopped ? 'ended' : 'live'; },
      stop: vi.fn(() => { stopped = true; }),
      addEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    await renderSignedIn();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Turn camera on' }));
    expect(await screen.findByText('Camera on for Jarvis')).not.toBeNull();
    const activeCamera = screen.getByRole('button', { name: 'Camera off' });
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
      audio: false,
    });
    await user.click(activeCamera);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.queryByText('Activity, sharing and backend')).toBeNull();
    expect(screen.queryByText('Camera on for Jarvis')).toBeNull();
  });

  it('opens and closes the contextual shell panel without replacing page content', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const toggle = screen.getByRole('button', { name: 'Toggle contextual panel' });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Context' })).not.toBeNull();
    expect(screen.getByText('No relevant information is available yet.')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close context panel' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Context' })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('enables chat and explains the other unavailable main-page actions', async () => {
    await renderSignedIn();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Dan Aakesen');
    expect(screen.getByRole('heading', { level: 2, name: 'Conversation' })).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Now' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Backend' })).toBeNull();

    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Danish' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
    expect(screen.getByRole('menuitemradio', { name: 'Danish' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    expect(screen.getByRole('button', { name: 'Start voice' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('group', { name: 'Voice controls' })).toBeNull();
    expect(screen.getByText(/Your browser asks for microphone access when voice starts/)).not.toBeNull();
  });

  it('shows the Now feed and backend sleep on Settings', async () => {
    let resolveFeed!: (response: Response) => void;
    const pendingFeed = new Promise<Response>((resolve) => { resolveFeed = resolve; });
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname === '/now') return pendingFeed;
      return new Response(JSON.stringify({ state: 'awake' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    await renderSignedIn('/settings');

    for (const name of ['Now', 'Backend']) {
      expect(await screen.findByRole('heading', { level: 2, name })).not.toBeNull();
    }
    expect(screen.getByText(/Loading current activity/)).not.toBeNull();
    resolveFeed(new Response(JSON.stringify({
      awayMode: false, confirmations: [], updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [],
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    expect(await screen.findByText('No tasks are running.')).not.toBeNull();
    expect(await screen.findByText('The backend is awake.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Put the backend to sleep' })).toHaveProperty('disabled', false);
    expect(document.querySelectorAll('.now-panel')).toHaveLength(1);
  });

  it('renders bounded Now data as an allowlisted generated view after sign-in', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/now') {
        return new Response(JSON.stringify({
          awayMode: false,
          confirmations: [],
          updatedAt: '2026-10-04T00:00:00.000Z',
          running: [{
            id: '42', title: '<script>window.compromised = true</script>', project: 'Jarvis',
            agent: 'copilot', activity: 'Running tests', startedAt: '2026-10-03T23:00:00.000Z',
          }],
          items: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/now/events') return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ waking: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    await renderSignedIn('/settings');

    const title = await screen.findByRole('link', { name: '<script>window.compromised = true</script>' });
    expect(title.getAttribute('href')).toBe('/factory/tasks/42');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('Running tests')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/now',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
    );
  });

  it('keeps the session while moving between areas, settings and the main page', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    await user.click(screen.getByRole('link', { name: 'Software Factory' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Kanban');
    expect(screen.getByRole('link', { name: 'Software Factory' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Create project' })).not.toBeNull();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');
    expect(await screen.findByRole('heading', { level: 2, name: 'Projects' })).not.toBeNull();

    await user.click(screen.getByRole('link', { name: 'Jarvis home' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Dan Aakesen');
    expect(restoreProfile).toHaveBeenCalledTimes(1);
  });

  it('opens /factory/projects/3 as the page that activity links target', async () => {
    await renderSignedIn('/factory/projects/3');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Project settings');
  });

  it('parks the chat in the rail off the home page and pops it out over the current page', async () => {
    const user = userEvent.setup();
    await renderSignedIn('/factory/kanban');
    const shell = document.querySelector('.app-shell')!;
    const orb = await screen.findByRole('button', { name: 'Chat with Jarvis' });
    expect(shell.getAttribute('data-chat')).toBe('rail');
    expect(document.querySelector('.jarvis-page')?.hasAttribute('inert')).toBe(true);

    await user.click(orb);
    expect(shell.getAttribute('data-chat')).toBe('out');
    expect(document.querySelector('.jarvis-page')?.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide the chat bar' }).getAttribute('aria-expanded')).toBe('true');

    await user.click(screen.getByRole('link', { name: 'Conversation' }));
    expect(shell.getAttribute('data-chat')).toBe('home');
    expect(screen.queryByRole('button', { name: 'Chat with Jarvis' })).toBeNull();
  });

  it('opens a task address as a task window over Kanban', async () => {
    await renderSignedIn('/factory/tasks/42');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Kanban');
    expect(await screen.findByRole('heading', { level: 3, name: 'Task 42' })).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('jarvis.windows.tasks') ?? '[]')).toEqual([{ taskId: '42', title: 'Task 42' }]);
  });

  it('resolves release activity links to the owning project release view', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/factory/releases/7') return new Response(JSON.stringify({ projectId: '42' }));
      if (path === '/factory/projects/42/releases') {
        return new Response(JSON.stringify({
          project: { id: '42', name: 'Jarvis', repo: 'DanAakesen/jarvis', defaultBranch: 'main' },
          releases: [], pullRequests: [], workflowRuns: [], deployments: [], graph: null,
        }));
      }
      return new Response(JSON.stringify({ state: 'awake' }));
    });

    await renderSignedIn('/factory/releases/7');

    expect(await screen.findByRole('heading', { name: 'Jarvis releases' })).not.toBeNull();
  });

  it.each(['/factory/tasks/abc', '/factory/tasks/0', '/factory/unknown'])('treats %s as an unknown page', async (path) => {
    await renderSignedIn(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
  });
});

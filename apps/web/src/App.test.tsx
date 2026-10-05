import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
vi.mock('./conversation-history', () => ({ loadConversationHistory, createChatSession, sendChatTurn }));
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
    enableMicrophone = vi.fn(async () => {});
    setMuted = vi.fn();
    sendScreenContext = vi.fn();
  },
}));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  voiceSessions.length = 0;
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

  it('shows Dan only after Microsoft sign-in and the backend profile request succeed', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    const button = await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    await user.click(button);

    expect(await screen.findByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    expect(signIn).toHaveBeenCalledWith(expect.anything(), config);
  });

  it('shows the backend refusal and does not show a name for an unauthorized account', async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValue(new Error("This Microsoft account isn't allowed to use Jarvis."));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));

    expect((await screen.findByRole('alert')).textContent).toBe("This Microsoft account isn't allowed to use Jarvis.");
    expect(screen.queryByRole('heading', { name: /Welcome,/ })).toBeNull();
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
    expect((await screen.findByText('Waking Jarvis…')).getAttribute('role')).toBe('status');
    resolveFeed(new Response(JSON.stringify({
      awayMode: false, confirmations: [], updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [],
    })));
    await screen.findByText('No tasks are running.');
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
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

  it('shows the working indicator only while a real chat turn is pending', async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
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
    expect(await screen.findByRole('status', { name: 'Jarvis is working' })).not.toBeNull();

    finish?.();
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Jarvis is working' })).toBeNull());
  });

  it('hides navigation and area pages until Dan is signed in', async () => {
    render(<MemoryRouter initialEntries={['/factory/tasks']}><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
  });

  it('offers the Software Factory and Usage areas with a settings entry', async () => {
    await renderSignedIn();

    const areas = screen.getByRole('navigation', { name: 'Areas' });
    expect(within(areas).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Conversation',
      'Software Factory',
      'Usage',
    ]);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
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
    expect(await screen.findByRole('heading', { name: 'Tasks' })).not.toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('opens and closes the area navigation with keyboard focus returning to its toggle', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const collapse = screen.getByRole('button', { name: 'Close area navigation' });
    collapse.focus();
    await user.keyboard('{Enter}');
    const expand = screen.getByRole('button', { name: 'Expand area navigation' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(expand);
    expect(screen.queryByRole('navigation', { name: 'Jarvis' })).toBeNull();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('navigation', { name: 'Jarvis' })).not.toBeNull();
  });

  it('turns the camera on and off from the shared shell', async () => {
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

    const camera = screen.getByRole('button', { name: 'Camera off. Turn camera on.' });
    expect(camera).toHaveProperty('disabled', false);
    expect(camera.getAttribute('aria-pressed')).toBe('false');
    await user.click(camera);
    const activeCamera = await screen.findByRole('button', { name: 'Camera on. Turn camera off.' });
    expect(activeCamera.getAttribute('aria-pressed')).toBe('true');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    await user.click(activeCamera);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('region', { name: 'Conversation' }))
      .getByRole('button', { name: 'Share screen' })).toHaveProperty('disabled', false);
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
    let resolveFeed!: (response: Response) => void;
    const pendingFeed = new Promise<Response>((resolve) => { resolveFeed = resolve; });
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname === '/now') return pendingFeed;
      return new Response(JSON.stringify({ state: 'awake' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    await renderSignedIn();
    await userEvent.click(screen.getByText('Activity and backend'));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Dan Aakesen');
    for (const name of ['Conversation', 'Now', 'Backend']) {
      expect(screen.getByRole('heading', { level: 2, name })).not.toBeNull();
    }
    expect(screen.getByText(/Loading current activity/)).not.toBeNull();
    resolveFeed(new Response(JSON.stringify({
      awayMode: false, confirmations: [], updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [],
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    expect(await screen.findByText('No tasks are running.')).not.toBeNull();

    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: 'Danish' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('disabled', false);

    expect(screen.getByRole('button', { name: 'Start voice' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull();
    expect(screen.getByText(/microphone stays off until you enable it/)).not.toBeNull();
    expect(await screen.findByText('The backend is awake.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Put the backend to sleep' })).toHaveProperty('disabled', false);
  });

  it('keeps the session while moving between areas, settings and the main page', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    await user.click(screen.getByRole('link', { name: 'Software Factory' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tasks');
    expect(screen.getByRole('link', { name: 'Software Factory' }).getAttribute('aria-current')).toBe('page');
    const factory = screen.getByRole('navigation', { name: 'Software Factory' });
    expect(within(factory).getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');

    await user.click(within(factory).getByRole('link', { name: 'Projects' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Projects');

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');

    await user.click(screen.getByRole('link', { name: 'Jarvis home' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Dan Aakesen');
    expect(restoreProfile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/factory/tasks/42', 'Task 42'],
    ['/factory/projects/3', 'Project settings'],
  ])('opens %s as the page that activity links target', async (path, heading) => {
    await renderSignedIn(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
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

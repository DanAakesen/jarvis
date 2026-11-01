import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { getSignInGreeting } from './sign-in-greeting';
import { publishJob } from './jobs-store';
import { dailyCapabilitiesVersion, dailyQuerySources, factoryBoardColumnIds, isDailyQuery, type DailyQuery, type FactoryBoard, type GeneratedView, type WorkspaceCommand } from '@jarvis/contracts';
import { dailyFixture, jsonResponse } from './daily/test-support';
import { expectNoDailyInRenderedContent } from './test/visible-copy';

const {
  createAuthClient,
  hasSignedInDeviceBefore,
  isSignInRedirectPending,
  isSignInStorageEvent,
  MicrosoftSignInError,
  needsSignInInteraction,
  restoreProfile,
  signIn,
  signInFailureMessage,
  signOut,
  revokeAllOwnerSessions,
  tryAutomaticSignInRedirect,
  saveSignInReturnPath,
  takeSignInReturnPath,
  loadConversationHistory,
  createChatSession,
  sendChatTurn,
  makeAuthClient,
  voiceSessions,
} = vi.hoisted(() => {
  const account = { homeAccountId: 'dan' };
  const makeAuthClient = () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn(() => account),
    getAllAccounts: vi.fn(() => [account]),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'fixture-token' }),
  });
  return {
    createAuthClient: vi.fn(makeAuthClient),
    hasSignedInDeviceBefore: vi.fn(() => false),
    isSignInRedirectPending: vi.fn(() => false),
    isSignInStorageEvent: vi.fn(() => false),
    MicrosoftSignInError: class extends Error {},
    needsSignInInteraction: vi.fn(() => false),
    restoreProfile: vi.fn().mockResolvedValue(null),
    signIn: vi.fn(),
    signInFailureMessage: vi.fn(() => 'Microsoft sign-in did not complete. Try again.'),
    signOut: vi.fn().mockResolvedValue(undefined),
    revokeAllOwnerSessions: vi.fn().mockResolvedValue(undefined),
    tryAutomaticSignInRedirect: vi.fn().mockResolvedValue(false),
    saveSignInReturnPath: vi.fn(),
    takeSignInReturnPath: vi.fn<() => string | null>(() => null),
    loadConversationHistory: vi.fn().mockResolvedValue({ messages: [], nextCursor: null }),
    createChatSession: vi.fn(),
    sendChatTurn: vi.fn(),
    makeAuthClient,
    voiceSessions: [] as Array<{
      setCameraState: (on: boolean) => void;
      options: {
        onStatus: (status: string, message: string) => void;
        onSessionEnded?: () => void;
        onMicrophoneState?: (state: 'live') => void;
      };
    }>,
  };
});
vi.mock('./auth', () => ({
  createAuthClient, hasSignedInDeviceBefore, isSignInRedirectPending, isSignInStorageEvent,
  MicrosoftSignInError, needsSignInInteraction, restoreProfile, signIn, signInFailureMessage, signOut,
  revokeAllOwnerSessions,
  tryAutomaticSignInRedirect,
  saveSignInReturnPath, takeSignInReturnPath,
}));
vi.mock('./conversation-history', () => ({
  loadActiveChatTurns: vi.fn(async () => []),
  loadConversationHistory,
  createChatSession,
  sendChatTurn,
  waitForChatSetup: <T,>(operation: () => Promise<T>) => operation(),
}));
vi.mock('./JarvisStage', () => ({
  JarvisStage: ({ children, active }: { children?: ReactNode; active: boolean }) =>
    <div data-testid="jarvis-stage" data-active={active}>{children}</div>,
}));
vi.mock('./voice-client', () => ({
  BrowserVoiceClient: class {
    constructor(private readonly options: {
      onStatus: (status: string, message: string) => void;
      onSessionEnded?: () => void;
      onMicrophoneState?: (state: 'live') => void;
    }) {
      voiceSessions.push({ options, setCameraState: this.setCameraState });
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
    setCameraState = vi.fn();
    sendScreenContext = vi.fn();
    sendScreenContextUnavailable = vi.fn();
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
  hasSignedInDeviceBefore.mockReturnValue(false);
  restoreProfile.mockResolvedValue(null);
  revokeAllOwnerSessions.mockResolvedValue(undefined);
  isSignInRedirectPending.mockReturnValue(false);
  takeSignInReturnPath.mockReturnValue(null);
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
const permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'permissions');
const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function MemoryRouter({ children, initialEntries = ['/'], initialIndex }: { children: ReactNode; initialEntries?: string[]; initialIndex?: number }) {
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: children }], {
    initialEntries, ...(initialIndex === undefined ? {} : { initialIndex }),
  }));
  return <RouterProvider router={router} />;
}

function HistoryControls() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(-1)}>Previous page</button>
    <button onClick={() => navigate(1)}>Next page</button>
  </>;
}

function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="location">{pathname}{search}{hash}</output>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
  if (permissionsDescriptor) Object.defineProperty(navigator, 'permissions', permissionsDescriptor);
  else Reflect.deleteProperty(navigator, 'permissions');
  if (serviceWorkerDescriptor) Object.defineProperty(navigator, 'serviceWorker', serviceWorkerDescriptor);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('Jarvis routes', () => {
  it.each([
    ['/daily', '/health'],
    ['/daily?section=data', '/health?section=data'],
    ['/daily#training-targets', '/health#training-targets'],
  ])('replaces legacy route %s with %s and keeps the URL suffix', async (path, expected) => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter initialEntries={['/', path]} initialIndex={1}>
      <><App config={config} /><LocationProbe /><HistoryControls /></>
    </MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(expected));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(getSignInGreeting());
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Use a different Microsoft account' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Use a different Microsoft account' }).getAttribute('aria-describedby'))
      .toBe('signin-unavailable');
    expect(screen.getByText('Sign-in is unavailable until the backend is configured.')).not.toBeNull();
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

  it('keeps the signed-out screen text to a personal greeting and a single default Microsoft sign-in action', async () => {
    render(<MemoryRouter><App config={config} /></MemoryRouter>);
    const greeting = await screen.findByRole('heading', { level: 1 });
    const button = await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    expect(greeting.textContent).toBe(getSignInGreeting());
    expect(button.textContent).toBe('Sign in');
    expect(button.classList.contains('luminous-glass')).toBe(true);
    expect(button.classList.contains('primary-button')).toBe(false);
    expect(button.querySelector('.signin-mark')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Not signed in.')).toBeNull();
    expect(screen.queryByText(/Your personal AI platform/)).toBeNull();
  });

  it('uses account selection only from the explicit different-account action', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Use a different Microsoft account' }));

    expect(signIn).toHaveBeenCalledWith(expect.anything(), config, true);
  });

  it('exposes sign-out in Settings and returns to the sign-in screen', async () => {
    const user = userEvent.setup();
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter initialEntries={['/settings']}><App config={config} /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Account' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledWith(expect.anything(), config);
    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
  });

  it('keeps Settings available after failed all-device revocation and allows retry', async () => {
    const user = userEvent.setup();
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    revokeAllOwnerSessions
      .mockRejectedValueOnce(new Error('temporary backend failure'))
      .mockResolvedValueOnce(undefined);
    render(<MemoryRouter initialEntries={['/settings']}><App config={config} /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Account' });

    await user.click(screen.getByRole('button', { name: 'Sign out on all devices' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign out on all devices' }));

    const revokeError = await screen.findByText(
      'Could not sign out other devices. This device is still signed in.',
    );
    expect(revokeError.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Confirm sign out on all devices' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirm sign out on all devices' }));
    expect(revokeAllOwnerSessions).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).toBeTruthy();
  });

  it('does not flash the sign-in screen while silent account restoration is pending', async () => {
    let restore!: (profile: { name: string } | null) => void;
    restoreProfile.mockReturnValue(new Promise((resolve) => { restore = resolve; }));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    await waitFor(() => expect(restoreProfile).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading');
    expect(screen.getByText('Loading', { selector: '[aria-hidden="true"]' }).textContent).toBe('Loading...');
    expect(document.querySelector('.loader-core')).toBeNull();

    restore({ name: 'Test User' });
    expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
  });

  it('shows Signing you in while resuming a prior device session', async () => {
    hasSignedInDeviceBefore.mockReturnValue(true);
    let restore!: (profile: { name: string } | null) => void;
    restoreProfile.mockReturnValue(new Promise((resolve) => { restore = resolve; }));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(screen.getByRole('status').textContent).toBe('Signing you in');
    await act(async () => { restore(null); });
    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
  });

  it('shows Signing you in while returning from the Microsoft redirect', async () => {
    isSignInRedirectPending.mockReturnValue(true);
    let restore!: (profile: null) => void;
    restoreProfile.mockReturnValue(new Promise(resolve => { restore = resolve; }));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(screen.getByRole('status').textContent).toBe('Signing you in');
    expect(screen.getByText('Signing you in', { selector: '[aria-hidden="true"]' }).textContent).toBe('Signing you in...');
    expect(document.querySelector('.loader-core')).toBeNull();
    isSignInRedirectPending.mockReturnValue(false);
    await act(async () => { restore(null); });
    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
  });

  it('shows the conversation window before history finishes loading and keeps its frame afterwards', async () => {
    restoreProfile.mockResolvedValue({ name: 'Test User' });
    let resolve!: (page: { messages: []; nextCursor: null }) => void;
    loadConversationHistory.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);
    const chat = await screen.findByRole('article', { name: 'Conversation' });
    expect(within(chat).getByText('Loading conversation history.')).not.toBeNull();
    expect(within(chat).getByLabelText('Conversation history').getAttribute('aria-busy')).toBe('true');
    await act(async () => { resolve({ messages: [], nextCursor: null }); });
    expect(screen.getByRole('article', { name: 'Conversation' })).toBe(chat);
    expect(within(chat).getByText('No messages yet.')).not.toBeNull();
  });

  it('uses local time for the personal greeting', () => {
    expect(getSignInGreeting(new Date(2026, 0, 1, 4))).toBe('Good evening, Dan.');
    expect(getSignInGreeting(new Date(2026, 0, 1, 5))).toBe('Good morning, Dan.');
    expect(getSignInGreeting(new Date(2026, 0, 1, 12))).toBe('Good afternoon, Dan.');
    expect(getSignInGreeting(new Date(2026, 0, 1, 18))).toBe('Good evening, Dan.');
  });

  it('sends the page to Microsoft sign-in and waits while it navigates away', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue(undefined);
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    const button = await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    await user.click(button);

    expect(signIn).toHaveBeenCalledWith(expect.anything(), config, false);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toContain('Redirecting');
    expect(button.getAttribute('aria-label')).toBe('Redirecting');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.loader-dots')?.textContent).toBe('...');
    expect(button.querySelector('canvas')).toBeNull();
  });

  it('shows the backend refusal and does not show a name for an unauthorized account', async () => {
    restoreProfile.mockRejectedValue(new Error("This Microsoft account isn't allowed to use Jarvis."));
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect((await screen.findByRole('alert')).textContent).toBe('Sign-in needs attention.');
    expect(screen.queryByRole('heading', { name: /Welcome,/ })).toBeNull();
  });

  it('shows a concise failure and retries through the same Microsoft sign-in action', async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValueOnce(new Error('provider details')).mockResolvedValue(undefined);
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    const button = await screen.findByRole('button', { name: 'Sign in with Microsoft' });
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(button);

    expect((await screen.findByRole('alert')).textContent).toBe('Sign-in failed.');
    expect(button.textContent).toBe('Retry');
    await user.click(button);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button).toHaveProperty('disabled', true);
  });

  it('recovers from an unknown address through the home link', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/unknown/nested']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    expect(screen.getByRole('region', { name: 'Page not found' }).classList.contains('panel')).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Return to Jarvis' }));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(getSignInGreeting());
  });

  it('restores the verified name from an existing sign-in', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
    expect(restoreProfile).toHaveBeenCalledWith(expect.anything(), config, expect.any(AbortSignal));
  });

  it('loads the signed-in shell from a stored session without asking MSAL to renew', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    const authClient = makeAuthClient();
    authClient.acquireTokenSilent.mockRejectedValue(Object.assign(new Error('silent renewal blocked'), {
      errorCode: 'interaction_required',
    }));
    createAuthClient.mockReturnValue(authClient);
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });

    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('navigation', { name: 'Areas' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
    expect(authClient.acquireTokenSilent).not.toHaveBeenCalled();
    expect(authClient.loginRedirect).not.toHaveBeenCalled();
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
  async function renderSignedIn(path = '/', dailyEnabled = false) {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    const rendered = render(<MemoryRouter initialEntries={[path]}><App config={config} dailyEnabled={dailyEnabled} /></MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });
    return rendered;
  }

  // The Health pages are listed in the shell's navigation panel (the Go to sheet on a phone); a pick closes either.
  async function openHealthPage(label: string, phone = false) {
    if (phone) {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      fireEvent.click(await within(screen.getByRole('navigation', { name: 'Pages' })).findByRole('link', { name: label }));
      return;
    }
    if (!screen.queryByRole('navigation', { name: 'Health' })) fireEvent.click(screen.getByRole('button', { name: 'Expand area navigation' }));
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Health' })).findByRole('link', { name: label }));
  }

  it('keeps push settings, item route, registration and requests absent when the gate is off', async () => {
    restoreProfile.mockResolvedValue({ name: 'Test User' });
    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });

    const settings = await renderSignedIn('/settings');
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Proactive', level: 2 })).toBeNull();
    expect(register).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => {
      const path = new URL(String(url)).pathname;
      return path.startsWith('/push/') || path.startsWith('/proactive/');
    })).toBe(false);

    settings.unmount();
    await renderSignedIn('/proactive/11111111-1111-4111-8111-111111111111');
    expect(screen.getByRole('heading', { name: 'Page not found' })).not.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('adds the Proactive navigation and settings section only with its independent gate', async () => {
    restoreProfile.mockResolvedValue({ name: 'Test User' });
    render(<MemoryRouter initialEntries={['/settings']}>
      <App config={config} pushEnabled={false} proactiveEnabled />
    </MemoryRouter>);
    const navigation = await screen.findByRole('navigation', { name: 'Areas' });
    expect(within(navigation).getByRole('link', { name: 'Proactive' })).not.toBeNull();
    expect(await screen.findByRole('heading', { name: 'Proactive', level: 2 })).not.toBeNull();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      new URL(String(url)).pathname === '/proactive/settings')).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) =>
      new URL(String(url)).pathname === '/push/config')).toBe(false);
  });

  it.each([
    { daily: false, proactive: true },
    { daily: true, proactive: true },
    { daily: true, proactive: false },
  ])('lists secondary destinations beside persistent phone navigation (daily $daily, proactive $proactive)', async ({ daily, proactive }) => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    restoreProfile.mockResolvedValue({ name: 'Test User' });
    const user = userEvent.setup();
    render(<MemoryRouter><App config={config} dailyEnabled={daily} pushEnabled={false} proactiveEnabled={proactive} /></MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });
    const mobileNavigation = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    expect(mobileNavigation.getByRole('link', { name: 'Chat' })).not.toBeNull();
    expect(Boolean(mobileNavigation.queryByRole('link', { name: 'Health' }))).toBe(daily);
    expect(mobileNavigation.getByRole('button', { name: 'Workspaces' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const pages = within(within(screen.getByRole('dialog', { name: 'Go to' })).getByRole('navigation', { name: 'Pages' }));
    expect(pages.getAllByRole('link').map((link) => link.textContent)).toEqual([
      ...(proactive ? ['Proactive'] : []), 'Software Factory', 'Notes', 'Usage', 'Status', 'Settings',
    ]);
    expect(pages.queryByRole('link', { name: 'Chat' })).toBeNull();
    expect(pages.queryByRole('link', { name: 'Health' })).toBeNull();
    expect(pages.getByRole('button', { name: 'Context panel' })).not.toBeNull();
    expect(pages.queryByRole('link', { name: 'Proactive' }) !== null).toBe(proactive);
  });

  it('names every rail control in a hover label and gives each page its own selected tone', async () => {
    restoreProfile.mockResolvedValue({ name: 'Test User' });
    render(<MemoryRouter><App config={config} dailyEnabled pushEnabled={false} /></MemoryRouter>);
    const rail = within(await screen.findByRole('navigation', { name: 'Areas' }));
    const workspaces = rail.getByRole('button', { name: 'Workspaces' });
    for (const control of [...rail.getAllByRole('link'), workspaces]) {
      const name = control.getAttribute('aria-label')!;
      expect(control.getAttribute('data-rail-tip'), name).toBeTruthy();
      expect(control.getAttribute('data-tone'), name).toBeTruthy();
      expect(control.hasAttribute('title'), name).toBe(false);
    }
    expect(new Set(rail.getAllByRole('link').map((link) => link.getAttribute('data-tone'))).size).toBe(rail.getAllByRole('link').length);
    fireEvent.pointerOver(workspaces, { pointerType: 'mouse' });
    const tip = document.body.querySelector('.rail-tip')!;
    expect(tip.textContent).toBe('Workspaces');
    expect(tip.getAttribute('data-open')).toBe('true');
  });

  it('restores the notification deep link after sign-in returns to the site root', async () => {
    const itemId = '11111111-1111-4111-8111-111111111111';
    restoreProfile.mockResolvedValue({ name: 'Test User' });
    takeSignInReturnPath.mockReturnValueOnce(`/proactive/${itemId}`);
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === `/proactive/items/${itemId}`) {
        return new Response(JSON.stringify({
          id: itemId, kind: 'test', title: 'Synthetic delivery test',
          body: 'Generic notification item.', createdAt: '2026-10-17T12:00:00.000Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ state: 'awake' }), { status: 200 });
    });

    render(<MemoryRouter><App config={config} pushEnabled /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Synthetic delivery test' })).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) =>
      new URL(String(url)).pathname === `/proactive/items/${itemId}`)).toBe(true);
  });

  it('saves the protected notification path before redirecting a signed-out visitor', async () => {
    const itemId = '11111111-1111-4111-8111-111111111111';
    const path = `/proactive/${itemId}?from=notification`;
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[path]}><App config={config} pushEnabled /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));
    expect(saveSignInReturnPath).toHaveBeenCalledWith(path);
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('keeps the workspace command stream connected when navigating away from conversation', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    const eventRequests = () => fetchMock.mock.calls.filter(([url]) => (
      new URL(String(url)).pathname === '/now/events'
    ));
    await waitFor(() => expect(eventRequests()).toHaveLength(1));

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(eventRequests()).toHaveLength(1);
  });

  it('keeps one 3D stage behind every route without remounting it', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const stage = screen.getByTestId('jarvis-stage');
    expect(stage.dataset.active).toBe('true');
    await user.click(screen.getByRole('link', { name: 'Software Factory' }));
    await screen.findByRole('heading', { level: 1, name: 'Kanban' });
    expect(screen.getByTestId('jarvis-stage')).toBe(stage);
    expect(stage.dataset.active).toBe('false');

    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.getByTestId('jarvis-stage')).toBe(stage);
    expect(stage.dataset.active).toBe('false');

    await user.click(screen.getByRole('link', { name: 'Jarvis home' }));
    await screen.findByRole('textbox', { name: 'Message Jarvis' });
    expect(screen.getByTestId('jarvis-stage')).toBe(stage);
    expect(stage.dataset.active).toBe('true');
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
    await waitFor(() => expect(screen.queryByText('Waking Jarvis…')).toBeNull());
  });

  it('keeps phone voice running internally off Chat and restores its controls only on Chat', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    await renderSignedIn();
    const shell = document.querySelector('.app-shell')!;
    expect(shell.getAttribute('data-phone')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Go to' })).getByRole('link', { name: 'Settings' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(shell.getAttribute('data-voice-active')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBe(heading);
    expect(screen.queryByRole('button', { name: 'End voice' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).toBeNull();
    expect(document.querySelector('.conversation-input-slot')?.hasAttribute('hidden')).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Chat' }));
    expect(shell.getAttribute('data-voice-active')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'End voice' }));
    expect(shell.getAttribute('data-voice-active')).toBe('false');
    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).not.toBeNull();
  });

  it('enters fullscreen voice immediately and restores the typing shell when voice ends', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const shell = screen.getByRole('navigation', { name: 'Areas' }).closest('.app-shell');
    expect(shell?.getAttribute('data-voice-active')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Start voice' }));

    expect(voiceSessions[0]?.setCameraState).toHaveBeenCalledWith(false);
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

  function streamWorkspaceCommands(pinResponse?: Promise<Response>) {
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/now/events') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { activityStream = controller; },
          cancel() { activityStream = null; },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (path === '/workspace/pins') return new Response(JSON.stringify({ pins: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
      if (path.startsWith('/workspace/pins/') && init?.method === 'PUT' && pinResponse) return pinResponse;
      if (path.startsWith('/workspace/pins/') && init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (path === '/status') return new Response(JSON.stringify({
        checkedAt: new Date().toISOString(),
        entries: ['database', 'foundry.chat', 'foundry.voice', 'foundry.embeddings', 'vault_index',
          'github_app', 'google', 'pc_bridge', 'runner', 'deployed_commit', 'last_error'].map(id => ({
          id, status: 'ok', checkedAt: new Date().toISOString(),
        })),
      }));
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
      ack,
      publishCommand: (command: WorkspaceCommand) => act(() => {
        publish('workspace-command', { command, expiresAt: Date.now() + 5_000 });
      }),
      ready: () => act(() => { publish('workspace-ready', { sessionId: '12345678-1234-4234-8234-123456789abc' }); }),
      command: async (commandId: string, operation: string, viewId = 'conversation') => {
        act(() => {
          publish('workspace-command', {
            command: { commandId, operation, viewId }, expiresAt: Date.now() + 5_000,
          });
        });
        await waitFor(() => expect(ack(commandId)).toBeTruthy());
        return JSON.parse(String(ack(commandId)![1]!.body)) as { applied: boolean };
      },
    };
  }

  it.each([false, true])('leaves Daily routes, navigation and requests disabled by default (phone=%s)', async (phone) => {
    if (phone) vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const workspace = streamWorkspaceCommands();
    await renderSignedIn('/daily');
    await waitFor(() => expect(activityStream).not.toBeNull());
    if (phone) fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('link', { name: 'Health' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Health' })).toBeNull();
    workspace.ready();
    workspace.publishCommand({ commandId: 'daily-disabled', operation: 'navigate', page: 'daily' });
    await waitFor(() => expect(workspace.ack('daily-disabled')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('daily-disabled')![1]!.body))).toMatchObject({ applied: false });
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname.startsWith('/daily/'))).toBe(false);
  });

  it.each([false, true])('uses the same gated Daily page and existing refresh stream (phone=%s)', async (phone) => {
    if (phone) vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const workspace = streamWorkspaceCommands();
    const respond = fetchMock.getMockImplementation()!;
    const queries: DailyQuery[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/daily/capabilities') return jsonResponse({ module: 'daily', version: dailyCapabilitiesVersion, sources: Object.values(dailyQuerySources) });
      if (path === '/daily/query') {
        const query: unknown = JSON.parse(String(init?.body));
        if (!isDailyQuery(query)) throw new Error('Invalid synthetic Daily query');
        queries.push(query);
        return jsonResponse(dailyFixture(query, [{ metric_name: 'synthetic_shell_measurement', value: 0, unit: 'kg' }]));
      }
      return respond(input, init);
    });
    await renderSignedIn('/', true);
    const navigation = phone ? screen.getByRole('navigation', { name: 'Mobile navigation' }) : screen.getByRole('navigation', { name: 'Areas' });
    expectNoDailyInRenderedContent(document.body);
    fireEvent.click(within(navigation).getByRole('link', { name: 'Health' }));
    await screen.findByRole('heading', { name: 'Training' });
    expectNoDailyInRenderedContent(document.body);
    expect(screen.queryByRole('tablist', { name: 'Health sections' })).toBeNull();
    await openHealthPage('Data', phone);
    await screen.findByText('Synthetic shell measurement');
    fireEvent.click(screen.getByText('Source, units and coverage'));
    expect(screen.getByText('Health · metrics')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Data' })).toBeTruthy();
    expectNoDailyInRenderedContent(document.body);
    for (const label of ['Workouts', 'Nutrition', 'Body & sleep', 'Briefs', 'Data']) {
      await openHealthPage(label, phone);
      await waitFor(() => expect(screen.queryByText(`Loading ${label}`)).toBeNull());
      expectNoDailyInRenderedContent(document.body);
    }
    await waitFor(() => expect(activityStream).not.toBeNull());
    const count = queries.length;
    workspace.ready();
    workspace.publishCommand({ commandId: 'daily-current', operation: 'navigate', page: 'daily' });
    await waitFor(() => expect(workspace.ack('daily-current')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('daily-current')![1]!.body))).toMatchObject({ applied: true });
    await waitFor(() => expect(queries.length).toBeGreaterThan(count));
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/now/events')).toHaveLength(1);
  });

  it('discards cached Daily rows when the rendered signed-in account changes', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    const client = makeAuthClient();
    createAuthClient.mockReturnValue(client);
    streamWorkspaceCommands();
    const respond = fetchMock.getMockImplementation()!;
    let owner = 'first';
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/daily/capabilities') return owner === 'first'
        ? jsonResponse({ module: 'daily', version: dailyCapabilitiesVersion, sources: Object.values(dailyQuerySources) })
        : jsonResponse({ error: 'forbidden' }, 403);
      if (path === '/daily/query') {
        const query: unknown = JSON.parse(String(init?.body));
        if (!isDailyQuery(query)) throw new Error('Invalid synthetic Daily query');
        return jsonResponse(dailyFixture(query, [{ metric_name: 'synthetic_first_owner', value: 1, unit: 'kg' }]));
      }
      return respond(input, init);
    });
    function AccountHarness() {
      const [, refresh] = useState(0);
      return <><button type="button" onClick={() => refresh(value => value + 1)}>Refresh synthetic owner</button>
        <App config={config} dailyEnabled /></>;
    }
    render(<MemoryRouter initialEntries={['/daily']}><AccountHarness /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Training' });
    await openHealthPage('Data');
    await screen.findByText('Synthetic first owner');
    owner = 'second';
    client.getActiveAccount.mockReturnValue({ homeAccountId: 'second' });
    client.getAllAccounts.mockReturnValue([{ homeAccountId: 'second' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh synthetic owner' }));
    expect(screen.queryByText('Synthetic first owner')).toBeNull();
    await screen.findByText(/Health access could not be verified/u);
    expect(screen.queryByText('Synthetic first owner')).toBeNull();
  });

  it.each([200, 503])('acknowledges a broker pin only after storage replies with status %s', async (status) => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finish = resolve; });
    const stream = streamWorkspaceCommands(response);
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    stream.ready();
    const view: GeneratedView = {
      version: 1, title: 'Stored broker report', renderer: 'text',
      source: { id: 'research', status: 'complete' }, data: { format: 'plain', content: 'Broker fixture result' },
    };
    stream.publishCommand({ commandId: 'create-broker-pin', operation: 'create', viewId: 'broker-report', view });
    await waitFor(() => expect(stream.ack('create-broker-pin')).toBeTruthy());
    stream.publishCommand({ commandId: 'save-broker-pin', operation: 'pin', viewId: 'broker-report' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/workspace/pins/broker-report') && init?.method === 'PUT')).toBe(true));
    expect(stream.ack('save-broker-pin')).toBeUndefined();
    await act(async () => {
      finish(new Response(JSON.stringify(status === 200
        ? { pin: { viewId: 'broker-report', view, pinnedAt: '2026-10-12T19:00:00.000Z' } }
        : { error: 'storage_unavailable' }), { status, headers: { 'Content-Type': 'application/json' } }));
    });
    await waitFor(() => expect(stream.ack('save-broker-pin')).toBeTruthy());
    const acknowledgement: unknown = JSON.parse(String(stream.ack('save-broker-pin')![1]!.body));
    expect(acknowledgement).toMatchObject({ applied: status === 200 });
    if (status === 200) {
      const controls = screen.getAllByRole('button', { name: 'Unpin Stored broker report' });
      expect(controls).toHaveLength(2);
      expect(controls.every((control) => control.getAttribute('aria-pressed') === 'true')).toBe(true);
    } else {
      const controls = screen.getAllByRole('button', { name: 'Pin Stored broker report' });
      expect(controls).toHaveLength(2);
      expect(controls.every((control) => control.getAttribute('aria-pressed') === 'false')).toBe(true);
      expect(screen.getByText('This window could not be pinned. Try again.')).not.toBeNull();
    }
  });

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
        typeof window === 'object' && window !== null &&
        (window as { viewId?: string }).viewId === 'conversation' &&
        (window as { title?: string }).title === 'Conversation' &&
        (window as { state?: string }).state === 'open' &&
        (window as { pinned?: boolean }).pinned === false
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
    expect(historyWindow.querySelectorAll('.conversation-resize-corner')).toHaveLength(4);
    expect(historyWindow.querySelectorAll('.conversation-resize-border')).toHaveLength(8);
    expect(within(historyWindow).getByRole('button', { name: 'Move Conversation' })).not.toBeNull();
    expect(within(historyWindow).getByRole('button', { name: 'Resize Conversation height' })).not.toBeNull();
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
      expect(screen.getByRole('menuitem', { name: 'Enable video' })).not.toBeNull();
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
  it('offers no screen sharing where the browser cannot share the screen (phones)', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Share screen' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Enable video' })).not.toBeNull();
  });
  it('keeps chat progress and tool feedback in the conversation, never in the header', async () => {
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
    const header = document.querySelector('.app-topbar') as HTMLElement;

    await user.type(screen.getByRole('textbox', { name: 'Message Jarvis' }), 'Start the task.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('status', { name: 'Jarvis is working' })).toBeNull();
    await waitFor(() => expect(activityStream).not.toBeNull());
    const publish = (event: { type: string; activityId: string; source: 'chat' }) => {
      activityStream?.enqueue(new TextEncoder().encode(`event: jarvis-activity\ndata: ${JSON.stringify(event)}\n\n`));
    };
    publish({ type: 'thinking', activityId: '22222222-2222-4222-8222-222222222222', source: 'chat' });
    expect(await screen.findByText('Jarvis is thinking…')).not.toBeNull();
    expect(within(header).queryByText(/thinking|working/i)).toBeNull();
    const tool = (type: string, outcome?: string) => activityStream?.enqueue(new TextEncoder().encode(`event: jarvis-activity\ndata: ${JSON.stringify({
      type, activityId: '33333333-3333-4333-8333-333333333333', source: 'chat', toolName: 'web_search', ...(outcome ? { outcome } : {}),
    })}\n\n`));
    tool('tool-call-started');
    const trail = await screen.findByRole('list', { name: 'Tools Jarvis is using' });
    expect(within(trail).getByTitle('web_search · running')).not.toBeNull();
    expect(within(header).queryByText(/web_search|working/i)).toBeNull();
    tool('tool-call-finished', 'ok');
    expect(await within(trail).findByTitle('web_search · done')).not.toBeNull();
    expect(within(trail).getAllByRole('listitem')).toHaveLength(1);

    finish?.();
    publish({ type: 'ended', activityId: '22222222-2222-4222-8222-222222222222', source: 'chat' });
    await waitFor(() => expect(screen.queryByText('Jarvis is thinking…')).toBeNull());
    expect(within(header).queryByText(/Jarvis activity ended|web_search|thinking|working/i)).toBeNull();
    expect(header.querySelector('.topbar-working')).toBeNull();
  });

  it('keeps voice progress beneath the orb rather than duplicating it in the header', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    const header = document.querySelector('.app-topbar') as HTMLElement;
    act(() => {
      voiceSessions[0]!.options.onMicrophoneState!('live');
      voiceSessions[0]!.options.onStatus('thinking', 'Jarvis is thinking.');
    });
    const voiceStatus = document.querySelector('.voice-status') as HTMLElement;
    expect(within(voiceStatus).getByText('Thinking')).not.toBeNull();
    expect(within(header).queryByText(/thinking|working/i)).toBeNull();
    act(() => voiceSessions[0]!.options.onStatus('speaking', 'Jarvis is speaking.'));
    expect(within(voiceStatus).getByText('Speaking')).not.toBeNull();
    expect(within(header).queryByText(/speaking/i)).toBeNull();
  });

  it('hides navigation and area pages until Dan is signed in', async () => {
    render(<MemoryRouter initialEntries={['/factory/tasks']}><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
  });

  it('offers Software Factory, Notes, Usage and Status areas with a settings entry', async () => {
    await renderSignedIn();

    const areas = screen.getByRole('navigation', { name: 'Areas' });
    expect(within(areas).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Conversation',
      'Software Factory',
      'Notes',
      'Usage',
      'Status',
    ]);
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(settings.getAttribute('href')).toBe('/settings');
    expect(settings.textContent).toBe('');
    expect(settings.title).toBe('Settings');
    fireEvent.click(settings);
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    expect(settings.getAttribute('aria-current')).toBe('page');
  });

  it.each(['/notes', '/knowledge', '/knowledge/old'])('publishes canonical Notes snapshots from %s and keeps the rail canonical', async path => {
    const workspace = streamWorkspaceCommands();
    await renderSignedIn(path);
    await screen.findByRole('heading', { name: 'Notes', level: 1 });
    const link = screen.getByRole('link', { name: 'Notes' });
    expect(link.getAttribute('href')).toBe('/notes');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/now/workspace/state') &&
      (JSON.parse(String(init?.body)) as { view?: { page: string } }).view?.page === 'notes',
    )).toBe(true));
  });

  it.each(['/tasks', '/tasks/old'])('sends %s to Notes with the task list open and no Tasks area left', async path => {
    await renderSignedIn(path);
    await screen.findByRole('heading', { name: 'Notes', level: 1 });
    expect(await screen.findByRole('region', { name: 'Task list' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Notes' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });

  it('carries the search from an old Tasks link into the task list', async () => {
    await renderSignedIn('/tasks?q=mirror');
    const search = await screen.findByRole('searchbox', { name: 'Search tasks' });
    expect((search as HTMLInputElement).value).toBe('mirror');
  });

  it.each([
    { page: 'usage' as const },
    { page: 'status' as const },
    { page: 'factory' as const, issueNumber: 793 },
  ])('refuses Jarvis page navigation while a Notes draft is unsaved (%j)', async (target) => {
    streamWorkspaceCommands();
    await renderSignedIn('/notes');
    await waitFor(() => expect(activityStream).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    const draft = screen.getByRole('textbox', { name: 'Markdown' });
    expect(document.activeElement).toBe(draft);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fixture draft' } });
    fireEvent.change(draft, { target: { value: '# Fixture draft\n\n' } });
    act(() => {
      activityStream!.enqueue(new TextEncoder().encode(
        `event: workspace-ready\ndata: ${JSON.stringify({ sessionId: '12345678-1234-4234-8234-123456789abc' })}\n\n` +
        `event: workspace-command\ndata: ${JSON.stringify({
          command: { commandId: 'notes-unsaved', operation: 'navigate', ...target }, expiresAt: Date.now() + 5_000,
        })}\n\n`,
      ));
    });
    await waitFor(() => expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/commands/notes-unsaved/ack'))).toBeTruthy());
    const ack = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/commands/notes-unsaved/ack'))!;
    expect(JSON.parse(String(ack[1]?.body))).toMatchObject({ applied: false });
    expect((screen.getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toBe('# Fixture draft\n\n');
    expect(screen.getByRole('link', { name: 'Notes' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens Status from an authenticated broker command and publishes its actual page and readback', async () => {
    const workspace = streamWorkspaceCommands();
    await renderSignedIn('/settings');
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    workspace.publishCommand({ commandId: 'navigate-status', operation: 'navigate', page: 'status' });
    await screen.findByRole('heading', { level: 1, name: 'Status' });
    await screen.findByRole('listitem', { name: 'SQL database' });
    await waitFor(() => expect(workspace.ack('navigate-status')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('navigate-status')?.[1]?.body))).toMatchObject({ applied: true });
    expect(screen.getByRole('link', { name: 'Status' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => {
      if (!String(url).endsWith('/now/workspace/state')) return false;
      const body = JSON.parse(String(init?.body)) as { view?: { page: string }; windows?: { viewId: string; content?: string }[] };
      return body.view?.page === 'status' && body.windows?.some(window => window.viewId === 'page-status' && window.content?.includes('SQL database'));
    })).toBe(true));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/now/events'))).toHaveLength(1);
  });

  it.each([
    { path: '/', phone: false }, { path: '/settings', phone: false }, { path: '/status', phone: false },
    { path: '/', phone: true }, { path: '/settings', phone: true }, { path: '/status', phone: true },
  ])('commits the actual Status page before its first acknowledgement, even with a held read (%j)', async ({ path, phone }) => {
    if (phone) vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const workspace = streamWorkspaceCommands();
    const original = fetchMock.getMockImplementation()!;
    let finish!: (response: Response) => void;
    const heldStatus = new Promise<Response>((resolve) => { finish = resolve; });
    const atAcknowledgement: unknown[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/status') return heldStatus;
      if (pathname.endsWith('/commands/status-first/ack')) {
        const composer = document.getElementById('message');
        atAcknowledgement.push({
          body: JSON.parse(String(init?.body)),
          heading: screen.queryByRole('heading', { level: 1, name: 'Status' })?.textContent,
          current: screen.queryByRole('link', { name: 'Status' })?.getAttribute('aria-current'),
          home: document.querySelector('.app-shell')?.getAttribute('data-home'),
          draft: composer instanceof HTMLTextAreaElement ? composer.value : null,
        });
      }
      return original(input, init);
    });
    sessionStorage.setItem('jarvis.chat.draft', 'Unsent navigation fixture');
    await renderSignedIn(path);
    await waitFor(() => expect(activityStream).not.toBeNull());
    const input = document.getElementById('message')!;
    workspace.ready();
    workspace.publishCommand({ commandId: 'status-first', operation: 'navigate', page: 'status' });
    await waitFor(() => expect(workspace.ack('status-first')).toBeTruthy());
    expect(atAcknowledgement).toEqual([{
      body: { sessionId: '12345678-1234-4234-8234-123456789abc', applied: true },
      heading: 'Status', current: 'page', home: 'false', draft: 'Unsent navigation fixture',
    }]);
    expect(document.getElementById('message')).toBe(input);
    expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).toBe(phone ? null : input);
    expect(input).toHaveProperty('value', 'Unsent navigation fixture');
    expect(screen.queryByRole('listitem', { name: 'SQL database' })).toBeNull();
    workspace.publishCommand({ commandId: 'status-follow-up', operation: 'navigate', page: 'status' });
    await waitFor(() => expect(workspace.ack('status-follow-up')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('status-follow-up')?.[1]?.body))).toMatchObject({ applied: true });
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/now/events')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/status')).toHaveLength(1);
    await act(async () => { finish(new Response(null, { status: 503 })); });
    expect(screen.getByRole('heading', { level: 1, name: 'Status' }).closest('[hidden], [aria-hidden="true"], [inert]')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/status/smoke')).toBe(false);
  });

  it.each(['cancel', 'deadline', 'supersede', 'unmount'] as const)(
    'bounds a held Status route commit and disposes its acknowledgement owner (%s)', async (outcome) => {
      const workspace = streamWorkspaceCommands();
      let finish!: () => void;
      let started = false;
      const heldCommit = new Promise<null>((resolve) => { finish = () => resolve(null); });
      const router = createMemoryRouter([{
        path: '*',
        element: <App config={config} />,
        loader: ({ request }) => {
          if (new URL(request.url).pathname !== '/status') return null;
          started = true;
          return heldCommit;
        },
      }], { initialEntries: ['/settings'] });
      restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
      const view = render(<RouterProvider router={router} />);
      await screen.findByRole('navigation', { name: 'Areas' });
      await waitFor(() => expect(activityStream).not.toBeNull());
      workspace.ready();
      act(() => activityStream!.enqueue(new TextEncoder().encode(
        `event: workspace-command\ndata: ${JSON.stringify({
          command: { commandId: 'held-status', operation: 'navigate', page: 'status' },
          expiresAt: Date.now() + (outcome === 'deadline' ? 650 : 5000),
        })}\n\n`,
      )));
      await waitFor(() => expect(started).toBe(true));
      expect(workspace.ack('held-status')).toBeUndefined();
      expect(screen.queryByRole('heading', { level: 1, name: 'Status' })).toBeNull();
      if (outcome === 'cancel') act(() => activityStream!.enqueue(new TextEncoder().encode(
        'event: workspace-cancel\ndata: {"commandId":"held-status"}\n\n',
      )));
      if (outcome === 'supersede' || outcome === 'unmount') {
        if (outcome === 'unmount') view.unmount();
        else await act(async () => { await router.navigate('/usage'); });
      }
      if (outcome !== 'unmount') {
        await waitFor(() => expect(workspace.ack('held-status')).toBeTruthy());
        expect(JSON.parse(String(workspace.ack('held-status')?.[1]?.body))).toMatchObject({
          applied: false, outcome: 'refused',
          reason: outcome === 'deadline' ? 'The requested page did not finish opening before the command deadline.' :
            outcome === 'cancel' ? 'Page navigation was cancelled before completion.' :
              'Page navigation was superseded before completion.',
        });
        if (outcome !== 'supersede') await act(async () => { await router.navigate('/usage'); });
      } else router.dispose();
      await act(async () => { finish(); });
      if (outcome === 'unmount') expect(workspace.ack('held-status')).toBeUndefined();
      else {
        expect(screen.queryByRole('heading', { level: 1, name: 'Status' })).toBeNull();
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/commands/held-status/ack'))).toHaveLength(1);
        expect(screen.getByRole('link', { name: 'Usage' }).getAttribute('aria-current')).toBe('page');
      }
      expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/status')).toHaveLength(0);
      expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/now/events')).toHaveLength(1);
    },
  );

  it.each([4749, 4750, 4751, 5001])(
    'checks the completion clock before acknowledging a held Status route, without firing its timer (%s ms)', async (elapsed) => {
      const workspace = streamWorkspaceCommands();
      const original = fetchMock.getMockImplementation()!;
      const atAcknowledgement: unknown[] = [];
      fetchMock.mockImplementation(async (input, init) => {
        if (String(input).endsWith('/commands/commit-clock/ack')) {
          atAcknowledgement.push({
            body: JSON.parse(String(init?.body)),
            heading: screen.queryByRole('heading', { level: 1, name: 'Status' })?.textContent,
            current: screen.queryByRole('link', { name: 'Status' })?.getAttribute('aria-current'),
            at: Date.now(),
          });
        }
        return original(input, init);
      });
      let finish!: () => void;
      let started = false;
      const heldCommit = new Promise<null>((resolve) => { finish = () => resolve(null); });
      const router = createMemoryRouter([{
        path: '*', element: <App config={config} />,
        loader: ({ request }) => {
          if (new URL(request.url).pathname !== '/status') return null;
          started = true;
          return heldCommit;
        },
      }], { initialEntries: ['/settings'] });
      restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
      const view = render(<RouterProvider router={router} />);
      await screen.findByRole('navigation', { name: 'Areas' });
      await waitFor(() => expect(activityStream).not.toBeNull());
      await act(async () => { workspace.ready(); });
      const startedAt = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
      const schedule = window.setTimeout;
      const timers = vi.spyOn(window, 'setTimeout');
      let expire!: () => void;
      let timeoutFired = false;
      timers.mockImplementation((callback, delay, ...args) => {
        if (delay !== 4750) return schedule.call(window, callback, delay, ...args);
        if (typeof callback !== 'function') throw new TypeError('Expected the page deadline callback.');
        expire = () => { timeoutFired = true; callback(...args); };
        return schedule.call(window, () => {}, delay);
      });
      try {
        await act(async () => {
          workspace.publishCommand({ commandId: 'commit-clock', operation: 'navigate', page: 'status' });
        });
        expect(started).toBe(true);
        expect(timers.mock.calls.some(([, delay]) => delay === 4750)).toBe(true);
        expect(workspace.ack('commit-clock')).toBeUndefined();
        expect(screen.queryByRole('heading', { level: 1, name: 'Status' })).toBeNull();
        clock.mockReturnValue(startedAt + elapsed);
        await act(async () => { finish(); });
        expect(router.state.location.pathname).toBe('/status');
        expect(timeoutFired).toBe(false);
        expect(atAcknowledgement).toEqual([{
          body: {
            sessionId: '12345678-1234-4234-8234-123456789abc',
            ...(elapsed < 4750 ? { applied: true } : {
              applied: false, outcome: 'refused',
              reason: 'The requested page did not finish opening before the command deadline.',
            }),
          },
          heading: 'Status', current: 'page', at: startedAt + elapsed,
        }]);
        await act(async () => { expire(); });
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/commands/commit-clock/ack'))).toHaveLength(1);
      } finally {
        view.unmount();
        router.dispose();
        timers.mockRestore();
      }
    },
  );

  it.each([4749, 4750])(
    'checks the completion clock after synchronous same-page Status application (%s ms)', async (elapsed) => {
      const workspace = streamWorkspaceCommands();
      await renderSignedIn('/status');
      await waitFor(() => expect(activityStream).not.toBeNull());
      await act(async () => { workspace.ready(); });
      fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
      const content = document.getElementById('content')!;
      act(() => { screen.getByRole('button', { name: 'Close Workspaces' }).focus(); });
      expect(document.activeElement?.closest('#workspaces-pane')).not.toBeNull();
      const startedAt = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
      const advanceClock = () => { clock.mockReturnValue(startedAt + elapsed); };
      content.addEventListener('focus', advanceClock, { once: true });
      try {
        await act(async () => {
          workspace.publishCommand({ commandId: 'same-page-clock', operation: 'navigate', page: 'status' });
        });
        expect(document.activeElement).toBe(content);
        expect(Date.now()).toBe(startedAt + elapsed);
        expect(JSON.parse(String(workspace.ack('same-page-clock')?.[1]?.body))).toMatchObject(
          elapsed < 4750 ? { applied: true } : {
            applied: false, outcome: 'refused',
            reason: 'The requested page did not finish opening before the command deadline.',
          },
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Status' })).not.toBeNull();
        expect(document.querySelector('.app-shell')?.getAttribute('data-workspaces-open')).toBe('false');
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/commands/same-page-clock/ack'))).toHaveLength(1);
      } finally {
        content.removeEventListener('focus', advanceClock);
      }
    },
  );

  function issueBoard() : FactoryBoard {
    return {
      project: { id: '7', repo: 'DanAakesen/jarvis' }, fetchedAt: new Date().toISOString(), stale: false,
      columns: factoryBoardColumnIds.map((id) => ({
        id, cards: id === 'done' ? [{
          issue: { number: 793, url: 'https://github.com/DanAakesen/jarvis/issues/793', title: 'Canonical board',
            taskCode: 'P10-07', labels: ['Dan'], worker: 'Dan', state: 'closed',
            updatedAt: new Date().toISOString(), closedAt: new Date().toISOString(), blockedBy: [] },
          pr: null, task: null,
        }] : [],
      })),
    };
  }

  function serveIssueBoard(boardResponse: () => Promise<Response>) {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/factory/projects') return new Response(JSON.stringify([
        { id: '7', name: 'Jarvis', default_agent: 'copilot', policy: 'deliver_pr' },
      ]));
      if (path === '/factory/board') return boardResponse();
      return original(input, init);
    });
  }

  function currentWorkspaceView() {
    const state = fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/now/workspace/state').at(-1);
    return state ? JSON.parse(String(state[1]?.body)).view : undefined;
  }

  it('keeps the broker connected from Settings and acknowledges an issue only after revealing its real card', async () => {
    const workspace = streamWorkspaceCommands();
    let finish!: (response: Response) => void;
    serveIssueBoard(() => new Promise<Response>((resolve) => { finish = resolve; }));
    localStorage.setItem('jarvis.kanban.collapsedColumns', JSON.stringify(['Done']));
    await renderSignedIn('/settings');
    await waitFor(() => expect(activityStream).not.toBeNull());
    const stream = activityStream;
    workspace.ready();
    workspace.publishCommand({ commandId: 'open-issue', operation: 'navigate', page: 'factory', issueNumber: 793 });
    await screen.findByRole('heading', { level: 1, name: 'Kanban' });
    await waitFor(() => expect(finish).toBeDefined());
    expect(workspace.ack('open-issue')).toBeUndefined();
    expect(activityStream).toBe(stream);
    await act(async () => { finish(new Response(JSON.stringify(issueBoard()))); });
    await waitFor(() => expect(workspace.ack('open-issue')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('open-issue')?.[1]?.body))).toMatchObject({ applied: true });
    expect(screen.getByRole('link', { name: 'Canonical board' })).toBe(document.activeElement);
    expect(screen.getByRole('button', { name: 'Done' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.workspace-window-task')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/now/events')).toHaveLength(1);
    await waitFor(() => expect(currentWorkspaceView()).toMatchObject({ page: 'factory', issueNumber: 793 }));
    act(() => screen.getByRole('searchbox', { name: 'Search issues' }).focus());
    await waitFor(() => expect(currentWorkspaceView()).not.toHaveProperty('issueNumber'));
    expect(currentWorkspaceView()).toMatchObject({ previous: { page: 'factory', issueNumber: 793 } });
    act(() => screen.getByRole('link', { name: 'Canonical board' }).focus());
    await waitFor(() => expect(currentWorkspaceView()).toHaveProperty('issueNumber', 793));
    await userEvent.setup().click(screen.getByRole('link', { name: 'Usage' }));
    await waitFor(() => expect(currentWorkspaceView()).toMatchObject({ page: 'usage' }));
    expect(currentWorkspaceView()).not.toHaveProperty('issueNumber');
  });

  it('publishes actual issue focus without conflicting selectors from a previously foreground task', async () => {
    const workspace = streamWorkspaceCommands();
    serveIssueBoard(async () => new Response(JSON.stringify(issueBoard())));
    await renderSignedIn('/factory/tasks/42');
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    await waitFor(() => expect(currentWorkspaceView()).toMatchObject({ page: 'factory', taskId: '42', focusedViewId: 'task-42' }));
    workspace.publishCommand({ commandId: 'issue-after-task', operation: 'navigate', page: 'factory', issueNumber: 793 });
    await waitFor(() => expect(workspace.ack('issue-after-task')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('issue-after-task')?.[1]?.body))).toMatchObject({ applied: true });
    await waitFor(() => expect(currentWorkspaceView()).toMatchObject({ page: 'factory', issueNumber: 793 }));
    expect(currentWorkspaceView()).not.toHaveProperty('taskId');
    expect(currentWorkspaceView()).not.toHaveProperty('focusedViewId');
  });

  it.each([502, 200])('refuses an issue instead of acknowledging a route-only result (board HTTP %s)', async (status) => {
    const workspace = streamWorkspaceCommands();
    serveIssueBoard(async () => new Response(JSON.stringify(status === 200 ? issueBoard() : {}), { status }));
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    workspace.publishCommand({ commandId: 'missing-issue', operation: 'navigate', page: 'factory', issueNumber: 999 });
    await waitFor(() => expect(workspace.ack('missing-issue')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('missing-issue')?.[1]?.body)))
      .toMatchObject({ applied: false, outcome: 'refused', reason: expect.stringContaining(status === 502 ? 'HTTP 502' : 'not in') });
    expect(document.querySelector('[data-navigated]')).toBeNull();
  });

  it('cancels an in-flight issue command without navigating to a card when its board arrives later', async () => {
    const workspace = streamWorkspaceCommands();
    let finish!: (response: Response) => void;
    serveIssueBoard(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    workspace.publishCommand({ commandId: 'cancel-issue', operation: 'navigate', page: 'factory', issueNumber: 793 });
    await waitFor(() => expect(finish).toBeDefined());
    act(() => activityStream!.enqueue(new TextEncoder().encode('event: workspace-cancel\ndata: {"commandId":"cancel-issue"}\n\n')));
    await waitFor(() => expect(workspace.ack('cancel-issue')).toBeTruthy());
    expect(JSON.parse(String(workspace.ack('cancel-issue')?.[1]?.body))).toMatchObject({ applied: false, reason: expect.stringContaining('cancelled') });
    await act(async () => { finish(new Response(JSON.stringify(issueBoard()))); });
    await screen.findByRole('article', { name: 'Canonical board' });
    expect(document.querySelector('[data-navigated]')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search issues' })).toHaveProperty('value', '');
  });

  it('marks only the current desktop area as the page', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    const areas = screen.getByRole('navigation', { name: 'Areas' });
    const home = within(areas).getByRole('link', { name: 'Conversation' });
    const usage = within(areas).getByRole('link', { name: 'Usage' });
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(usage.hasAttribute('aria-current')).toBe(false);
    await user.click(usage);
    expect(usage.getAttribute('aria-current')).toBe('page');
    expect(home.hasAttribute('aria-current')).toBe(false);
    expect(areas.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('keeps phone menu expansion and current page in sync after navigation and Escape', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    await renderSignedIn();
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('mobile-menu');
    await user.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    const sheet = screen.getByRole('dialog', { name: 'Go to' });
    const usage = within(sheet).getByRole('link', { name: 'Usage' });
    const factory = within(sheet).getByRole('link', { name: 'Software Factory' });
    const notes = within(sheet).getByRole('link', { name: 'Notes' });
    expect(factory.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sheet).queryByRole('link', { name: 'Tasks' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('link', { name: 'Chat' }).getAttribute('aria-current')).toBe('page');
    expect(usage.hasAttribute('aria-current')).toBe(false);
    await user.click(usage);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    await user.click(menu);
    expect(usage.getAttribute('aria-current')).toBe('page');
    expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('link', { name: 'Chat' }).hasAttribute('aria-current')).toBe(false);
    expect(sheet.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
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

  it('hides empty phone background work after reload with server-filtered dismissals', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    streamWorkspaceCommands();
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => new URL(String(input)).pathname === '/jobs'
      ? Promise.resolve(new Response(JSON.stringify({ jobs: [], dismissedJobIds: ['11111111-1111-4111-8111-111111111111'] })))
      : respond(input, init));
    localStorage.clear();
    await renderSignedIn();
    expect(screen.queryByRole('button', { name: /Open windows/ })).toBeNull();
    expect(document.querySelector('.app-shell')!.getAttribute('data-windows-open')).toBe('false');
    await waitFor(() => expect(document.querySelector('.job-tabs')).toHaveProperty('hidden', true));
    expect(screen.queryByRole('button', { name: 'Show background work' })).toBeNull();
    expect(document.querySelector('.app-shell')!.getAttribute('data-windows-open')).toBe('false');
    expect(screen.queryByRole('button', { name: /Open windows/ })).toBeNull();
  });

  it('keeps phone job-only history reachable and open, without changing artifact restore behaviour', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const stream = streamWorkspaceCommands();
    const respond = fetchMock.getMockImplementation()!;
    const jobId = '11111111-1111-4111-8111-111111111111';
    let dismissed = false;
    let serverHasJob = false;
    const historicalJob = {
      jobId, kind: 'embedding', title: 'Re-embed memory and vault', status: 'failed', step: 1, steps: 2,
      detail: 'interrupted by restart', startedAt: '2026-10-16T08:00:00.000Z', updatedAt: '2026-10-16T08:05:07.000Z',
    };
    fetchMock.mockImplementation((input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/jobs') return Promise.resolve(new Response(JSON.stringify({
        jobs: serverHasJob && !dismissed ? [historicalJob] : [], dismissedJobIds: dismissed ? [jobId] : [],
      })));
      if (path === `/jobs/${jobId}/dismiss` && init?.method === 'POST') {
        dismissed = true;
        return Promise.resolve(new Response(JSON.stringify({ dismissedJobIds: [jobId] })));
      }
      return respond(input, init);
    });
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    expect(screen.queryByRole('button', { name: /Open windows/ })).toBeNull();
    serverHasJob = true;
    act(() => publishJob(historicalJob));
    const user = userEvent.setup();
    const shell = document.querySelector('.app-shell')!;
    await user.click(await screen.findByRole('button', { name: 'Show background work' }));
    expect(shell.getAttribute('data-windows-open')).toBe('false');
    await user.click(screen.getByRole('button', { name: /Re-embed memory and vault Memory re-embed · interrupted/ }));
    expect(shell.getAttribute('data-windows-open')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Re-embed memory and vault details' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example.com/jobs/${jobId}/dismiss`, expect.objectContaining({ method: 'POST' }));
    expect(shell.getAttribute('data-windows-open')).toBe('false');
    expect(screen.queryByRole('button', { name: /Open windows/ })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Background work: idle' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Show background work/ })).toBeNull();
    stream.ready();
    stream.publishCommand({
      commandId: 'create-header-fixture', operation: 'create', viewId: 'header-report',
      view: { version: 1, title: 'Header fixture report', renderer: 'text', source: { id: 'research', status: 'complete' },
        data: { format: 'plain', content: 'Offline header fixture result' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Open windows: 1' }));
    expect(shell.getAttribute('data-windows-open')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Show Header fixture report' }));
    expect(shell.getAttribute('data-windows-open')).toBe('false');
    stream.publishCommand({ commandId: 'minimise-header-fixture', operation: 'minimise', viewId: 'header-report' });
    const restore = await screen.findByRole('button', { name: 'Restore Header fixture report' });
    const report = document.querySelector('[data-view-id="header-report"].workspace-window')!;
    expect(report.classList.contains('workspace-window-minimized')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Open windows: 1' }));
    restore.focus();
    await user.keyboard('{Enter}');
    expect(shell.getAttribute('data-windows-open')).toBe('false');
    expect(report.classList.contains('workspace-window-minimized')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Open windows: 1' }));
    expect(shell.getAttribute('data-windows-open')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Show Header fixture report' }).querySelector('svg')!);
    expect(shell.getAttribute('data-windows-open')).toBe('false');
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

  function mockHealthBackend() {
    streamWorkspaceCommands();
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/daily/capabilities') return jsonResponse({ module: 'daily', version: dailyCapabilitiesVersion, sources: Object.values(dailyQuerySources) });
      if (path === '/daily/query') {
        const query: unknown = JSON.parse(String(init?.body));
        if (!isDailyQuery(query)) throw new Error('Invalid synthetic Health query');
        return jsonResponse(dailyFixture(query, []));
      }
      return respond(input, init);
    });
  }
  const healthPages = ['Overview', 'Workouts', 'Track workout', 'Nutrition', 'Body & sleep', 'Briefs', 'Data', 'Rules & sources'];

  it('lists the Health pages in the navigation panel, marks the current one and closes the panel on a pick', async () => {
    mockHealthBackend();
    await renderSignedIn('/', true);
    const rail = within(screen.getByRole('navigation', { name: 'Areas' }));
    expect(screen.queryByRole('navigation', { name: 'Health' })).toBeNull();

    fireEvent.click(rail.getByRole('link', { name: 'Health' }));
    const pages = within(await screen.findByRole('navigation', { name: 'Health' }));
    await pages.findByRole('link', { name: 'Overview' });
    expect(pages.getAllByRole('link').map(link => link.textContent)).toEqual(healthPages);
    expect(pages.getAllByRole('link').filter(link => link.hasAttribute('aria-current'))).toEqual([pages.getByRole('link', { name: 'Overview' })]);
    expect(pages.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('tablist', { name: 'Health sections' })).toBeNull();
    expectNoDailyInRenderedContent(document.body);

    fireEvent.click(pages.getByRole('link', { name: 'Nutrition' }));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Health' })).toBeNull());
    // The rail's Health link now only toggles the panel, so the page the owner is on is kept.
    fireEvent.click(rail.getByRole('link', { name: 'Health' }));
    const reopened = within(await screen.findByRole('navigation', { name: 'Health' }));
    expect(reopened.getByRole('link', { name: 'Nutrition' }).getAttribute('aria-current')).toBe('page');
    expect(reopened.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
    fireEvent.click(rail.getByRole('link', { name: 'Health' }));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Health' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Expand area navigation' })).toBeTruthy();
  });

  it('opens the Health page named in the address and keeps it marked in the navigation panel', async () => {
    mockHealthBackend();
    await renderSignedIn('/health?section=briefs', true);
    await screen.findByRole('heading', { level: 2, name: 'Briefs' });
    fireEvent.click(screen.getByRole('button', { name: 'Expand area navigation' }));
    const pages = within(await screen.findByRole('navigation', { name: 'Health' }));
    expect((await pages.findByRole('link', { name: 'Briefs' })).getAttribute('aria-current')).toBe('page');
    expect(pages.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/health?section=overview');
  });

  it('shows a loader in the navigation panel until the Health pages are known, then the list', async () => {
    mockHealthBackend();
    const respond = fetchMock.getMockImplementation()!;
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname === '/daily/capabilities') await held;
      return respond(input, init);
    });
    await renderSignedIn('/health', true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand area navigation' }));
    const pages = within(await screen.findByRole('navigation', { name: 'Health' }));
    expect(pages.queryAllByRole('link')).toHaveLength(0);
    expect(pages.getByText('Loading Health pages')).toBeTruthy();
    release();
    await pages.findByRole('link', { name: 'Overview' });
    expect(pages.queryByText('Loading Health pages')).toBeNull();
  });

  it('closes the navigation panel on a press outside it, and only then', async () => {
    mockHealthBackend();
    await renderSignedIn('/health', true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand area navigation' }));
    const panel = await screen.findByRole('navigation', { name: 'Health' });
    await within(panel).findByRole('link', { name: 'Overview' });
    const content = document.getElementById('content')!;
    const rail = screen.getByRole('navigation', { name: 'Areas' });
    const heading = panel.closest('aside')!.querySelector('.sidebar-heading')!;
    const press = (down: Element, up: Element = down) => { fireEvent.pointerDown(down); fireEvent.pointerUp(up); };
    const stillOpen = () => expect(screen.getByRole('navigation', { name: 'Health' })).toBeTruthy();

    press(heading);
    press(within(panel).getByRole('link', { name: 'Workouts' }));
    press(rail);
    // A press that starts inside (resizing) or ends inside is not an outside press, and a cancelled touch is not a press at all.
    press(heading, content);
    press(content, heading);
    fireEvent.pointerDown(content, { pointerType: 'touch' });
    fireEvent.pointerCancel(content, { pointerType: 'touch' });
    fireEvent.pointerUp(content, { pointerType: 'touch' });
    stillOpen();

    press(content);
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Health' })).toBeNull());
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Expand area navigation' }));

    fireEvent.click(screen.getByRole('button', { name: 'Expand area navigation' }));
    expect(await screen.findByRole('navigation', { name: 'Health' })).toBeTruthy();
  });

  it('closes Workspaces on a press outside it, as it does the area navigation, and not on a press inside it or on the rail', async () => {
    const user = userEvent.setup();
    await renderSignedIn('/');
    const shell = document.querySelector('.app-shell')!;
    await user.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(shell.getAttribute('data-workspaces-open')).toBe('true');
    const pane = document.getElementById('workspaces-pane')!;
    const content = document.getElementById('content')!;
    const press = (down: Element, up: Element = down) => { fireEvent.pointerDown(down); fireEvent.pointerUp(up); };

    press(pane);
    press(screen.getByRole('navigation', { name: 'Areas' }));
    press(pane, content);
    expect(shell.getAttribute('data-workspaces-open')).toBe('true');

    press(content);
    await waitFor(() => expect(shell.getAttribute('data-workspaces-open')).toBe('false'));
    expect(shell.getAttribute('data-navigation-open')).toBe('false');
  });

  it.each([true, false])('keeps the composer on Chat only on phones and preserves its draft (phone=%s)', async (phone) => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: phone && query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 844);
    await renderSignedIn();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Unsent navigation draft' } });
    input.focus();
    viewport.height = 480;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    const shell = document.querySelector('.app-shell')!;
    if (phone) expect(shell.getAttribute('data-keyboard-open')).toBe('true');
    if (phone) {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Go to' })).getByRole('link', { name: 'Settings' }));
    } else fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(shell.getAttribute('data-home')).toBe('false'));
    expect(input.closest('.conversation-input-slot')?.hasAttribute('hidden')).toBe(phone);
    expect(input.isConnected).toBe(true);
    expect(input).toHaveProperty('value', 'Unsent navigation draft');
    if (phone) {
      expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).toBeNull();
      expect(document.activeElement).not.toBe(input);
      expect(shell.hasAttribute('data-keyboard-open')).toBe(false);
    }
    viewport.height = 844;
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    fireEvent.click(screen.getByRole('link', { name: phone ? 'Chat' : 'Jarvis home' }));
    await waitFor(() => expect(shell.getAttribute('data-home')).toBe('true'));
    expect(input.closest('.conversation-input-slot')?.hasAttribute('hidden')).toBe(false);
    expect(input).toHaveProperty('value', 'Unsent navigation draft');
    if (phone) {
      expect(shell.getAttribute('data-keyboard-open')).toBe('false');
      input.focus();
      viewport.height = 480;
      act(() => { viewport.dispatchEvent(new Event('resize')); });
      expect(shell.getAttribute('data-keyboard-open')).toBe('true');
    }
  });

  it('hides the mobile composer for Workspaces, restores it on close or Chat, and keeps Menu as an overlay', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    await renderSignedIn();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    fireEvent.change(input, { target: { value: 'Workspaces navigation draft' } });
    const navigation = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    const shell = document.querySelector('.app-shell')!;
    await user.click(navigation.getByRole('button', { name: 'Menu' }));
    expect(input.closest('[hidden]')).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menu', { name: 'More options' })).toBeTruthy();
    expect(input.closest('[hidden]')).toBeNull();
    await user.keyboard('{Escape}');
    for (const destination of ['close', 'Chat']) {
      await user.click(navigation.getByRole('button', { name: 'Workspaces' }));
      expect(shell.getAttribute('data-home')).toBe('true');
      expect(shell.getAttribute('data-workspaces-open')).toBe('true');
      expect(input.closest('.conversation-input-slot')?.hasAttribute('hidden')).toBe(true);
      expect(screen.queryByRole('textbox', { name: 'Message Jarvis' })).toBeNull();
      expect(shell.hasAttribute('data-keyboard-open')).toBe(false);
      if (destination === 'close') await user.click(screen.getByRole('button', { name: 'Close Workspaces' }));
      else await user.click(navigation.getByRole('link', { name: 'Chat' }));
      expect(shell.getAttribute('data-workspaces-open')).toBe('false');
      expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toBe(input);
      expect(input).toHaveProperty('value', 'Workspaces navigation draft');
    }
  });

  it('keeps untouched phone startup navigation available despite composer autofocus, then follows keyboard resize', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    let height = 844;
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', height);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => height);
    await renderSignedIn();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const shell = document.querySelector('.app-shell')!;
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeTruthy();
    expect(shell.getAttribute('data-keyboard-open')).toBe('false');
    viewport.height = height = 480;
    vi.stubGlobal('innerHeight', height);
    act(() => { window.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('resize')); });
    expect(shell.getAttribute('data-keyboard-open')).toBe('true');
    viewport.height = height = 844;
    vi.stubGlobal('innerHeight', height);
    act(() => { viewport.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); });
    expect(document.activeElement).toBe(input);
    expect(shell.getAttribute('data-keyboard-open')).toBe('false');
  });

  it('keeps the dock available on short-screen startup, then hides it after tapping the focused composer', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const viewport = Object.assign(new EventTarget(), { height: 480, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 480);
    vi.stubGlobal('screen', { height: 844 });
    const layoutHeight = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(480);
    await renderSignedIn();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const shell = document.querySelector('.app-shell')!;
    expect(document.activeElement).toBe(input);
    expect(shell.getAttribute('data-keyboard-open')).toBe('false');

    fireEvent.pointerDown(input, { pointerType: 'touch', isPrimary: true });
    expect(shell.getAttribute('data-keyboard-open')).toBe('true');
    expect(navigation.isConnected).toBe(true);

    await userEvent.setup().type(input, 'Still typing');
    expect(input).toHaveProperty('value', 'Still typing');
    viewport.height = 844;
    vi.stubGlobal('innerHeight', 844);
    layoutHeight.mockReturnValue(844);
    act(() => { viewport.dispatchEvent(new Event('resize')); });
    expect(shell.getAttribute('data-keyboard-open')).toBe('false');
    expect(navigation.isConnected).toBe(true);
  });

  it('lists the Health pages under Health in the phone menu and nowhere else', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    mockHealthBackend();
    await renderSignedIn('/health', true);
    await screen.findByRole('heading', { name: 'Training' });
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const pages = within(screen.getByRole('navigation', { name: 'Pages' }));
    await pages.findByRole('link', { name: 'Overview' });
    const labels = pages.getAllByRole('link').map(link => link.textContent);
    const start = labels.indexOf('Health');
    expect(labels.slice(start, start + 1 + healthPages.length)).toEqual(['Health', ...healthPages]);
    expect(labels.filter(label => healthPages.includes(label!))).toHaveLength(healthPages.length);
    expect(pages.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(pages.getByRole('link', { name: 'Health' }).getAttribute('aria-current')).toBe('location');
    expect(screen.queryByRole('tablist', { name: 'Health sections' })).toBeNull();
  });

  it('offers no navigation panel for areas that have a single page', async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    expect(screen.queryByRole('button', { name: /area navigation/ })).toBeNull();

    for (const [area, heading] of [['Software Factory', 'Kanban'], ['Usage', 'Usage'], ['Status', 'Status']] as const) {
      await user.click(screen.getByRole('link', { name: area }));
      await screen.findByRole('heading', { level: 1, name: heading });
      expect(screen.queryByRole('button', { name: /area navigation/ })).toBeNull();
      expect(screen.queryByRole('navigation', { name: area })).toBeNull();
    }
  });

  it.each([
    ['Software Factory', '/'],
    ['Notes', '/'],
    ['Usage', '/'],
    ['Usage', '/usage'],
    ['Conversation', '/usage'],
    ['Conversation', '/'],
    ['Jarvis home', '/'],
    ['Settings', '/'],
  ])('closes Workspaces when selecting %s from %s on desktop', async (name, path) => {
    const user = userEvent.setup();
    await renderSignedIn(path);
    const shell = document.querySelector('.app-shell')!;
    const workspaces = screen.getByRole('button', { name: 'Workspaces' });
    await user.click(workspaces);
    expect(shell.getAttribute('data-workspaces-open')).toBe('true');
    await user.click(screen.getByRole('link', { name }));
    expect(shell.getAttribute('data-workspaces-open')).toBe('false');
    expect(shell.getAttribute('data-navigation-open')).toBe('false');
    expect(workspaces.getAttribute('aria-pressed')).toBe('false');
  });

  it('closes Workspaces when phone navigation selects Chat or a menu destination', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 700px'),
      media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    await renderSignedIn();
    const menu = screen.getByRole('button', { name: 'Menu' });
    const mobileNavigation = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    const shell = document.querySelector('.app-shell')!;
    for (const page of ['Chat', 'Usage', 'Usage', 'Settings']) {
      await user.click(mobileNavigation.getByRole('button', { name: 'Workspaces' }));
      expect(shell.getAttribute('data-workspaces-open')).toBe('true');
      expect(document.getElementById('workspaces-pane')?.hidden).toBe(false);
      if (page === 'Chat') await user.click(mobileNavigation.getByRole('link', { name: 'Chat' }));
      else {
        await user.click(menu);
        await user.click(within(screen.getByRole('dialog', { name: 'Go to' })).getByRole('link', { name: page }));
      }
      expect(shell.getAttribute('data-workspaces-open')).toBe('false');
      expect(mobileNavigation.getByRole('button', { name: 'Workspaces' }).getAttribute('aria-pressed')).toBe('false');
      expect(menu.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('closes Workspaces for Jarvis navigation even when the page does not change', async () => {
    const user = userEvent.setup();
    streamWorkspaceCommands();
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    act(() => {
      activityStream!.enqueue(new TextEncoder().encode(
        `event: workspace-ready\ndata: ${JSON.stringify({ sessionId: '12345678-1234-4234-8234-123456789abc' })}\n\n`,
      ));
    });
    const shell = document.querySelector('.app-shell')!;
    for (const [index, page] of ['home', 'usage'].entries()) {
      await user.click(screen.getByRole('button', { name: 'Workspaces' }));
      expect(shell.getAttribute('data-workspaces-open')).toBe('true');
      const commandId = `leave-workspaces-${index}`;
      act(() => {
        activityStream!.enqueue(new TextEncoder().encode(
          `event: workspace-command\ndata: ${JSON.stringify({
            command: { commandId, operation: 'navigate', page },
            expiresAt: Date.now() + 5_000,
          })}\n\n`,
        ));
      });
      await waitFor(() => expect(shell.getAttribute('data-workspaces-open')).toBe('false'));
      expect(document.activeElement?.closest('#workspaces-pane')).toBeNull();
      await waitFor(() => expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/commands/${commandId}/ack`))).toBeTruthy());
    }
  });

  it('does not reopen Workspaces after history navigation returns to its previous page', async () => {
    const user = userEvent.setup();
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter initialEntries={['/', '/usage']} initialIndex={1}>
      <App config={config} /><HistoryControls />
    </MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });
    await user.click(screen.getByRole('button', { name: 'Workspaces' }));
    const shell = document.querySelector('.app-shell')!;
    expect(shell.getAttribute('data-workspaces-open')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(shell.getAttribute('data-workspaces-open')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(shell.getAttribute('data-workspaces-open')).toBe('false');
  });

  it('opens a local camera preview, docks it without stopping capture, and lets Jarvis restore and close it', async () => {
    const user = userEvent.setup();
    const workspace = streamWorkspaceCommands();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let stopped = false;
    const track = {
      get readyState() { return stopped ? 'ended' : 'live'; },
      stop: vi.fn(() => { stopped = true; }),
      addEventListener: vi.fn(),
      getSettings: () => ({ facingMode: 'user' }),
    } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => { stopped = false; return stream; });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    await user.type(input, 'Keep my draft');

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Enable video' }));
    expect(await screen.findByRole('button', { name: 'Close camera preview' })).not.toBeNull();
    expect(screen.queryByText('Front camera on')).toBeNull();
    const preview = screen.getByRole('article', { name: 'Camera preview' });
    const video = within(preview).getByLabelText('Live camera preview') as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    expect(input.closest('.conversation-input')?.querySelector('.camera-status')).toBeNull();
    expect(preview.querySelector('.camera-status-control')?.getAttribute('aria-label')).toBe('Close camera preview');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
      audio: false,
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/now/workspace/state') &&
      JSON.parse(String(init?.body)).windows.some((window: { viewId: string; title: string }) =>
        window.viewId === 'camera-preview' && window.title === 'Camera preview'))).toBe(true));
    expect(await workspace.command('minimise-camera', 'minimise', 'camera-preview')).toMatchObject({ applied: true });
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    expect(track.stop).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(stream);
    expect(await workspace.command('restore-camera', 'restore', 'camera-preview')).toMatchObject({ applied: true });
    expect(preview.getAttribute('aria-hidden')).toBeNull();
    expect(await workspace.command('close-camera', 'close', 'camera-preview')).toMatchObject({ applied: true });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('article', { name: 'Camera preview' })).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe('Keep my draft');
    expect(screen.queryByText('Activity, sharing and backend')).toBeNull();
    expect(screen.queryByText('Front camera on')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/screen/frames'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Enable video' }));
    const restoredPreview = await screen.findByRole('article', { name: 'Camera preview' });
    await user.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(voiceSessions[0]?.setCameraState).toHaveBeenCalledWith(true);
    const cameraClose = restoredPreview.querySelector<HTMLButtonElement>('.camera-status-control')!;
    expect(cameraClose.getAttribute('aria-label')).toBe('Close camera preview');
    await user.click(cameraClose);
    await waitFor(() => expect(voiceSessions[0]?.setCameraState).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole('article', { name: 'Camera preview' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'End voice' }));
  });

  it.each(['granted', 'prompt'] as const)('lets Jarvis open a closed Camera preview only with %s permission', async permission => {
    const workspace = streamWorkspaceCommands();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const track = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn(), getSettings: () => ({}) } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(navigator, 'permissions', { configurable: true,
      value: { query: vi.fn(async () => ({ state: permission })) } });
    await renderSignedIn();
    await waitFor(() => expect(activityStream).not.toBeNull());
    workspace.ready();
    const result = await workspace.command('open-closed-camera', 'show', 'camera-preview');
    expect(result.applied).toBe(permission === 'granted');
    if (permission === 'granted') {
      expect(await screen.findByRole('article', { name: 'Camera preview' })).not.toBeNull();
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'user' } }),
      }));
      expect(screen.getByLabelText('Live camera preview')).not.toBeNull();
      expect(screen.queryByText('Camera on - direction unavailable')).toBeNull();
      expect(await workspace.command('close-reopened-camera', 'close', 'camera-preview')).toMatchObject({ applied: true });
      expect(track.stop).toHaveBeenCalledOnce();
    } else {
      expect(screen.queryByRole('article', { name: 'Camera preview' })).toBeNull();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(result).toMatchObject({ reason: expect.stringContaining('Camera access') });
    }
  });

  it('opens and closes the contextual shell panel without replacing page content', async () => {
    const user = userEvent.setup();
    await renderSignedIn();

    const toggle = screen.getByRole('button', { name: 'Toggle contextual panel' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('context-panel');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Context' })).not.toBeNull();
    expect(screen.getByText('No relevant information.')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome, Dan Aakesen' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close context panel' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Context' })).toBeNull();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
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

  it('keeps the feed running without exposing Now or Backend sections in Settings', async () => {
    const pendingFeed = new Promise<Response>(() => {});
    fetchMock.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname === '/now') return pendingFeed;
      return new Response(JSON.stringify({}), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    await renderSignedIn('/settings');

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Now' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Backend' })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/now')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/operations/sleep')).toBe(false);
  });

  it('keeps Nutrition targets out of Settings while Daily is off', async () => {
    await renderSignedIn('/settings');

    expect(await screen.findByRole('heading', { level: 2, name: 'Projects' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /^Nutrition targets/u })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/daily/nutrition-targets')).toBe(false);
  });

  it('shows Nutrition targets on Settings once Daily is on and reads them as the signed-in owner', async () => {
    const bound = (label: string, unit: string, min: number, max: number) => ({ label, unit, min, max });
    fetchMock.mockImplementation(async (input) => {
      const body = new URL(String(input)).pathname === '/daily/nutrition-targets'
        ? {
          targets: { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 },
          missing: [],
          updatedAt: '2026-10-17T09:30:00.000Z',
          bounds: {
            restingKcal: bound('Resting energy burn', 'kcal', 1000, 4000),
            deficitKcal: bound('Per-day deficit', 'kcal', 0, 2000),
            proteinGrams: bound('Protein target', 'g', 30, 400),
          },
        }
        : { state: 'awake' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await renderSignedIn('/settings', true);

    expect(await screen.findByRole('heading', { level: 2, name: /^Nutrition targets/u })).not.toBeNull();
    expect(((await screen.findByLabelText('Resting energy burn (kcal)')) as HTMLInputElement).value).toBe('1750');
    const read = fetchMock.mock.calls.find(([url]) => new URL(String(url)).pathname === '/daily/nutrition-targets');
    expect(read?.[0]).toBe('https://api.example.com/daily/nutrition-targets');
    expect(read?.[1]?.method).toBe('GET');
    expect(new Headers(read?.[1]?.headers).get('Authorization')).toEqual(expect.any(String));
  });

  it('shows feed attention in the header without mounting the old Now panel', async () => {
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
          items: [{
            id: '8', category: 'attention', title: '<script>window.compromised = true</script>',
            link: 'task:43', at: '2026-10-03T23:30:00.000Z',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/now/events') return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ waking: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    await renderSignedIn('/settings');

    const trigger = await screen.findByRole('button', { name: '1 item needs attention' });
    await userEvent.setup().click(trigger);
    const title = screen.getByRole('link', { name: '<script>window.compromised = true</script>' });
    expect(title.getAttribute('href')).toBe('/factory/tasks/43');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByText('Running tests')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Now' })).toBeNull();
    const nowRequest = fetchMock.mock.calls.find(([url]) => new URL(String(url)).pathname === '/now');
    expect(new Headers(nowRequest?.[1]?.headers).get('Authorization')).toEqual(expect.any(String));
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
      if (path === '/settings') {
        return new Response(JSON.stringify({ settings: { appearance: { theme: 'dark' } } }));
      }
      if (path === '/jobs') return new Response(JSON.stringify({ jobs: [] }));
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

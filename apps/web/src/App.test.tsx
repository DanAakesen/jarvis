import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const { createAuthClient, restoreProfile, signIn, loadConversationHistory, makeAuthClient } = vi.hoisted(() => {
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
    makeAuthClient,
  };
});
vi.mock('./auth', () => ({ createAuthClient, restoreProfile, signIn }));
vi.mock('./conversation-history', () => ({ loadConversationHistory }));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  createAuthClient.mockReturnValue(makeAuthClient());
  restoreProfile.mockResolvedValue(null);
  loadConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: 'awake' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Jarvis routes', () => {
  it('disables sign-in until a backend is deployed', () => {
    render(<MemoryRouter><App config={{ ...__JARVIS_CONFIG__, backendUrl: null }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Jarvis is taking shape');
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Sign-in is unavailable until the backend is deployed.')).not.toBeNull();
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
});

describe('App shell', () => {
  async function renderSignedIn(path = '/') {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter initialEntries={[path]}><App config={config} /></MemoryRouter>);
    await screen.findByRole('navigation', { name: 'Areas' });
  }

  it('hides navigation and area pages until Dan is signed in', async () => {
    render(<MemoryRouter initialEntries={['/factory/tasks']}><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
  });

  it('offers the Software Factory and Usage areas with a settings entry', async () => {
    await renderSignedIn();

    const areas = screen.getByRole('navigation', { name: 'Areas' });
    expect(within(areas).getAllByRole('link').map((link) => link.textContent)).toEqual(['Software Factory', 'Usage']);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
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

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Dan Aakesen');
    for (const name of ['Conversation', 'Now', 'Backend']) {
      expect(screen.getByRole('heading', { level: 2, name })).not.toBeNull();
    }
    expect(screen.getByText(/Loading current activity/)).not.toBeNull();
    resolveFeed(new Response(JSON.stringify({ updatedAt: '2026-10-04T00:00:00.000Z', running: [], items: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    expect(await screen.findByText('No tasks are running.')).not.toBeNull();

    expect(screen.getByRole('textbox', { name: 'Message Jarvis' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: 'Danish' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('disabled', false);

    expect(screen.getByRole('button', { name: 'Start voice' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/microphone opens after the voice session is ready/)).not.toBeNull();
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
    ['/factory/releases/7', 'Release 7'],
  ])('opens %s as the page that activity links target', async (path, heading) => {
    await renderSignedIn(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(heading);
  });

  it.each(['/factory/tasks/abc', '/factory/tasks/0', '/factory/unknown'])('treats %s as an unknown page', async (path) => {
    await renderSignedIn(path);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
  });
});

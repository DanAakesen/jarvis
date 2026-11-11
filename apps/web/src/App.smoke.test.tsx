import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const { restoreProfile } = vi.hoisted(() => ({ restoreProfile: vi.fn() }));
vi.mock('./auth', () => ({
  createAuthClient: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn(() => ({ homeAccountId: 'dan' })),
    getAllAccounts: vi.fn(() => [{ homeAccountId: 'dan' }]),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'fixture-token' }),
  }),
  hasSignedInDeviceBefore: () => false,
  isSignInRedirectPending: () => false,
  isSignInStorageEvent: () => false,
  MicrosoftSignInError: class extends Error {},
  needsSignInInteraction: () => false,
  restoreProfile,
  signIn: vi.fn(),
  signInFailureMessage: () => 'Microsoft sign-in did not complete. Try again.',
  signOut: vi.fn().mockResolvedValue(undefined),
  revokeAllOwnerSessions: vi.fn().mockResolvedValue(undefined),
  tryAutomaticSignInRedirect: vi.fn().mockResolvedValue(false),
  saveSignInReturnPath: vi.fn(),
  takeSignInReturnPath: () => null,
}));
vi.mock('./conversation-history', () => ({
  loadActiveChatTurns: vi.fn(async () => []),
  loadConversationHistory: vi.fn().mockResolvedValue({ messages: [], nextCursor: null }),
  createChatSession: vi.fn(),
  sendChatTurn: vi.fn(),
  waitForChatSetup: <T,>(operation: () => Promise<T>) => operation(),
}));
vi.mock('./JarvisStage', () => ({
  JarvisStage: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };

function MemoryRouter({ children, initialEntries = ['/'] }: { children: ReactNode; initialEntries?: string[] }) {
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: children }], { initialEntries }));
  return <RouterProvider router={router} />;
}

describe('App smoke', () => {
  beforeEach(() => {
    localStorage.clear();
    restoreProfile.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'awake' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
  });

  it('hides navigation and area pages until Dan is signed in', async () => {
    render(<MemoryRouter initialEntries={['/factory/tasks']}><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
  });

  it('renders the signed-in shell', async () => {
    restoreProfile.mockResolvedValue({ name: 'Dan Aakesen' });
    render(<MemoryRouter><App config={config} /></MemoryRouter>);

    expect(await screen.findByRole('navigation', { name: 'Areas' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull();
  });
});

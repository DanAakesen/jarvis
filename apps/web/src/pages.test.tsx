import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { beginOwnerSessionVerification } from './backend-request';
import type { SignInSession } from './useSignIn';
import { SignInPage } from './pages';

function signInSession(state: 'checking' | 'signing-in', hasOwnerSession: boolean): SignInSession {
  return {
    state,
    profile: null,
    message: '',
    signIn: async () => {},
    switchAccount: async () => {},
    signOut: async () => {},
    signOutAllDevices: async () => {},
    hasOwnerSession,
    getAccessToken: async () => 'fixture-token',
    getEntraAccessToken: async () => 'fixture-token',
    client: {} as SignInSession['client'],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sign-in loading state', () => {
  it.each(['checking', 'signing-in'] as const)('shows the shared cue after a slow owner restore while %s', async (state) => {
    vi.useFakeTimers();
    const finishVerification = beginOwnerSessionVerification();
    render(<MemoryRouter><SignInPage session={signInSession(state, true)} /></MemoryRouter>);
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('status').textContent).toBe('Waking Jarvis…');

    finishVerification();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
  });

  it('does not show the owner-session cue when no session is held', async () => {
    vi.useFakeTimers();
    const finishVerification = beginOwnerSessionVerification();
    render(<MemoryRouter><SignInPage session={signInSession('checking', false)} /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
    finishVerification();
  });
});

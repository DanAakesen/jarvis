import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { useSignIn } from './useSignIn';
import { preferEntraOwnerSession, preferOwnerSession } from './owner-session';

const auth = vi.hoisted(() => {
  const accounts: Array<{ homeAccountId: string }> = [];
  const client = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn((): { homeAccountId: string } | null => null),
    getAllAccounts: vi.fn(() => accounts),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'fixture-token' }),
  };
  return {
    accounts,
    client,
    createAuthClient: vi.fn(() => client),
    isSignInRedirectPending: vi.fn(() => false),
    hasSignedInDeviceBefore: vi.fn(() => false),
    isSignInStorageEvent: vi.fn((event: StorageEvent) =>
      event.key === 'jarvis.sign-in-device' || event.key === 'jarvis.owner-session' ||
      event.key?.startsWith('msal.') === true),
    MicrosoftSignInError: class extends Error {},
    restoreProfile: vi.fn(async () => accounts.length ? { name: 'Owner' } : null),
    confirmOwnerSession: vi.fn().mockResolvedValue('temporary'),
    revokeAllOwnerSessions: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    needsSignInInteraction: vi.fn(() => false),
    signInFailureMessage: vi.fn(() => 'Sign-in failed.'),
    tryAutomaticSignInRedirect: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('./auth', () => ({
  createAuthClient: auth.createAuthClient,
  hasSignedInDeviceBefore: auth.hasSignedInDeviceBefore,
  isSignInRedirectPending: auth.isSignInRedirectPending,
  isSignInStorageEvent: auth.isSignInStorageEvent,
  MicrosoftSignInError: auth.MicrosoftSignInError,
  needsSignInInteraction: auth.needsSignInInteraction,
  restoreProfile: auth.restoreProfile,
  signIn: auth.signIn,
  signInFailureMessage: auth.signInFailureMessage,
  signOut: auth.signOut,
  confirmOwnerSession: auth.confirmOwnerSession,
  revokeAllOwnerSessions: auth.revokeAllOwnerSessions,
  tryAutomaticSignInRedirect: auth.tryAutomaticSignInRedirect,
}));

const config: PublicConfig = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  webClientId: '22222222-2222-4222-8222-222222222222',
  apiScope: 'api://33333333-3333-4333-8333-333333333333/access_as_user',
  backendUrl: 'https://api.example.com',
};

function storeOwnerSession() {
  const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
  const record = {
    version: 1,
    backendOrigin: 'https://api.example.com',
    sessionId: 'a'.repeat(22),
    token,
    idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  };
  localStorage.setItem('jarvis.owner-session', JSON.stringify(record));
  return record;
}

beforeEach(() => {
  localStorage.clear();
  preferOwnerSession(config);
  auth.accounts.length = 0;
  auth.client.getActiveAccount.mockReturnValue(null);
  auth.client.getAllAccounts.mockImplementation(() => auth.accounts);
  auth.client.acquireTokenSilent.mockResolvedValue({ accessToken: 'fixture-token' });
  auth.revokeAllOwnerSessions.mockResolvedValue(undefined);
  auth.signOut.mockResolvedValue(undefined);
  auth.restoreProfile.mockImplementation(async () => auth.accounts.length ? { name: 'Owner' } : null);
  auth.needsSignInInteraction.mockReturnValue(false);
  auth.tryAutomaticSignInRedirect.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
  auth.accounts.length = 0;
  preferOwnerSession(config);
});

describe('useSignIn cross-tab synchronization', () => {
  it('reflects account additions and removals from another tab', async () => {
    const { result, unmount } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-out'));

    auth.accounts.push({ homeAccountId: 'shared-account' });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'msal.1.account', newValue: '{}' }));
    });
    await waitFor(() => expect(result.current.state).toBe('signed-in'));
    expect(result.current.profile).toEqual({ name: 'Owner' });

    auth.accounts.length = 0;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'msal.1.account', oldValue: '{}' }));
    });
    await waitFor(() => expect(result.current.state).toBe('signed-out'));
    expect(result.current.profile).toBeNull();

    unmount();
  });

  it('clears account state after another tab removes the device marker on sign-out', async () => {
    const { result } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-out'));
    auth.accounts.push({ homeAccountId: 'shared-account' });
    auth.restoreProfile.mockResolvedValue({ name: 'Owner' });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'msal.1.account', newValue: '{}' }));
    });
    await waitFor(() => expect(result.current.state).toBe('signed-in'));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'jarvis.sign-in-device',
        oldValue: 'previous',
        newValue: null,
      }));
    });

    expect(result.current.state).toBe('signed-out');
    expect(result.current.profile).toBeNull();
  });

  it('recovers an interaction-required token renewal with the automatic redirect', async () => {
    const account = { homeAccountId: 'shared-account' };
    auth.accounts.push(account);
    auth.client.getActiveAccount.mockReturnValue(account);
    auth.restoreProfile.mockResolvedValue({ name: 'Owner' });
    auth.client.acquireTokenSilent.mockRejectedValue(Object.assign(new Error('renewal required'), {
      errorCode: 'interaction_required',
    }));
    auth.needsSignInInteraction.mockReturnValue(true);
    auth.tryAutomaticSignInRedirect.mockResolvedValue(true);
    const { result } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-in'));

    await act(async () => {
      await expect(result.current.getAccessToken()).rejects.toThrow('Sign-in is redirecting.');
    });

    expect(auth.tryAutomaticSignInRedirect).toHaveBeenCalledWith(
      auth.client,
      config,
      expect.objectContaining({ errorCode: 'interaction_required' }),
    );
    expect(result.current.state).toBe('signing-in');
  });

  it('uses the stored session token before MSAL for the configured backend', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    const { result, unmount } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-out'));

    await expect(result.current.getAccessToken()).resolves.toBe(token);
    expect(result.current.hasOwnerSession).toBe(true);
    expect(auth.client.acquireTokenSilent).not.toHaveBeenCalled();
    unmount();
  });

  it('prefers Entra after a slow session restore until a session request succeeds', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    const account = { homeAccountId: 'shared-account' };
    auth.accounts.push(account);
    auth.client.getActiveAccount.mockReturnValue(account);
    preferEntraOwnerSession(config);
    const { result, unmount } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-in'));

    await expect(result.current.getAccessToken()).resolves.toBe('fixture-token');
    expect(auth.client.acquireTokenSilent).toHaveBeenCalledOnce();
    preferOwnerSession(config);
    await expect(result.current.getAccessToken()).resolves.toBe(token);
    unmount();
  });

  it('updates session availability when another tab removes the session key', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    const { result, unmount } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.hasOwnerSession).toBe(true));
    localStorage.removeItem('jarvis.owner-session');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'jarvis.owner-session', oldValue: 'record', newValue: null,
      }));
    });

    await waitFor(() => expect(result.current.hasOwnerSession).toBe(false));
    expect(auth.restoreProfile).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('keeps the signed-in session intact when all-device revocation fails', async () => {
    auth.accounts.push({ homeAccountId: 'owner' });
    const session = storeOwnerSession();
    auth.restoreProfile.mockResolvedValue({ name: 'Owner' });
    auth.revokeAllOwnerSessions.mockRejectedValue(new Error('temporary failure'));
    const { result } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-in'));

    await act(async () => {
      await expect(result.current.signOutAllDevices()).rejects.toThrow('temporary failure');
    });

    expect(result.current.state).toBe('signed-in');
    expect(result.current.profile).toEqual({ name: 'Owner' });
    expect(JSON.parse(localStorage.getItem('jarvis.owner-session')!)).toEqual(session);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the signed-in state when token acquisition for all-device revocation fails', async () => {
    auth.accounts.push({ homeAccountId: 'owner' });
    auth.restoreProfile.mockResolvedValue({ name: 'Owner' });
    auth.client.acquireTokenSilent.mockRejectedValue(new Error('token unavailable'));
    const { result } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-in'));

    await act(async () => {
      await expect(result.current.signOutAllDevices()).rejects.toThrow('Your Microsoft sign-in needs attention. Sign in again.');
    });

    expect(result.current.state).toBe('signed-in');
    expect(result.current.profile).toEqual({ name: 'Owner' });
    expect(auth.revokeAllOwnerSessions).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('clears local sign-in only after all-device revocation succeeds', async () => {
    auth.accounts.push({ homeAccountId: 'owner' });
    storeOwnerSession();
    auth.restoreProfile.mockResolvedValue({ name: 'Owner' });
    let finishRevocation!: () => void;
    let revoked = false;
    auth.revokeAllOwnerSessions.mockImplementation(() => new Promise<void>((resolve) => {
      finishRevocation = () => {
        revoked = true;
        resolve();
      };
    }));
    auth.signOut.mockImplementation(async () => {
      expect(revoked).toBe(true);
      localStorage.removeItem('jarvis.owner-session');
    });
    const { result } = renderHook(() => useSignIn(config));
    await waitFor(() => expect(result.current.state).toBe('signed-in'));

    let operation!: Promise<void>;
    act(() => { operation = result.current.signOutAllDevices(); });
    await waitFor(() => expect(auth.revokeAllOwnerSessions).toHaveBeenCalledOnce());
    expect(result.current.state).toBe('signed-in');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();

    await act(async () => {
      finishRevocation();
      await operation;
    });

    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('signed-out');
    expect(result.current.profile).toBeNull();
    expect(localStorage.getItem('jarvis.owner-session')).toBeNull();
  });
});

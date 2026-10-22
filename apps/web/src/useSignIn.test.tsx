import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { useSignIn } from './useSignIn';

const auth = vi.hoisted(() => {
  const accounts: Array<{ homeAccountId: string }> = [];
  const client = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getActiveAccount: vi.fn(() => null),
    getAllAccounts: vi.fn(() => accounts),
  };
  return {
    accounts,
    client,
    createAuthClient: vi.fn(() => client),
    isSignInRedirectPending: vi.fn(() => false),
    hasSignedInDeviceBefore: vi.fn(() => false),
    isSignInStorageEvent: vi.fn((event: StorageEvent) =>
      event.key === 'jarvis.sign-in-device' || event.key?.startsWith('msal.') === true),
    restoreProfile: vi.fn(async () => accounts.length ? { name: 'Owner' } : null),
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
  needsSignInInteraction: auth.needsSignInInteraction,
  restoreProfile: auth.restoreProfile,
  signIn: auth.signIn,
  signInFailureMessage: auth.signInFailureMessage,
  signOut: auth.signOut,
  tryAutomaticSignInRedirect: auth.tryAutomaticSignInRedirect,
}));

const config: PublicConfig = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  webClientId: '22222222-2222-4222-8222-222222222222',
  apiScope: 'api://33333333-3333-4333-8333-333333333333/access_as_user',
  backendUrl: 'https://api.example.com',
};

beforeEach(() => {
  auth.accounts.length = 0;
  auth.client.getActiveAccount.mockReturnValue(null);
  auth.client.getAllAccounts.mockImplementation(() => auth.accounts);
  auth.restoreProfile.mockImplementation(async () => auth.accounts.length ? { name: 'Owner' } : null);
});

afterEach(() => {
  vi.clearAllMocks();
  auth.accounts.length = 0;
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
});

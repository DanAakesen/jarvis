import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthUploadSettings } from './HealthUploadSettings';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const token = 's'.repeat(43);

describe('Health upload settings', () => {
  it('shows the exact upload contract and allows one-time create, rotate and revoke', async () => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const { action } = JSON.parse(String(init.body)) as { action: string };
        return new Response(JSON.stringify(action === 'revoke'
          ? { state: 'revoked' }
          : { state: action === 'create' ? 'created' : 'rotated', token, expiresAt: '2027-10-18T00:00:00.000Z' }));
      }
      return new Response(JSON.stringify({ state: 'empty', expiresAt: null }));
    });
    vi.stubGlobal('fetch', fetch);
    const getAccessToken = vi.fn(async () => 'synthetic-session-token');
    const getEntraAccessToken = vi.fn(async () => 'synthetic-entra-token');
    render(<HealthUploadSettings backendUrl="https://jarvis.example.test/" getAccessToken={getAccessToken}
      getEntraAccessToken={getEntraAccessToken} />);

    await screen.findByText('Credential: empty');
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization)
      .toBe(`${['Bear', 'er'].join('')} synthetic-session-token`);
    expect(screen.getByText('https://jarvis.example.test/api/health/ingest')).toBeTruthy();
    expect(screen.getByText(/POST/u)).toBeTruthy();
    expect(screen.getByText(`Authorization: ${['Bear', 'er'].join('')} <token>`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\*{6,}/u);
    expect(screen.getByText(/automation-id/u)).toBeTruthy();
    expect(screen.getByText(/session-id/u)).toBeTruthy();
    expect(screen.getByText(/each metric\/date group in one upload/u)).toBeTruthy();
    expect(screen.getByText(/up to 8 MiB/u)).toBeTruthy();
    expect(screen.getByText(/10,000 normalized rows and 8 MiB/u)).toBeTruthy();
    expect(screen.queryByText(/batching guidance is not yet qualified/u)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));
    await screen.findByLabelText('One-time bearer token');
    expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ action: 'create' }),
      headers: {
        Authorization: `${['Bear', 'er'].join('')} synthetic-entra-token`,
        'Content-Type': 'application/json',
      },
    });
    expect(getEntraAccessToken).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('One-time bearer token')).toHaveProperty('value', token);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate credential' }));
    await screen.findByText('Shown once. Copy it now.');
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ action: 'rotate' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential' }));
    await screen.findByText('Revoked');
    expect(screen.queryByLabelText('One-time bearer token')).toBeNull();
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ action: 'revoke' });
    expect(screen.getAllByRole('status')[0]?.textContent).toContain('revoked');
    expect(getEntraAccessToken).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
      .every(([, init]) => (init?.headers as Record<string, string>).Authorization ===
        `${['Bear', 'er'].join('')} synthetic-entra-token`))
      .toBe(true);
  });

  it('explains unavailable configuration and surfaces status failures with a retry', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'synthetic' }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const getAccessToken = async () => 'synthetic-session-token';
    const getEntraAccessToken = async () => 'synthetic-entra-token';
    render(<HealthUploadSettings backendUrl={null} getAccessToken={getAccessToken} getEntraAccessToken={getEntraAccessToken} />);
    expect(screen.getByText('API URL not configured')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Retry status' }) as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    render(<HealthUploadSettings backendUrl="https://jarvis.example.test" getAccessToken={getAccessToken}
      getEntraAccessToken={getEntraAccessToken} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Health upload settings could not be loaded.'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('announces an interactive sign-in before redirecting and shows the required sign-in error', async () => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => init?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'Microsoft sign-in required' }), { status: 403 })
      : new Response(JSON.stringify({ state: 'empty', expiresAt: null })));
    vi.stubGlobal('fetch', fetch);
    const getEntraAccessToken = vi.fn(async (beforeInteractiveSignIn?: () => void | Promise<void>) => {
      await beforeInteractiveSignIn?.();
      throw new Error('Sign-in is redirecting.');
    });
    render(<HealthUploadSettings backendUrl="https://jarvis.example.test" getAccessToken={async () => 'session'}
      getEntraAccessToken={getEntraAccessToken} />);
    await screen.findByText('Credential: empty');

    fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));

    expect(await screen.findByText('Changing this credential needs a fresh Microsoft sign-in.')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create credential' }) as HTMLButtonElement).disabled).toBe(false));

    getEntraAccessToken.mockImplementationOnce(async () => 'entra');
    fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(await screen.findByText('Microsoft sign-in required.')).toBeTruthy();
  });
});

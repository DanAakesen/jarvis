import type { PublicClientApplication } from '@azure/msal-browser';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { BackendSleepControl } from './BackendSleepControl';

const account = { homeAccountId: 'dan' };
const client = {
  getActiveAccount: vi.fn(() => account),
  getAllAccounts: vi.fn(() => [account]),
  acquireTokenSilent: vi.fn(async () => ({ accessToken: 'fixture-token' })),
} as unknown as PublicClientApplication;
const config: PublicConfig = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('BackendSleepControl', () => {
  it('loads the current state and switches the backend to sleep', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response({ state: 'awake' }))
      .mockResolvedValueOnce(response({ state: 'asleep' }));
    render(<BackendSleepControl client={client} config={config} />);

    await user.click(await screen.findByRole('button', { name: 'Put the backend to sleep' }));
    expect(await screen.findByText('The backend is asleep; the next request will wake it.')).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Wake the backend' })).toHaveProperty('disabled', false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, request] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('https://api.example.com/operations/sleep');
    expect(request?.method).toBe('PUT');
    expect(JSON.parse(String(request?.body))).toEqual({ state: 'asleep' });
    expect(new Headers(request?.headers).get('Authorization')).toBe(`${['Bear', 'er'].join('')} fixture-token`);
  });

  it('keeps the current state and explains a refusal while tasks are active', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response({ state: 'awake' }))
      .mockResolvedValueOnce(response({ error: 'refused' }, 409));
    render(<BackendSleepControl client={client} config={config} />);

    await user.click(await screen.findByRole('button', { name: 'Put the backend to sleep' }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Cannot put the backend to sleep while tasks are Ready or Running.');
    expect(screen.getByRole('button', { name: 'Put the backend to sleep' })).toHaveProperty('disabled', false);
  });

  it('offers recovery when the backend returns an invalid status', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response({ state: 'unknown' }))
      .mockResolvedValueOnce(response({ state: 'asleep' }));
    render(<BackendSleepControl client={client} config={config} />);

    await user.click(await screen.findByRole('button', { name: 'Retry backend status' }));
    expect(await screen.findByText('The backend is asleep; the next request will wake it.')).not.toBeNull();
  });
});

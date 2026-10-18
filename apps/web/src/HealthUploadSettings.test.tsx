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
    render(<HealthUploadSettings backendUrl="https://jarvis.example.test/" getAccessToken={async () => 'synthetic-owner-token'} />);

    await screen.findByText('Credential status: empty.');
    expect(screen.getByText('https://jarvis.example.test/api/health/ingest')).toBeTruthy();
    expect(screen.getByText(/POST/u)).toBeTruthy();
    expect(screen.getByText(`Authorization: ${['Bear', 'er'].join('')} <token>`)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\*{6,}/u);
    expect(screen.getByText(/automation-id/u)).toBeTruthy();
    expect(screen.getByText(/session-id/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));
    await screen.findByLabelText('One-time bearer token');
    expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ action: 'create' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(screen.getByLabelText('One-time bearer token')).toHaveProperty('value', token);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate credential' }));
    await screen.findByText('Credential created. Copy it now; Jarvis will not show it again.');
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ action: 'rotate' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential' }));
    await screen.findByText('Upload credential revoked.');
    expect(screen.queryByLabelText('One-time bearer token')).toBeNull();
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ action: 'revoke' });
    expect(screen.getAllByRole('status')[0]?.textContent).toContain('revoked');
  });

  it('explains unavailable configuration and surfaces status failures with a retry', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'synthetic' }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    render(<HealthUploadSettings backendUrl={null} getAccessToken={async () => 'synthetic-owner-token'} />);
    expect(screen.getByText('Unavailable until the Jarvis API URL is configured')).toBeTruthy();
    expect(screen.getByText('Actions are disabled because no configured API base URL is available.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Retry status' }) as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    render(<HealthUploadSettings backendUrl="https://jarvis.example.test" getAccessToken={async () => 'synthetic-owner-token'} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Health upload settings could not be loaded.'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

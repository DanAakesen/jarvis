import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceChip, PresenceSettings } from './Presence';
import { publishPresenceMode } from './presence-store';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('presence modes', () => {
  it('shows the live mode in the top bar, switches it and follows mode changes made by Jarvis', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return json({ mode: JSON.parse(String(init.body)).mode, source: 'dan', changedAt: '2026-10-06T20:00:00.000Z' });
      return json({ mode: 'present', source: 'dan', changedAt: '2026-10-06T19:00:00.000Z' });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PresenceChip backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Presence: Present. Change mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'On the move' }));
    expect(await screen.findByRole('button', { name: 'Presence: On the move. Change mode' })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/presence', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: 'on_the_move' }) }));

    act(() => publishPresenceMode('away'));
    expect(screen.getByRole('button', { name: 'Presence: Away. Change mode' })).not.toBeNull();
    act(() => publishPresenceMode('asleep'));
    expect(screen.getByRole('button', { name: 'Presence: Away. Change mode' })).not.toBeNull();
  });

  it('says presence is not available yet instead of guessing when the service is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/presence')
      ? json({ error: 'not found' }, 404)
      : json({ settings: { personality: { customInstructions: '' } } })));
    render(<PresenceSettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    expect(await screen.findByText(/Presence modes are not available yet/)).not.toBeNull();
    expect(await screen.findByText(/Instructions per mode are not available yet/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Present' })).toBeNull();
  });

  it('saves one instruction per mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/presence')) return json({ mode: 'away', source: 'jarvis', changedAt: null });
      if (init?.method === 'PATCH') return json({});
      return json({ settings: { personality: { customInstructions: 'Base', modeInstructions: { present: '', away: 'Be brief.', on_the_move: '' } } } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PresenceSettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const move = await screen.findByLabelText('On the move');
    fireEvent.change(move, { target: { value: 'Speak short sentences.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save mode instructions' }));

    expect(await screen.findByText(/Mode instructions saved/)).not.toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ personality: { modeInstructions: { present: '', away: 'Be brief.', on_the_move: 'Speak short sentences.' } } }),
    })));
    expect(screen.getByRole('button', { name: /^Away/ }).getAttribute('aria-pressed')).toBe('true');
  });
});

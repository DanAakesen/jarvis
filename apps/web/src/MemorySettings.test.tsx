import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemorySettings } from './MemorySettings';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('memory settings', () => {
  it('shows a neutral unavailable state when memory is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not found' }, 404)));
    render(<MemorySettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect(await screen.findByText('Memory unavailable.')).not.toBeNull();
  });

  it('shows only what Jarvis remembers from conversations, then corrects and forgets it', async () => {
    const memory = { id: '42', type: 'memory', folder: 'General', key: 'tea', content: 'Dan takes his tea with milk.', updatedAt: '2026-10-05T10:00:00.000Z' };
    const note = { id: 'vault_UGVvcGxlL0FubmEubWQ', type: 'vault_note', path: 'General/Anna.md', folder: 'General', title: 'Anna', snippet: 'Anna likes tea.' };
    let deleteStatus = 503;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/memory') return json({ items: [memory, note], count: 2, limit: 50, offset: 0, hasMore: false });
      if (url.pathname === '/memory/42' && init?.method === 'PATCH') return json({ item: { ...memory, content: 'Dan takes his tea black.' } });
      if (url.pathname === '/memory/42' && init?.method === 'DELETE') return deleteStatus === 200 ? json({ deleted: true }) : json({ error: 'unavailable' }, 503);
      if (url.pathname === '/memory/42') return json({ ...memory, history: [] });
      return json({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemorySettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    fireEvent.click(await screen.findByRole('button', { name: /tea with milk/ }));
    expect(screen.queryByRole('button', { name: /Anna/ })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/memory?folder=General&limit=50', expect.anything());
    fireEvent.change(screen.getByLabelText('Search memory'), { target: { value: 'tea' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/memory?query=tea&folder=General&limit=50', expect.anything()));

    fireEvent.change(await screen.findByLabelText('Memory text'), { target: { value: 'Dan takes his tea black.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText(/Correction saved/)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/memory/42', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ text: 'Dan takes his tea black.' }) }));

    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory', hidden: true }));
    expect(await screen.findByText(/nothing was deleted/)).not.toBeNull();

    deleteStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory', hidden: true }));
    expect(await screen.findByText('Memory forgotten.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /tea/ })).toBeNull();
  });
});
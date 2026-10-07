import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemorySettings } from './MemorySettings';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('memory settings', () => {
  it('shows that memory is not available yet when the service is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not found' }, 404)));
    render(<MemorySettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect(await screen.findByText(/Memory is not available yet/)).not.toBeNull();
  });

  it('searches, opens, corrects and asks Jarvis to forget a vault note', async () => {
    const note = { id: 'vault_UGVvcGxlL0FubmEubWQ', type: 'vault_note', path: 'People/Anna.md', folder: 'People', title: 'Anna', snippet: 'Anna likes tea.',
      updatedAt: '2026-10-05T10:00:00.000Z', source: { type: 'github', url: 'https://github.com/DanAakesen/vault/blob/master/People/Anna.md' } };
    let deleteStatus = 202;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/memory/status') return json({ lastVaultSyncAt: '2026-10-06T18:00:00.000Z', notesByFolder: { People: 2, Work: 5, Personal: 0, General: 1 }, lastIndexOutcome: { outcome: 'ok' } });
      if (url.pathname === '/memory') return json({ items: [note], count: 1, limit: 50, offset: 0, hasMore: false });
      if (url.pathname === `/memory/${note.id}` && init?.method === 'PATCH') return json({ item: { ...note, snippet: 'Anna likes coffee.' }, commitUrl: 'https://github.com/DanAakesen/vault/commit/abc123' });
      if (url.pathname === `/memory/${note.id}` && init?.method === 'DELETE') return deleteStatus === 202
        ? json({ status: 'approval_pending', message: 'approval pending in Jarvis' }, 202)
        : json({ error: 'Web approval is unavailable while Jarvis is away' }, 409);
      if (url.pathname === `/memory/${note.id}`) return json({ ...note, content: 'Anna likes tea.', history: [{ updatedAt: '2026-10-01T09:00:00.000Z', message: 'Created from a meeting note', url: 'https://github.com/DanAakesen/vault/commit/def456', content: 'Anna likes tea.' }], mayHaveMore: false });
      return json({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemorySettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    expect(await screen.findByText('People', { selector: 'li' })).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Search memory'), { target: { value: 'anna' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/memory?query=anna&limit=50', expect.anything()));
    fireEvent.click(await screen.findByRole('button', { name: /Anna/ }));
    expect(await screen.findByRole('link', { name: 'Created from a meeting note' })).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Anna likes coffee.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText(/Correction committed to your vault/)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'View commit' }).getAttribute('href')).toBe('https://github.com/DanAakesen/vault/commit/abc123');
    expect(fetchMock).toHaveBeenCalledWith(`https://api.example.com/memory/${note.id}`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ text: 'Anna likes coffee.' }) }));

    deleteStatus = 409;
    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory', hidden: true }));
    expect(await screen.findByText(/Jarvis is away/)).not.toBeNull();

    deleteStatus = 202;
    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory', hidden: true }));
    expect(await screen.findByText(/Approval pending in Jarvis/)).not.toBeNull();
  });
});
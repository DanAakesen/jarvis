import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemorySettings } from './MemorySettings';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('memory settings', () => {
  it('uses shared confirmation anatomy, preserves the editor on Escape, and returns focus', async () => {
    const user = userEvent.setup();
    const memory = { id: '42', type: 'memory', key: 'tea', content: 'Dan takes his tea with milk.' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/memory'
      ? json({ items: [memory] }) : json({ ...memory, history: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemorySettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await user.click(await screen.findByRole('button', { name: /tea with milk/ }));
    const editor = await screen.findByLabelText('Memory text');
    await user.clear(editor);
    await user.type(editor, 'Unsaved correction');
    const trigger = screen.getByRole('button', { name: 'Forget…' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Forget this memory?' });
    expect(within(dialog).getByText('Jarvis forgets it straight away; it cannot be restored.').closest('.modal-body')).not.toBeNull();
    const forget = within(dialog).getByRole('button', { name: 'Forget memory' });
    expect(forget.closest('.modal-footer')).not.toBeNull();
    expect(forget.previousElementSibling?.textContent).toBe('Keep it');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(editor).toHaveProperty('value', 'Unsaved correction');
    expect(fetchMock.mock.calls.every(([, init]: [RequestInfo | URL, RequestInit?]) => init?.method !== 'DELETE')).toBe(true);
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editor).toHaveProperty('value', 'Unsaved correction');
  });

  it('blocks Escape, backdrop, and Keep it while forgetting and prevents duplicate requests', async () => {
    const user = userEvent.setup();
    const memory = { id: '42', type: 'memory', key: 'tea', content: 'Dan takes his tea with milk.' };
    let finishDelete!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Promise<Response>((resolve) => { finishDelete = resolve; });
      return new URL(String(input)).pathname === '/memory' ? json({ items: [memory] }) : json({ ...memory, history: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemorySettings backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await user.click(await screen.findByRole('button', { name: /tea with milk/ }));
    await screen.findByLabelText('Memory text');
    await user.click(screen.getByRole('button', { name: 'Forget…' }));
    await user.click(screen.getByRole('button', { name: 'Forget memory' }));
    await waitFor(() => expect(finishDelete).toBeTypeOf('function'));
    const dialog = screen.getByRole('dialog');
    await user.keyboard('{Escape}');
    const backdrop = dialog.parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    await user.click(screen.getByRole('button', { name: 'Forgetting…' }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    finishDelete(json({ error: 'unavailable' }, 503));
    await screen.findByText(/nothing was deleted/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Memory text')).not.toBeNull();
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory' }));
    expect(await screen.findByText(/nothing was deleted/)).not.toBeNull();

    deleteStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory' }));
    expect(await screen.findByText('Memory forgotten.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /tea/ })).toBeNull();
  });
});
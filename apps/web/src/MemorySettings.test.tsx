import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';
import { MemorySettings } from './MemorySettings';

const backendUrl = 'https://fixture.invalid';
const getAccessToken = async () => 'fixture';
const memory = (id: string, content: string, type = 'memory') => ({ id, type, content });
const page = (offset: number, items: unknown[], hasMore = false) => Response.json({
  items, count: items.length, limit: 50, offset, hasMore,
});
const showMemory = () => render(<MemorySettings backendUrl={backendUrl} getAccessToken={getAccessToken} />);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings Memory', () => {
  it('scopes requests, skips vault notes, and retries the same page without losing rows', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(page(0, [memory('1', 'Keep this'), memory('v', 'Hidden note', 'vault_note')], true))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(page(50, [memory('1', 'Duplicate'), memory('2', 'Older memory')]))
      .mockResolvedValueOnce(page(0, [memory('3', 'Written by PI')]));
    vi.stubGlobal('fetch', fetch);
    showMemory();
    await screen.findByText('Keep this');
    expect(screen.queryByText('Hidden note')).toBeNull();
    click('Load more');
    await screen.findByText('More memories could not be loaded.');
    expect(screen.getByText('Keep this')).toBeTruthy();
    click('Retry');
    await screen.findByText('Older memory');
    expect(within(screen.getByRole('list', { name: 'Memories' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Load more')).toBeNull();
    click('Refresh');
    await screen.findByText('Written by PI');
    expect(screen.queryByText('Older memory')).toBeNull();
    expect(fetch.mock.calls.map(([url]) => Object.fromEntries(new URL(url).searchParams))).toEqual(
      ['0', '50', '50', '0'].map((offset) => ({ scope: 'personal', limit: '50', offset })),
    );
    expect(fetch.mock.calls.every(([, init]) => init?.cache === 'no-store')).toBe(true);
  });

  it('refreshes only while open, and recovers after an unavailable initial read', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(page(0, [memory('1', 'Available now')]))
      .mockResolvedValueOnce(page(0, [memory('2', 'New on re-open')]))
      .mockResolvedValueOnce(page(0, [memory('3', 'New on return')]));
    vi.stubGlobal('fetch', fetch);
    render(
      <CollapsibleSection storageKey="memory-test" title="Memory" persist={false} initiallyOpen={false} unmountWhenClosed>
        <MemorySettings backendUrl={backendUrl} getAccessToken={getAccessToken} />
      </CollapsibleSection>,
    );
    expect(fetch).not.toHaveBeenCalled();
    click('Memory');
    await screen.findByText('Memory unavailable.');
    click('Retry');
    await screen.findByText('Available now');
    click('Memory');
    expect(screen.queryByText('Available now')).toBeNull();
    click('Memory');
    await screen.findByText('New on re-open');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('New on return');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('ignores a superseded page when searching and requests the new query at offset zero', async () => {
    let finishPage: (response: Response) => void = () => {};
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(page(0, [memory('1', 'First page')], true))
      .mockReturnValueOnce(new Promise((resolve) => { finishPage = resolve; }))
      .mockResolvedValueOnce(page(0, [memory('3', 'Search result')]));
    vi.stubGlobal('fetch', fetch);
    showMemory();
    await screen.findByText('First page');
    click('Load more');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'exercise' } });
    await screen.findByText('Search result');
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(new URL(fetch.mock.calls[2]![0]).searchParams.get('query')).toBe('exercise');
    expect(new URL(fetch.mock.calls[2]![0]).searchParams.get('offset')).toBe('0');
    finishPage(page(50, [memory('2', 'Old result')]));
    expect(screen.queryByText('Old result')).toBeNull();
  });

  it('recovers detail reads without exposing vault notes and scopes mutations', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(page(0, [memory('1', 'Open me')]))
      .mockResolvedValueOnce(Response.json(memory('1', 'Vault detail', 'vault_note')))
      .mockResolvedValueOnce(Response.json(memory('1', 'Read my details')))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(page(0, [memory('1', 'Correction')]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(page(0, []));
    vi.stubGlobal('fetch', fetch);
    showMemory();
    fireEvent.click(await screen.findByRole('button', { name: 'Open me' }));
    await screen.findByText('Memory returned an unexpected entry.');
    expect(screen.queryByDisplayValue('Vault detail')).toBeNull();
    click('Retry');
    await screen.findByDisplayValue('Read my details');
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory text' }), { target: { value: 'Correction' } });
    click('Save correction');
    await screen.findByText('Correction saved. Jarvis uses it from the next reply.');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    click('Forget');
    await screen.findByText('No memories');
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === '/memory/1').map(([url, init]) => [
      new URL(url).searchParams.get('scope'), init?.method,
    ])).toEqual([['personal', 'GET'], ['personal', 'GET'], ['personal', 'PATCH'], ['personal', 'DELETE']]);
  });
});

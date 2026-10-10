import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolioPane } from './Folio';
import { groupFolio, isFolioItem, type FolioItem } from './folio-data';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const now = new Date('2026-10-08T12:00:00');
const item = (n: number, kind: FolioItem['kind'], title: string, createdAt: string, pinned = false): FolioItem => ({
  id: `${kind}:0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`, kind, title, createdAt, promptSummary: `Summary of ${title}`, pinned,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Folio', () => {
  it('validates items and groups them as Pinned, Today, This week and Earlier', () => {
    const items = [
      item(1, 'research', 'Old report', '2026-09-20T10:00:00'),
      item(2, 'html_app', 'Today app', '2026-10-08T09:00:00'),
      item(3, 'image', 'Pinned image', '2026-09-01T09:00:00', true),
      item(4, 'knowledge_graph', 'Graph this week', '2026-10-04T09:00:00'),
    ];
    expect(items.every(isFolioItem)).toBe(true);
    expect(isFolioItem({ ...items[0], id: 'image:00000001-aaaa-4bbb-8ccc-000000000001' })).toBe(false);
    expect(groupFolio(items, now).map((group) => [group.label, group.items.map((entry) => entry.title)])).toEqual([
      ['Pinned', ['Pinned image']], ['Today', ['Today app']], ['This week', ['Graph this week']], ['Earlier', ['Old report']],
    ]);
  });

  it('searches, filters by kind, reopens, pins and removes after confirmation', async () => {
    const report = item(1, 'research', 'Ignite research', new Date().toISOString());
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
      if (url.pathname === '/folio') return json({ items: url.searchParams.get('q') === 'nothing' ? [] : [report] });
      if (url.pathname.endsWith('/open')) return json(report);
      if (init?.method === 'PATCH') return json({ ...report, pinned: true });
      if (init?.method === 'DELETE') return json({ deleted: true });
      return json({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<FolioPane backendUrl="https://api.example.com" getAccessToken={getAccessToken} open onClose={() => {}} refreshKey={0} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Ignite research' }));
    await waitFor(() => expect(calls).toContain(`POST /folio/${encodeURIComponent(report.id)}/open`));

    fireEvent.click(screen.getByRole('button', { name: 'Pin Ignite research' }));
    expect(await screen.findByRole('region', { name: 'Pinned' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    await waitFor(() => expect(calls).toContain('GET /folio?kind=research'));

    fireEvent.change(screen.getByLabelText('Search the Folio'), { target: { value: 'nothing' } });
    expect(await screen.findByText(/Nothing matches “nothing” in Reports/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    const confirmRow = await screen.findByRole('button', { name: 'Remove Ignite research' });
    fireEvent.click(confirmRow);
    const confirm = screen.getByRole('group', { name: 'Remove Ignite research' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Removed “Ignite research” from the Folio.')).not.toBeNull();
    expect(calls).toContain(`DELETE /folio/${encodeURIComponent(report.id)}`);
  });

  it('shows an empty Folio and offers retry on failure', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async () => fail ? json({ error: 'Folio is unavailable' }, 503) : json({ items: [] })));
    render(<FolioPane backendUrl="https://api.example.com" getAccessToken={getAccessToken} open onClose={() => {}} refreshKey={0} />);
    expect(await screen.findByText('The Folio is unavailable right now.')).not.toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No saved items.')).not.toBeNull();
  });
});

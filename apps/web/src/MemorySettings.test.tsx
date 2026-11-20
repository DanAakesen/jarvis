import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemorySettings } from './MemorySettings';
import { loadKnowledgeNote } from './knowledge/knowledge-data';

const activity = vi.hoisted(() => ({
  current: null as {
    type: 'tool-call-finished';
    activityId: string;
    source: 'chat' | 'voice';
    toolName: string;
    outcome: 'ok';
  } | null,
}));

vi.mock('./activity-context', () => ({
  useJarvisActivity: () => ({ latestActivity: activity.current }),
}));

afterEach(() => {
  activity.current = null;
  vi.unstubAllGlobals();
});

function memory(id: string, text: string) {
  return {
    id,
    type: 'memory',
    title: `memory-${id}`,
    folder: 'General',
    content: text,
    updatedAt: '2026-11-20T04:00:00.000Z',
  };
}

it('loads memory-only pages and keeps Load more on the correct SQL offset', async () => {
  const requests: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    const offset = Number(url.searchParams.get('offset'));
    const items = offset === 0
      ? [
        memory('1', 'Afternoon appointments.'),
        { ...memory('vault', 'A note that must stay in Knowledge'), id: 'vault_abc', type: 'vault_note' },
      ]
      : [memory('2', 'Morning meetings.')];
    return new Response(JSON.stringify({
      items,
      count: items.length,
      limit: 50,
      offset,
      hasMore: offset === 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));

  render(<MemorySettings backendUrl="https://api.example.test" getAccessToken={async () => 'fixture'} />);
  expect(await screen.findByText('Afternoon appointments.')).not.toBeNull();
  expect(screen.queryByText('A note that must stay in Knowledge')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Morning meetings.')).not.toBeNull();
  expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '2']);
});

it('advances past a raw page containing only Vault notes', async () => {
  const offsets: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const offset = url.searchParams.get('offset') ?? '0';
    offsets.push(offset);
    const items = offset === '0'
      ? [
        { ...memory('vault-1', 'First note'), id: 'vault_abc', type: 'vault_note' },
        { ...memory('vault-2', 'Second note'), id: 'vault_def', type: 'vault_note' },
      ]
      : [memory('3', 'The next real memory.')];
    return new Response(JSON.stringify({
      items,
      count: items.length,
      limit: 50,
      offset: Number(offset),
      hasMore: offset === '0',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));

  render(<MemorySettings backendUrl="https://api.example.test" getAccessToken={async () => 'fixture'} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('The next real memory.')).not.toBeNull();
  expect(offsets).toEqual(['0', '2']);
});

it('refreshes the first page after a successful Chat or Voice memory write', async () => {
  let refreshed = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    items: refreshed
      ? [memory('2', 'Prefers mornings now.')]
      : [memory('1', 'Prefers afternoons.')],
    count: 1,
    limit: 50,
    offset: 0,
    hasMore: false,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  const getAccessToken = async () => 'fixture';
  const view = render(
    <MemorySettings backendUrl="https://api.example.test" getAccessToken={getAccessToken} />,
  );
  expect(await screen.findByText('Prefers afternoons.')).not.toBeNull();

  refreshed = true;
  activity.current = {
    type: 'tool-call-finished',
    activityId: '00000000-0000-4000-8000-000000000001',
    source: 'voice',
    toolName: 'memory_correct',
    outcome: 'ok',
  };
  view.rerender(<MemorySettings backendUrl="https://api.example.test" getAccessToken={getAccessToken} />);
  expect(await screen.findByText('Prefers mornings now.')).not.toBeNull();
});

it('opens Vault Knowledge through the Notes contract, never through Memory', async () => {
  let requested = '';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    requested = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).toString();
    return new Response(JSON.stringify({
      path: 'Personal/Preferences.md',
      content: '---\ntags: private\n---\nA Vault note.',
      sha: 'a'.repeat(40),
      url: 'https://github.com/DanAakesen/vault/blob/master/Personal/Preferences.md',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const note = await loadKnowledgeNote(
    'https://api.example.test',
    async () => 'fixture',
    {
      id: 'graph-node',
      path: 'Personal/Preferences.md',
      title: 'Preferences',
      folder: 'Personal',
      updatedAt: '2026-11-20T04:00:00.000Z',
    },
  );
  expect(requested).toContain('/notes/note?path=Personal%2FPreferences.md');
  expect(requested).not.toContain('/memory/');
  expect(note.content).toBe('A Vault note.');
});

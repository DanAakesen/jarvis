import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesArea } from './NotesArea';
import { notePathFor, slugifyTitle } from './notes-data';

const sha = (digit: string) => digit.repeat(40);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const getAccessToken = async () => 'token';
const list = [
  { path: 'Work/Roadmap.md', title: 'Roadmap', folder: 'Work', updatedAt: '2026-10-10T10:00:00.000Z' },
  { path: 'People/Anna.md', title: 'Anna', folder: 'People', updatedAt: '2026-10-09T10:00:00.000Z' },
];

interface Call { method: string; path: string; search: URLSearchParams; body: Record<string, string> | null }
function stubBackend(handler: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = { method: init?.method ?? 'GET', path: url.pathname, search: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return handler(call) ?? json({ error: 'unexpected' }, 500);
  }));
  return calls;
}
const renderNotes = (route = '/notes') => render(
  <MemoryRouter initialEntries={[route]}>
    <Routes><Route path="notes/*" element={<NotesArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />} /></Routes>
  </MemoryRouter>,
);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('note paths', () => {
  it('builds a safe slug and path', () => {
    expect(slugifyTitle('  Q4 plan: <draft>/../x?  ')).toBe('Q4-plan-draft-x');
    expect(slugifyTitle('Æble & grød')).toBe('Æble-grød');
    expect(slugifyTitle('...')).toBe('');
    expect(notePathFor('Work', 'Weekly sync')).toBe('Work/Weekly-sync.md');
    expect(notePathFor('Work', '???')).toBeNull();
    expect(slugifyTitle('a'.repeat(300))).toHaveLength(100);
  });
});

describe('Notes page', () => {
  it('lists notes, filters by folder and searches', async () => {
    const calls = stubBackend(({ path }) => path === '/notes' ? json({ notes: list, limit: 50, offset: 0, hasMore: false }) : undefined);
    const user = userEvent.setup();
    renderNotes();
    expect(await screen.findByRole('button', { name: /Roadmap/ })).not.toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Folder' }), 'People');
    await waitFor(() => expect(calls.at(-1)?.search.get('folder')).toBe('People'));
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'anna');
    await waitFor(() => expect(calls.at(-1)?.search.get('query')).toBe('anna'), { timeout: 2000 });
  });

  it('shows empty and error states with retry', async () => {
    let fail = true;
    stubBackend(({ path }) => path === '/notes'
      ? (fail ? json({ error: 'Vault index is not ready' }, 503) : json({ notes: [], limit: 50, offset: 0, hasMore: false }))
      : undefined);
    const user = userEvent.setup();
    renderNotes();
    expect((await screen.findByRole('alert')).textContent).toBe('Vault index is not ready');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No notes yet. Create the first one.')).not.toBeNull();
  });

  it('opens a note, previews it and saves with the loaded sha', async () => {
    let content = '# Roadmap\n\nOld';
    let current = sha('a');
    const calls = stubBackend(({ method, path, body }) => {
      if (path === '/notes') return json({ notes: list, limit: 50, offset: 0, hasMore: false });
      if (path === '/notes/note' && method === 'GET') return json({ path: 'Work/Roadmap.md', content, sha: current, url: 'https://github.com/x/y' });
      if (path === '/notes/note' && method === 'PUT') {
        content = body!.content!;
        current = sha('b');
        return json({ path: 'Work/Roadmap.md', commit: sha('c'), url: 'https://github.com/x/y/commit/c' });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderNotes();
    await user.click(await screen.findByRole('button', { name: /Roadmap/ }));
    const source = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown source' });
    expect(source.value).toBe('# Roadmap\n\nOld');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(source);
    await user.type(source, '# Roadmap{enter}New');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(within(screen.getByRole('region', { name: 'Preview' })).getByRole('heading', { name: 'Roadmap' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
    expect(calls.find(({ method }) => method === 'PUT')?.body).toMatchObject({ path: 'Work/Roadmap.md', content: '# Roadmap\nNew', sha: sha('a') });
  });

  it('shows the 409 recovery with compare and reload', async () => {
    const calls = stubBackend(({ method, path }) => {
      if (path === '/notes') return json({ notes: list, limit: 50, offset: 0, hasMore: false });
      if (path === '/notes/note' && method === 'GET') return json({ path: 'Work/Roadmap.md', content: 'mine-base', sha: sha('a'), url: 'https://github.com/x/y' });
      if (path === '/notes/note' && method === 'PUT') return json({ error: 'The note changed since it was loaded', currentSha: sha('d'), content: 'theirs' }, 409);
      return undefined;
    });
    const user = userEvent.setup();
    renderNotes('/notes?note=Work%2FRoadmap.md');
    const source = await screen.findByRole('textbox', { name: 'Markdown source' });
    await user.type(source, ' edit');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByText('This note changed elsewhere since you opened it.');
    expect(alert).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(within(screen.getByRole('region', { name: 'Latest version' })).getByText('theirs')).not.toBeNull();
    expect(within(screen.getByRole('region', { name: 'Your version' })).getByText('mine-base edit')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keep my version' }));
    expect(screen.queryByText('This note changed elsewhere since you opened it.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter(({ method }) => method === 'PUT')).toHaveLength(2));
    expect(calls.filter(({ method }) => method === 'PUT')[1]?.body?.sha).toBe(sha('d'));
    await user.click(await screen.findByRole('button', { name: 'Reload latest (discard my edits)' }));
    expect((screen.getByRole('textbox', { name: 'Markdown source' }) as HTMLTextAreaElement).value).toBe('theirs');
  });

  it('asks before discarding unsaved edits', async () => {
    stubBackend(({ method, path }) => {
      if (path === '/notes') return json({ notes: list, limit: 50, offset: 0, hasMore: false });
      if (path === '/notes/note' && method === 'GET') return json({ path: 'Work/Roadmap.md', content: 'text', sha: sha('a'), url: 'https://github.com/x/y' });
      return undefined;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderNotes('/notes?note=Work%2FRoadmap.md');
    await user.type(await screen.findByRole('textbox', { name: 'Markdown source' }), ' more');
    await user.click(screen.getByRole('button', { name: /Anna/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Markdown source' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to notes' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Markdown source' })).toBeNull());
  });

  it('creates a note at a safe path and opens it', async () => {
    const calls = stubBackend(({ method, path }) => {
      if (path === '/notes' && method === 'GET') return json({ notes: list, limit: 50, offset: 0, hasMore: false });
      if (path === '/notes' && method === 'POST') return json({ path: 'Personal/Trip-ideas.md', commit: sha('c'), url: 'https://github.com/x/y/commit/c' });
      if (path === '/notes/note') return json({ path: 'Personal/Trip-ideas.md', content: '# Trip ideas\n\n', sha: sha('e'), url: 'https://github.com/x/y' });
      return undefined;
    });
    const user = userEvent.setup();
    renderNotes();
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    const form = screen.getByRole('form', { name: 'New note' });
    expect((within(form).getByRole('button', { name: 'Create note' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Folder' }), 'Personal');
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Trip ideas/../');
    expect(within(form).getByText('Personal/Trip-ideas.md')).not.toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Create note' }));
    expect(await screen.findByRole('textbox', { name: 'Markdown source' })).not.toBeNull();
    expect(calls.find(({ method }) => method === 'POST')?.body).toMatchObject({ path: 'Personal/Trip-ideas.md', content: '# Trip ideas/../\n\n' });
  });

  it('reports an existing note on create and offers to open it', async () => {
    stubBackend(({ method, path }) => {
      if (path === '/notes' && method === 'GET') return json({ notes: list, limit: 50, offset: 0, hasMore: false });
      if (path === '/notes' && method === 'POST') return json({ error: 'A note already exists at this path', currentSha: sha('a'), content: 'x' }, 409);
      return undefined;
    });
    const user = userEvent.setup();
    renderNotes('/notes?new=1');
    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Roadmap');
    fireEvent.submit(screen.getByRole('form', { name: 'New note' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A note already exists at this path');
    expect(screen.getByRole('button', { name: 'Open existing note' })).not.toBeNull();
  });

  it('keeps the graph one view away', async () => {
    stubBackend(({ path }) => path === '/notes' ? json({ notes: [], limit: 50, offset: 0, hasMore: false }) : json({ nodes: [], edges: [] }));
    renderNotes();
    expect(screen.getByRole('link', { name: 'Graph' }).getAttribute('href')).toBe('/notes/graph');
  });
});

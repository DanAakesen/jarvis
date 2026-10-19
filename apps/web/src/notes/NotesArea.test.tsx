import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesArea } from './NotesArea';
import { NavigationGuardContext } from '../page-navigation';

const oldSha = 'a'.repeat(40), newSha = 'b'.repeat(40), commit = 'c'.repeat(40);
const raw = '---\ntags: [fixture]\n---\n# Fixture\n\nExact content.\n';
const path = 'Work/fixture.md';
const summary = { path, title: 'Fixture', folder: 'Work', updatedAt: '2026-10-11T00:00:00Z' };
const second = { ...summary, path: 'General/other.md', title: 'Other', folder: 'General' };
const vaultTask = (letter: string, text: string, taskPath: string, line: number) => ({
  id: letter.repeat(64), text, done: false, dueDate: '2031-04-09', dueTime: null, dueAt: null,
  priority: 'normal', path: taskPath, line, heading: 'Inbox',
});
const vaultTasks = [vaultTask('d', 'Buy a mirror', path, 3), vaultTask('e', 'Call about the frame', second.path, 1)];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const getAccessToken = async () => 'fixture-token';
const fetchMock = vi.fn<typeof fetch>();
const scene = vi.hoisted(() => ({ selectStar: null as null | ((id: string) => void), builds: 0 }));
vi.mock('../knowledge/knowledge-scene', () => ({
  createKnowledgeScene: (_host: HTMLElement, _graph: unknown, events: { onSelect: (id: string) => void }) => {
    scene.selectStar = events.onSelect; scene.builds += 1;
    return { highlight: vi.fn(), select: vi.fn(), showFolders: vi.fn(), resetView: vi.fn(), dispose: vi.fn() };
  },
}));
let savedContent: string;
let blobSha: string;
let lastRead: string;
const noteResponse = (notePath = path) => json({ path: notePath, content: savedContent, sha: blobSha, url: `https://github.com/example/vault/blob/master/${notePath}` });

beforeEach(() => {
  savedContent = raw; blobSha = oldSha; lastRead = path;
  scene.selectStar = null; scene.builds = 0;
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/knowledge/graph') return json({
      nodes: [{ id: 'fixture', path, title: 'Fixture', folder: 'Work', degree: 1 },
        { id: 'other', ...second, degree: 1 }], edges: [{ source: 'fixture', target: 'other', type: 'link' }],
    });
    if (url.pathname === '/notes/tree') return json({
      directories: ['Customers', 'Customers/Novaro', 'General', 'Work'],
      rootNoteCount: 1, truncated: false, updatedAt: '2026-10-11T17:00:00Z',
    });
    if (url.pathname === '/vault/tasks') return json({
      items: vaultTasks, readAt: '2031-04-09T20:28:00.000Z', today: '2031-04-09', total: vaultTasks.length, truncated: false,
    });
    if (init?.method === 'POST' || init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { path: string; content: string };
      savedContent = body.content; blobSha = newSha; lastRead = body.path;
      return json({ path: body.path, commit, url: `https://github.com/example/vault/commit/${commit}` });
    }
    if (url.pathname === '/notes/note') { lastRead = url.searchParams.get('path')!; return noteResponse(lastRead); }
    return json({ notes: [summary, second], limit: 50, offset: Number(url.searchParams.get('offset') ?? 0), hasMore: false });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function mount(initialEntries = ['/notes'], initialIndex = initialEntries.length - 1, strict = false) {
  const guard = { current: false };
  const router = createMemoryRouter([
    { path: '/notes', element: <NavigationGuardContext.Provider value={guard}>
      <Link to="/other">Other page</Link>
      <NotesArea backendUrl="https://api.example.com" getAccessToken={getAccessToken} />
    </NavigationGuardContext.Provider> },
    { path: '/other', element: <h1>Other page opened</h1> },
  ], { initialEntries, initialIndex });
  const app = <RouterProvider router={router} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { router, guard };
}
async function openFixture() {
  fireEvent.click(await screen.findByRole('button', { name: 'Work1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Fixture' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Markdown' }));
  return screen.findByRole('textbox', { name: 'Markdown' });
}
const saveCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PUT');

describe('Notes workflow', () => {
  it('opens a source note from its vault-task deep link', async () => {
    mount(['/notes?note=Work%2Ffixture.md'], undefined, true);
    expect(await screen.findByRole('dialog', { name: 'fixture' })).not.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input));
      return url.pathname === '/notes/note' && url.searchParams.get('path') === path;
    })).toBe(true);
  });

  it('shows tasks on request, opens a task’s note in place and puts the list away again', async () => {
    mount();
    const toggle = await screen.findByRole('button', { name: 'Show tasks' });
    expect(toggle.closest('.knowledge-search')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Task list' })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === '/vault/tasks')).toBe(false);

    fireEvent.click(toggle);
    const list = await screen.findByRole('region', { name: 'Task list' });
    expect(screen.getByRole('button', { name: 'Hide tasks' }).getAttribute('aria-controls')).toBe(list.id);
    expect(await within(list).findByText('Buy a mirror')).not.toBeNull();

    fireEvent.click(within(list).getByRole('link', { name: 'Open source note Work/fixture.md, line 3' }));
    const dialog = await screen.findByRole('dialog', { name: 'fixture' });
    expect(within(dialog).getByRole('region', { name: 'Markdown preview' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Task list' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide tasks' }));
    expect(screen.queryByRole('region', { name: 'Task list' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show tasks' })).not.toBeNull();
  });

  it('opens the task list from a link that asks for it, with the search already typed', async () => {
    mount(['/notes?tasks=1&q=mirror']);
    const list = await screen.findByRole('region', { name: 'Task list' });
    expect((within(list).getByRole('searchbox', { name: 'Search tasks' }) as HTMLInputElement).value).toBe('mirror');
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input));
      return url.pathname === '/vault/tasks' && url.searchParams.get('q') === 'mirror';
    })).toBe(true));
  });

  it('closes the task list with Escape and hands focus back to its button', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Show tasks' }));
    const list = await screen.findByRole('region', { name: 'Task list' });
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Task list' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show tasks' }));
  });

  it('puts the task list away when a task’s note opens on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 900px'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    mount(['/notes?tasks=1']);
    const list = await screen.findByRole('region', { name: 'Task list' });
    fireEvent.click(await within(list).findByRole('link', { name: 'Open source note Work/fixture.md, line 3' }));
    await screen.findByRole('dialog', { name: 'fixture' });
    expect(screen.queryByRole('region', { name: 'Task list' })).toBeNull();
  });

  it('asks before a task’s note replaces an unsaved draft', async () => {
    mount();
    const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show tasks' }));
    const list = await screen.findByRole('region', { name: 'Task list' });
    fireEvent.click(await within(list).findByRole('link', { name: 'Open source note General/other.md, line 1' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toBe('Unsaved draft');
    expect(fetchMock.mock.calls.some(([request]) => new URL(String(request)).searchParams.get('path') === second.path)).toBe(false);
  });

  it('keeps a long note title available to assistive technology and on hover', async () => {
    const title = 'A'.repeat(120);
    mount([`/notes?${new URLSearchParams({ note: `Work/${title}.md` })}`], undefined, true);
    const dialog = await screen.findByRole('dialog', { name: title });
    const heading = within(dialog).getByRole('heading', { level: 3, name: title });
    expect(heading.getAttribute('title')).toBe(title);
    expect(heading.querySelector('.knowledge-note-title')?.textContent).toBe(title);
  });

  it('defaults to the original graph, opens its familiar reader and edits only after selecting a note', async () => {
    mount();
    expect(await screen.findByLabelText('Search your knowledge')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Browse notes' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Graph' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/notes')).toBe(false);
    await waitFor(() => expect(scene.selectStar).toBeTypeOf('function'));
    act(() => scene.selectStar!('fixture'));
    const popup = await screen.findByRole('dialog', { name: 'Fixture' });
    const preview = await within(popup).findByRole('region', { name: 'Markdown preview' });
    expect(within(preview).getByRole('heading', { name: 'Fixture' })).not.toBeNull();
    expect(preview.textContent).not.toContain('tags:');
    expect(screen.queryByRole('textbox', { name: 'Markdown' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname.startsWith('/memory/'))).toBe(false);
    fireEvent.click(within(popup).getByRole('button', { name: 'Edit Markdown' }));
    const input = screen.getByRole('textbox', { name: 'Markdown' });
    fireEvent.change(input, { target: { value: 'Graph stays mounted while typing' } });
    expect(scene.builds).toBe(1);
    expect(screen.getByRole('button', { name: 'Other' })).not.toBeNull();
    act(() => scene.selectStar!('other'));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((input as HTMLTextAreaElement).value).toBe('Graph stays mounted while typing');
  });
  it('opens exact Markdown source and previews without raw HTML or unsafe links/images', async () => {
    mount();
    const input = await openFixture();
    expect((input as HTMLTextAreaElement).value).toBe(raw);
    fireEvent.change(input, { target: { value: '# Preview fixture\n\n**Bold**\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n![alt](https://example.com/private.png)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = screen.getByRole('region', { name: 'Markdown preview' });
    expect(within(preview).getByRole('heading', { name: 'Preview fixture' })).not.toBeNull();
    expect(preview.querySelector('script, img, a')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }));
    expect((screen.getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toContain('# Preview fixture');
  });
  it('saves once, rereads the blob revision and uses it on the next save', async () => {
    mount();
    const input = await openFixture();
    fireEvent.change(input, { target: { value: `${raw}First edit.\n` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved to your vault.');
    expect(JSON.parse(String(saveCalls()[0]![1]?.body)).sha).toBe(oldSha);
    expect((input as HTMLTextAreaElement).value).toBe(`${raw}First edit.\n`);
    fireEvent.change(input, { target: { value: `${raw}Second edit.\n` } });
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saveCalls()).toHaveLength(2));
    expect(JSON.parse(String(saveCalls()[1]![1]?.body)).sha).toBe(newSha);
    expect(screen.getByRole('link', { name: 'View saved commit on GitHub' }).getAttribute('href')).toContain(commit);
  });
  it('opens an immediately writable draft and saves in a nested new folder without changing source', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create new' }));
    const dialog = screen.getByRole('dialog', { name: 'New note' });
    const input = within(dialog).getByRole('textbox', { name: 'Markdown' });
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: 'Start writing' })).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(input, { target: { value: '# My exact source\n\n  Whitespace.\n' } });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Café / review?' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Save in Work' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'New folder in Work' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'New folder in Work' }), { target: { value: 'Research' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add folder' }));
    expect(within(dialog).getByRole('button', { name: 'Choose note location: Work/Research' })).not.toBeNull();
    expect(dialog.querySelector('.knowledge-note-meta')).toBeNull();
    expect(saveCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved to your vault.');
    const [, request] = saveCalls()[0]!;
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toEqual({ path: 'Work/Research/cafe-review.md', content: '# My exact source\n\n  Whitespace.\n' });
    expect(lastRead).toBe('Work/Research/cafe-review.md');
  });
  it('keeps icon-only creation inside search and puts vault freshness only in the popup header', async () => {
    mount();
    const create = await screen.findByRole('button', { name: 'Create new' });
    expect(create.closest('.knowledge-search')).not.toBeNull();
    expect(create.textContent).toBe('');
    fireEvent.click(create);
    const dialog = screen.getByRole('dialog', { name: 'New note' });
    await within(dialog).findByText(/Vault folders. Updated/);
    const time = dialog.querySelector('header time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-11T17:00:00Z');
    expect(time?.parentElement?.parentElement?.tagName).toBe('HEADER');
    expect(time?.parentElement?.nextElementSibling?.getAttribute('aria-label')).toBe('Close New note');
    expect(dialog.querySelector('.notes-location time')).toBeNull();
    expect(screen.queryByText('Hidden dot-folders are excluded.')).toBeNull();
    expect(screen.queryByText('Write now. Add a title before saving.')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Markdown' }));
  });
  it('closes an untouched new draft without a discard prompt and guards title-only edits', async () => {
    const { guard } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create new' }));
    expect(guard.current).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close New note' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved title' } });
    expect(guard.current).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close New note' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Unsaved title');
    expect(saveCalls()).toHaveLength(0);
  });
  it('keeps writing focus and refuses saving until the new draft has a valid title', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create new' }));
    const input = screen.getByRole('textbox', { name: 'Markdown' });
    fireEvent.change(input, { target: { value: 'Write first' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    const titleInput = screen.getByLabelText('Title');
    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: 'Root note' } });
    expect(document.activeElement).toBe(titleInput);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved to your vault.');
    expect(JSON.parse(String(saveCalls()[0]![1]?.body))).toEqual({ path: 'root-note.md', content: 'Write first' });
  });
  it('loads actual vault folders once, not paged notes, and keeps writing during a folder-tree outage', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => new URL(String(input)).pathname === '/notes/tree'
      ? Promise.resolve(json({ error: 'Not found' }, 404)) : defaultFetch(input, init));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create new' }));
    await screen.findByText(/folder tree is not available yet/);
    const input = screen.getByRole('textbox', { name: 'Markdown' });
    fireEvent.change(input, { target: { value: 'Keep writing while the tree is unavailable.' } });
    expect((input as HTMLTextAreaElement).value).toBe('Keep writing while the tree is unavailable.');
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/notes/tree')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/notes')).toBe(false);
    expect(saveCalls()).toHaveLength(0);
  });
  it('keeps drafts on conflicts, compares versions and saves only with an explicitly adopted latest revision', async () => {
    mount();
    const input = await openFixture();
    fireEvent.change(input, { target: { value: 'My draft' } });
    fetchMock.mockImplementationOnce(async () => json({ error: 'Changed', currentSha: newSha, content: 'Elsewhere' }, 409));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/changed elsewhere/);
    expect((input as HTMLTextAreaElement).value).toBe('My draft');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    expect(screen.getByText('Elsewhere')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my draft on latest revision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved to your vault.');
    expect(JSON.parse(String(saveCalls()[1]![1]?.body))).toMatchObject({ sha: newSha, content: 'My draft' });
  });
  it('requires explicit discard before reloading a conflicted note', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Draft stays' } });
    fetchMock.mockImplementationOnce(async () => json({ error: 'Changed', currentSha: newSha, content: 'Latest version' }, 409));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/changed elsewhere/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((input as HTMLTextAreaElement).value).toBe('Draft stays');
    savedContent = 'Latest version'; blobSha = newSha;
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    expect((await screen.findByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toBe('Latest version');
  });
  it('retains the previous draft if an approved note switch fails to load', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Keep this draft until another note opens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fetchMock.mockImplementationOnce(async () => json({ error: 'Unavailable' }, 503));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    await screen.findByText(/temporarily unavailable/);
    expect((screen.getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toBe('Keep this draft until another note opens');
    expect(within(screen.getByRole('dialog', { name: 'Fixture' })).getByText('Work · Work/fixture.md')).not.toBeNull();
  });
  it('keeps an uncertain draft if checking the latest revision fails', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Uncertain but retained' } });
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/save result is uncertain/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest note' }));
    fetchMock.mockImplementationOnce(async () => json({ error: 'Unavailable' }, 503));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    await screen.findByText(/temporarily unavailable/);
    const retained = screen.getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement;
    expect(retained.value).toBe('Uncertain but retained');
    expect(retained.readOnly).toBe(true);
    expect(saveCalls()).toHaveLength(1);
  });
  it('preserves the submitted text when the note changes during the post-save refresh', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Written draft' } });
    fetchMock.mockImplementationOnce(async () => json({ path, commit, url: `https://github.com/example/vault/commit/${commit}` }));
    fetchMock.mockImplementationOnce(async () => json({ path, content: 'Later edit', sha: newSha, url: `https://github.com/example/vault/blob/master/${path}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/changed elsewhere/);
    expect((input as HTMLTextAreaElement).value).toBe('Written draft');
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    expect(screen.getByText('Later edit')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveCalls()).toHaveLength(1);
  });
  it('blocks links, history, closing and other notes, warns on reload, and permits leaving only after discard', async () => {
    const { router, guard } = mount(['/other', '/notes']);
    const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Unsaved' } });
    expect(guard.current).toBe(true);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/notes');
    await act(() => router.navigate(-1));
    await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Fixture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe('Unsaved');
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    await screen.findByRole('heading', { name: 'Other page opened' });
    expect(guard.current).toBe(false);
  });
  it('prevents duplicate saves and leaving while a save is in flight', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Saving draft' } });
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    await screen.findByRole('dialog', { name: 'Save in progress' });
    expect((screen.getByRole('button', { name: 'Discard changes and continue' }) as HTMLButtonElement).disabled).toBe(true);
    savedContent = 'Saving draft'; blobSha = newSha;
    await act(async () => finish(json({ path, commit, url: `https://github.com/example/vault/commit/${commit}` })));
    await screen.findByText('Saved to your vault.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((input as HTMLTextAreaElement).value).toBe('Saving draft');
  });
  it('distinguishes a successful write followed by failed refresh and disables another save', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Written' } });
    fetchMock.mockImplementationOnce(async () => json({ path, commit, url: `https://github.com/example/vault/commit/${commit}` }));
    fetchMock.mockImplementationOnce(async () => json({ error: 'Unavailable' }, 503));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/latest revision could not be loaded/);
    expect(screen.getByText('Saved to your vault.')).not.toBeNull();
    expect((input as HTMLTextAreaElement).readOnly).toBe(true);
    expect(saveCalls()).toHaveLength(1);
  });
  it('keeps an uncertain draft, does not claim saved and requires a latest-note check', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Uncertain' } });
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/save result is uncertain/);
    expect(screen.queryByText('Saved to your vault.')).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe('Uncertain');
    expect((input as HTMLTextAreaElement).readOnly).toBe(true);
    expect(saveCalls()).toHaveLength(1);
  });
  it('keeps Create new available when the graph fails and does not invent notes', async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: 'Index not ready' }, 503));
    mount();
    await screen.findByText(/could not load your knowledge/);
    expect(screen.queryByRole('button', { name: 'Fixture' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    expect(screen.getByLabelText('Title')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Markdown' })).not.toBeNull();
    expect(saveCalls()).toHaveLength(0);
  });
  it('retains graph search and section filtering without replacing them with a separate browser', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Work1' }));
    expect(await screen.findByRole('list', { name: 'Work notes' })).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Search your knowledge'), { target: { value: 'Other' } });
    const results = await screen.findByRole('list', { name: 'Matching notes' });
    expect(await within(results).findByRole('button', { name: 'Other' })).not.toBeNull();
    expect(within(results).queryByRole('button', { name: 'Fixture' })).toBeNull();
  });
  it('cancels an obsolete read when the popup is closed and keeps the graph mounted', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Work1' }));
    const open = await screen.findByRole('button', { name: 'Fixture' });
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(open);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Close Fixture' }));
    await act(async () => finish(noteResponse()));
    expect(await screen.findByLabelText('Search your knowledge')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Markdown' })).toBeNull();
  });
  it('restores focus through the discard dialog and supports keyboard creation', async () => {
    mount(); const input = await openFixture();
    const user = userEvent.setup();
    fireEvent.change(input, { target: { value: 'Draft' } });
    await user.click(screen.getByRole('button', { name: 'Create new' }));
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create new' }));
  });
  it('guards Escape from the editable popup and closes it only after explicit discard', async () => {
    mount(); const input = await openFixture();
    fireEvent.change(input, { target: { value: 'Keyboard draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((input as HTMLTextAreaElement).value).toBe('Keyboard draft');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Search your knowledge')).not.toBeNull();
    expect(saveCalls()).toHaveLength(0);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryGraph, cleanSnippet, matchTitles, readKnowledgeGraph, sampleKnowledgeGraph, vaultMemoryId } from './knowledge-data';
import { GeneratedViewRenderer } from '../GeneratedViewRenderer';
import { KnowledgeBackendContext } from './knowledge-context';
import { createKnowledgeLayout } from './knowledge-layout';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { folderColours, resolveFolderColour } from './knowledge-scene';

const sceneMocks = vi.hoisted(() => ({ create: vi.fn(), showTasks: vi.fn() }));
vi.mock('./knowledge-scene', async (importOriginal) => ({
  ...await importOriginal<typeof import('./knowledge-scene')>(),
  createKnowledgeScene: sceneMocks.create,
}));

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  sceneMocks.showTasks.mockClear();
  sceneMocks.create.mockReset();
  sceneMocks.create.mockImplementation(() => ({
    highlight: vi.fn(),
    select: vi.fn(),
    showFolders: vi.fn(),
    showTasks: sceneMocks.showTasks,
    resetView: vi.fn(),
    dispose: vi.fn(),
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('knowledge graph data', () => {
  it('cleans search snippets into one plain line', () => {
    expect(cleanSnippet('<!-- id: 1 -->\n---\ntitle: Plan\ntags: [a]\n---\nThe plan is ready.')).toBe('The plan is ready.');
    expect(cleanSnippet('---\ntitle: Plan\n---\n<!-- id: 2 -->\nThe plan is ready.')).toBe('The plan is ready.');
    expect(cleanSnippet('---\ntitle: Plan\n---\n<!-- unclosed')).toBe('');
    expect(cleanSnippet('--- title: Plan tags: [a] --- The plan is ready.')).toBe('The plan is ready.');
    expect(cleanSnippet('---\ntitle: Plan\ntags: [a]')).toBe('');
    expect(cleanSnippet('<!-- unclosed')).toBe('');
    expect(cleanSnippet('- [ ] Buy a mirror 📅 2031-04-09 ⏫ [priority:: high]')).toBe('Buy a mirror');
    expect(cleanSnippet('- [x] Ship it ✅ 2031-04-09 🔁 every week 🆔 abc-1')).toBe('Ship it');
    expect(cleanSnippet('---\n\nA rule above plain text')).toBe('--- A rule above plain text');
  });

  it('preserves full-vault folders and drops dangling or self edges', () => {
    const graph = readKnowledgeGraph({
      nodes: [
        { id: 'a', path: 'People/Anna.md', title: 'Anna', folder: 'People', updatedAt: '2026-10-07T10:00:00.000Z', degree: 2 },
        { id: 'b', path: 'Archive/Roadmap.md', title: 'Roadmap', folder: 'Archive', updatedAt: null, degree: 1 },
      ],
      edges: [{ source: 'a', target: 'b', type: 'link' }, { source: 'a', target: 'a', type: 'link' }, { source: 'a', target: 'zzz', type: 'similar' }],
    });
    expect(graph.nodes.map((node) => node.folder)).toEqual(['People', 'Archive']);
    expect(graph.edges).toEqual([{ source: 'a', target: 'b', type: 'link' }]);
    expect(matchTitles(graph, 'ann')).toEqual(['a']);
    expect(() => readKnowledgeGraph({ nodes: 'nope' })).toThrow();
    expect(vaultMemoryId('People/Anna.md')).toBe('vault_UGVvcGxlL0FubmEubWQ');
  });
  it('reads task counts additively and accepts graph payloads from older servers', () => {
    const graph = readKnowledgeGraph({
      nodes: [{ id: 'task-note', path: 'Work/Tasks.md', openTaskCount: 2 }],
      edges: [],
      openTaskNoteCount: 1,
      taskCountsPartial: true,
    });
    expect(graph.nodes[0]?.openTaskCount).toBe(2);
    expect(graph.openTaskNoteCount).toBe(1);
    expect(graph.taskCountsPartial).toBe(true);
    const older = readKnowledgeGraph({ nodes: [{ id: 'old', path: 'Work/Old.md' }], edges: [] });
    expect(older.nodes[0]?.openTaskCount).toBeUndefined();
    expect(older.openTaskNoteCount).toBeUndefined();
    expect(older.taskCountsPartial).toBeUndefined();
  });
  it('lays out root and arbitrary folders without assuming four regions', () => {
    const graph = readKnowledgeGraph({ nodes: [
      { id: 'root', path: 'AGENTS.md', folder: '' }, { id: 'customer', path: 'Customers/Review.md', folder: 'Customers' },
      { id: 'prototype', path: 'constructor/Review.md', folder: 'constructor' },
    ], edges: [] });
    const layout = createKnowledgeLayout(graph);
    layout.settle();
    expect(layout.positions.every(Number.isFinite)).toBe(true);
    expect(graph.nodes.map(node => node.folder)).toEqual(['', 'Customers', 'constructor']);
  });

  it('lays out a deterministic cloud that settles with finite positions', () => {
    const graph = sampleKnowledgeGraph(300);
    const first = createKnowledgeLayout(graph);
    first.settle(120);
    const second = createKnowledgeLayout(graph);
    second.settle(120);
    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    expect(first.positions.every(Number.isFinite)).toBe(true);
  });
});

describe('knowledge graph view', () => {
  it('leaves the vault root and system folders off the map entirely, with their links', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ nodes: [
      { id: 'root', path: 'AGENTS.md', title: 'Root fixture', folder: '' },
      { id: 'log', path: '_agent-log/Run.md', title: 'Log fixture', folder: '_agent-log' },
      { id: 'template', path: 'Templates/Note.md', title: 'Template fixture', folder: 'Templates' },
      { id: 'work', path: 'Work/Review.md', title: 'Work fixture', folder: 'Work', degree: 2 },
      { id: 'home', path: 'Personal/Plan.md', title: 'Personal fixture', folder: 'Personal', degree: 1 },
    ], edges: [
      { source: 'work', target: 'home', type: 'link' },
      { source: 'work', target: 'log', type: 'link' },
    ] })));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    await waitFor(() => expect(document.querySelector('.knowledge')?.getAttribute('data-nodes')).toBe('2'));
    expect(document.querySelector('.knowledge')?.getAttribute('data-edges')).toBe('1');
    expect(within(screen.getByRole('list', { name: 'Map legend' })).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Work1', 'Personal1']);
  });
  it('recounts note degrees and open-task notes after dropping hidden folders', () => {
    const node = (id: string, folder: string, degree: number, openTaskCount: number) =>
      ({ id, path: `${folder}/${id}.md`, title: id, folder, directory: folder, updatedAt: null, degree, openTaskCount });
    const graph = categoryGraph({
      nodes: [node('a', 'Work', 2, 1), node('b', 'Templates', 1, 3), node('c', 'Personal', 1, 0)],
      edges: [{ source: 'a', target: 'b', type: 'link' }, { source: 'a', target: 'c', type: 'link' }],
      openTaskNoteCount: 2,
    });
    expect(graph.nodes.map((entry) => [entry.id, entry.degree])).toEqual([['a', 1], ['c', 1]]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.openTaskNoteCount).toBe(1);
  });
  it('uses the muted star colour for root and unknown folders', () => {
    const colours = folderColours(document.createElement('div'));
    const fallback = colours.get('')!;
    expect(resolveFolderColour(colours, '')).toBe(fallback);
    expect(resolveFolderColour(colours, 'Archive')).toBe(fallback);
    expect(fallback.getHexString()).toBe('a4b5bb');
  });
  it('shows the task-note count and toggles scene marks without filtering notes', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json({
      nodes: [
        { id: 'task', path: 'Personal/Inbox.md', title: 'Inbox', folder: 'Personal', openTaskCount: 2 },
        { id: 'quiet', path: 'Personal/Quiet.md', title: 'Quiet', folder: 'Personal', openTaskCount: 0 },
      ],
      edges: [],
      openTaskNoteCount: 1,
      taskCountsPartial: true,
    })));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const toggle = await screen.findByRole('button', { name: 'Tasks, 1 note with open tasks' });
    expect(toggle.textContent).not.toMatch(/partial/i);
    expect(toggle.getAttribute('title')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(sceneMocks.create).toHaveBeenCalledOnce());
    expect(sceneMocks.create.mock.calls[0]?.[1].nodes[0]?.openTaskCount).toBe(2);
    expect(screen.getByRole('button', { name: 'Personal2' })).not.toBeNull();
    const callbacks = (sceneMocks.create.mock.calls[0] as unknown[] | undefined)?.[2] as
      { onHover: (hover: { id: string; x: number; y: number }) => void } | undefined;
    act(() => callbacks?.onHover({ id: 'task', x: 12, y: 34 }));
    expect(screen.getByText('Inbox · 2 open tasks')).not.toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(sceneMocks.showTasks).toHaveBeenLastCalledWith(false));
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(sceneMocks.showTasks).toHaveBeenLastCalledWith(true));
  });
  it('labels and disables task marking when a bounded scan could not produce counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      nodes: [{ id: 'task', path: 'Personal/Inbox.md', title: 'Inbox', folder: 'Personal' }],
      edges: [],
      taskCountsPartial: true,
    })));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    const toggle = await screen.findByRole('button', { name: 'Tasks, count unavailable' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.textContent).toContain('—');
    expect(toggle.textContent).not.toMatch(/partial/i);
    expect(toggle.getAttribute('aria-label')).not.toMatch(/partial/i);
    expect(toggle.getAttribute('title')).toBe('Task marks are unavailable right now');
  });
  it.each([
    ['front matter first', '---\ntags: [fixture]\ncreated: 2026-10-10\n---\n'],
    ['leading comments and whitespace', ' \n<!-- Fixture sync template -->\n<!-- Another comment -->\n---\ntags: [fixture]\n---\n'],
    ['no front matter', ''],
    ['malformed YAML', '---\ntags: [broken\ncreated: : invalid\n---\n'],
    ['BOM and CRLF', '\uFEFF \r\n<!-- Fixture -->\r\n---\r\ntags: [fixture]\r\n---\r\n'],
    ['closing delimiter at EOF', '---\ntags: [fixture]\n---'],
    ['many leading comments', `${'<!-- fixture -->'.repeat(2000)}\n---\ntags: [fixture]\n---\n`],
    ['many comments without front matter', `${'<!-- fixture -->'.repeat(2000)}\n`],
  ])('renders fixture Markdown without raw metadata: %s', async (_name, prefix) => {
    const content = prefix.endsWith('---') ? prefix : `${prefix}# Fixture heading\n\n- First item\n- Second item\n\n---\n\nBody text.`;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/knowledge/graph'
      ? json({ nodes: [{ id: 'fixture', path: 'Work/Fixture.md', title: 'Fixture note', folder: 'Work' }], edges: [] })
      : json({ title: 'Fixture note', content })));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Work1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Fixture note' }));
    const body = await screen.findByRole('region', { name: 'Note content' });
    if (prefix.endsWith('---')) {
      expect(await within(body).findByText('This note is empty.')).not.toBeNull();
    } else {
      expect(await within(body).findByRole('heading', { name: 'Fixture heading' })).not.toBeNull();
      expect(within(body).getAllByRole('listitem')).toHaveLength(2);
      expect(body.querySelectorAll('hr')).toHaveLength(1);
    }
    expect(body.textContent).not.toMatch(/tags:|created:|broken|invalid|sync template/);
    expect(body.tabIndex).toBe(0);
  });

  it('shows a working scroll cue only while fixture content remains below the reader', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/knowledge/graph'
      ? json({ nodes: [{ id: 'fixture', path: 'Work/Fixture.md', title: 'Fixture note', folder: 'Work' }], edges: [] })
      : json({ content: '# Long fixture\n\nReadable body.' })));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Work1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Fixture note' }));
    const body = await screen.findByRole('region', { name: 'Note content' });
    await within(body).findByRole('heading', { name: 'Long fixture' });
    Object.defineProperties(body, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } });
    const scrollBy = vi.fn();
    body.scrollBy = scrollBy;
    fireEvent.scroll(body);
    fireEvent.click(await screen.findByRole('button', { name: 'Scroll down' }));
    expect(scrollBy).toHaveBeenCalledWith({ top: 160, behavior: 'smooth' });
    body.scrollTop = 800;
    fireEvent.scroll(body);
    expect(screen.queryByRole('button', { name: 'Scroll down' })).toBeNull();
  });

  it('shows a neutral unavailable state instead of inventing data when the service is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not found' }, 404)));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect(await screen.findByText('The knowledge graph is unavailable.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /sample/i })).toBeNull();
  });

  it('searches titles, lists the matches and opens a note with its connections', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/knowledge/graph') {
        return json({
          nodes: [
            { id: 'a', path: 'People/Anna.md', title: 'Anna Jensen', folder: 'People', updatedAt: null, degree: 1 },
            { id: 'b', path: 'Work/Roadmap.md', title: 'Roadmap', folder: 'Work', updatedAt: null, degree: 1 },
          ],
          edges: [{ source: 'a', target: 'b', type: 'link' }],
        });
      }
      if (url.pathname === '/knowledge/search') return json({ hits: [{ nodeId: 'a' }] });
      if (url.pathname === `/memory/${vaultMemoryId('People/Anna.md')}`) return json({ id: 'a', title: 'Anna Jensen', folder: 'People', content: 'Leads the platform team.', source: { type: 'github', url: 'https://github.com/DanAakesen/vault/blob/master/People/Anna.md' } });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    fireEvent.change(await screen.findByLabelText('Search your knowledge'), { target: { value: 'anna' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Anna Jensen' }));
    expect(await screen.findByText('Leads the platform team.')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open in GitHub' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Roadmap' })).not.toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/knowledge/search?q=anna', expect.anything()));
  });

  it('announces an empty search without rendering an empty results shell', async () => {
    const query = '<fixture> & no matches';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/knowledge/graph') return json({
        nodes: [{ id: 'fixture', path: 'Work/Fixture.md', title: 'Fixture note', folder: 'Work' }],
        edges: [],
      });
      if (url.pathname === '/knowledge/search') return json({ hits: [] });
      if (url.pathname === '/vault/tasks') return json({
        items: [], readAt: '2031-04-09T20:28:00.000Z', today: '2031-04-09', total: 0, truncated: false,
      });
      return json({}, 404);
    }));
    const { container } = render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} showTaskMatches />);

    fireEvent.change(await screen.findByLabelText('Search your knowledge'), { target: { value: query } });

    const message = await screen.findByText(`No notes or tasks match “${query}”.`);
    expect(message.getAttribute('role')).toBe('status');
    expect(message.querySelector('fixture')).toBeNull();
    expect(container.querySelector('.knowledge-results')).toBeNull();
  });

  it('says only notes match when task matches are not searched', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/knowledge/graph') return json({
        nodes: [{ id: 'fixture', path: 'Work/Fixture.md', title: 'Fixture note', folder: 'Work' }],
        edges: [],
      });
      if (url.pathname === '/knowledge/search') return json({ hits: [] });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);

    fireEvent.change(await screen.findByLabelText('Search your knowledge'), { target: { value: 'nothing here' } });

    const message = await screen.findByText('No notes match “nothing here”.');
    expect(message.getAttribute('role')).toBe('status');
    expect(screen.queryByText(/No notes or tasks match/)).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === '/vault/tasks')).toBe(false);
  });

  it('shows task matches and plain note snippets as separate search results', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/knowledge/graph') return json({
        nodes: [{ id: 'home', path: 'Personal/Home.md', title: 'Home note', folder: 'Personal' }],
        edges: [],
      });
      if (url.pathname === '/knowledge/search') {
        return json({ hits: [{ nodeId: 'home', snippet: 'The hallway is ready for a new mirror.' }] });
      }
      if (url.pathname === '/vault/tasks') return json({
        items: [{
          id: 'c'.repeat(64), text: 'Buy a mirror', done: false,
          dueDate: '2031-04-09', dueTime: '14:30', dueAt: '2031-04-09T12:30:00.000Z',
          priority: 'normal', path: 'Personal/Inbox.md', line: 4, heading: 'Home',
        }],
        readAt: '2031-04-09T12:00:00.000Z', today: '2031-04-09', total: 3, truncated: false,
      });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onShowTasks = vi.fn();
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} showTaskMatches onShowTasks={onShowTasks} />);
    fireEvent.change(await screen.findByLabelText('Search your knowledge'), { target: { value: 'mirror' } });
    expect(await screen.findByText('The hallway is ready for a new mirror.')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
    expect(screen.queryByText(/matching tasks?/)).toBeNull();
    const tasks = await screen.findByRole('list', { name: 'Matching tasks' });
    expect(within(tasks).getByText('Tasks')).not.toBeNull();
    fireEvent.click(within(tasks).getByRole('button', { name: /Buy a mirror/ }));
    expect(onShowTasks).toHaveBeenCalledWith('mirror');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 3 tasks' }));
    expect(onShowTasks).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/9 Apr 2031/)).not.toBeNull();
    const notes = screen.getByRole('list', { name: 'Matching notes' });
    expect(tasks.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const note = within(notes).getByRole('button', { name: /Home note/ });
    expect(within(note).getByText('Personal')).not.toBeNull();
    expect(note.getAttribute('aria-describedby')).toBe(within(note).getByText('Personal').id);
  });
});

describe('knowledge window from Jarvis', () => {
  it('renders the knowledge-graph view with Jarvis’s query and lit matches', async () => {
    const hash = (char: string) => char.repeat(64);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/knowledge/graph'
      ? json({ nodes: [
        { id: hash('a'), path: 'People/Anna.md', title: 'Anna Jensen', folder: 'People', updatedAt: null, degree: 0 },
        { id: hash('b'), path: 'Work/Roadmap.md', title: 'Roadmap', folder: 'Work', updatedAt: null, degree: 0 },
      ], edges: [] })
      : json({}, 404)));
    render(
      <KnowledgeBackendContext.Provider value={{ backendUrl: 'https://api.example.com', getAccessToken }}>
        <GeneratedViewRenderer view={{
          version: 1, title: 'Knowledge: Anna', renderer: 'knowledge-graph',
          source: { id: 'knowledge_graph', status: 'complete' }, data: { query: 'who leads platform', highlight: [hash('a')] },
        }} />
      </KnowledgeBackendContext.Provider>,
    );
    expect((await screen.findByLabelText('Search your knowledge') as HTMLInputElement).value).toBe('who leads platform');
    expect(await screen.findByRole('button', { name: 'Anna Jensen' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Roadmap' })).toBeNull();
  });
});
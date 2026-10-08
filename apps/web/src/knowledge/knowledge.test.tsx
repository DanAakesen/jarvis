import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchTitles, readKnowledgeGraph, sampleKnowledgeGraph, vaultMemoryId } from './knowledge-data';
import { GeneratedViewRenderer } from '../GeneratedViewRenderer';
import { KnowledgeBackendContext } from './knowledge-context';
import { createKnowledgeLayout } from './knowledge-layout';
import { KnowledgeGraphView } from './KnowledgeGraphView';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('knowledge graph data', () => {
  it('validates the graph, defaults unknown folders and drops dangling or self edges', () => {
    const graph = readKnowledgeGraph({
      nodes: [
        { id: 'a', path: 'People/Anna.md', title: 'Anna', folder: 'People', updatedAt: '2026-10-07T10:00:00.000Z', degree: 2 },
        { id: 'b', path: 'Work/Roadmap.md', title: 'Roadmap', folder: 'Archive', updatedAt: null, degree: 1 },
      ],
      edges: [{ source: 'a', target: 'b', type: 'link' }, { source: 'a', target: 'a', type: 'link' }, { source: 'a', target: 'zzz', type: 'similar' }],
    });
    expect(graph.nodes.map((node) => node.folder)).toEqual(['People', 'General']);
    expect(graph.edges).toEqual([{ source: 'a', target: 'b', type: 'link' }]);
    expect(matchTitles(graph, 'ann')).toEqual(['a']);
    expect(() => readKnowledgeGraph({ nodes: 'nope' })).toThrow();
    expect(vaultMemoryId('People/Anna.md')).toBe('vault_UGVvcGxlL0FubmEubWQ');
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
  it('says the graph is not available yet instead of inventing data when the service is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'not found' }, 404)));
    render(<KnowledgeGraphView backendUrl="https://api.example.com" getAccessToken={getAccessToken} />);
    expect(await screen.findByText(/knowledge graph is not available yet/)).not.toBeNull();
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
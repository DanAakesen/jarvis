import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { MarkdownContent } from '../MarkdownContent';
import {
  KnowledgeUnavailable, knowledgeFolders, loadKnowledgeGraph, loadKnowledgeNote, matchTitles,
  searchKnowledge, type KnowledgeFolder, type KnowledgeGraph, type KnowledgeNote,
} from './knowledge-data';
import type { KnowledgeScene } from './knowledge-scene';
import { useKnowledgeBackend } from './knowledge-context';
import { Loader } from '../Loader';

type Load = { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ready'; graph: KnowledgeGraph };

const reducedMotion = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

function NoteReader({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const element = viewport.current;
    setMore(!!element && element.scrollHeight - element.clientHeight - element.scrollTop > 2);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (viewport.current) observer?.observe(viewport.current);
    if (content.current) observer?.observe(content.current);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [update]);

  return (
    <div className="knowledge-note-reader" data-more={more || undefined}>
      <div ref={viewport} className="knowledge-note-body" role="region" aria-label="Note content" tabIndex={0} onScroll={update}>
        <div ref={content}>{children}</div>
      </div>
      {more && <button className="knowledge-note-scroll" type="button" onClick={() => {
        const element = viewport.current;
        element?.scrollBy({ top: element.clientHeight * 0.8, behavior: reducedMotion() ? 'instant' : 'smooth' });
      }}>Scroll down <span aria-hidden="true">↓</span></button>}
    </div>
  );
}

/**
 * Dan's vault as a 3D star cloud (P7-43): every note a star coloured by folder, links as fine lines. Search lights up the
 * matches and flies to them; a star opens its note. Used by the Knowledge page and by the window Jarvis opens.
 */
export function KnowledgeGraphView({ backendUrl, getAccessToken, initialQuery = '', initialHighlight, compact = false }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  initialQuery?: string;
  initialHighlight?: readonly string[];
  compact?: boolean;
}) {
  const ids = useId();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<KnowledgeScene | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<string[]>(initialHighlight ? [...initialHighlight] : []);
  // Jarvis can update an open knowledge window with a new query and highlight; adopt them when they change.
  const externalKey = `${initialQuery}\n${(initialHighlight ?? []).join(',')}`;
  const [external, setExternal] = useState({ key: externalKey, query: initialQuery, highlight: initialHighlight ? [...initialHighlight] : [] });
  if (external.key !== externalKey) {
    setExternal({ key: externalKey, query: initialQuery, highlight: initialHighlight ? [...initialHighlight] : [] });
    setQuery(initialQuery);
    setHits(initialHighlight ? [...initialHighlight] : []);
  }
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Browsing: one folder can be isolated from the legend; its notes list beside the search.
  const [folder, setFolder] = useState<KnowledgeFolder | null>(null);
  const [note, setNote] = useState<{ id: string; value: KnowledgeNote | null; error: string } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [labels, setLabels] = useState<{ id: string; x: number; y: number }[]>([]);
  const graph = load.status === 'ready' ? load.graph : null;
  const nodesById = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []), [graph]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!backendUrl) {
      void Promise.resolve().then(() => { if (active) setLoad({ status: 'unavailable' }); });
      return () => { active = false; };
    }
    void loadKnowledgeGraph(backendUrl, getAccessToken, controller.signal).then((value) => {
      if (active) setLoad({ status: 'ready', graph: value });
    }).catch((reason: unknown) => {
      if (!active) return;
      setLoad(reason instanceof KnowledgeUnavailable ? { status: 'unavailable' }
        : { status: 'error', message: reason instanceof Error ? reason.message : 'Jarvis could not load your knowledge.' });
    });
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, reload]);

  // The scene is loaded on demand (three.js stays out of the main bundle) and rebuilt only for a new graph.
  useEffect(() => {
    const element = host.current;
    if (!graph || !element) return;
    let disposed = false;
    void import('./knowledge-scene').then(({ createKnowledgeScene }) => {
      if (disposed) return;
      try {
        scene.current = createKnowledgeScene(element, graph, {
          onSelect: (id) => setSelectedId(id),
          onHover: setHover,
          onLabels: (next) => setLabels((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next),
        }, reducedMotion());
        setSceneFailed(false);
      } catch {
        setSceneFailed(true);
      }
    }).catch(() => { if (!disposed) setSceneFailed(true); });
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [graph]);

  useEffect(() => { scene.current?.highlight(hits); }, [hits, graph]);
  useEffect(() => { scene.current?.select(selectedId); }, [selectedId]);
  useEffect(() => { scene.current?.showFolders(folder ? [folder] : null); }, [folder, graph]);

  // Search: titles match instantly; the knowledge search refines the result when it answers.
  useEffect(() => {
    if (!graph) return;
    const trimmed = query.trim();
    // Jarvis's own search result stands for the query it sent; Dan's own typing searches afresh.
    if (external.highlight.length && trimmed === external.query.trim()) {
      const timer = window.setTimeout(() => setHits(external.highlight.filter((id) => nodesById.has(id))), 0);
      return () => window.clearTimeout(timer);
    }
    const local = trimmed ? matchTitles(graph, trimmed) : [];
    const timer = window.setTimeout(() => setHits(local), 0);
    if (!trimmed || !backendUrl || graph.sample) return () => window.clearTimeout(timer);
    const controller = new AbortController();
    const remote = window.setTimeout(() => {
      setSearching(true);
      void searchKnowledge(backendUrl, getAccessToken, trimmed, controller.signal)
        .then((found) => { if (found.length) setHits(found.filter((id) => nodesById.has(id))); })
        .catch(() => { /* Title matches stay when the search service is unavailable. */ })
        .finally(() => setSearching(false));
    }, 300);
    return () => { window.clearTimeout(timer); window.clearTimeout(remote); controller.abort(); };
  }, [backendUrl, external, getAccessToken, graph, nodesById, query]);

  useEffect(() => {
    let active = true;
    const node = selectedId ? nodesById.get(selectedId) : undefined;
    if (!selectedId || !node || !backendUrl || graph?.sample) return () => { active = false; };
    const controller = new AbortController();
    void loadKnowledgeNote(backendUrl, getAccessToken, node, controller.signal).then((value) => {
      if (active) setNote({ id: selectedId, value, error: '' });
    }).catch(() => {
      if (active) setNote({ id: selectedId, value: null, error: 'This note could not be opened. Try again.' });
    });
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, graph?.sample, nodesById, selectedId]);

  const open = useCallback((id: string) => setSelectedId(id), []);
  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  const neighbours = useMemo(() => {
    if (!graph || !selectedId) return [];
    return graph.edges.flatMap((edge) => edge.source === selectedId ? [edge.target] : edge.target === selectedId ? [edge.source] : [])
      .filter((id, index, list) => list.indexOf(id) === index).slice(0, 12).flatMap((id) => nodesById.get(id) ?? []);
  }, [graph, nodesById, selectedId]);
  const counts = useMemo(() => new Map(knowledgeFolders.map((folder) => [folder, graph?.nodes.filter((node) => node.folder === folder).length ?? 0])), [graph]);
  const currentNote = note && note.id === selectedId ? note : null;

  return (
    <section className="knowledge" data-compact={compact || undefined} data-nodes={graph?.nodes.length} data-edges={graph?.edges.length} data-links={graph?.edges.filter((edge) => edge.type === 'link').length} data-similar={graph?.edges.filter((edge) => edge.type === 'similar').length} aria-label="Knowledge graph">
      <div ref={host} className="knowledge-stage" aria-hidden="true" />
      {load.status === 'loading' && <Loader variant="core" className="knowledge-loader" label="Mapping your knowledge…" />}
      {load.status === 'error' && (
        <div className="knowledge-status" role="alert">
          <p>{load.message}</p>
          <button className="secondary-button" type="button" onClick={() => { setLoad({ status: 'loading' }); setReload((value) => value + 1); }}>Retry</button>
        </div>
      )}
      {load.status === 'unavailable' && (
        <div className="knowledge-status" role="status">
          <p>The knowledge graph is unavailable.</p>
        </div>
      )}
      {sceneFailed && graph && <p className="knowledge-status" role="status">The 3D view is unavailable. Search remains available.</p>}

      {graph && (
        <>
          {labels.map((label) => {
            const node = nodesById.get(label.id);
            return node ? (
              <span key={label.id} className="knowledge-label" data-folder={node.folder} data-selected={label.id === selectedId || undefined}
                style={{ transform: `translate(${Math.round(label.x)}px, ${Math.round(label.y)}px)` }} aria-hidden="true">{node.title}</span>
            ) : null;
          })}
          {hover && nodesById.get(hover.id) && !labels.some((label) => label.id === hover.id) && (
            <span className="knowledge-label knowledge-label-hover" style={{ transform: `translate(${Math.round(hover.x)}px, ${Math.round(hover.y)}px)` }} aria-hidden="true">
              {nodesById.get(hover.id)!.title}
            </span>
          )}
          <div className="knowledge-search luminous-glass">
            <label className="visually-hidden" htmlFor={`${ids}-query`}>Search your knowledge</label>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input id={`${ids}-query`} type="search" placeholder="Search your knowledge…" value={query} maxLength={200} autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
            <span className="knowledge-count" role="status" aria-live="polite">
              {query.trim() ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}${searching ? '…' : ''}` : `${graph.nodes.length} notes`}
            </span>
            {(query || selectedId || folder) && (
              <button className="knowledge-reset" type="button" onClick={() => { setQuery(''); setSelectedId(null); setFolder(null); scene.current?.resetView(); }}>Reset view</button>
            )}
          </div>
          {(query.trim() ? hits.length > 0 : folder !== null) && (
            <ol className="knowledge-results luminous-glass" aria-label={query.trim() ? 'Matching notes' : `${folder} notes`}>
              {(query.trim()
                ? hits.slice(0, compact ? 6 : 12).flatMap((id) => nodesById.get(id) ?? [])
                : graph.nodes.filter((node) => node.folder === folder).sort((left, right) => left.title.localeCompare(right.title)).slice(0, 60)
              ).map((node) => (
                <li key={node.id}>
                  <button type="button" data-folder={node.folder} aria-pressed={node.id === selectedId} onClick={() => open(node.id)}>
                    <span className="knowledge-dot" aria-hidden="true" />{node.title}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <ul className="knowledge-legend" aria-label="Folders">
            {knowledgeFolders.map((name) => (
              <li key={name} data-folder={name}>
                <button type="button" aria-pressed={folder === name} title={folder === name ? 'Show every folder' : `Show only ${name}`}
                  onClick={() => setFolder((current) => current === name ? null : name)}>
                  <span className="knowledge-dot" aria-hidden="true" />{name}<span className="knowledge-legend-count">{counts.get(name)}</span>
                </button>
              </li>
            ))}
            {graph.edges.length === 0 && <li className="knowledge-sample">No links.</li>}
          </ul>
          {selected && (
            <aside className="knowledge-note luminous-glass" aria-labelledby={`${ids}-note`}>
              <header className="knowledge-note-heading">
                <h3 id={`${ids}-note`}><span className="knowledge-dot" data-folder={selected.folder} aria-hidden="true" />{selected.title}</h3>
                <button className="modal-close" type="button" aria-label={`Close ${selected.title}`} onClick={() => setSelectedId(null)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </header>
              <NoteReader key={selected.id}>
                <p className="knowledge-note-meta">{selected.folder} · {selected.path}</p>
                {!currentNote ? <Loader variant="lines" label="Opening the note…" />
                    : currentNote.error ? <p role="alert">{currentNote.error}</p>
                      : currentNote.value!.content ? <MarkdownContent source={currentNote.value!.content} />
                        : <p>This note is empty.</p>}
                {currentNote?.value?.githubUrl && <a className="knowledge-note-link" href={currentNote.value.githubUrl} target="_blank" rel="noreferrer">Open in GitHub</a>}
                {neighbours.length > 0 && (
                  <>
                    <h4 className="knowledge-note-subheading">Connected notes</h4>
                    <ul className="knowledge-neighbours">
                      {neighbours.map((node) => (
                        <li key={node.id}><button type="button" data-folder={node.folder} onClick={() => open(node.id)}><span className="knowledge-dot" aria-hidden="true" />{node.title}</button></li>
                      ))}
                    </ul>
                  </>
                )}
              </NoteReader>
            </aside>
          )}
        </>
      )}
    </section>
  );
}

/** The `knowledge-graph` window Jarvis opens with `show_knowledge`: the same cloud with its matches lit. */
export function KnowledgeGraphWindow({ query, highlight }: { query: string; highlight: readonly string[] }) {
  const backend = useKnowledgeBackend();
  if (!backend) return <p role="status">The knowledge graph is unavailable in this view.</p>;
  return <KnowledgeGraphView backendUrl={backend.backendUrl} getAccessToken={backend.getAccessToken} initialQuery={query} initialHighlight={highlight} compact />;
}
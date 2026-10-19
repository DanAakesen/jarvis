import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MarkdownContent } from '../MarkdownContent';
import {
  connectedNotes, KnowledgeUnavailable, knowledgeFolders, loadKnowledgeGraph, loadKnowledgeNote, matchTitles,
  searchKnowledge, type KnowledgeGraph, type KnowledgeNode, type KnowledgeNote,
} from './knowledge-data';
import type { KnowledgeScene } from './knowledge-scene';
import { useKnowledgeBackend } from './knowledge-context';
import { loadVaultTasks, VaultTasksUnavailable, vaultTaskRecovery, type VaultTaskRead } from '../tasks/tasks-data';
import { StateMessage } from '../StateMessage';

type Load = { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ready'; graph: KnowledgeGraph };

const reducedMotion = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

function taskDateLabel(dueDate: string | null, dueTime: string | null, dueAt: string | null): string {
  if (!dueDate) return 'No due date';
  const [year, month, day] = dueDate.split('-').map(Number);
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
  const time = dueAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(dueAt)) : dueTime;
  return time ? `${date}, ${time}` : date;
}

export function KnowledgeNoteReader({ children }: { children: ReactNode }) {
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
export function KnowledgeGraphView({ backendUrl, getAccessToken, initialQuery = '', initialHighlight, compact = false,
  onOpenNote, selectedPath, refreshKey = 0, searchAction, showTaskMatches = false, children }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  initialQuery?: string;
  initialHighlight?: readonly string[];
  compact?: boolean;
  onOpenNote?: (node: KnowledgeNode, graph: KnowledgeGraph) => void;
  selectedPath?: string;
  refreshKey?: number;
  searchAction?: ReactNode;
  showTaskMatches?: boolean;
  children?: ReactNode;
}) {
  const ids = useId();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<KnowledgeScene | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<string[]>(initialHighlight ? [...initialHighlight] : []);
  const [noteSnippets, setNoteSnippets] = useState<Record<string, string>>({});
  const [taskSearch, setTaskSearch] = useState<{ result: VaultTaskRead | null; error: string }>({ result: null, error: '' });
  // Jarvis can update an open knowledge window with a new query and highlight; adopt them when they change.
  const externalKey = `${initialQuery}\n${(initialHighlight ?? []).join(',')}`;
  const [external, setExternal] = useState({ key: externalKey, query: initialQuery, highlight: initialHighlight ? [...initialHighlight] : [] });
  if (external.key !== externalKey) {
    setExternal({ key: externalKey, query: initialQuery, highlight: initialHighlight ? [...initialHighlight] : [] });
    setQuery(initialQuery);
    setHits(initialHighlight ? [...initialHighlight] : []);
  }
  const [searching, setSearching] = useState(false);
  const [localSelectedId, setSelectedId] = useState<string | null>(null);
  // Browsing: one folder can be isolated from the legend; its notes list beside the search.
  const [folder, setFolder] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; value: KnowledgeNote | null; error: string } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [labels, setLabels] = useState<{ id: string; x: number; y: number }[]>([]);
  const graph = load.status === 'ready' ? load.graph : null;
  const nodesById = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []), [graph]);
  const selectedId = onOpenNote ? graph?.nodes.find(node => node.path === selectedPath)?.id ?? null : localSelectedId;
  const open = useCallback((nodeId: string) => {
    const node = nodesById.get(nodeId);
    if (onOpenNote) { if (node && graph) onOpenNote(node, graph); }
    else setSelectedId(nodeId);
  }, [graph, nodesById, onOpenNote]);
  const openRef = useRef(open);
  useLayoutEffect(() => { openRef.current = open; }, [open]);

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
  }, [backendUrl, getAccessToken, reload, refreshKey]);

  // The scene is loaded on demand (three.js stays out of the main bundle) and rebuilt only for a new graph.
  useEffect(() => {
    const element = host.current;
    if (!graph || !element) return;
    let disposed = false;
    void import('./knowledge-scene').then(({ createKnowledgeScene }) => {
      if (disposed) return;
      try {
        scene.current = createKnowledgeScene(element, graph, {
          onSelect: (id) => openRef.current(id),
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
  useEffect(() => { scene.current?.showFolders(folder !== null ? [folder] : null); }, [folder, graph]);

  // Search: titles match instantly; the knowledge search refines the result when it answers.
  useEffect(() => {
    if (!graph) return;
    const trimmed = query.trim();
    // Jarvis's own search result stands for the query it sent; Dan's own typing searches afresh.
    if (external.highlight.length && trimmed === external.query.trim()) {
      const timer = window.setTimeout(() => {
        setSearching(false);
        setNoteSnippets({});
        setTaskSearch({ result: null, error: '' });
        setHits(external.highlight.filter((id) => nodesById.has(id)));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const local = trimmed ? matchTitles(graph, trimmed) : [];
    const timer = window.setTimeout(() => {
      setSearching(false);
      setNoteSnippets({});
      setTaskSearch({ result: null, error: '' });
      setHits(local);
    }, 0);
    if (!trimmed || !backendUrl || graph.sample) return () => window.clearTimeout(timer);
    const controller = new AbortController();
    const remote = window.setTimeout(() => {
      setSearching(true);
      void searchKnowledge(backendUrl, getAccessToken, trimmed, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          if (found.length) {
            const matching = found.filter(({ nodeId }) => nodesById.has(nodeId));
            setHits(matching.map(({ nodeId }) => nodeId));
            setNoteSnippets(Object.fromEntries(matching.map(({ nodeId, snippet }) => [nodeId, snippet])));
          }
        })
        .catch(() => { /* Title matches stay when the search service is unavailable. */ })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
      if (showTaskMatches) {
        void loadVaultTasks(backendUrl, getAccessToken, trimmed, 'open', controller.signal)
          .then((result) => { if (!controller.signal.aborted) setTaskSearch({ result, error: '' }); })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            const recovery = error instanceof VaultTasksUnavailable ? vaultTaskRecovery(error.reason) : 'Try again later.';
            setTaskSearch({ result: null, error: `Task matches are unavailable. ${recovery}` });
          });
      }
    }, 300);
    return () => { window.clearTimeout(timer); window.clearTimeout(remote); controller.abort(); };
  }, [backendUrl, external, getAccessToken, graph, nodesById, query, showTaskMatches]);

  useEffect(() => {
    let active = true;
    const node = selectedId ? nodesById.get(selectedId) : undefined;
    if (onOpenNote || !selectedId || !node || !backendUrl || graph?.sample) return () => { active = false; };
    const controller = new AbortController();
    void loadKnowledgeNote(backendUrl, getAccessToken, node, controller.signal).then((value) => {
      if (active) setNote({ id: selectedId, value, error: '' });
    }).catch(() => {
      if (active) setNote({ id: selectedId, value: null, error: 'This note could not be opened. Try again.' });
    });
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, graph?.sample, nodesById, selectedId, onOpenNote]);

  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  const neighbours = useMemo(() => connectedNotes(graph, selectedId), [graph, selectedId]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const node of graph?.nodes ?? []) result.set(node.folder, (result.get(node.folder) ?? 0) + 1);
    return result;
  }, [graph]);
  const folders = [...counts.keys()].sort((left, right) => {
    const rank = (name: string) => {
      const index = knowledgeFolders.findIndex(folder => folder === name);
      return index === -1 ? knowledgeFolders.length : index;
    };
    return rank(left) - rank(right) || left.localeCompare(right);
  });
  const currentNote = note && note.id === selectedId ? note : null;

  return (
    <section className="knowledge" data-compact={compact || undefined} data-nodes={graph?.nodes.length} data-edges={graph?.edges.length} data-links={graph?.edges.filter((edge) => edge.type === 'link').length} data-similar={graph?.edges.filter((edge) => edge.type === 'similar').length} aria-label="Knowledge graph">
      <div ref={host} className="knowledge-stage" aria-hidden="true" />
      {load.status === 'loading' && <StateMessage variant="loading" className="knowledge-loader" message="Mapping your knowledge" />}
      {load.status === 'error' && (
        <StateMessage variant="error" className="knowledge-status" message={load.message}
          actionLabel="Retry" onAction={() => { setLoad({ status: 'loading' }); setReload((value) => value + 1); }} />
      )}
      {load.status === 'unavailable' && (
        <StateMessage variant="empty" className="knowledge-status" message="The knowledge graph is unavailable." />
      )}
      {sceneFailed && graph && <StateMessage variant="partial" className="knowledge-status"
        message="Search remains available." detail="The 3D view is unavailable." />}
      {graph && graph.nodes.length === 0 && <StateMessage variant="empty" className="knowledge-status"
        message="No knowledge notes are available." detail="Add notes to the vault to build the knowledge graph." />}

      {(graph || searchAction) && <div className="knowledge-search luminous-glass">
        <label className="visually-hidden" htmlFor={`${ids}-query`}>Search your knowledge</label>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input id={`${ids}-query`} type="search" placeholder="Search your knowledge…" value={query} maxLength={200} autoComplete="off"
          disabled={!graph} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} />
        {graph && <span className="knowledge-count" role="status" aria-live="polite">
          {query.trim() ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}${searching ? '…' : ''}` : `${graph.nodes.length} ${graph.nodes.length === 1 ? 'note' : 'notes'}`}
        </span>}
        {(query || selectedId || folder !== null) && (
          <button className="knowledge-reset" type="button" onClick={() => { setQuery(''); setSelectedId(null); setFolder(null); scene.current?.resetView(); }}>Reset view</button>
        )}
        {searchAction}
      </div>}
      {graph && query.trim() && !searching && hits.length === 0 &&
        <StateMessage variant="empty" className="knowledge-status" message="No notes match this search." />}
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
          {(query.trim()
            ? hits.length > 0 || (showTaskMatches && (!!taskSearch.result || !!taskSearch.error))
            : folder !== null) && (
            <div className="knowledge-results luminous-glass">
              {query.trim() && showTaskMatches && taskSearch.result && taskSearch.result.total > 0 && (
                <section className="knowledge-task-results" aria-labelledby={`${ids}-task-results`}>
                  <h2 id={`${ids}-task-results`}>Tasks</h2>
                  <a className="knowledge-task-results-count" href={`/tasks?${new URLSearchParams({ q: query.trim() })}`}>
                    {taskSearch.result.total} matching {taskSearch.result.total === 1 ? 'task' : 'tasks'}
                  </a>
                  <ol>
                    {taskSearch.result.items.slice(0, 3).map((task) => (
                      <li key={task.id}>
                        <span>{task.text}</span>
                        <time dateTime={task.dueAt ?? task.dueDate ?? undefined}>
                          {taskDateLabel(task.dueDate, task.dueTime, task.dueAt)}
                        </time>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {query.trim() && taskSearch.error && <p className="knowledge-task-search-error" role="status">{taskSearch.error}</p>}
              {(query.trim() ? hits.length > 0 : folder !== null) && (
                <ol className="knowledge-result-list" aria-label={query.trim() ? 'Matching notes' : `${folder || 'Vault root'} notes`}>
                  {(query.trim()
                    ? hits.slice(0, compact ? 6 : 12).flatMap((id) => nodesById.get(id) ?? [])
                    : graph.nodes.filter((node) => node.folder === folder).sort((left, right) => left.title.localeCompare(right.title)).slice(0, 60)
                  ).map((node) => (
                    <li key={node.id}>
                      <button className="ghost-button" type="button" data-folder={node.folder} aria-pressed={node.id === selectedId} onClick={() => open(node.id)}>
                        <span className="knowledge-dot" aria-hidden="true" />
                        <span className="knowledge-result-note-text">
                          <span>{node.title}</span>
                          {noteSnippets[node.id] && <span className="knowledge-result-snippet">{noteSnippets[node.id]}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          <ul className="knowledge-legend" aria-label="Folders">
            {folders.map((name) => (
              <li key={name} data-folder={name}>
                <button className="ghost-button" type="button" aria-pressed={folder === name} title={folder === name ? 'Show every folder' : `Show only ${name}`}
                  onClick={() => setFolder((current) => current === name ? null : name)}>
                  <span className="knowledge-dot" aria-hidden="true" />{name || 'Vault root'}<span className="knowledge-legend-count">{counts.get(name)}</span>
                </button>
              </li>
            ))}
            {graph.edges.length === 0 && <li className="knowledge-sample">No links.</li>}
          </ul>
          {selected && !onOpenNote && (
            <aside className="knowledge-note luminous-glass" aria-labelledby={`${ids}-note`}>
              <header className="knowledge-note-heading">
                <h3 id={`${ids}-note`}><span className="knowledge-dot" data-folder={selected.folder} aria-hidden="true" />{selected.title}</h3>
                <button className="modal-close" type="button" aria-label={`Close ${selected.title}`} onClick={() => setSelectedId(null)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </header>
              <KnowledgeNoteReader key={selected.id}>
                <p className="knowledge-note-meta">{selected.folder} · {selected.path}</p>
                {!currentNote ? <StateMessage variant="loading" loaderVariant="lines" message="Opening the note" />
                    : currentNote.error ? <StateMessage variant="error" message={currentNote.error} />
                      : currentNote.value!.content ? <MarkdownContent source={currentNote.value!.content} />
                        : <StateMessage variant="empty" message="This note is empty." />}
                {currentNote?.value?.githubUrl && <a className="knowledge-note-link" href={currentNote.value.githubUrl} target="_blank" rel="noreferrer">Open in GitHub</a>}
                {neighbours.length > 0 && (
                  <>
                    <h4 className="knowledge-note-subheading">Connected notes</h4>
                    <ul className="knowledge-neighbours">
                      {neighbours.map((node) => (
                        <li key={node.id}><button className="ghost-button" type="button" data-folder={node.folder} onClick={() => open(node.id)}><span className="knowledge-dot" aria-hidden="true" />{node.title}</button></li>
                      ))}
                    </ul>
                  </>
                )}
              </KnowledgeNoteReader>
            </aside>
          )}
        </>
      )}
      {children}
    </section>
  );
}

/** The `knowledge-graph` window Jarvis opens with `show_knowledge`: the same cloud with its matches lit. */
export function KnowledgeGraphWindow({ query, highlight }: { query: string; highlight: readonly string[] }) {
  const backend = useKnowledgeBackend();
  if (!backend) return <StateMessage variant="empty" message="The knowledge graph is unavailable in this view." />;
  return <KnowledgeGraphView backendUrl={backend.backendUrl} getAccessToken={backend.getAccessToken} initialQuery={query} initialHighlight={highlight} compact />;
}
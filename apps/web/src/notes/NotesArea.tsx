import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import type { AreaProps } from '../areas';
import { KnowledgeGraphView } from '../knowledge/KnowledgeGraphView';
import { NoteEditor } from './NoteEditor';
import { NoteList } from './NoteList';
import { NewNote } from './NewNote';
import type { NoteFolder } from './notes-data';

const discardPrompt = 'You have unsaved changes to this note. Discard them?';

/** The Notes page: browse, create and edit vault notes, with the knowledge graph one view away. */
export function NotesArea({ backendUrl, getAccessToken }: AreaProps) {
  return (
    <Routes>
      <Route index element={<NotesPage backendUrl={backendUrl} getAccessToken={getAccessToken} />} />
      <Route path="graph" element={
        <div className="area knowledge-page">
          <h1 className="visually-hidden">Notes graph</h1>
          <KnowledgeGraphView backendUrl={backendUrl} getAccessToken={getAccessToken} />
        </div>
      } />
      <Route path="*" element={<Navigate to="/notes" replace />} />
    </Routes>
  );
}

function NotesPage({ backendUrl, getAccessToken }: AreaProps) {
  const [params, setParams] = useSearchParams();
  const { pathname, search } = useLocation();
  const auth = useMemo(() => backendUrl ? { backendUrl, getAccessToken } : null, [backendUrl, getAccessToken]);
  const [dirty, setDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [folder, setFolder] = useState<NoteFolder | undefined>();
  const selected = params.get('note');
  const creating = params.get('new') !== null;
  const onSaved = useCallback(() => setRefreshKey((value) => value + 1), []);

  // Closing the tab, reloading or following a link out of Notes must not silently drop edits.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || (link as HTMLAnchorElement).target === '_blank') return;
      const url = new URL((link as HTMLAnchorElement).href, window.location.href);
      if (url.origin === window.location.origin && (url.pathname !== pathname || url.search !== search) && !window.confirm(discardPrompt)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, pathname, search]);

  const go = (next: Record<string, string> | null) => {
    if (dirty && !window.confirm(discardPrompt)) return;
    setDirty(false);
    setParams(next ?? {}, { replace: false });
  };
  const screen = creating || selected ? 'editor' : 'list';

  return (
    <div className="area notes-page" data-screen={screen}>
      <div className="notes-header panel">
        <h1>Notes</h1>
        <nav className="notes-views" aria-label="Notes views">
          <NavLink to="/notes" end>Notes</NavLink>
          <NavLink to="/notes/graph">Graph</NavLink>
        </nav>
      </div>
      {!auth ? (
        <p className="notes-message">Notes are unavailable until the backend is deployed.</p>
      ) : (
        <div className="notes-layout">
          <section className="notes-list panel" aria-label="Note list">
            <NoteList auth={auth} selectedPath={selected} refreshKey={refreshKey} folder={folder} onFolder={setFolder}
              onOpen={(path) => go({ note: path })} onNew={() => go({ new: '1' })} />
          </section>
          <section className="notes-detail panel" aria-label="Note editor">
            {creating ? (
              <NewNote auth={auth} defaultFolder={folder} onCancel={() => go(null)} onCreated={(path) => { setRefreshKey((value) => value + 1); setDirty(false); setParams({ note: path }); }} />
            ) : selected ? (
              <NoteEditor key={selected} auth={auth} path={selected} onDirtyChange={setDirty} onSaved={onSaved} onBack={() => go(null)} />
            ) : (
              <p className="notes-message">Choose a note to read or edit it, or create a new one.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

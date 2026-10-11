import { useEffect, useState } from 'react';
import { Loader } from '../Loader';
import { listNotes, noteFolders, type NoteFolder, type NoteListItem } from './notes-data';

type Auth = { backendUrl: string; getAccessToken: () => Promise<string> };
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; notes: NoteListItem[]; hasMore: boolean };

/** Search and folder filter over the vault's notes; the backend returns them sorted by path in pages. */
export function NoteList({ auth, selectedPath, refreshKey, folder, onFolder, onOpen, onNew }: {
  auth: Auth;
  selectedPath: string | null;
  refreshKey: number;
  folder: NoteFolder | undefined;
  onFolder: (folder: NoteFolder | undefined) => void;
  onOpen: (path: string) => void;
  onNew: () => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [more, setMore] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    listNotes(auth, { query, folder }, controller.signal).then(
      (page) => { setState({ status: 'ready', ...page }); setMore({ busy: false, error: '' }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Jarvis could not load your notes.' });
      },
    );
    return () => controller.abort();
  }, [auth, query, folder, refreshKey, attempt]);

  const loadMore = async () => {
    if (state.status !== 'ready') return;
    setMore({ busy: true, error: '' });
    try {
      const page = await listNotes(auth, { query, folder, offset: state.notes.length });
      setState({ status: 'ready', notes: [...state.notes, ...page.notes], hasMore: page.hasMore });
      setMore({ busy: false, error: '' });
    } catch (error) {
      setMore({ busy: false, error: error instanceof Error ? error.message : 'Jarvis could not load more notes.' });
    }
  };

  return (
    <div className="notes-list-pane">
      <div className="notes-filters">
        <input type="search" aria-label="Search notes" placeholder="Search notes" value={input} maxLength={500}
          onChange={(event) => setInput(event.target.value)} />
        <select aria-label="Folder" value={folder ?? ''} onChange={(event) => onFolder(event.target.value ? event.target.value as NoteFolder : undefined)}>
          <option value="">All folders</option>
          {noteFolders.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button className="primary-button notes-new-button" type="button" onClick={onNew}>New note</button>
      </div>
      {state.status === 'loading' && <Loader label="Loading notes" variant="rows" />}
      {state.status === 'error' && (
        <div className="notes-message">
          <p role="alert">{state.message}</p>
          <button className="secondary-button" type="button" onClick={() => { setState({ status: 'loading' }); setAttempt((value) => value + 1); }}>Try again</button>
        </div>
      )}
      {state.status === 'ready' && state.notes.length === 0 && (
        <p className="notes-message">{query || folder ? 'No notes match.' : 'No notes yet. Create the first one.'}</p>
      )}
      {state.status === 'ready' && state.notes.length > 0 && (
        <>
          <ul className="notes-items" aria-label="Notes">
            {state.notes.map((note) => (
              <li key={note.path}>
                <button type="button" className="notes-item" data-folder={note.folder} aria-current={note.path === selectedPath ? 'true' : undefined}
                  onClick={() => onOpen(note.path)}>
                  <span className="knowledge-dot" aria-hidden="true" />
                  <span className="notes-item-text"><span className="notes-item-title">{note.title}</span><span className="notes-item-path">{note.path}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {more.error && <p className="notes-error" role="alert">{more.error}</p>}
          {state.hasMore && <button className="secondary-button notes-more" type="button" disabled={more.busy} onClick={() => void loadMore()}>
            {more.busy ? 'Loading…' : 'Load more'}
          </button>}
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Loader } from '../Loader';
import { StateMessage } from '../StateMessage';
import { folderTree, type Folder, type NotePage, type NoteSummary, type NoteTree } from './notes-data';
import './NotesTree.css';

interface Listing { notes: NoteSummary[]; hasMore: boolean; status: 'loading' | 'ready' | 'error'; error: string }
type Entry =
  | { type: 'folder'; key: string; path: string; name: string; level: number; parent: string; size: number; position: number; open: boolean }
  | { type: 'note'; key: string; path: string; name: string; level: number; parent: string; size: number; position: number }
  | { type: 'loading' | 'empty'; key: string; level: number }
  | { type: 'error'; key: string; level: number; directory: string; offset: number; message: string }
  | { type: 'more'; key: string; level: number; directory: string; offset: number };

const failure = (cause: unknown) => cause instanceof Error ? cause.message : 'Notes could not be loaded. Try again.';
const hidden = (path: string) => path.split('/').some(segment => segment.startsWith('.'));
const topFolder = (path: string) => path.split('/')[0] ?? '';

function Glyph({ kind }: { kind: 'folder' | 'note' }) {
  return <svg className="notes-tree-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
    {kind === 'folder' ? <path d="M3 7V5h6l2 2h10v12H3Z" /> : <path d="M6 3h8l4 4v14H6Z M14 3v4h4M9 12h6M9 16h6" />}
  </svg>;
}

/**
 * A lazy tree of the vault's folders and notes. Folders come from one tree read; each folder's notes are
 * read a page at a time when it opens, so a large vault never loads at once.
 */
export function NotesTree({ id, loadTree, loadNotes, selectedPath, refreshKey = 0, onOpenNote, onClose }: {
  id: string;
  loadTree: (signal: AbortSignal) => Promise<NoteTree>;
  loadNotes: (directory: string, offset: number, signal: AbortSignal) => Promise<NotePage>;
  selectedPath?: string;
  refreshKey?: number;
  onOpenNote: (path: string, title: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const session = useRef<{ controller: AbortController; started: Set<string> } | null>(null);
  const [revision, setRevision] = useState(0);
  const [inventory, setInventory] = useState<NoteTree | null>(null);
  const [treeError, setTreeError] = useState('');
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState('');

  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController();
    session.current = { controller, started: new Set() };
    setInventory(null); setTreeError(''); setListings({});
    void loadTree(controller.signal).then(next => {
      if (!controller.signal.aborted) setInventory(next);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setTreeError(failure(cause));
    });
    return () => controller.abort();
  }, [loadTree, revision, refreshKey]);

  const fetchDirectory = useCallback((directory: string, offset: number) => {
    const current = session.current;
    const key = `${directory}:${offset}`;
    if (!current || current.started.has(key)) return;
    current.started.add(key);
    setListings(previous => ({ ...previous, [directory]: { notes: previous[directory]?.notes ?? [], hasMore: false, status: 'loading', error: '' } }));
    loadNotes(directory, offset, current.controller.signal).then(page => {
      if (current.controller.signal.aborted) return;
      setListings(previous => {
        const known = offset === 0 ? [] : previous[directory]?.notes ?? [];
        const seen = new Set(known.map(note => note.path));
        return { ...previous, [directory]: { notes: [...known, ...page.notes.filter(note => !seen.has(note.path))], hasMore: page.hasMore, status: 'ready', error: '' } };
      });
    }).catch((cause: unknown) => {
      if (current.controller.signal.aborted) return;
      setListings(previous => ({ ...previous, [directory]: { notes: previous[directory]?.notes ?? [], hasMore: false, status: 'error', error: failure(cause) } }));
    });
  }, [loadNotes]);
  useEffect(() => {
    for (const directory of ['', ...expanded]) fetchDirectory(directory, 0);
  }, [expanded, fetchDirectory, revision, refreshKey]);

  const retry = (directory: string, offset: number) => {
    session.current?.started.delete(`${directory}:${offset}`);
    fetchDirectory(directory, offset);
  };

  const folders = useMemo(() => folderTree((inventory?.directories ?? []).filter(path => !hidden(path))), [inventory]);
  const entries = useMemo(() => {
    const result: Entry[] = [];
    const walk = (directory: string, children: Folder[], level: number, parent: string) => {
      const listing = listings[directory];
      const notes = listing?.notes ?? [];
      const size = children.length + notes.length;
      children.forEach((folder, index) => {
        const open = expanded.has(folder.path);
        result.push({ type: 'folder', key: `d:${folder.path}`, path: folder.path, name: folder.name, level, parent, size, position: index + 1, open });
        if (open) walk(folder.path, folder.children, level + 1, `d:${folder.path}`);
      });
      notes.forEach((note, index) => {
        result.push({ type: 'note', key: `n:${note.path}`, path: note.path, name: note.title, level, parent, size, position: children.length + index + 1 });
      });
      if (listing?.status === 'loading') result.push({ type: 'loading', key: `l:${directory}`, level });
      else if (listing?.status === 'error') result.push({ type: 'error', key: `e:${directory}`, level, directory, offset: notes.length, message: listing.error });
      else if (listing?.hasMore) result.push({ type: 'more', key: `m:${directory}`, level, directory, offset: notes.length });
      else if (listing?.status === 'ready' && size === 0 && directory !== '') result.push({ type: 'empty', key: `x:${directory}`, level });
    };
    walk('', folders, 1, '');
    return result;
  }, [folders, listings, expanded]);
  const navigable = useMemo(() => entries.filter((entry): entry is Extract<Entry, { type: 'folder' | 'note' }> => entry.type === 'folder' || entry.type === 'note'), [entries]);
  const tabKey = navigable.some(entry => entry.key === active) ? active : navigable[0]?.key;
  const treeReady = !!inventory && listings['']?.status === 'ready';
  const nothing = treeReady && navigable.length === 0 && !treeError;

  const focusItem = (entry: { key: string } | undefined) => {
    if (!entry) return;
    setActive(entry.key);
    items.current.get(entry.key)?.focus();
  };
  const toggle = (path: string, open: boolean) => setExpanded(current => {
    const next = new Set(current);
    if (open) next.add(path); else next.delete(path);
    return next;
  });
  const activate = (entry: Extract<Entry, { type: 'folder' | 'note' }>) => {
    setActive(entry.key);
    if (entry.type === 'folder') toggle(entry.path, !entry.open);
    else onOpenNote(entry.path, entry.name);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if ((event.target as HTMLElement).getAttribute('role') !== 'treeitem' || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = navigable.findIndex(entry => entry.key === (event.target as HTMLElement).dataset.key);
    const current = navigable[index];
    if (!current) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowDown': focusItem(navigable[index + 1]); break;
      case 'ArrowUp': focusItem(navigable[index - 1]); break;
      case 'Home': focusItem(navigable[0]); break;
      case 'End': focusItem(navigable.at(-1)); break;
      case 'ArrowRight':
        if (current.type === 'folder' && !current.open) toggle(current.path, true);
        else if (current.type === 'folder' && navigable[index + 1]?.parent === current.key) focusItem(navigable[index + 1]);
        break;
      case 'ArrowLeft':
        if (current.type === 'folder' && current.open) toggle(current.path, false);
        else focusItem(navigable.find(entry => entry.key === current.parent));
        break;
      case 'Enter': case ' ': activate(current); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  };

  const row = (entry: Extract<Entry, { type: 'folder' | 'note' }>) => <li key={entry.key} className="notes-tree-item" role="treeitem" data-key={entry.key}
    ref={element => { if (element) items.current.set(entry.key, element); else items.current.delete(entry.key); }}
    tabIndex={entry.key === tabKey ? 0 : -1} title={entry.path} data-folder={topFolder(entry.path) || undefined}
    aria-level={entry.level} aria-setsize={entry.size} aria-posinset={entry.position}
    {...(entry.type === 'folder' ? { 'aria-expanded': entry.open } : { 'aria-selected': entry.path === selectedPath })}
    style={{ '--level': entry.level } as CSSProperties}
    onFocus={event => { if (event.target === event.currentTarget) setActive(entry.key); }}
    onClick={() => activate(entry)}>
    <span className="notes-tree-row">
      {entry.type === 'folder'
        ? <svg className="notes-tree-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        : <span className="notes-tree-spacer" aria-hidden="true" />}
      <Glyph kind={entry.type} />
      <span className="notes-tree-name">{entry.name}</span>
    </span>
  </li>;

  return <section ref={panel} id={id} className="notes-tree-panel luminous-glass" aria-label="Notes tree" aria-busy={!treeReady && !treeError} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <ul className="notes-tree" role="tree" aria-label="Vault notes" onKeyDown={onKeyDown}>
      {entries.map(entry => {
        const style = { '--level': entry.level } as CSSProperties;
        if (entry.type === 'folder' || entry.type === 'note') return row(entry);
        if (entry.type === 'loading') return <li key={entry.key} role="none" className="notes-tree-status" style={style}><Loader variant="rows" label="Loading notes" /></li>;
        if (entry.type === 'empty') return <li key={entry.key} role="none" className="notes-tree-status" style={style}><p role="status">Empty</p></li>;
        if (entry.type === 'error') return <li key={entry.key} role="none" className="notes-tree-status" style={style}>
          <p role="alert">{entry.message}</p>
          <button className="notes-tree-action" type="button" onClick={() => retry(entry.directory, entry.offset)}>Retry</button>
        </li>;
        if (entry.type !== 'more') return null;
        return <li key={entry.key} role="none" className="notes-tree-status" style={style}>
          <button className="notes-tree-action" type="button" onClick={() => fetchDirectory(entry.directory, entry.offset)}>Show more</button>
        </li>;
      })}
    </ul>
    {nothing && <p className="notes-tree-empty" role="status">No notes</p>}
    {treeError && <StateMessage variant="error" className="notes-tree-error" message={treeError} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} />}
    {inventory?.truncated && <StateMessage variant="partial" message="Some folders may be missing."
      actionLabel="Retry" onAction={() => setRevision(value => value + 1)} />}
  </section>;
}

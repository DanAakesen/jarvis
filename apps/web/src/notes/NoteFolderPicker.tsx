import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { safeNoteFolder, type NoteTree } from './notes-data';

interface Folder { path: string; name: string; children: Folder[] }
const ancestors = (path: string) => path ? path.split('/').map((_, index, segments) => segments.slice(0, index + 1).join('/')) : [];

function folderTree(paths: readonly string[]): Folder[] {
  const folders = new Map<string, Folder>();
  for (const path of paths) {
    for (const parent of ancestors(path)) {
      if (!folders.has(parent)) folders.set(parent, { path: parent, name: parent.split('/').at(-1)!, children: [] });
    }
  }
  const roots: Folder[] = [];
  for (const folder of folders.values()) {
    const parent = folder.path.includes('/') ? folders.get(folder.path.slice(0, folder.path.lastIndexOf('/'))) : null;
    (parent?.children ?? roots).push(folder);
  }
  for (const children of [roots, ...[...folders.values()].map(folder => folder.children)]) {
    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  }
  return roots;
}

function FolderIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 7V5h6l2 2h10v12H3Z" /></svg>;
}

export function NoteFolderPicker({ value, onChange, loadFolders, disabled = false }: {
  value: string;
  onChange: (path: string) => void;
  loadFolders: (signal: AbortSignal) => Promise<NoteTree>;
  disabled?: boolean;
}) {
  const id = useId();
  const [inventory, setInventory] = useState<NoteTree | null>(null);
  const [newFolders, setNewFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [show, setShow] = useState(() => !(window.matchMedia?.('(max-width: 700px), (max-height: 500px) and (pointer: coarse)').matches ?? false));
  const [expanded, setExpanded] = useState(() => new Set(ancestors(value)));
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const restoreAddFocus = useRef(false);
  const tree = useMemo(() => folderTree([...(inventory?.directories ?? []), ...newFolders, value]), [inventory, newFolders, value]);
  const candidate = adding === null ? '' : `${adding ? `${adding}/` : ''}${name.trim().normalize('NFC')}`;
  const validName = !!name.trim() && !name.includes('/') && safeNoteFolder(candidate);
  const duplicate = [...(inventory?.directories ?? []), ...newFolders].some(path => ancestors(path).includes(candidate));

  useEffect(() => {
    const controller = new AbortController();
    void loadFolders(controller.signal).then(next => {
      if (!controller.signal.aborted) { setInventory(next); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'The vault folders could not be loaded. Try again.');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [loadFolders, reload]);
  useEffect(() => {
    if (adding !== null) {
      folderInput.current?.focus();
      folderInput.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    }
    else if (restoreAddFocus.current) { restoreAddFocus.current = false; addButton.current?.focus(); }
  }, [adding]);

  const select = (path: string) => {
    setExpanded(current => new Set([...current, ...ancestors(path)]));
    onChange(path);
  };
  const cancelFolder = () => { restoreAddFocus.current = true; setAdding(null); setName(''); };
  const addFolder = () => {
    if (!validName || duplicate || disabled) return;
    setNewFolders(current => [...current, candidate]);
    select(candidate);
    cancelFolder();
  };
  const newFolderButton = (path: string) => <button className="notes-folder-add" type="button" disabled={disabled}
    aria-label={`New folder in ${path || 'Vault root'}`} title={`New folder in ${path || 'Vault root'}`}
    onClick={event => {
      addButton.current = event.currentTarget;
      if (adding === path) { folderInput.current?.focus(); return; }
      setExpanded(current => new Set([...current, ...ancestors(path)]));
      setAdding(path); setName('');
    }}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  </button>;
  const folderNameErrorId = `${id}-folder-name-error`;
  const folderDuplicateErrorId = `${id}-folder-name-duplicate`;
  const folderEntry = (path: string) => adding === path && <div className="notes-folder-entry">
    <label className="visually-hidden" htmlFor={`${id}-folder-name`}>New folder in {path || 'Vault root'}</label>
    <div className="notes-folder-input-row">
      <input ref={folderInput} id={`${id}-folder-name`} className="form-control" value={name} maxLength={170} disabled={disabled}
        placeholder="Folder name" aria-invalid={!!name && (!validName || duplicate)}
        aria-describedby={[
          name && !validName ? folderNameErrorId : null,
          duplicate ? folderDuplicateErrorId : null,
        ].filter(Boolean).join(' ') || undefined}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); addFolder(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelFolder(); }
        }} />
      <button className="notes-folder-confirm" type="button" aria-label="Add folder" title="Add folder"
        disabled={disabled || !validName || duplicate} onClick={addFolder}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 12 4 4 10-10" /></svg>
      </button>
      <button className="notes-folder-cancel" type="button" aria-label="Cancel new folder" title="Cancel new folder" disabled={disabled} onClick={cancelFolder}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    {name && !validName && <p className="field-error" id={folderNameErrorId} role="alert">Use a short folder name without slashes, a leading dot or URL characters.</p>}
    {duplicate && <p className="field-error" id={folderDuplicateErrorId} role="alert">This folder already exists. Select it in the tree.</p>}
  </div>;
  const rows = (nodes: Folder[]) => <ul>{nodes.map(folder => <li key={folder.path}>
    <div className="notes-folder-row">
      {folder.children.length || adding === folder.path ? <button className="notes-folder-expand" type="button" disabled={disabled}
        aria-label={`${expanded.has(folder.path) ? 'Collapse' : 'Expand'} ${folder.path}`} aria-expanded={expanded.has(folder.path)}
        aria-controls={`${id}-${encodeURIComponent(folder.path)}`} onClick={event => {
          if (expanded.has(folder.path) && adding !== null && ancestors(adding).includes(folder.path)) {
            addButton.current = event.currentTarget;
            cancelFolder();
          }
          setExpanded(current => {
            const next = new Set(current);
            if (next.has(folder.path)) next.delete(folder.path); else next.add(folder.path);
            return next;
          });
        }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={expanded.has(folder.path) ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} /></svg>
      </button> : <span className="notes-folder-spacer" />}
      <button className="notes-folder-select" type="button" disabled={disabled} aria-pressed={value === folder.path}
        aria-label={`Save in ${folder.path}`} title={folder.path} onClick={() => select(folder.path)}>
        <FolderIcon /><span>{folder.name}</span>
        {newFolders.includes(folder.path) && <small>New</small>}
        {value === folder.path && <svg className="notes-folder-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 12 4 4 10-10" /></svg>}
      </button>
      {newFolderButton(folder.path)}
    </div>
    {(folder.children.length > 0 || adding === folder.path) && <div className="notes-folder-children"
      id={`${id}-${encodeURIComponent(folder.path)}`} hidden={!expanded.has(folder.path)}>
      {folderEntry(folder.path)}{rows(folder.children)}
    </div>}
  </li>)}</ul>;

  return <section className="notes-location" aria-label="Note location">
    <button className="notes-location-toggle" type="button" aria-expanded={show} aria-controls={`${id}-folders`}
      aria-label={`Choose note location: ${value || 'Vault root'}`} title={`Save in ${value || 'Vault root'}`}
      disabled={disabled} onClick={() => setShow(current => !current)}>
      <FolderIcon /><span>Save in {value || 'Vault root'}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={show ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
    </button>
    <div id={`${id}-folders`} hidden={!show}>
      <nav className="notes-folder-tree" aria-label="Save location">
        <div className="notes-folder-row">
          <button className="notes-folder-select notes-folder-root" type="button" disabled={disabled} aria-pressed={value === ''}
            onClick={() => select('')}><FolderIcon /><span>Vault root</span></button>
          {newFolderButton('')}
        </div>
        {folderEntry('')}
        {rows(tree)}
      </nav>
      {loading && <p role="status">Loading folders…</p>}
      {inventory?.truncated && <p role="status">The vault tree is incomplete. Some folders may be missing; your draft is kept.</p>}
      {error && <div className="notes-folder-error" role="alert"><p>{error}</p>
        <button className="secondary-button" type="button" disabled={loading || disabled} onClick={() => {
          setLoading(true); setError(''); setReload(current => current + 1);
        }}>Retry folders</button>
      </div>}
      {newFolders.length > 0 && <p className="notes-folder-hint">New folders are added to Obsidian when you save a note inside them.</p>}
    </div>
  </section>;
}

import { useState, type FormEvent } from 'react';
import {
  NoteConflictError, createNote, maxTitleLength, noteFolders, notePathFor, type NoteFolder,
} from './notes-data';

type Auth = { backendUrl: string; getAccessToken: () => Promise<string> };

/** Folder and title become a safe `Folder/slug.md` path; the note starts with its title as a heading. */
export function NewNote({ auth, defaultFolder, onCreated, onCancel }: {
  auth: Auth;
  defaultFolder?: NoteFolder | undefined;
  onCreated: (path: string) => void;
  onCancel: () => void;
}) {
  const [folder, setFolder] = useState<NoteFolder>(defaultFolder ?? 'General');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState<string | null>(null);
  const path = notePathFor(folder, title);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!path || busy) return;
    setBusy(true);
    setError('');
    setExisting(null);
    try {
      await createNote(auth, path, `# ${title.trim()}\n\n`);
      onCreated(path);
    } catch (failure) {
      if (failure instanceof NoteConflictError) setExisting(path);
      setError(failure instanceof Error ? failure.message : 'Jarvis could not create this note.');
      setBusy(false);
    }
  };

  return (
    <form className="notes-editor notes-new" onSubmit={(event) => void submit(event)} aria-label="New note">
      <h2 className="notes-editor-title">New note</h2>
      <label className="notes-field">Folder
        <select value={folder} onChange={(event) => setFolder(event.target.value as NoteFolder)}>
          {noteFolders.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="notes-field">Title
        <input type="text" value={title} maxLength={maxTitleLength} autoFocus autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
      </label>
      <p className="notes-path">{path ? <>Path: <code>{path}</code></> : 'Enter a title using letters or numbers.'}</p>
      {error && <p className="notes-error" role="alert">{error}</p>}
      <div className="notes-conflict-actions">
        <button className="primary-button notes-save" type="submit" disabled={!path || busy}>{busy ? 'Creating…' : 'Create note'}</button>
        {existing && <button className="secondary-button" type="button" onClick={() => onCreated(existing)}>Open existing note</button>}
        <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

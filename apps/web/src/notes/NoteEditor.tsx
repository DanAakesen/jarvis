import { useCallback, useEffect, useState } from 'react';
import { MarkdownContent } from '../MarkdownContent';
import { Loader } from '../Loader';
import { NoteConflictError, readNote, saveNote, type Note, type NoteConflict } from './notes-data';

type Auth = { backendUrl: string; getAccessToken: () => Promise<string> };
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; note: Note };
type Save = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string; reload?: boolean };

/** Plain Markdown source with a preview toggle. Remount (key by path) to open another note. */
export function NoteEditor({ auth, path, onDirtyChange, onSaved, onBack }: {
  auth: Auth;
  path: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [save, setSave] = useState<Save>({ status: 'idle' });
  const [conflict, setConflict] = useState<NoteConflict | null>(null);
  const [comparing, setComparing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    readNote(auth, path, controller.signal).then((note) => {
      setDraft(note.content);
      setLoad({ status: 'ready', note });
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Jarvis could not open this note.' });
    });
    return () => controller.abort();
    // The auth object is rebuilt by the parent only when the backend changes.
  }, [auth, path, attempt]);

  const note = load.status === 'ready' ? load.note : null;
  const dirty = note !== null && draft !== note.content;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const saving = save.status === 'saving';
  const canSave = dirty && !saving && !conflict && draft.length > 0;
  const submit = useCallback(async () => {
    if (!note || !canSave) return;
    setSave({ status: 'saving' });
    try {
      await saveNote(auth, note.path, draft, note.sha);
    } catch (error) {
      if (error instanceof NoteConflictError) {
        setConflict(error.conflict);
        setSave({ status: 'idle' });
      } else {
        setSave({ status: 'error', message: error instanceof Error ? error.message : 'Jarvis could not save this note.' });
      }
      return;
    }
    onSaved();
    try {
      setLoad({ status: 'ready', note: await readNote(auth, note.path) });
      setSave({ status: 'saved' });
    } catch {
      setSave({ status: 'error', message: 'Saved, but the new version could not be loaded.', reload: true });
    }
  }, [auth, canSave, draft, note, onSaved]);

  const reloadLatest = () => {
    if (!conflict || conflict.content === null || conflict.currentSha === null || !note) return;
    setLoad({ status: 'ready', note: { ...note, content: conflict.content, sha: conflict.currentSha } });
    setDraft(conflict.content);
    setConflict(null);
    setComparing(false);
    setSave({ status: 'idle' });
  };
  const keepMine = () => {
    if (!conflict || conflict.currentSha === null || conflict.content === null || !note) return;
    // Rebase onto the latest version: the next save replaces it with this draft, which Dan has now seen compared.
    setLoad({ status: 'ready', note: { ...note, content: conflict.content, sha: conflict.currentSha } });
    setConflict(null);
    setComparing(false);
  };

  if (load.status === 'loading') return <div className="notes-editor"><Loader label="Opening note" variant="lines" /></div>;
  if (load.status === 'error') {
    return (
      <div className="notes-editor notes-editor-empty">
        <button className="secondary-button notes-back" type="button" onClick={onBack}>Back to notes</button>
        <p role="alert">{load.message}</p>
        <button className="secondary-button" type="button" onClick={() => { setLoad({ status: 'loading' }); setAttempt((value) => value + 1); }}>Try again</button>
      </div>
    );
  }
  const removed = conflict !== null && (conflict.currentSha === null || conflict.content === null);

  return (
    <div className="notes-editor" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void submit();
      }
    }}>
      <div className="notes-editor-head">
        <button className="secondary-button notes-back" type="button" onClick={onBack}>Back to notes</button>
        <h2 className="notes-editor-title" title={path}>{path}</h2>
        <div className="notes-mode" role="group" aria-label="Editor view">
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</button>
        </div>
        <button className="primary-button notes-save" type="button" disabled={!canSave} onClick={() => void submit()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="notes-status" role="status">
        {saving ? 'Saving…' : save.status === 'saved' && !dirty ? 'Saved.' : dirty ? 'Unsaved changes.' : ''}
      </p>
      {save.status === 'error' && (
        <p className="notes-error" role="alert">
          {save.message}{' '}
          {save.reload && <button className="secondary-button" type="button" onClick={() => { setLoad({ status: 'loading' }); setAttempt((value) => value + 1); }}>Reload note</button>}
        </p>
      )}
      {draft.length === 0 && dirty && <p className="notes-error">A note cannot be empty.</p>}
      {conflict && (
        <div className="notes-conflict" role="alert">
          <p>{removed ? 'This note was removed elsewhere, so it cannot be saved over.' : 'This note changed elsewhere since you opened it.'}</p>
          <div className="notes-conflict-actions">
            {!removed && <button className="secondary-button" type="button" onClick={reloadLatest}>Reload latest (discard my edits)</button>}
            {!removed && <button className="secondary-button" type="button" aria-pressed={comparing} onClick={() => setComparing((value) => !value)}>
              {comparing ? 'Hide comparison' : 'Compare'}
            </button>}
            {!removed && comparing && <button className="secondary-button" type="button" onClick={keepMine}>Keep my version</button>}
            {removed && <button className="secondary-button" type="button" onClick={() => setConflict(null)}>Dismiss</button>}
          </div>
          {comparing && conflict.content !== null && (
            <div className="notes-compare">
              <section aria-label="Your version"><h3>Your version</h3><pre>{draft}</pre></section>
              <section aria-label="Latest version"><h3>Latest version</h3><pre>{conflict.content}</pre></section>
            </div>
          )}
        </div>
      )}
      {mode === 'edit'
        ? <textarea className="notes-source" aria-label="Markdown source" spellCheck value={draft} readOnly={saving}
            onChange={(event) => { setDraft(event.target.value); if (save.status !== 'idle') setSave({ status: 'idle' }); }} />
        : <div className="notes-preview" role="region" aria-label="Preview" tabIndex={0}>
            {draft.trim() ? <MarkdownContent source={draft} /> : <p className="hint">Nothing to preview yet.</p>}
          </div>}
    </div>
  );
}

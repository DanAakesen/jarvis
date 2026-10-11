import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBlocker } from 'react-router-dom';
import type { AreaProps } from '../areas';
import { KnowledgeGraphView, KnowledgeNoteReader } from '../knowledge/KnowledgeGraphView';
import { connectedNotes, knowledgeFolders, withoutFrontMatter, type KnowledgeFolder, type KnowledgeGraph, type KnowledgeNode } from '../knowledge/knowledge-data';
import { Loader } from '../Loader';
import { MarkdownContent } from '../MarkdownContent';
import { Modal } from '../Modal';
import { NavigationGuardContext } from '../page-navigation';
import { createNotesClient, maxNoteBytes, newNotePath, NoteConflict, NoteSaveUnverified, safeNotePath, validNoteText } from './notes-data';
import './NotesArea.css';

interface Editor {
  path: string;
  title: string;
  draft: string;
  original: string;
  sha: string | null;
  created: boolean;
  revisionMissing?: boolean;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Notes could not be loaded. Try again.';

export function NotesArea({ backendUrl, getAccessToken }: AreaProps) {
  const id = useId();
  const client = useMemo(() => backendUrl ? createNotesClient(backendUrl, getAccessToken) : null, [backendUrl, getAccessToken]);
  const [reload, setReload] = useState(0);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [opening, setOpening] = useState(false);
  const [openingTitle, setOpeningTitle] = useState('Note');
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const editorInput = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [commitUrl, setCommitUrl] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<NoteConflict | null>(null);
  const [compare, setCompare] = useState(false);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [newFolder, setNewFolder] = useState<KnowledgeFolder>('General');
  const [pendingChange, setPendingChange] = useState<(() => void) | null>(null);
  const dirty = !!editor && (editor.created || editor.draft !== editor.original);
  const guardRef = useContext(NavigationGuardContext);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (dirty || saving) && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const path = newNotePath(newFolder, title);
  const bytes = editor ? new TextEncoder().encode(editor.draft).length : 0;
  const invalidContent = !!editor && !validNoteText(editor.draft);
  const editorPath = editor?.path;
  const selectedNode = graph?.nodes.find(node => node.path === editorPath);
  const neighbours = useMemo(() => connectedNotes(graph, selectedNode?.id ?? null), [graph, selectedNode?.id]);

  useLayoutEffect(() => {
    if (!guardRef) return;
    guardRef.current = dirty || saving;
    return () => { guardRef.current = false; };
  }, [guardRef, dirty, saving]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; readController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);
  useEffect(() => {
    if (editorPath && !opening) {
      if (preview) popup.current?.querySelector<HTMLElement>('.notes-preview')?.focus();
      else editorInput.current?.focus();
    }
  }, [editorPath, opening, preview]);

  const change = (action: () => void) => {
    if (saving) return;
    if (dirty) setPendingChange(() => action);
    else action();
  };
  const openNote = async (notePath: string, noteTitle: string, showPreview = true) => {
    if (!client) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setOpening(true); setOpeningTitle(noteTitle); setError(''); setFeedback(''); setCommitUrl(''); setConflict(null); setCompare(false);
    try {
      const note = await client.read(notePath, controller.signal);
      if (controller.signal.aborted) return;
      setEditor({ path: note.path, title: noteTitle, draft: note.content, original: note.content, sha: note.sha, created: false });
      setPreview(showPreview);
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause));
    } finally {
      if (!controller.signal.aborted) setOpening(false);
    }
  };
  const save = async () => {
    if (!client || !editor || savePending.current || !dirty || editor.revisionMissing || conflict) return;
    savePending.current = true; setSaving(true); setError(''); setFeedback('');
    const current = editor;
    try {
      const written = await client.save(current.path, current.draft, current.sha);
      if (!alive.current) return;
      setCommitUrl(written.url);
      // A write returns the commit SHA, not the Contents SHA needed for the next edit.
      setEditor({ ...current, original: current.draft, created: false, revisionMissing: true });
      setFeedback('Saved. Refreshing the note revision…');
      try {
        const controller = new AbortController();
        readController.current = controller;
        const latest = await client.read(current.path, controller.signal);
        if (!alive.current) return;
        if (latest.content !== current.draft) {
          setEditor({ ...current, original: current.draft, created: false, revisionMissing: true });
          setConflict(new NoteConflict(latest.sha, latest.content));
          setFeedback('');
        } else {
          setEditor({ ...current, original: current.draft, sha: latest.sha, created: false });
          setFeedback('Saved to your vault.');
        }
      } catch (cause) {
        if (alive.current) { setFeedback('Saved to your vault.'); setError(`The latest revision could not be loaded. Reload before editing again. ${message(cause)}`); }
      }
      setReload(value => value + 1);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof NoteConflict) { setConflict(cause); setCompare(false); }
      else {
        if (cause instanceof NoteSaveUnverified) setEditor({ ...current, revisionMissing: true });
        setError(message(cause));
      }
    } finally {
      savePending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const clearEditor = () => {
    readController.current?.abort(); setOpening(false);
    setEditor(null); setConflict(null); setCompare(false); setError(''); setFeedback(''); setCommitUrl('');
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
  };
  const openGraphNote = (node: KnowledgeNode, currentGraph: KnowledgeGraph) => {
    if (node.path === editor?.path && !opening) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    change(() => {
      if (!editor) returnFocus.current = origin;
      setGraph(currentGraph);
      void openNote(node.path, node.title);
    });
  };
  const discard = () => {
    const action = pendingChange;
    setPendingChange(null);
    if (blocker.state === 'blocked') blocker.proceed();
    else action?.();
  };

  return (
    <div className="area knowledge-page notes-page">
      <h1 className="visually-hidden">Notes</h1>
      <KnowledgeGraphView backendUrl={backendUrl} getAccessToken={getAccessToken}
        onOpenNote={openGraphNote} {...(editorPath ? { selectedPath: editorPath } : {})} refreshKey={reload}>
        <button className="primary-button notes-create-button" type="button" disabled={!client || saving}
          onClick={() => {
            const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            change(() => { if (!editor) returnFocus.current = origin; setTitle(''); setCreate(true); });
          }}>Create new</button>
        {(editor || opening || error) && createPortal(<aside ref={popup} className="knowledge-note luminous-glass notes-popup" role="dialog"
          aria-labelledby={`${id}-note`} aria-busy={saving || opening} onKeyDown={event => {
            if (event.key === 'Escape' && !pendingChange && blocker.state !== 'blocked') { event.preventDefault(); change(clearEditor); }
          }}>
          <header className="knowledge-note-heading">
            <h3 id={`${id}-note`}><span className="knowledge-dot" data-folder={editor?.path.split('/')[0]} aria-hidden="true" />{editor?.title ?? openingTitle}</h3>
            <button className="modal-close" type="button" disabled={saving} aria-label={`Close ${editor?.title ?? openingTitle}`}
              onClick={() => change(clearEditor)}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <KnowledgeNoteReader>
            <div className="notes-editor">
              {opening ? <Loader variant="inline" label="Opening note…" /> : editor ? (
                <>
                  <p className="knowledge-note-meta">{editor.path.split('/')[0]} · {editor.path}</p>
                  <div className="notes-editor-actions">
                    <button className="secondary-button" type="button" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Edit Markdown' : 'Preview'}</button>
                    <button className="primary-button" type="button" disabled={saving || !dirty || !editor.draft.trim() || bytes > maxNoteBytes || invalidContent || !!conflict || editor.revisionMissing}
                      onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save'}</button>
                    <span className="notes-dirty" role="status">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
                  </div>
                  {bytes > maxNoteBytes && <p role="alert">This note exceeds 256 KiB. Shorten it before saving.</p>}
                  {invalidContent && <p role="alert">Remove invalid text or null characters before saving.</p>}
                  {!editor.draft.trim() && <p>A note needs some content before it can be saved.</p>}
                  {preview ? <div className="notes-preview" role="region" aria-label="Markdown preview" tabIndex={0}><MarkdownContent source={withoutFrontMatter(editor.draft)} /></div> :
                    <label className="notes-source-label" htmlFor={`${id}-content`}>Markdown
                      <textarea ref={editorInput} id={`${id}-content`} value={editor.draft} spellCheck={false} readOnly={saving || editor.revisionMissing}
                        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }}
                        onChange={event => { setEditor({ ...editor, draft: event.target.value }); setFeedback(''); }} />
                    </label>}
                  {editor.revisionMissing && !conflict && <button type="button" className="secondary-button" disabled={saving}
                    onClick={() => change(() => { void openNote(editor.path, editor.title, preview); })}>Reload latest note</button>}
                </>
              ) : null}
              {error && <p role="alert">{error}</p>}
              {feedback && <p role="status">{feedback}</p>}
              {commitUrl && <a href={commitUrl} target="_blank" rel="noopener noreferrer">View saved commit on GitHub</a>}
              {conflict && editor && <div className="notes-conflict" role="alert">
                <p>{conflict.message}</p>
                <div className="notes-editor-actions">
                  <button className="secondary-button" type="button" onClick={() => change(() => { void openNote(editor.path, editor.title, preview); })}>Reload latest note</button>
                  <button className="secondary-button" type="button" onClick={() => setCompare(value => !value)} aria-expanded={compare}>Compare versions</button>
                </div>
                {compare && <div className="notes-comparison">
                  <section><h3>Your draft</h3><pre>{editor.draft}</pre></section>
                  <section><h3>Latest in vault</h3><pre>{conflict.content ?? 'The latest content is unavailable. Reload the note.'}</pre></section>
                  {conflict.currentSha && conflict.content !== null && <button type="button" className="secondary-button" onClick={() => {
                    const latestContent = conflict.content;
                    if (latestContent === null || !conflict.currentSha) return;
                    setEditor({ ...editor, sha: conflict.currentSha, original: latestContent, created: false, revisionMissing: false });
                    setConflict(null); setCompare(false); setFeedback('Your draft is kept. Review it and Save to update the latest revision.');
                  }}>Keep my draft on latest revision</button>}
                </div>}
              </div>}
              {neighbours.length > 0 && graph && <section>
                <h4 className="knowledge-note-subheading">Connected notes</h4>
                <ul className="knowledge-neighbours">{neighbours.map(node => <li key={node.id}>
                  <button type="button" data-folder={node.folder} disabled={saving} onClick={() => openGraphNote(node, graph)}>
                    <span className="knowledge-dot" aria-hidden="true" />{node.title}
                  </button>
                </li>)}</ul>
              </section>}
            </div>
          </KnowledgeNoteReader>
        </aside>, document.body)}
      </KnowledgeGraphView>
      {create && <Modal title="New note" titleId={`${id}-new`} onClose={() => setCreate(false)}>
        <form className="notes-create" onSubmit={event => {
          event.preventDefault();
          if (!title.trim() || !safeNotePath(path)) return;
          readController.current?.abort(); setOpening(false);
          setEditor({ path, title: title.trim(), draft: `# ${title.trim()}\n\n`, original: '', sha: null, created: true });
          setPreview(false); setError(''); setFeedback(''); setCommitUrl(''); setConflict(null); setCreate(false);
        }}>
          <div><label htmlFor={`${id}-new-folder`}>Section</label><select id={`${id}-new-folder`} value={newFolder} onChange={event => {
            const selected = knowledgeFolders.find(name => name === event.target.value);
            if (selected) setNewFolder(selected);
          }}>
            {knowledgeFolders.map(name => <option key={name}>{name}</option>)}
          </select></div>
          <div><label htmlFor={`${id}-title`}>Title</label><input id={`${id}-title`} value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></div>
          <p>{path || 'Use a title with letters or numbers for the file name.'}</p>
          {path && !safeNotePath(path) && <p role="alert">Use a shorter title for this note.</p>}
          <button className="primary-button" type="submit" disabled={!title.trim() || !safeNotePath(path)}>Start writing</button>
        </form>
      </Modal>}
      {(pendingChange || blocker.state === 'blocked') && <Modal title={saving ? 'Save in progress' : dirty ? 'Unsaved changes' : 'Continue navigation'} titleId={`${id}-guard`}
        busy={saving} onClose={() => { setPendingChange(null); if (blocker.state === 'blocked') blocker.reset(); }}>
        <p>{saving ? 'Wait for the save result before leaving this note.' : dirty ? 'Your changes have not been saved to the vault.' : 'Your note was saved. Continue to the page you selected?'}</p>
        <div className="notes-editor-actions">
          <button className="secondary-button" type="button" disabled={saving} onClick={() => { setPendingChange(null); if (blocker.state === 'blocked') blocker.reset(); }}>Keep editing</button>
          <button className="secondary-button" type="button" disabled={saving} onClick={discard}>{dirty ? 'Discard changes and continue' : 'Continue'}</button>
        </div>
      </Modal>}
    </div>
  );
}

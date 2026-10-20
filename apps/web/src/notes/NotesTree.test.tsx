import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotesTree } from './NotesTree';
import type { NotePage, NoteSummary, NoteTree } from './notes-data';

const note = (path: string, title: string): NoteSummary => {
  const slash = path.lastIndexOf('/');
  return { path, title, folder: slash < 0 ? '' : path.slice(0, slash), directory: slash < 0 ? '' : path.slice(0, slash), updatedAt: '2026-10-11T00:00:00Z' };
};
const tree = (directories: string[]): NoteTree => ({ directories, rootNoteCount: 1, truncated: false, updatedAt: '2026-10-11T17:00:00Z' });
const page = (notes: NoteSummary[], offset = 0, hasMore = false): NotePage => ({ notes, limit: 50, offset, hasMore });
const vault: Record<string, NoteSummary[]> = {
  '': [note('Readme.md', 'Readme')],
  Inbox: [note('Inbox/Idea.md', 'Idea')],
  Customers: [],
  'Customers/Novaro': [note('Customers/Novaro/Kickoff.md', 'Kickoff')],
  Work: [note('Work/Plan.md', 'Plan')],
};

function setup(overrides: Partial<Parameters<typeof NotesTree>[0]> = {}) {
  const loadTree = vi.fn(async () => tree(['.obsidian', 'Customers', 'Customers/Novaro', 'Inbox', 'Work']));
  const loadNotes = vi.fn(async (directory: string, offset: number) => page(vault[directory] ?? [], offset));
  const onOpenNote = vi.fn();
  const onClose = vi.fn();
  const view = render(<NotesTree id="tree" loadTree={loadTree} loadNotes={loadNotes} onOpenNote={onOpenNote} onClose={onClose} {...overrides} />);
  return { loadTree, loadNotes, onOpenNote, onClose, ...view };
}
const names = () => screen.queryAllByRole('treeitem').map(item => item.querySelector('.notes-tree-name')?.textContent);

describe('NotesTree', () => {
  it('lists folders and the notes at the vault root, and never the hidden folders', async () => {
    const { loadNotes } = setup();
    expect(screen.getByRole('region', { name: 'Notes tree' })).not.toBeNull();
    await screen.findByRole('treeitem', { name: /Readme/ });
    expect(names()).toEqual(['Customers', 'Inbox', 'Work', 'Readme']);
    expect(screen.getByRole('tree', { name: 'Vault notes' })).not.toBeNull();
    expect(screen.queryByText('.obsidian')).toBeNull();
    expect(loadNotes).toHaveBeenCalledTimes(1);
    expect(loadNotes).toHaveBeenCalledWith('', 0, expect.any(AbortSignal));
  });

  it('describes each item for assistive technology', async () => {
    setup({ selectedPath: 'Readme.md' });
    const folder = await screen.findByRole('treeitem', { name: /Inbox/ });
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(folder.getAttribute('aria-level')).toBe('1');
    expect(folder.getAttribute('aria-setsize')).toBe('4');
    expect(folder.getAttribute('aria-posinset')).toBe('2');
    const file = screen.getByRole('treeitem', { name: /Readme/ });
    expect(file.hasAttribute('aria-expanded')).toBe(false);
    expect(file.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('treeitem').filter(item => item.tabIndex === 0)).toHaveLength(1);
  });

  it('reads a folder only when it is opened, then lists its subfolders before its notes', async () => {
    const { loadNotes } = setup();
    fireEvent.click(await screen.findByRole('treeitem', { name: /Customers/ }));
    await screen.findByRole('treeitem', { name: /Novaro/ });
    expect(loadNotes.mock.calls.map(call => call[0])).toEqual(['', 'Customers']);
    expect(screen.getByRole('treeitem', { name: /Customers/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('treeitem', { name: /Novaro/ }).getAttribute('aria-level')).toBe('2');

    fireEvent.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await screen.findByRole('treeitem', { name: /Idea/ });
    expect(screen.getByRole('treeitem', { name: /Idea/ }).getAttribute('aria-level')).toBe('2');

    fireEvent.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    expect(screen.queryByRole('treeitem', { name: /Idea/ })).toBeNull();
    fireEvent.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await screen.findByRole('treeitem', { name: /Idea/ });
    expect(loadNotes.mock.calls.filter(call => call[0] === 'Inbox')).toHaveLength(1);
  });

  it('opens a note on click and on Enter', async () => {
    const { onOpenNote } = setup();
    fireEvent.click(await screen.findByRole('treeitem', { name: /Readme/ }));
    expect(onOpenNote).toHaveBeenCalledWith('Readme.md', 'Readme');
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /Readme/ }), { key: 'Enter' });
    expect(onOpenNote).toHaveBeenCalledTimes(2);
  });

  it('moves with the arrow, Home and End keys and opens or closes folders', async () => {
    setup();
    await screen.findByRole('treeitem', { name: /Readme/ });
    const first = screen.getByRole('treeitem', { name: /Customers/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /Inbox/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /Readme/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /Customers/ }));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    const novaro = await screen.findByRole('treeitem', { name: /Novaro/ });
    expect(screen.getByRole('treeitem', { name: /Customers/ }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(novaro);
    fireEvent.keyDown(novaro, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /Customers/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.queryByRole('treeitem', { name: /Novaro/ })).toBeNull();
  });

  it('pages a long folder and keeps what was already shown', async () => {
    const loadNotes = vi.fn(async (directory: string, offset: number) => directory === ''
      ? page(offset === 0 ? [note('A.md', 'First')] : [note('B.md', 'Second')], offset, offset === 0)
      : page([], offset));
    setup({ loadNotes });
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByRole('treeitem', { name: /Second/ });
    expect(screen.getByRole('treeitem', { name: /First/ })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(loadNotes).toHaveBeenCalledWith('', 1, expect.any(AbortSignal));
  });

  it('shows an empty folder as empty', async () => {
    const loadNotes = vi.fn(async (_directory: string, offset: number) => page([], offset));
    setup({ loadNotes, loadTree: async () => tree(['Inbox']) });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Inbox/ }));
    expect(await screen.findByText('Empty')).not.toBeNull();
  });

  it('says so when the vault has no notes', async () => {
    setup({ loadTree: async () => tree([]), loadNotes: async (_directory, offset) => page([], offset) });
    expect(await screen.findByText('No notes')).not.toBeNull();
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('shows a loading state until the vault has answered', async () => {
    let release: (value: NoteTree) => void = () => undefined;
    setup({ loadTree: () => new Promise<NoteTree>(resolve => { release = resolve; }) });
    expect(screen.getByRole('region', { name: 'Notes tree' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Loading notes')).not.toBeNull();
    release(tree(['Work']));
    await screen.findByRole('treeitem', { name: /Work/ });
    expect(screen.getByRole('region', { name: 'Notes tree' }).getAttribute('aria-busy')).toBe('false');
  });

  it('shows a failed tree and tries again', async () => {
    const loadTree = vi.fn<() => Promise<NoteTree>>().mockRejectedValueOnce(new Error('Vault is unreachable.')).mockResolvedValue(tree(['Work']));
    setup({ loadTree });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Vault is unreachable.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('treeitem', { name: /Work/ });
    expect(loadTree).toHaveBeenCalledTimes(2);
  });

  it('shows a failed folder in place and tries only that folder again', async () => {
    const loadNotes = vi.fn<(directory: string, offset: number) => Promise<NotePage>>()
      .mockImplementation(async (directory, offset) => page(vault[directory] ?? [], offset));
    loadNotes.mockImplementationOnce(async (_directory, offset) => page(vault[''] ?? [], offset))
      .mockRejectedValueOnce(new Error('Folder is unavailable.'));
    setup({ loadNotes });
    fireEvent.click(await screen.findByRole('treeitem', { name: /Inbox/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Folder is unavailable.');
    expect(screen.getByRole('treeitem', { name: /Readme/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('treeitem', { name: /Idea/ });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns when the folder list is incomplete', async () => {
    setup({ loadTree: async () => ({ ...tree(['Work']), truncated: true }) });
    expect(await screen.findByText('Some folders may be missing.')).not.toBeNull();
  });

  it('stops reporting busy when the root listing fails and offers Retry', async () => {
    const loadNotes = vi.fn<(directory: string, offset: number) => Promise<NotePage>>()
      .mockRejectedValueOnce(new Error('Root is unavailable.'))
      .mockImplementation(async (directory, offset) => page(vault[directory] ?? [], offset));
    setup({ loadNotes });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Root is unavailable.');
    expect(screen.getByRole('region', { name: 'Notes tree' }).getAttribute('aria-busy')).not.toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('treeitem', { name: /Readme/ });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes on Escape', async () => {
    const { onClose } = setup();
    await screen.findByRole('treeitem', { name: /Readme/ });
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /Readme/ }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reloads when the notes change underneath it', async () => {
    const { loadTree, rerender, onClose, onOpenNote, loadNotes } = setup();
    await screen.findByRole('treeitem', { name: /Readme/ });
    rerender(<NotesTree id="tree" loadTree={loadTree} loadNotes={loadNotes} refreshKey={1} onOpenNote={onOpenNote} onClose={onClose} />);
    await waitFor(() => expect(loadTree).toHaveBeenCalledTimes(2));
    await screen.findByRole('treeitem', { name: /Readme/ });
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NoteFolderPicker } from './NoteFolderPicker';
import type { NoteTree } from './notes-data';

const directories = ['Customers', 'Customers/Novaro', 'Customers/Novaro/Meetings', 'General', '_agent-log'];
const inventory: NoteTree = { directories, rootNoteCount: 2, truncated: false, updatedAt: '2026-10-11T17:00:00Z' };
function mount(loadFolders = vi.fn<(signal: AbortSignal) => Promise<NoteTree>>(async () => inventory)) {
  function Picker() {
    const [value, setValue] = useState('');
    return <NoteFolderPicker value={value} onChange={setValue} loadFolders={loadFolders} />;
  }
  render(<Picker />);
  return loadFolders;
}

describe('Note destination tree', () => {
  it('expands real nested folders and selects a destination or vault root with native keyboard controls', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Customers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Customers/Novaro' }));
    const meeting = screen.getByRole('button', { name: 'Save in Customers/Novaro/Meetings' });
    fireEvent.click(meeting);
    expect(meeting.getAttribute('aria-pressed')).toBe('true');
    const location = screen.getByRole('button', { name: 'Choose note location: Customers/Novaro/Meetings' });
    expect(location.textContent).toBe('Save in Customers/Novaro/Meetings');
    expect(location.querySelectorAll('span')).toHaveLength(1);
    expect(location.title).toBe('Save in Customers/Novaro/Meetings');
    expect(screen.getByRole('button', { name: 'Collapse Customers' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Vault root' }));
    expect(screen.getByRole('button', { name: 'Vault root' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Save in Work' })).toBeNull();
  });
  it('adds and selects nested draft folders without an API write or reload', async () => {
    const load = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Save in Customers' }));
    fireEvent.click(screen.getByRole('button', { name: 'New folder in Customers' }));
    const input = screen.getByRole('textbox', { name: 'New folder in Customers' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Projects' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Save in Customers/Projects' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/when you save a note inside them/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New folder in Customers/Projects' }));
    const nested = screen.getByRole('textbox', { name: 'New folder in Customers/Projects' });
    fireEvent.change(nested, { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(screen.getByRole('button', { name: 'Save in Customers/Projects/Research' }).getAttribute('aria-pressed')).toBe('true');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('rejects unsafe and duplicate folder names and cancels only the inline field with Escape', async () => {
    mount();
    await screen.findByRole('button', { name: 'Save in Customers' });
    fireEvent.click(screen.getByRole('button', { name: 'New folder in Vault root' }));
    const input = screen.getByRole('textbox', { name: 'New folder in Vault root' });
    for (const value of ['..', '../Work', '.obsidian', 'a/b', 'a\\b', 'a?b', 'a%b']) {
      fireEvent.change(input, { target: { value } });
      expect((screen.getByRole('button', { name: 'Add folder' }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(input, { target: { value: 'Customers' } });
    expect(screen.getByText(/already exists/)).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New folder in Vault root' }));
  });
  it('opens a focused child row inside the clicked folder even when another destination is selected', async () => {
    const load = mount();
    const add = await screen.findByRole('button', { name: 'New folder in Customers' });
    expect(add.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    fireEvent.click(add);
    const input = screen.getByRole('textbox', { name: 'New folder in Customers' });
    expect(document.activeElement).toBe(input);
    const children = input.closest('.notes-folder-children');
    expect(children?.id).toBe(screen.getByRole('button', { name: 'Collapse Customers' }).getAttribute('aria-controls'));
    expect(children?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByRole('button', { name: 'Vault root' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(input, { target: { value: 'Projects' } });
    fireEvent.click(add);
    expect((input as HTMLInputElement).value).toBe('Projects');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Save in Customers/Projects' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(add);
    expect(load).toHaveBeenCalledOnce();
  });
  it('creates a focused child row in a leaf and cancels it without changing the destination', async () => {
    mount();
    const add = await screen.findByRole('button', { name: 'New folder in General' });
    fireEvent.click(add);
    expect(screen.getByRole('button', { name: 'Collapse General' }).getAttribute('aria-expanded')).toBe('true');
    const input = screen.getByRole('textbox', { name: 'New folder in General' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'Temporary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel new folder' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save in General/Temporary' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Vault root' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(add);
  });
  it('keeps new folder actions disabled during a save', async () => {
    render(<NoteFolderPicker value="" onChange={vi.fn()} loadFolders={async () => inventory} disabled />);
    await screen.findByRole('button', { name: 'New folder in General' });
    for (const button of screen.getAllByRole('button', { name: /^New folder in/ })) {
      expect(button.hasAttribute('disabled')).toBe(true);
    }
  });
  it('cancels a nested naming row when its ancestor is collapsed and restores visible focus', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Customers' }));
    fireEvent.click(screen.getByRole('button', { name: 'New folder in Customers/Novaro' }));
    expect(screen.getByRole('textbox', { name: 'New folder in Customers/Novaro' })).not.toBeNull();
    const collapse = screen.getByRole('button', { name: 'Collapse Customers' });
    fireEvent.click(collapse);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(collapse);
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
  });
  it('shows failed loading and retries rather than fabricating a folder tree', async () => {
    const load = vi.fn<(signal: AbortSignal) => Promise<NoteTree>>(async () => inventory).mockRejectedValueOnce(new Error('Vault unavailable.'));
    mount(load);
    await screen.findByText('Vault unavailable.');
    expect(screen.queryByRole('button', { name: 'Save in Customers' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry folders' }));
    await screen.findByRole('button', { name: 'Save in Customers' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Vault unavailable.')).toBeNull();
  });
  it('ignores obsolete folder responses after unmount', async () => {
    let finish!: (paths: NoteTree) => void;
    const load = vi.fn<(signal: AbortSignal) => Promise<NoteTree>>(() => new Promise<NoteTree>(resolve => { finish = resolve; }));
    const { unmount } = render(<NoteFolderPicker value="" onChange={vi.fn()} loadFolders={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    unmount();
    expect(load.mock.calls[0]![0].aborted).toBe(true);
    await act(async () => finish(inventory));
  });
  it('makes a truncated tree explicit without duplicate freshness copy or invented folders', async () => {
    mount(vi.fn(async () => ({ ...inventory, truncated: true })));
    await screen.findByText(/vault tree is incomplete/);
    expect(document.querySelector('time')).toBeNull();
    expect(screen.queryByText('Hidden dot-folders are excluded.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save in Work' })).toBeNull();
  });
  it('includes returned folders without requiring an indexed Markdown note', async () => {
    mount(vi.fn(async () => ({ ...inventory, directories: ['Assets', 'Assets/Images'] })));
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Assets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save in Assets/Images' }));
    expect(screen.getByRole('button', { name: 'Save in Assets/Images' }).getAttribute('aria-pressed')).toBe('true');
  });
  it.each([0, 3])('adds a selectable implicit root when the tree has no directories and %s root notes', async rootNoteCount => {
    mount(vi.fn(async () => ({ ...inventory, directories: [], rootNoteCount })));
    await waitFor(() => expect(screen.queryByText('Loading folders…')).toBeNull());
    const root = screen.getByRole('button', { name: 'Vault root' });
    fireEvent.click(root);
    expect(root.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.notes-folder-root')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Save in Customers' })).toBeNull();
  });
});

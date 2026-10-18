import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { useModalLifecycle } from './useModalLifecycle';
import { ConversationMoreMenu } from './ConversationMoreMenu';

afterEach(() => { vi.restoreAllMocks(); });

function FormDialog({ busy = false, dirty = false }: { busy?: boolean; dirty?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open form</button>
    {open && <Modal title="Edit" titleId="edit-heading" busy={busy} dirty={dirty} onClose={() => setOpen(false)}
      footer={<div className="button-group task-dialog-actions">
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" form="edit-form">Save</button>
      </div>}>
      <form id="edit-form" onSubmit={(event) => { event.preventDefault(); setOpen(false); }}>
        <label>Name<input autoFocus name="name" /></label>
      </form>
    </Modal>}
  </>;
}

function EmptyDialog() {
  const dialog = useRef<HTMLDivElement>(null);
  useModalLifecycle({ dialog, onDismiss: () => {} });
  return <div role="dialog" ref={dialog} tabIndex={-1}>
    <button hidden>Hidden</button>
    <button style={{ display: 'none' }}>Not displayed</button>
    <fieldset disabled><button>Disabled by fieldset</button></fieldset>
    <input type="hidden" />
  </div>;
}

describe('modal lifecycle', () => {
  it('enters, traps from the root, skips hidden/disabled controls, and restores the original trigger', async () => {
    const user = userEvent.setup();
    render(<FormDialog />);
    const trigger = screen.getByRole('button', { name: 'Open form' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    dialog.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Edit' }));
    trigger.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.closest('[inert]')).toBeNull();
  });

  it('keeps Tab and Shift+Tab inside a dialog with zero available controls', async () => {
    const user = userEvent.setup();
    render(<EmptyDialog />);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    await user.tab();
    expect(document.activeElement).toBe(dialog);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(dialog);
  });

  it('protects changed forms from Escape/backdrop while explicit Cancel still works', async () => {
    const user = userEvent.setup();
    render(<FormDialog />);
    await user.click(screen.getByRole('button', { name: 'Open form' }));
    await user.type(screen.getByRole('textbox'), 'Unsaved draft');
    await user.keyboard('{Escape}');
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Unsaved draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps external form submit associated after moving actions to the footer', async () => {
    const user = userEvent.setup();
    render(<FormDialog />);
    await user.click(screen.getByRole('button', { name: 'Open form' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.form).toBe(document.getElementById('edit-form'));
    expect(save.closest('.modal-body')).toBeNull();
    await user.type(screen.getByRole('textbox'), 'Draft');
    await user.click(save);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks passive dismissal for an already-dirty draft and blocks all shared close paths while busy', () => {
    const close = vi.fn();
    const page = render(<Modal title="Busy" titleId="busy-heading" onClose={close} busy><input /></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    fireEvent.click(screen.getByRole('button', { name: 'Close Busy' }));
    expect(close).not.toHaveBeenCalled();
    page.rerender(<Modal title="Busy" titleId="busy-heading" onClose={close} dirty><input /></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close Busy' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('dismisses only the top nested dialog and keeps scroll locked until the last closes', async () => {
    const user = userEvent.setup();
    function Nested() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return <>
        <button onClick={() => setOuter(true)}>Outer trigger</button>
        {outer && <Modal title="Outer" titleId="outer-heading" onClose={() => setOuter(false)}>
          <button onClick={() => setInner(true)}>Inner trigger</button>
          {inner && <Modal title="Inner" titleId="inner-heading" onClose={() => setInner(false)}><button>Inner action</button></Modal>}
        </Modal>}
      </>;
    }
    document.body.style.overflow = 'auto';
    document.body.style.paddingRight = '7px';
    const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(window.innerWidth - 15);
    const page = render(<Nested />);
    await user.click(screen.getByRole('button', { name: 'Outer trigger' }));
    const innerTrigger = screen.getByRole('button', { name: 'Inner trigger' });
    await user.click(innerTrigger);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.paddingRight).toBe('22px');
    expect(innerTrigger.closest('[inert]')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Outer' })).not.toBeNull();
    expect(document.activeElement).toBe(innerTrigger);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.paddingRight).toBe('22px');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.paddingRight).toBe('7px');
    page.unmount();
    width.mockRestore();
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  });

  it('tracks the visible keyboard viewport and cleans up its listeners', () => {
    const viewport = new EventTarget() as VisualViewport;
    Object.assign(viewport, { height: 420, offsetTop: 12 });
    vi.stubGlobal('visualViewport', viewport);
    const page = render(<EmptyDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.getPropertyValue('--overlay-viewport-height')).toBe('420px');
    Object.assign(viewport, { height: 300 });
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(dialog.style.getPropertyValue('--overlay-viewport-height')).toBe('300px');
    page.unmount();
    expect(dialog.style.getPropertyValue('--overlay-viewport-height')).toBe('');
    vi.unstubAllGlobals();
  });

  it('places viewport sizing on the backdrop boundary so both backdrop and dialog inherit it', () => {
    const viewport = new EventTarget() as VisualViewport;
    Object.assign(viewport, { height: 380, offsetTop: 24 });
    vi.stubGlobal('visualViewport', viewport);
    const page = render(<Modal title="Keyboard" titleId="keyboard" onClose={() => {}}>Content</Modal>);
    const backdrop = screen.getByRole('dialog').parentElement!;
    expect(backdrop.style.getPropertyValue('--overlay-viewport-height')).toBe('380px');
    expect(backdrop.style.getPropertyValue('--overlay-viewport-top')).toBe('24px');
    page.unmount();
    expect(backdrop.style.getPropertyValue('--overlay-viewport-height')).toBe('');
    expect(backdrop.style.getPropertyValue('--overlay-viewport-top')).toBe('');
    vi.unstubAllGlobals();
  });

  it('retains a nested lock when a lower dialog unmounts first and restores existing inert state', async () => {
    const user = userEvent.setup();
    const page = render(<>
      <div inert data-testid="previously-inert">Unavailable background</div>
      <Modal title="Lower" titleId="lower" onClose={() => {}}>Lower body</Modal>
    </>);
    const prior = screen.getByTestId('previously-inert');
    page.rerender(<>
      <div inert data-testid="previously-inert">Unavailable background</div>
      <Modal title="Lower" titleId="lower" onClose={() => {}}>Lower body</Modal>
      <Modal title="Upper" titleId="upper" onClose={() => {}}><button>Upper control</button></Modal>
    </>);
    page.rerender(<>
      <div inert data-testid="previously-inert">Unavailable background</div>
      {null}
      <Modal title="Upper" titleId="upper" onClose={() => {}}><button>Upper control</button></Modal>
    </>);
    expect(document.body.style.overflow).toBe('hidden');
    await user.tab({ shift: true });
    expect(screen.getByRole('dialog', { name: 'Upper' }).contains(document.activeElement)).toBe(true);
    page.unmount();
    expect(prior.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('lets a descendant menu consume Escape before dismissing the modal', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<Modal title="Options" titleId="options" onClose={close}>
      <ConversationMoreMenu actions={[{ id: 'action', label: 'Action', icon: null, onSelect: () => {} }]} />
    </Modal>);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });
});

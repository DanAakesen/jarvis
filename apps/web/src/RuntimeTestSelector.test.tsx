import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeTestSelector } from './RuntimeTestSelector';
import { ConversationMoreMenu } from './ConversationMoreMenu';

describe('RuntimeTestSelector', () => {
  it('requires an explicit available choice, creates only on Start and closes after success', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<RuntimeTestSelector availability={{ current: { available: true }, copilot: { available: true } }} onStart={onStart} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Open test conversation' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Copilot' }));
    expect(onStart).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open test conversation' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledExactlyOnceWith('copilot'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps missing and unsupported runtimes disabled with explanations', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<RuntimeTestSelector availability={{ copilot: { available: false, reason: 'The selected settings are unsupported.' } }} onStart={onStart} onClose={vi.fn()} />);
    expect(screen.getByText('Availability has not been confirmed.')).not.toBeNull();
    expect(screen.getByText('The selected settings are unsupported.')).not.toBeNull();
    for (const radio of screen.getAllByRole('radio')) { expect(radio.hasAttribute('disabled')).toBe(true); await user.click(radio); }
    expect(onStart).not.toHaveBeenCalled();
  });
  it('prevents duplicate starts and dismissal while pending, then offers explicit retry after failure', async () => {
    let reject!: () => void;
    const first = new Promise<void>((_, fail) => { reject = () => fail(new Error('private provider detail')); });
    const onStart = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RuntimeTestSelector availability={{ current: { available: true } }} onStart={onStart} onClose={onClose} />);
    await user.click(screen.getByRole('radio', { name: 'Current' }));
    await user.dblClick(screen.getByRole('button', { name: 'Open test conversation' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    reject();
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.queryByText('private provider detail')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('uses native keyboard radio selection and traps focus, and respects a caller disabled reason', async () => {
    const user = userEvent.setup();
    const view = render(<RuntimeTestSelector availability={{ current: { available: true }, copilot: { available: true } }} onStart={vi.fn()} onClose={vi.fn()} />);
    screen.getByRole('radio', { name: 'Current' }).focus();
    await user.keyboard('{ArrowRight}');
    expect((screen.getByRole('radio', { name: 'Copilot' }) as HTMLInputElement).checked).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    view.rerender(<RuntimeTestSelector availability={{ current: { available: true } }} disabledReason="Finish the current reply first." onStart={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Finish the current reply first.');
    expect(screen.getByRole('button', { name: 'Open test conversation' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('runtime menu opt-in', () => {
  it('only offers Test agent runtime with a supplied handler and closes before calling it', () => {
    const start = vi.fn();
    const view = render(<ConversationMoreMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Test agent runtime' })).toBeNull();
    view.rerender(<ConversationMoreMenu onTestRuntime={start} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Test agent runtime' }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

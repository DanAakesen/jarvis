import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationToast } from './ConversationToast';

afterEach(() => vi.useRealTimers());

describe('conversation notifications', () => {
  it('announces failures outside the conversation and lets the user dismiss them', () => {
    const dismiss = vi.fn();
    const { container } = render(<ConversationToast notification={{ id: 1, error: true, message: 'Camera access was not started.' }} onDismiss={dismiss} />);
    const alert = screen.getByRole('alert');
    expect(container.contains(alert)).toBe(false);
    expect(alert.closest('.conversation-toast')?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('expires guidance but keeps it available while the user reads or focuses it', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const { rerender } = render(<ConversationToast notification={{ id: 1, error: false, message: 'Choose Share screen in More options.' }} onDismiss={dismiss} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss notification' }));
    act(() => vi.advanceTimersByTime(20_000));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole('button', { name: 'Dismiss notification' }));
    act(() => vi.advanceTimersByTime(5_000));
    rerender(<ConversationToast notification={{ id: 2, error: false, message: 'Choose Turn on camera in More options.' }} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_000));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});

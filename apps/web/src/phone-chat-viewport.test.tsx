import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePhoneChatViewport } from './phone-chat-viewport';

function Chat({ enabled = true, autoFocus = false }: { enabled?: boolean; autoFocus?: boolean }) {
  const shell = useRef<HTMLDivElement>(null);
  usePhoneChatViewport(shell, enabled);
  return (
    <div ref={shell} data-testid="shell">
      <div className="conversation-input">
        <textarea id="message" aria-label="Message Jarvis" defaultValue="Unsent fixture draft" autoFocus={autoFocus} />
        <button type="button">Composer action</button>
      </div>
      <div className="more-menu-flyout"><button type="button">Language</button></div>
      <div data-testid="outside">Transcript</div>
      <textarea aria-label="Other editor" />
    </div>
  );
}

function viewport() {
  const value = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('visualViewport', value);
  return value;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('phone chat viewport', () => {
  it('follows keyboard resize and pan, then iOS Hide Keyboard without requiring blur or changing the draft', async () => {
    const visible = viewport();
    render(<Chat />);
    const shell = screen.getByTestId('shell');
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    input.focus();
    visible.height = 480;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('480px'));
    expect(shell.dataset.keyboardOpen).toBe('true');
    visible.offsetTop = 60;
    act(() => { visible.dispatchEvent(new Event('scroll')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-top')).toBe('60px'));
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('480px');
    visible.height = 844;
    visible.offsetTop = 0;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('844px'));
    expect(shell.dataset.keyboardOpen).toBe('false');
    expect(document.activeElement).toBe(input);
    expect(input).toHaveProperty('value', 'Unsent fixture draft');
    visible.height = 400;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('400px'));
  });

  it.each(['focus-first', 'viewport-first'] as const)('removes dock clearance when all viewport heights shrink together (%s)', async (order) => {
    const visible = viewport();
    let layoutHeight = 844;
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => layoutHeight);
    render(<Chat />);
    const shell = screen.getByTestId('shell');
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    const shrink = () => {
      layoutHeight = 480;
      vi.stubGlobal('innerHeight', 480);
      act(() => { window.dispatchEvent(new Event('resize')); });
      if (order === 'focus-first') expect(shell.dataset.keyboardOpen).toBe('true');
      visible.height = 480;
      act(() => { visible.dispatchEvent(new Event('resize')); });
    };
    if (order === 'focus-first') input.focus();
    shrink();
    if (order === 'viewport-first') input.focus();
    expect(shell.dataset.keyboardOpen).toBe('true');
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('480px');
    expect(input).toHaveProperty('value', 'Unsent fixture draft');
    input.blur();
    await waitFor(() => expect(shell.dataset.keyboardOpen).toBe('false'));
  });

  it('starts in typing mode when mounted after all viewports have already shrunk', () => {
    const visible = viewport();
    visible.height = 480;
    vi.stubGlobal('innerHeight', 480);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(480);
    render(<Chat autoFocus />);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message Jarvis' }));
    expect(screen.getByTestId('shell').dataset.keyboardOpen).toBe('true');
  });

  it('keeps typing space through visual-first resize, panning, and the later layout resize', () => {
    const visible = viewport();
    let layoutHeight = 844;
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => layoutHeight);
    render(<Chat />);
    screen.getByRole('textbox', { name: 'Message Jarvis' }).focus();
    const shell = screen.getByTestId('shell');
    visible.height = 480;
    visible.offsetTop = 364;
    act(() => { visible.dispatchEvent(new Event('resize')); visible.dispatchEvent(new Event('scroll')); });
    expect(shell.dataset.keyboardOpen).toBe('true');
    layoutHeight = 480;
    vi.stubGlobal('innerHeight', 480);
    visible.offsetTop = 0;
    act(() => { window.dispatchEvent(new Event('resize')); visible.dispatchEvent(new Event('scroll')); });
    expect(shell.dataset.keyboardOpen).toBe('true');
    screen.getByRole('textbox', { name: 'Other editor' }).focus();
    expect(shell.dataset.keyboardOpen).toBe('false');
  });

  it('handles enabling the phone dock with an already focused input and an already resized layout', () => {
    const visible = viewport();
    visible.height = 480;
    vi.stubGlobal('innerHeight', 480);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(480);
    const view = render(<Chat enabled={false} />);
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    input.focus();
    view.rerender(<Chat />);
    const shell = screen.getByTestId('shell');
    expect(shell.dataset.keyboardOpen).toBe('true');
    // Keyboard dismissal can enlarge the viewport without removing focus.
    for (const height of [510, 560, 620, 700, 844]) {
      visible.height = height;
      vi.stubGlobal('innerHeight', height);
      act(() => { visible.dispatchEvent(new Event('resize')); });
    }
    expect(document.activeElement).toBe(input);
    expect(shell.dataset.keyboardOpen).toBe('false');
    // Reopening while the caret remains focused must hide navigation again.
    visible.height = 480;
    vi.stubGlobal('innerHeight', 480);
    act(() => { visible.dispatchEvent(new Event('resize')); });
    expect(shell.dataset.keyboardOpen).toBe('true');
    view.rerender(<Chat enabled={false} />);
    expect(shell.hasAttribute('data-keyboard-open')).toBe(false);
  });

  it('keeps the dock steady while focus moves from typing to composer controls', () => {
    const visible = viewport();
    visible.height = 480;
    vi.stubGlobal('innerHeight', 480);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(480);
    render(<Chat />);
    const shell = screen.getByTestId('shell');
    const control = screen.getByRole('button', { name: 'Composer action' });
    control.focus();
    expect(shell.dataset.keyboardOpen).toBe('false');
    screen.getByRole('textbox', { name: 'Message Jarvis' }).focus();
    control.focus();
    expect(shell.dataset.keyboardOpen).toBe('true');
    screen.getByRole('button', { name: 'Language' }).focus();
    expect(shell.dataset.keyboardOpen).toBe('true');
    screen.getByRole('textbox', { name: 'Other editor' }).focus();
    expect(shell.dataset.keyboardOpen).toBe('false');
  });

  it('dismisses touch taps outside only the composer, without swallowing the tap or blurring another editor', () => {
    viewport();
    render(<Chat />);
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    input.focus();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Composer action' }), { pointerType: 'touch' });
    expect(document.activeElement).toBe(input);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Language' }), { pointerType: 'touch' });
    expect(document.activeElement).toBe(input);
    fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'mouse' });
    expect(document.activeElement).toBe(input);
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
    screen.getByTestId('outside').dispatchEvent(event);
    expect(document.activeElement).not.toBe(input);
    expect(event.defaultPrevented).toBe(false);
    const editor = screen.getByRole('textbox', { name: 'Other editor' });
    editor.focus();
    fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'touch' });
    expect(document.activeElement).toBe(editor);
  });

  it('uses the latest viewport, clears stale insets on zoom and disposes on desktop/voice/unmount', async () => {
    const visible = viewport();
    const remove = vi.spyOn(visible, 'removeEventListener');
    const view = render(<Chat />);
    const shell = screen.getByTestId('shell');
    visible.height = 400;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    visible.height = 500;
    act(() => { visible.dispatchEvent(new Event('scroll')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('500px'));
    visible.scale = 2;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('100dvh'));
    view.rerender(<Chat enabled={false} />);
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('');
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    visible.scale = 1;
    view.rerender(<Chat />);
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('500px');
    act(() => { visible.dispatchEvent(new Event('resize')); });
    view.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('');
  });

  it('uses the normal dock without VisualViewport and ignores signed-out/desktop inputs', () => {
    vi.stubGlobal('visualViewport', undefined);
    const view = render(<Chat />);
    const shell = screen.getByTestId('shell');
    expect(shell.style.getPropertyValue('--phone-chat-top')).toBe('0px');
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('100dvh');
    view.rerender(<Chat enabled={false} />);
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    input.focus();
    fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'touch' });
    expect(document.activeElement).toBe(input);
  });

  it('publishes the same visible rectangle when innerHeight changes independently of the fixed containing viewport', () => {
    const visible = viewport();
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(844);
    render(<Chat />);
    const shell = screen.getByTestId('shell');
    visible.height = 400;
    visible.offsetTop = 40;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    expect(shell.style.getPropertyValue('--phone-chat-top')).toBe('40px');
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('400px');
    vi.stubGlobal('innerHeight', 440);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(shell.dataset.keyboardOpen).toBe('true');
    expect(shell.style.getPropertyValue('--phone-chat-top')).toBe('40px');
    expect(shell.style.getPropertyValue('--phone-chat-height')).toBe('400px');
  });
});

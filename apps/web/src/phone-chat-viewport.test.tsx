import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePhoneChatViewport } from './phone-chat-viewport';

function Chat({ enabled = true }: { enabled?: boolean }) {
  const shell = useRef<HTMLDivElement>(null);
  usePhoneChatViewport(shell, enabled);
  return (
    <div ref={shell} data-testid="shell">
      <div className="conversation-input">
        <textarea id="message" aria-label="Message Jarvis" defaultValue="Unsent fixture draft" />
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
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('364px'));
    visible.offsetTop = 60;
    act(() => { visible.dispatchEvent(new Event('scroll')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-top')).toBe('60px'));
    expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('304px');
    visible.height = 844;
    visible.offsetTop = 0;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('0px'));
    expect(document.activeElement).toBe(input);
    expect(input).toHaveProperty('value', 'Unsent fixture draft');
    visible.height = 400;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('444px'));
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
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('344px'));
    visible.scale = 2;
    act(() => { visible.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('0px'));
    view.rerender(<Chat enabled={false} />);
    expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('');
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    visible.scale = 1;
    view.rerender(<Chat />);
    expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('344px');
    act(() => { visible.dispatchEvent(new Event('resize')); });
    view.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('');
  });

  it('uses the normal dock without VisualViewport and ignores signed-out/desktop inputs', () => {
    vi.stubGlobal('visualViewport', undefined);
    const view = render(<Chat />);
    const shell = screen.getByTestId('shell');
    expect(shell.style.getPropertyValue('--phone-chat-top')).toBe('0px');
    expect(shell.style.getPropertyValue('--phone-chat-bottom')).toBe('0px');
    view.rerender(<Chat enabled={false} />);
    const input = screen.getByRole('textbox', { name: 'Message Jarvis' });
    input.focus();
    fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'touch' });
    expect(document.activeElement).toBe(input);
  });
});

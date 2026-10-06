import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceBarStatus } from './VoiceBarStatus';

function state(container: HTMLElement) {
  return (container.firstChild as HTMLElement).getAttribute('data-state');
}

describe('VoiceBarStatus', () => {
  it('shows a readable label for each live state without repeating the routine message', () => {
    const { container, rerender } = render(<VoiceBarStatus status="listening" message="Listening for your voice." />);

    expect(screen.getByText('Listening').id).toBe('voice-status');
    expect(screen.getByText('Listening for your voice.').classList.contains('visually-hidden')).toBe(true);
    expect(state(container)).toBe('listening');
    expect(screen.queryByRole('heading')).toBeNull();

    rerender(<VoiceBarStatus status="thinking" message="Jarvis is thinking." />);
    expect(screen.getByText('Thinking')).not.toBeNull();
    expect(state(container)).toBe('thinking');

    rerender(<VoiceBarStatus status="speaking" message="Jarvis is speaking." />);
    expect(screen.getByText('Speaking')).not.toBeNull();
    expect(state(container)).toBe('speaking');
  });

  it('bounds live audio level for the glyph without hiding the state label', () => {
    const { container, rerender } = render(
      <VoiceBarStatus status="listening" message="Listening for your voice." audioLevel={0.75} />,
    );
    const glyph = container.querySelector<HTMLElement>('.voice-bar-glyph')!;

    expect(glyph.style.getPropertyValue('--voice-level')).toBe('0.75');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');

    rerender(<VoiceBarStatus status="listening" message="Listening for your voice." audioLevel={4} />);
    expect(glyph.style.getPropertyValue('--voice-level')).toBe('1');
    rerender(<VoiceBarStatus status="listening" message="Listening for your voice." audioLevel={Number.NaN} />);
    expect(glyph.style.getPropertyValue('--voice-level')).toBe('0');
    expect(screen.getByText('Listening')).not.toBeNull();
  });

  it('announces detail changes while the voice state stays ready', () => {
    const { rerender } = render(<VoiceBarStatus status="ready" message="Microphone is off." />);

    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Ready');
    expect(screen.getByText('Microphone is off.').classList.contains('voice-bar-detail')).toBe(true);

    rerender(<VoiceBarStatus status="ready" message="Microphone access was denied." />);
    expect(screen.getByRole('status').textContent).toContain('Microphone access was denied.');
  });

  it('shows reconnecting as its own state, never as listening', () => {
    const { container, rerender } = render(<VoiceBarStatus status="listening" message="Listening for your voice." />);

    rerender(<VoiceBarStatus status="reconnecting" message="Voice connection ended. Reconnecting…" />);
    expect(screen.getByText('Reconnecting')).not.toBeNull();
    expect(screen.queryByText('Listening')).toBeNull();
    expect(state(container)).toBe('reconnecting');
  });

  it('shows muted listening truthfully and points to the More menu', () => {
    const { container, rerender } = render(
      <VoiceBarStatus status="listening" message="Listening for your voice." muted />,
    );

    expect(screen.getByText('Microphone muted')).not.toBeNull();
    expect(screen.getByText('Jarvis can’t hear you. Unmute from More options.')).not.toBeNull();
    expect(state(container)).toBe('muted');

    rerender(<VoiceBarStatus status="speaking" message="Jarvis is speaking." muted />);
    expect(screen.getByText('Speaking')).not.toBeNull();
    expect(screen.getByText('Jarvis is speaking. Your microphone is muted.')).not.toBeNull();
  });

  it('maps a published tool-call state and keeps unknown states unavailable', () => {
    const { container, rerender } = render(<VoiceBarStatus status="tool_call" message="Jarvis is using a tool." />);

    expect(screen.getByText('Using a tool')).not.toBeNull();
    expect(screen.getByText('Jarvis is using a tool.')).not.toBeNull();
    expect(state(container)).toBe('tool-call');

    rerender(<VoiceBarStatus status="future-runtime-state" message="Unexpected state." />);
    expect(screen.getByText('Voice unavailable')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Unexpected state. Voice status was not recognized.');
    expect(state(container)).toBe('unavailable');
  });

  it('distinguishes off, connecting, stopping and failed states', () => {
    const { container, rerender } = render(<VoiceBarStatus status="stopped" message="Voice is off." />);
    expect(screen.getByText('Voice off')).not.toBeNull();

    rerender(<VoiceBarStatus status="connecting" message="Connecting to Jarvis voice…" />);
    expect(screen.getByText('Connecting')).not.toBeNull();
    expect(state(container)).toBe('connecting');

    rerender(<VoiceBarStatus status="stopping" message="Saving voice session…" />);
    expect(screen.getByText('Ending voice')).not.toBeNull();
    expect(screen.getByText('Saving voice session…').classList.contains('voice-bar-detail')).toBe(true);
    expect(state(container)).toBe('stopping');

    rerender(<VoiceBarStatus status="error" message="Voice could not reconnect." />);
    expect(screen.getByText('Voice unavailable')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Voice could not reconnect.');
    expect(state(container)).toBe('unavailable');
  });
});

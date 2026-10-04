import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceOrb } from './VoiceOrb';

describe('VoiceOrb', () => {
  it('shows distinct live states with a text alternative', () => {
    const { container, rerender } = render(<VoiceOrb status="listening" message="Listening for your voice." />);

    expect(screen.getByRole('status').textContent).toContain('Listening');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('listening');

    rerender(<VoiceOrb status="thinking" message="Jarvis is thinking." />);
    expect(screen.getByRole('status').textContent).toContain('Thinking');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('thinking');

    rerender(<VoiceOrb status="speaking" message="Jarvis is speaking." />);
    expect(screen.getByRole('status').textContent).toContain('Speaking');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('speaking');
  });

  it('reflects interruption and reconnect transitions', () => {
    const { container, rerender } = render(<VoiceOrb status="speaking" message="Jarvis is speaking." />);

    rerender(<VoiceOrb status="listening" message="Listening for your voice." />);
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('listening');

    rerender(<VoiceOrb status="reconnecting" message="Voice connection ended. Reconnecting…" />);
    expect(screen.getByRole('status').textContent).toContain('Reconnecting');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('reconnecting');
  });

  it('does not imply tool activity when the runtime does not publish it', () => {
    render(<VoiceOrb status="thinking" message="Jarvis is thinking." />);

    expect(screen.getByText(/Tool-call activity is unavailable/u)).not.toBeNull();
  });

  it('maps a published tool-call state and keeps unknown states unavailable', () => {
    const { container, rerender } = render(<VoiceOrb status="tool_call" message="Jarvis is using a tool." />);

    expect(screen.getByRole('status').textContent).toContain('Tool call');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('tool-call');

    rerender(<VoiceOrb status="future-runtime-state" message="Unexpected state." />);
    expect(screen.getByRole('alert').textContent).toContain('Voice status unavailable');
    expect(screen.getByRole('alert').textContent).toContain('unrecognized status');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('unavailable');
  });

  it('marks a stopped voice session as off', () => {
    render(<VoiceOrb status="stopped" message="Voice is off." />);

    expect(screen.getByRole('status').textContent).toContain('Voice off');
  });
});

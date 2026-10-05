import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceOrb } from './VoiceOrb';

describe('VoiceOrb', () => {
  it('shows distinct live states with a text alternative', () => {
    const { container, rerender } = render(<VoiceOrb status="listening" message="Listening for your voice." />);

    expect(screen.getByRole('status').textContent).toContain('Listening for your voice.');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('listening');

    rerender(<VoiceOrb status="thinking" message="Jarvis is thinking." />);
    expect(screen.getByRole('status').textContent).toContain('Jarvis is thinking.');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('thinking');

    rerender(<VoiceOrb status="speaking" message="Jarvis is speaking." />);
    expect(screen.getByRole('status').textContent).toContain('Jarvis is speaking.');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('speaking');
  });

  it('maps live audio level to a bounded visual intensity without hiding the state label', () => {
    const { container, rerender } = render(
      <VoiceOrb status="speaking" message="Jarvis is speaking." audioLevel={0.75} />,
    );
    const orb = container.firstChild as HTMLElement;

    expect(orb.style.getPropertyValue('--voice-level')).toBe('0.06');
    expect(screen.getByRole('status').textContent).toContain('Jarvis is speaking.');

    rerender(<VoiceOrb status="speaking" message="Jarvis is speaking." audioLevel={4} />);
    expect(orb.style.getPropertyValue('--voice-level')).toBe('0.08');
    expect(screen.getByRole('status').textContent).toContain('Jarvis is speaking.');
  });

  it('reflects interruption and reconnect transitions', () => {
    const { container, rerender } = render(<VoiceOrb status="speaking" message="Jarvis is speaking." />);

    rerender(<VoiceOrb status="listening" message="Listening for your voice." />);
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('listening');

    rerender(<VoiceOrb status="reconnecting" message="Voice connection ended. Reconnecting…" />);
    expect(screen.getByRole('status').textContent).toContain('Reconnecting');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('reconnecting');
  });

  it('maps a published tool-call state and keeps unknown states unavailable', () => {
    const { container, rerender } = render(<VoiceOrb status="tool_call" message="Jarvis is using a tool." />);

    expect(screen.getByRole('status').textContent).toContain('Jarvis is using a tool.');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('tool-call');
    expect(screen.queryByText('Tool running')).toBeNull();

    rerender(<VoiceOrb status="future-runtime-state" message="Unexpected state." />);
    expect(screen.getByRole('alert').textContent).toContain('Voice status unavailable');
    expect(screen.getByRole('alert').textContent).toContain('unrecognized status');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('unavailable');
  });

  it('marks a stopped voice session as off', () => {
    render(<VoiceOrb status="stopped" message="Voice is off." />);

    expect(screen.getByRole('status').textContent).toContain('Voice is off.');
  });

  it('distinguishes connecting, stopping and failed states', () => {
    const { container, rerender } = render(<VoiceOrb status="connecting" message="Connecting to Jarvis voice…" />);

    expect(screen.getByRole('status').textContent).toContain('Connecting');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('connecting');

    rerender(<VoiceOrb status="stopping" message="Saving voice session…" />);
    expect(screen.getByRole('status').textContent).toContain('Saving voice session');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('stopping');

    rerender(<VoiceOrb status="error" message="Voice could not reconnect." />);
    expect(screen.getByRole('alert').textContent).toContain('Voice unavailable');
    expect(screen.getByRole('alert').textContent).toContain('Voice could not reconnect.');
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('unavailable');
  });
});

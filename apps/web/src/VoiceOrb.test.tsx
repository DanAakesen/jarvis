import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceOrb } from './VoiceOrb';

describe('VoiceOrb', () => {
  it('shows distinct live states with a text alternative', () => {
    const { container, rerender } = render(<VoiceOrb status="listening" message="Listening for your voice." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Listening' })).not.toBeNull();
    expect(screen.getByText('Listening for your voice.')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('listening');

    rerender(<VoiceOrb status="thinking" message="Jarvis is thinking." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Thinking' })).not.toBeNull();
    expect(screen.getByText('Jarvis is thinking.')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('thinking');

    rerender(<VoiceOrb status="speaking" message="Jarvis is speaking." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Speaking' })).not.toBeNull();
    expect(screen.getByText('Jarvis is speaking.')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('speaking');
  });

  it('maps live audio level to a bounded visual intensity without hiding the state label', () => {
    const { container, rerender } = render(
      <VoiceOrb status="speaking" message="Jarvis is speaking." audioLevel={0.75} />,
    );
    const orb = container.firstChild as HTMLElement;

    expect(orb.style.getPropertyValue('--voice-level')).toBe('0.06');
    expect(screen.getByRole('heading', { level: 1, name: 'Speaking' })).not.toBeNull();
    expect(screen.getByText('Jarvis is speaking.')).not.toBeNull();

    rerender(<VoiceOrb status="speaking" message="Jarvis is speaking." audioLevel={4} />);
    expect(orb.style.getPropertyValue('--voice-level')).toBe('0.08');
    expect(screen.getByText('Jarvis is speaking.')).not.toBeNull();
  });

  it('announces detail changes while the voice state stays ready', () => {
    const { rerender } = render(<VoiceOrb status="ready" message="Microphone is off." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Ready' })).not.toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true');

    rerender(<VoiceOrb status="ready" message="Microphone access was denied." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ready' })).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Microphone access was denied.');
  });

  it('reflects interruption and reconnect transitions', () => {
    const { container, rerender } = render(<VoiceOrb status="speaking" message="Jarvis is speaking." />);

    rerender(<VoiceOrb status="listening" message="Listening for your voice." />);
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('listening');

    rerender(<VoiceOrb status="reconnecting" message="Voice connection ended. Reconnecting…" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Reconnecting' })).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('reconnecting');
  });

  it('does not imply tool activity when the runtime does not publish it', () => {
    render(<VoiceOrb status="thinking" message="Jarvis is thinking." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Thinking' })).not.toBeNull();
    expect(screen.queryByText('Tool running')).toBeNull();
  });

  it('maps a published tool-call state and keeps unknown states unavailable', () => {
    const { container, rerender } = render(<VoiceOrb status="tool_call" message="Jarvis is using a tool." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Using a tool' })).not.toBeNull();
    expect(screen.getByText('Jarvis is using a tool.')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('tool-call');
    expect(screen.getByText('Tool running').classList.contains('tool-call-running')).toBe(true);

    rerender(<VoiceOrb status="future-runtime-state" message="Unexpected state." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Voice unavailable' })).not.toBeNull();
    expect(screen.getByText('Unexpected state. Voice status was not recognized.')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('unavailable');
  });

  it('marks a stopped voice session as off', () => {
    render(<VoiceOrb status="stopped" message="Voice is off." />);

    expect(screen.getByRole('heading', { level: 1, name: 'Voice off' })).not.toBeNull();
    expect(screen.getByText('Voice is off.')).not.toBeNull();
  });

  it('distinguishes connecting, stopping and failed states', () => {
    const { container, rerender } = render(<VoiceOrb status="connecting" message="Connecting to Jarvis voice…" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Connecting' })).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('connecting');

    rerender(<VoiceOrb status="stopping" message="Saving voice session…" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ending voice' })).not.toBeNull();
    expect(screen.getByText('Saving voice session…')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('stopping');

    rerender(<VoiceOrb status="error" message="Voice could not reconnect." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Voice unavailable' })).not.toBeNull();
    expect(screen.getByText('Voice could not reconnect.')).not.toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('data-state')).toBe('unavailable');
  });
});

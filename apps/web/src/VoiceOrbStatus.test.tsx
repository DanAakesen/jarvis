import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceOrbStatus } from './VoiceOrbStatus';
import { voicePresentation, type VoicePresentationInput } from './voice-presentation';

const live: VoicePresentationInput = {
  status: 'listening',
  message: 'Listening for your voice.',
  microphone: 'live',
  muted: false,
  activity: null,
};

function renderStatus(input: Partial<VoicePresentationInput>) {
  return render(<VoiceOrbStatus presentation={voicePresentation({ ...live, ...input })} />);
}

describe('VoiceOrbStatus', () => {
  it('shows one readable label per live state and hides routine detail visually', () => {
    const { container, rerender } = renderStatus({});
    const status = () => container.firstChild as HTMLElement;

    expect(screen.getByText('Listening').id).toBe('voice-status');
    expect(screen.getByText('Listening for your voice.').classList.contains('visually-hidden')).toBe(true);
    expect(status().getAttribute('data-state')).toBe('listening');
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true');
    expect(screen.queryByRole('heading')).toBeNull();

    rerender(<VoiceOrbStatus presentation={voicePresentation({ ...live, status: 'thinking' })} />);
    expect(screen.getByText('Thinking')).not.toBeNull();
    rerender(<VoiceOrbStatus presentation={voicePresentation({ ...live, status: 'speaking' })} />);
    expect(screen.getByText('Speaking')).not.toBeNull();
    expect(status().querySelector('.voice-status-glyph')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('announces microphone problems assertively with readable recovery detail', () => {
    const message = 'Microphone access is blocked. Allow it for this site in your browser settings, then choose Retry microphone in More options.';
    renderStatus({ status: 'ready', microphone: 'denied', message });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Microphone blocked');
    expect(screen.getByText(message).classList.contains('voice-status-detail')).toBe(true);
    expect(screen.queryByText('Listening')).toBeNull();
  });

  it('keeps long details inside the status for wrapping beneath the orb', () => {
    const message = `${'A very long recovery explanation that must wrap. '.repeat(8)}`.trim();
    renderStatus({ status: 'error', microphone: 'off', message });
    expect(screen.getByText(message).id).toBe('voice-status-detail');
  });
});

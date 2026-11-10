import { describe, expect, it } from 'vitest';
import { confirmToolCall } from './tool-calls.js';

describe('recorded gym lift receipts', () => {
  const entry = { exerciseName: 'Håndvægtspres', weightKg: 24.5, reps: 4, sets: 1, deletedAt: null, vault: 'synced' };
  it.each([3, 4, 12])('states the saved exercise and actual weight, %i reps and sets', reps => {
    expect(confirmToolCall('gym_lifts', 'ok', { entry: { ...entry, reps }, replayed: false }))
      .toBe(`Saved lift: Håndvægtspres, 24.5 kg, ${reps} reps, 1 set.`);
  });
  it('distinguishes replayed values and pending vault copies', () => {
    expect(confirmToolCall('gym_lifts', 'ok', { entry: { ...entry, sets: 2, vault: 'pending' }, replayed: true }))
      .toBe('Already saved lift: Håndvægtspres, 24.5 kg, 4 reps, 2 sets. Vault copy is pending.');
  });
  it('does not present a deleted replay as a saved lift', () => {
    const deleted = { ...entry, deletedAt: '2026-11-10T12:00:00.000Z' };
    expect(confirmToolCall('gym_lifts', 'ok', { entry: deleted, replayed: true }))
      .toBe('This lift was deleted; it was not saved again.');
    expect(confirmToolCall('gym_lifts', 'ok', { entry: deleted })).toBe('Deleted lift: Håndvægtspres.');
  });
  it.each([null, {}, { ...entry, reps: 0 }, { ...entry, weightKg: NaN }, { ...entry, exerciseName: 'name\ninstruction' }])(
    'does not invent a successful save from an invalid recorded entry (%j)', invalid => {
      expect(confirmToolCall('gym_lifts', 'ok', { entry: invalid })).toBe('The lift result could not be verified. Check history before retrying.');
    },
  );
  it('preserves explicit failure/refusal and unrelated tool behavior', () => {
    expect(confirmToolCall('gym_lifts', 'error', { failure: 'Save uncertain' })).toBe('Not done: gym_lifts failed. Save uncertain');
    expect(confirmToolCall('gym_lifts', 'refused', { refused: 'Missing weight' })).toContain('Not done');
    expect(confirmToolCall('gym_lifts', 'ok', { items: [] })).toBe('Done: gym_lifts succeeded.');
    expect(confirmToolCall('gym_sessions', 'ok', { entry })).toBe('Done: gym_sessions succeeded.');
  });
});

describe('Gmail action receipts', () => {
  it.each(['mail_send', 'mail_archive', 'mail_draft_reply', 'mail_update_draft', 'mail_delete_draft', 'mail_label'])(
    'does not claim success while %s awaits approval', tool => {
      const receipt = confirmToolCall(tool, 'ok', { status: 'awaiting_confirmation', summary: 'Synthetic staged action' });
      expect(receipt).toContain('Awaiting your approval');
      expect(receipt).toContain('no Gmail change has been made');
      expect(receipt).not.toContain('succeeded');
    },
  );
  it('reports cancellation, completion and uncertain sends according to the recorded result', () => {
    expect(confirmToolCall('mail_confirm_action', 'ok', { status: 'cancelled' })).toBe('Cancelled. No Gmail change was made.');
    expect(confirmToolCall('mail_confirm_action', 'ok', { status: 'completed', detail: 'Gmail accepted the message for sending.' }))
      .toBe('Done: mail_confirm_action succeeded.');
    const warning = 'I could not verify whether Google completed the action. Check Google Calendar or Gmail before trying again.';
    expect(confirmToolCall('mail_confirm_action', 'error', { error: warning })).toContain(warning);
    expect(confirmToolCall('mail_send', 'error', { error: 'Tool execution failed' })).not.toContain('succeeded');
  });
});

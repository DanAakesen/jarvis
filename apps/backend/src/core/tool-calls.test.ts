import { describe, expect, it } from 'vitest';
import { confirmToolCall } from './tool-calls.js';

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
      .toBe('Gmail accepted the message for sending.');
    const warning = 'I could not verify whether Google completed the action. Check Google Calendar or Gmail before trying again.';
    expect(confirmToolCall('mail_confirm_action', 'error', { error: warning })).toContain(warning);
    expect(confirmToolCall('mail_send', 'error', { error: 'Tool execution failed' })).not.toContain('succeeded');
  });
});

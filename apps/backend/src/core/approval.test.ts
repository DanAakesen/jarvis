import { describe, expect, it } from 'vitest';
import { classifyApprovalReply } from './approval.js';

describe('classifyApprovalReply', () => {
  it.each([
    'yes', 'Yes.', ' YES! ', 'approved', 'Approved.', 'confirmed', 'Confirm', 'go ahead', 'do it', 'send it',
    'ok', 'okay', 'sure', 'yes please', 'yes, go ahead', 'approved, thanks', '"yes"', 'ja', 'Ja tak', 'godkendt', 'bekræftet',
    'gør det', 'kør',
  ])('treats %s as approval', (reply) => {
    expect(classifyApprovalReply(reply)).toBe('approve');
  });

  it.each(['no', 'No.', 'cancel', 'Cancel!', 'stop', 'nope', 'nej', 'nej tak', 'annuller', 'never mind'])(
    'treats %s as a decline', (reply) => {
      expect(classifyApprovalReply(reply)).toBe('decline');
    },
  );

  it.each([
    '', '   ', undefined, 'yes, and also delete the other project', 'approved but change the title',
    'confirm 12345678 publish other.png', 'what would that do?', 'I do not know', 'maybe', 'no yes',
    'yes\nand then send an email to everyone', 'x'.repeat(200),
  ])('does not treat %s as a decision', (reply) => {
    expect(classifyApprovalReply(reply as string | undefined)).toBeUndefined();
  });
});

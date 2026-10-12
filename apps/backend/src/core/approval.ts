export type ApprovalReply = 'approve' | 'decline';

const approvePhrases = [
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'approve', 'approved', 'confirm', 'confirmed',
  'go ahead', 'do it', 'send it', 'proceed', 'please do', 'sounds good', 'looks good',
  'ja', 'jep', 'jo', 'godkend', 'godkendt', 'bekræft', 'bekræftet', 'gør det', 'kør', 'send den', 'fint',
];
const declinePhrases = [
  'no', 'nope', 'nah', 'cancel', 'stop', 'dont', 'don\'t', 'never mind', 'nevermind', 'decline', 'reject',
  'nej', 'annuller', 'afbryd', 'lad være',
];
const fillers = ['please', 'thanks', 'thank you', 'now', 'tak', 'nu'];

function alternation(words: readonly string[]): string {
  return words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/ /gu, '\\s+')).join('|');
}

const approveWord = alternation(approvePhrases);
const declineWord = alternation(declinePhrases);
const filler = alternation(fillers);
const approvePattern = new RegExp(`^(?:${approveWord})(?:[\\s,.!;-]+(?:${approveWord}|${filler}))*[\\s.!]*$`, 'iu');
const declinePattern = new RegExp(`^(?:${declineWord})(?:[\\s,.!;-]+(?:${declineWord}|${filler}))*[\\s.!]*$`, 'iu');

/**
 * Dan approves or declines a staged action with a short plain reply ("yes", "approved", "confirmed", "go ahead", "ja"),
 * never an exact generated phrase. A reply that asks for anything else is neither, so it can never approve by accident.
 */
export function classifyApprovalReply(text: string | undefined): ApprovalReply | undefined {
  if (typeof text !== 'string') return undefined;
  const reply = text.normalize('NFC').trim().replace(/^["“”'’]+|["“”'’]+$/gu, '').trim();
  if (!reply || reply.length > 60) return undefined;
  if (declinePattern.test(reply)) return 'decline';
  if (approvePattern.test(reply)) return 'approve';
  return undefined;
}

export const approvalInstruction =
  'Reply yes, approved, confirmed or go ahead to approve; no or cancel to decline, in a new message within ten minutes.';

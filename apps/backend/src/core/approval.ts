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
 * Deterministic fast path only: a short plain reply such as "yes" or "nej" needs no model. Anything else, including
 * every natural sentence, is decided by the bounded interpreter in approval-interpreter.ts. A reply that is not
 * recognised here is undefined, never an approval.
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
  'Ask Dan in your own words whether he wants this done; it happens only after his later reply clearly agrees. Never ask him to repeat a code or phrase.';

/** Returned when Dan's later message is verified but does not clearly approve or decline. */
export const approvalUnclear =
  'No change was made. Dan’s latest message did not clearly approve or decline the pending change. Ask him one short, natural question about it; never ask him to repeat a code or phrase.';

/** Returned when nothing can be approved: missing, expired, or no later verified Dan reply. */
export const approvalNotPending =
  'No change was made. The pending change is missing, has expired, or Dan has not replied after it yet. If he still wants it, show him the proposal again and ask in your own words.';

export function isSimpleApproval(value: string): boolean {
  return classifyApprovalReply(value) === 'approve';
}

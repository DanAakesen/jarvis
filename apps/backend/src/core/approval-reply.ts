import type { ConversationLanguage, ConversationStore } from './conversation-store.js';

export type ApprovalOutcome = 'completed' | 'cancelled' | 'unverified';

function oneLine(text: string): string {
  const line = Array.from(text, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f) ? ' ' : character;
  }).join('').replace(/\s+/gu, ' ').trim();
  return [...line].slice(0, 160).join('');
}

/** The chat line that closes a decided approval: the outcome, plus a follow-up question when one helps. */
export function approvalReplyText(outcome: ApprovalOutcome, summary: string, language: ConversationLanguage): string {
  const line = oneLine(summary);
  const subject = /[.!?]$/u.test(line) ? line : `${line}.`;
  if (language === 'da') {
    if (outcome === 'completed') return `Det er gjort: ${subject} Skal jeg også gøre noget andet i den forbindelse?`;
    if (outcome === 'cancelled') return `Okay, jeg har ikke lavet ændringen: ${subject} Skal jeg foreslå noget andet i stedet?`;
    return `Jeg kan ikke bekræfte, at ændringen blev gennemført: ${subject} Tjek kalenderen, før jeg prøver igen. Skal jeg tjekke den for dig?`;
  }
  if (outcome === 'completed') return `Done: ${subject} Do you want me to do anything else around it?`;
  if (outcome === 'cancelled') return `Okay, I did not make the change: ${subject} Would you like me to suggest something different?`;
  return `I cannot confirm the change went through: ${subject} Check the calendar before I try again. Should I check it for you?`;
}

/** Posts the outcome of a tapped approval into the chat session that proposed it. Never throws. */
export async function postApprovalReply(
  conversations: Pick<ConversationStore, 'getSession' | 'addMessage'> | null,
  action: { readonly sessionId: string; readonly summary: string } | undefined,
  outcome: ApprovalOutcome,
): Promise<boolean> {
  if (!conversations || !action) return false;
  try {
    const session = await conversations.getSession(action.sessionId);
    if (!session) return false;
    const message = await conversations.addMessage({
      sessionId: action.sessionId,
      role: 'jarvis',
      text: approvalReplyText(outcome, action.summary, session.language),
      model: null,
      language: session.language,
    });
    return message !== null;
  } catch {
    return false;
  }
}

// The deployed jarvis-brain skill owns tool contracts. Only this owner-editable routine appears on the phone.
export const defaultBrainInstructions = [
  'Review what changed against my preferences and current priorities.',
  'Act when useful. Tell me once when I can make a decision or something needs my attention.',
  'Keep the message short. Otherwise stay quiet.',
].join('\n');
export const maxBrainInstructionLength = 16_000;

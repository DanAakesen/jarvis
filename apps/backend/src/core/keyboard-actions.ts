export type KeySequence = readonly string[];

const namedKeys = new Set([
  'enter', 'tab', 'escape', 'esc', 'space', 'backspace', 'delete', 'insert', 'home', 'end',
  'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
]);

const commonKeySequences: readonly KeySequence[] = [
  ['Ctrl+P'], ['Ctrl+Shift+P'], ['Ctrl+L'], ['Ctrl+F'], ['Ctrl+S'], ['Ctrl+A'], ['Ctrl+W'],
  ['Ctrl+Enter'], ['Enter'], ['Tab'], ['Escape'], ['Backspace'], ['Delete'],
];

const shortcutHints: Record<string, readonly string[]> = {
  vscode: ['Ctrl+P opens Quick Open', 'Ctrl+Shift+P opens the command palette'],
  code: ['Ctrl+P opens Quick Open', 'Ctrl+Shift+P opens the command palette'],
  spotify: ['Ctrl+L focuses Spotify search'],
  chrome: ['Ctrl+L focuses the address and search bar', 'Ctrl+F finds text on the page'],
};

export function commonShortcutsFor(application: string): readonly string[] {
  return shortcutHints[application.toLowerCase()] ?? [];
}

export function keySequencesFor(
  application: string,
  goal: string,
): KeySequence[] {
  const candidates = [...commonKeySequences];
  for (const hint of commonShortcutsFor(application)) {
    const sequence = hint.split(' ')[0]!;
    candidates.push([sequence]);
  }
  if (/\b(?:close|quit|exit|shut down)\b/iu.test(goal)) candidates.push(['Alt+F4']);

  const mentioned = [...goal.matchAll(
    /\b(?:Ctrl|Alt|Shift|Win)\s*\+\s*[A-Za-z0-9]|(?:Enter|Tab|Escape|Esc|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)\b/giu,
  )].map(match => match[0]!.replace(/\s+/gu, ''));
  if (/\b(?:then|followed by)\b/iu.test(goal) && mentioned.length >= 2 && mentioned.length <= 4) {
    candidates.push(mentioned);
  }
  return uniqueSequences(candidates.filter(sequence => isSafeKeySequence(
    sequence,
    /\b(?:close|quit|exit|shut down)\b/iu.test(goal),
  )));
}

export function isSafeKeySequence(value: unknown, closeIntent: boolean): value is KeySequence {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  return value.every(chord => {
    if (typeof chord !== 'string' || chord.length > 32) return false;
    const parsed = parseChord(chord);
    if (!parsed) return false;
    const { modifiers, key } = parsed;
    if ((modifiers.includes('Win') && key.toLowerCase() === 'l') ||
        (modifiers.includes('Ctrl') && modifiers.includes('Alt') && key.toLowerCase() === 'delete'))
      return false;
    return !(modifiers.includes('Alt') && key.toLowerCase() === 'f4' && !closeIntent);
  });
}

export function isIrreversibleKeySequence(sequence: KeySequence): boolean {
  return sequence.some(chord => {
    const parsed = parseChord(chord);
    return parsed !== undefined && (
      parsed.key.toLowerCase() === 'delete' ||
      (parsed.key.toLowerCase() === 'enter' && parsed.modifiers.includes('Ctrl'))
    );
  });
}

export function closeIntentFor(goal: string): boolean {
  return /\b(?:close|quit|exit|shut down)\b/iu.test(goal);
}

export function keySequenceChoiceOptions(sequences: readonly KeySequence[]): Record<string, string> {
  return Object.fromEntries(sequences.map((sequence, index) => [
    `keys_${index}`,
    sequence.join(' then '),
  ]));
}

export function keySequenceFromChoice(
  choice: string,
  sequences: readonly KeySequence[],
): KeySequence | undefined {
  const match = /^keys_(\d{1,2})$/u.exec(choice);
  return match ? sequences[Number(match[1])] : undefined;
}

function parseChord(chord: string): { modifiers: string[]; key: string } | undefined {
  const plusKey = chord === '+' || chord.endsWith('++');
  const parts = plusKey
    ? chord === '+' ? [] : chord.slice(0, -2).split('+')
    : chord.split('+');
  const modifiers: string[] = [];
  for (const part of parts.slice(0, plusKey ? parts.length : -1)) {
    const modifier = ({
      ctrl: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift',
      win: 'Win',
    } as const)[part!.toLowerCase() as 'ctrl' | 'alt' | 'shift' | 'win'];
    if (!modifier || modifiers.includes(modifier)) return undefined;
    modifiers.push(modifier);
  }
  const key = plusKey ? '+' : parts.at(-1)!;
  const validKey = key.length === 1
    ? key.charCodeAt(0) >= 0x21 && key.charCodeAt(0) <= 0x7e
    : namedKeys.has(key.toLowerCase()) ||
      (/^f(?:[1-9]|1[0-2])$/iu.test(key));
  if (!validKey) return undefined;
  return { modifiers, key };
}

function uniqueSequences(sequences: readonly KeySequence[]): KeySequence[] {
  const seen = new Set<string>();
  return sequences.filter(sequence => {
    const key = JSON.stringify(sequence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

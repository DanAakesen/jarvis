export type LivePhase = 'thinking' | 'working' | 'composing';

// The working line names what Jarvis is actually doing, not a random generic phrase.
// First match wins; unknown tools fall back to a plain "Working on it…".
const toolActivity: ReadonlyArray<readonly [RegExp, string]> = [
  [/^image_generation$/u, 'Drawing it…'],
  [/^(vault_write|vault_delete)$/u, 'Updating your notes…'],
  [/^(vault_|show_knowledge|folio_)/u, 'Searching your notes…'],
  [/^daily_/u, 'Checking your health data…'],
  [/^calendar_/u, 'Checking your calendar…'],
  [/^mail_/u, 'Going through your mail…'],
  [/^memory_/u, 'Checking what I remember…'],
  [/^weather$/u, 'Checking the weather…'],
  [/^(web_research|research|browser_|pc_browser)/u, 'Looking it up…'],
  [/^(repo_|pr_|checks_|ci_|issue_|github_|manage_repository)/u, 'Reading the repository…'],
  [/task|release|deployment|work_status|project/u, 'Working on your tasks…'],
  [/^(pc_|codex_|workspace_)/u, 'Working on your PC…'],
];

/** The single, honest line for the current phase; a running tool names what Jarvis is doing. */
export function livePhraseFor(phase: LivePhase, tool?: string | null) {
  if (phase === 'thinking') return 'Thinking…';
  if (phase === 'composing') return 'Writing it up…';
  return toolActivity.find(([pattern]) => pattern.test(tool ?? ''))?.[1] ?? 'Working on it…';
}

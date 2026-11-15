/**
 * Temporary dual-path support while the vault clean-up is pending: task inboxes and the gym log exist under
 * a legacy and a current path. Reads prefer the current path, then the legacy one; a new note goes to the
 * current path only when the current layout is detected. Remove the legacy paths and this file's fallbacks
 * once the vault clean-up has merged.
 */
export interface DualPath {
  readonly current: string;
  readonly legacy: string;
}

export type TaskScopeFolder = 'Personal' | 'Work';

export const CURRENT_GYM_LOG_FOLDER = 'Personal/Health/Gym log';
export const LEGACY_GYM_LOG_FOLDER = 'Health/Gym log';

const CURRENT_LAYOUT_PATHS: ReadonlySet<string> = new Set(['Personal/Task inbox.md', 'Work/Task inbox.md']);
const CURRENT_LAYOUT_PREFIXES = [`${CURRENT_GYM_LOG_FOLDER}/`, '_agent-activity/'] as const;

export function taskInboxPaths(folder: TaskScopeFolder): DualPath {
  return { current: `${folder}/Task inbox.md`, legacy: `${folder}/Inbox.md` };
}

export function gymLogNotePaths(fileName: string): DualPath {
  return { current: `${CURRENT_GYM_LOG_FOLDER}/${fileName}`, legacy: `${LEGACY_GYM_LOG_FOLDER}/${fileName}` };
}

export function isCurrentVaultLayout(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (CURRENT_LAYOUT_PATHS.has(path) || CURRENT_LAYOUT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  }
  return false;
}

/** The existing note's path, preferring the current one, or undefined when neither exists. */
export function existingVaultPath(paths: DualPath, existing: ReadonlySet<string>): string | undefined {
  if (existing.has(paths.current)) return paths.current;
  return existing.has(paths.legacy) ? paths.legacy : undefined;
}

interface LayoutVault {
  read(path: string, signal: AbortSignal): Promise<unknown | null>;
  tree(signal: AbortSignal): Promise<readonly { path: string }[]>;
}

/** Where to read or write a note: an existing note wins; a new note follows the detected layout. The tree is read only when neither note exists. */
export async function resolveVaultPath(paths: DualPath, vault: LayoutVault, signal: AbortSignal): Promise<string> {
  if (await vault.read(paths.current, signal)) return paths.current;
  if (await vault.read(paths.legacy, signal)) return paths.legacy;
  return isCurrentVaultLayout((await vault.tree(signal)).map(({ path }) => path)) ? paths.current : paths.legacy;
}

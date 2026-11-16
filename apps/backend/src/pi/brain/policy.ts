/**
 * The tools that exist only for a background wake: speak to Dan, keep notes, add to an inbox trail and record a look at a
 * watch. Chat and voice never see them. A wake otherwise has the same tools as chat.
 */
export const brainOnlyTools: ReadonlySet<string> = new Set(['message_dan', 'pi_note', 'inbox_trail', 'watch_look']);

export function isBrainOnlyTool(name: string): boolean {
  return brainOnlyTools.has(name);
}

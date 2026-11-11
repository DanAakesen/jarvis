import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { isCurrentAssistantTool } from '../core/tool-registry.js';

export const VOICE_FIND_TOOLS_TOOL = 'find_tools';
export const VOICE_CALL_TOOL = 'call_tool';

/**
 * Tools sent to the voice model on every turn. Voice re-reads every advertised schema each turn, so
 * only what a quick spoken conversation needs is listed: tasks and notes, calendar reads, a gym quick
 * log, Factory task status, presence and the camera watch. Every other catalogue tool is reached
 * through find_tools and call_tool, so its schema costs tokens only in a session that uses it.
 */
export const VOICE_CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'vault_task_create', 'vault_task_complete', 'vault_search', 'vault_write',
  'calendar_today_agenda', 'calendar_next_event', 'calendar_list_events',
  'gym_lifts',
  'list_tasks', 'create_task',
  'set_presence_mode',
  'watch_for', 'stop_watching_for',
]);

export function isVoiceCoreTool(name: string): boolean {
  return VOICE_CORE_TOOL_NAMES.has(name);
}

/** Tools the voice model may run: the core set, or one that find_tools returned in this session. */
export function isVoiceToolAllowed(name: string, discovered: ReadonlySet<string>): boolean {
  return isCurrentAssistantTool(name) && (isVoiceCoreTool(name) || discovered.has(name));
}

const MAX_VOICE_DESCRIPTION_CHARACTERS = 240;

/** Keeps whole leading sentences up to the limit; a single long sentence is cut at a word boundary. */
export function shortenVoiceDescription(text: string): string {
  if (text.length <= MAX_VOICE_DESCRIPTION_CHARACTERS) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/gu) ?? [text];
  let result = '';
  for (const sentence of sentences) {
    if (result && result.length + sentence.length > MAX_VOICE_DESCRIPTION_CHARACTERS) break;
    result += sentence;
  }
  result = result.trim();
  if (result.length <= MAX_VOICE_DESCRIPTION_CHARACTERS) return result;
  const cut = result.slice(0, MAX_VOICE_DESCRIPTION_CHARACTERS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`;
}

/** Ranks non-core catalogue tools by query words in their name (strongest) and description. */
export function searchVoiceTools(tools: ToolRegistry, query: string): RegisteredTool[] {
  const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2))].slice(0, 8);
  if (words.length === 0) return [];
  return tools.list()
    .filter((tool) => isCurrentAssistantTool(tool.name) && !isVoiceCoreTool(tool.name))
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const segments = name.split('_');
      const description = tool.description.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (segments.includes(word)) score += 4;
        else if (name.includes(word)) score += 2;
        if (description.includes(word)) score += 1;
      }
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .map((entry) => entry.tool);
}

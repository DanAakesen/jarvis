import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { isCurrentAssistantTool } from '../core/tool-registry.js';

export const VOICE_FIND_TOOLS_TOOL = 'find_tools';
export const VOICE_CALL_TOOL = 'call_tool';

/**
 * Voice advertises no per-tool schema: only find_tools and call_tool. A catalogue tool may run once
 * find_tools has returned it in this session. agents/jarvis/tool_lookup.py ranks the same way for chat.
 */
export function isVoiceToolAllowed(name: string, discovered: ReadonlySet<string>): boolean {
  return isCurrentAssistantTool(name) && discovered.has(name);
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

/** Ranks catalogue tools by query words in their name (strongest) and description. */
export function searchVoiceTools(tools: ToolRegistry, query: string): RegisteredTool[] {
  const words = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2))].slice(0, 8);
  if (words.length === 0) return [];
  return tools.list()
    .filter((tool) => isCurrentAssistantTool(tool.name))
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

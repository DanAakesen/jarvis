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
export function searchVoiceTools(tools: ToolRegistry, query: string, visible: (name: string) => boolean = isCurrentAssistantTool): RegisteredTool[] {
  const normalizedQuery = query.toLowerCase().trim().replace(/[_-]+/gu, ' ');
  const aliases: Readonly<Record<string, readonly string[]>> = {
    kalender: ['calendar'], calendar: ['kalender'],
    mail: ['email', 'e-mail', 'post'], email: ['mail', 'e-mail', 'post'], 'e-mail': ['mail', 'email', 'post'], post: ['mail', 'email'],
    opgave: ['task', 'tasks'], opgaver: ['task', 'tasks'], task: ['opgave', 'opgaver'], tasks: ['opgaver'],
    påmindelse: ['reminder'], påmindelser: ['reminders'], reminder: ['påmindelse'], reminders: ['påmindelser'],
    note: ['notes', 'noter'], notes: ['note', 'noter'], noter: ['note', 'notes'],
    projekt: ['project', 'projects'], projekter: ['project', 'projects'], project: ['projekt', 'projekter'], projects: ['projekter'],
    søg: ['search', 'find'], search: ['søg', 'find'], find: ['søg', 'search'],
    viden: ['knowledge'], knowledge: ['viden'],
    sundhed: ['health'], health: ['sundhed'],
    mad: ['food'], food: ['mad'],
    træning: ['workout', 'gym'], workout: ['træning'], gym: ['træning'],
    vejr: ['weather'], weather: ['vejr'],
    rejse: ['travel'], travel: ['rejse'],
    indbakke: ['inbox'], inbox: ['indbakke'],
  };
  const words = [...new Set(normalizedQuery.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2))].slice(0, 8);
  if (words.length === 0) return [];
  return tools.list()
    .filter((tool) => visible(tool.name))
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const segments = name.split('_');
      const description = tool.description.toLowerCase();
      const exactName = name.replaceAll('_', ' ') === normalizedQuery;
      let score = exactName ? 12 : 0;
      for (const word of words) {
        const variants = [word, ...(aliases[word] ?? [])];
        score += Math.max(...variants.map((variant) => {
          let wordScore = 0;
          if (segments.includes(variant)) wordScore += 4;
          else if (name.includes(variant)) wordScore += 2;
          if (description.includes(variant)) wordScore += 1;
          return wordScore;
        }));
      }
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .map((entry) => entry.tool);
}

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

const aliases = new Map<string, string>([
  ['kalender', 'calendar'], ['aftale', 'event'], ['aftaler', 'event'], ['begivenheder', 'event'], ['events', 'event'],
  ['dagsorden', 'agenda'], ['dag', 'today'], ['møde', 'event'], ['møder', 'event'], ['næste', 'next'],
  ['ledig', 'free'], ['ledige', 'free'],
  ['note', 'vault'], ['notes', 'vault'], ['notat', 'vault'], ['notater', 'vault'], ['noter', 'vault'], ['obsidian', 'vault'],
  ['opgave', 'task'], ['opgaver', 'task'], ['tasks', 'task'], ['todo', 'task'], ['todos', 'task'], ['gøremål', 'task'],
  ['indbakke', 'mail'], ['inbox', 'mail'], ['email', 'mail'], ['emails', 'mail'], ['mails', 'mail'],
  ['vejr', 'weather'], ['vejret', 'weather'],
  ['webben', 'web'], ['nettet', 'web'], ['internet', 'web'], ['internettet', 'web'], ['online', 'web'],
  ['undersøg', 'research'], ['researching', 'research'],
  ['søg', 'search'], ['find', 'search'], ['læs', 'read'], ['vis', 'list'], ['listér', 'list'],
  ['opret', 'create'], ['skriv', 'write'], ['opdater', 'update'], ['slet', 'delete'],
  ['sag', 'issue'], ['sager', 'issue'], ['issues', 'issue'], ['fejlrapport', 'issue'],
  ['lager', 'repo'], ['repositorium', 'repo'], ['repository', 'repo'], ['repositories', 'repo'], ['repos', 'repo'],
  ['ressource', 'resource'], ['ressourcer', 'resource'], ['resources', 'resource'],
  ['ressourcegruppe', 'resource group'], ['ressourcegrupper', 'resource group'], ['resourcegroup', 'resource group'],
  ['gruppe', 'group'], ['grupper', 'group'], ['groups', 'group'], ['abonnement', 'subscription'],
]);
const stopWords = new Set([
  'can', 'could', 'would', 'you', 'please', 'me', 'my', 'the', 'for', 'in', 'on', 'and', 'is', 'what', 'are',
  'kan', 'kunne', 'vil', 'du', 'mig', 'min', 'mit', 'mine', 'den', 'det', 'der', 'på', 'og', 'hvad', 'er', 'af',
]);
const searchWords = (text: string): string[] =>
  text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2 && !stopWords.has(word));
const canonicalWords = (words: string[]): string[] =>
  words.flatMap((word) => (aliases.get(word) ?? word).split(' '));

/** Ranks exact names first, then bilingual query words in names and descriptions. */
export function searchVoiceTools(tools: Pick<ToolRegistry, 'list'>, query: string, visible: (name: string) => boolean = isCurrentAssistantTool): RegisteredTool[] {
  const exactName = query.trim().toLowerCase();
  const words = [...new Set(canonicalWords(searchWords(query.replace(/\bi dag\b/giu, 'today'))))].slice(0, 12);
  return tools.list()
    .filter((tool) => visible(tool.name))
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const exact = name === exactName;
      const segments = canonicalWords(searchWords(name));
      const description = tool.description.toLowerCase();
      const descriptionWords = new Set(canonicalWords(searchWords(description)));
      let score = 0;
      for (const word of words) {
        if (segments.includes(word)) score += 4;
        else if (name.includes(word)) score += 2;
        if (descriptionWords.has(word) || description.includes(word)) score += 1;
      }
      return { tool, exact, score };
    })
    .filter((entry) => entry.exact || entry.score > 0)
    .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .map((entry) => entry.tool);
}

import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import { isCurrentAssistantTool } from '../core/tool-registry.js';

const MAX_DESCRIPTION_CHARACTERS = 240;

export function shortenToolDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARACTERS) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/gu) ?? [text];
  let result = '';
  for (const sentence of sentences) {
    if (result && result.length + sentence.length > MAX_DESCRIPTION_CHARACTERS) break;
    result += sentence;
  }
  result = result.trim();
  if (result.length <= MAX_DESCRIPTION_CHARACTERS) return result;
  const cut = result.slice(0, MAX_DESCRIPTION_CHARACTERS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}\u2026`;
}

export function searchJarvisTools(
  tools: ToolRegistry,
  query: string,
  visible: (name: string) => boolean = isCurrentAssistantTool,
): RegisteredTool[] {
  const words = [...new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2),
  )].slice(0, 8);
  if (words.length === 0) return [];
  return tools.list()
    .filter((tool) => visible(tool.name))
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

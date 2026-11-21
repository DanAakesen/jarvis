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

/**
 * English and Danish wording for the common intents, as a plain table. A query word that equals a stem (or starts with it when
 * the stem ends in `*`: "kalender*"; words are split on hyphens too, so "github-issues" is "github" and "issues") adds the row's `terms` to the search, so "vejr" finds `weather`. A row with a `provider`
 * also names that remote provider (`gh_` GitHub, `az_` Azure): only then is its catalogue loaded for the search.
 */
interface IntentAlias {
  readonly stems: readonly string[];
  readonly terms: readonly string[];
  readonly provider?: 'gh_' | 'az_';
}

export const intentAliases: readonly IntentAlias[] = [
  { stems: ['vejr*', 'weather', 'forecast', 'temperatur*'], terms: ['weather'] },
  { stems: ['remember', 'memory', 'husk*', 'hukommelse*', 'erindring*'], terms: ['memory'] },
  { stems: ['remind*', 'paaminde*', 'paamindelse*', 'påmind*'], terms: ['reminders'] },
  { stems: ['calendar*', 'kalender*', 'aftale*', 'meeting*', 'møde*', 'moede*'], terms: ['calendar'] },
  { stems: ['mail', 'mails', 'email*', 'gmail'], terms: ['mail'] },
  { stems: ['task', 'tasks', 'todo*', 'opgave*'], terms: ['task'] },
  { stems: ['note', 'notes', 'noter*', 'vault'], terms: ['vault', 'notes'] },
  { stems: ['health*', 'sundhed*', 'sleep', 'søvn', 'soevn'], terms: ['health'] },
  { stems: ['github*', 'git', 'gh', 'issue*', 'pull', 'pullrequest*', 'pullanmodning*', 'pr', 'prs', 'commit*', 'branch*',
    'repo', 'repos', 'repositor*', 'workflow*', 'arbejdsgang*'],
    terms: ['github', 'issue', 'pull'], provider: 'gh_' },
  { stems: ['azure*', 'az', 'ressource*', 'resource*', 'subscription*', 'abonnement*', 'container*'],
    terms: ['azure', 'resource'], provider: 'az_' },
];

const stemMatches = (token: string, stem: string): boolean => stem.endsWith('*') ? token.startsWith(stem.slice(0, -1)) : token === stem;
const aliasesFor = (query: string): IntentAlias[] => {
  const found = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return intentAliases.filter((alias) => alias.stems.some((stem) => found.some((token) => stemMatches(token, stem))));
};

/** The remote providers a query names, by alias word or by a tool name such as `gh_issue_read`. */
export function providersNamedBy(query: string): ReadonlySet<'gh_' | 'az_'> {
  const named = new Set<'gh_' | 'az_'>();
  for (const alias of aliasesFor(query)) if (alias.provider) named.add(alias.provider);
  for (const prefix of ['gh_', 'az_'] as const) {
    if (new RegExp(`(?:^|[^a-z0-9])${prefix}`, 'u').test(query.toLowerCase())) named.add(prefix);
  }
  return named;
}

export function searchJarvisTools(
  tools: ToolRegistry,
  query: string,
  visible: (name: string) => boolean = isCurrentAssistantTool,
): RegisteredTool[] {
  const queryWords = [...new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2),
  )].slice(0, 8);
  const words = [...new Set([...queryWords, ...aliasesFor(query).flatMap((alias) => alias.terms)])];
  if (words.length === 0) return [];
  // A query that contains a tool's exact name ranks that tool first.
  const exactNames = new Set(query.toLowerCase().split(/[^a-z0-9_-]+/u).filter(Boolean));
  return tools.list()
    .filter((tool) => visible(tool.name))
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const segments = name.split('_');
      const description = tool.description.toLowerCase();
      let score = exactNames.has(name) ? 1_000 : 0;
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

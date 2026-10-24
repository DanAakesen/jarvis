import { createHash } from 'node:crypto';
import { safeDecision, type ApprovalDecider } from '../core/approval-interpreter.js';
import {
  findingCategories, sourceIds, type FindingCategory, type ProactiveSettings, type SuggestionScopePreference,
} from './types.js';
import type { ProactiveSettingsPatch } from './store.js';

export type ProactivePreferenceIntent =
  | { paused: boolean }
  | { category: FindingCategory; enabled: boolean }
  | { suggestionScope: SuggestionScopePreference };

export const proactivePreferenceHelp = {
  title: { en: 'What can I ask?', da: 'Hvad kan jeg bede om?' },
  examples: [
    { en: 'Pause proactive suggestions.', da: 'Sæt proaktive forslag på pause.' },
    { en: 'Resume proactive suggestions.', da: 'Genoptag proaktive forslag.' },
    { en: 'Show only personal suggestions.', da: 'Vis kun personlige forslag.' },
    { en: 'Stop travel suggestions.', da: 'Hold op med rejseforslag.' },
    { en: 'What proactive preferences apply?', da: 'Hvilke præferencer gælder for proaktive forslag?' },
  ],
} as const;

const categoryLabels: Record<FindingCategory, string> = {
  deadline: 'deadlines',
  clash: 'calendar clashes',
  travel: 'travel',
  todo: 'task',
  prep: 'preparation',
  news: 'news',
  weather: 'weather',
  status: 'status',
  suggestion: 'general',
};

export function understoodProactivePreferences(settings: ProactiveSettings): string[] {
  const scope = settings.suggestionScope === 'all' ? 'all personal and work suggestions'
    : settings.suggestionScope === 'personal' ? 'personal suggestions only' : 'work suggestions only';
  const excluded = findingCategories.filter((category) => !settings.categories[category])
    .map((category) => categoryLabels[category]);
  return [
    settings.paused ? 'Automatic proactive suggestions are paused.' : 'Automatic proactive suggestions are on.',
    `The current scope is ${scope}.`,
    ...(excluded.length > 0 ? [`Do not suggest: ${excluded.join(', ')}.`] : []),
  ];
}

export function proactiveSettingsRevision(settings: ProactiveSettings): string {
  const value = {
    paused: settings.paused,
    monthlyBudgetDkk: settings.monthlyBudgetDkk,
    sources: sourceIds.map((id) => [id, settings.sources[id]]),
    categories: findingCategories.map((id) => [id, settings.categories[id]]),
    suggestionScope: settings.suggestionScope,
    newsFeeds: settings.newsFeeds,
    guidance: settings.guidance,
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pauseIntent(text: string): ProactivePreferenceIntent | undefined {
  const normalized = text.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const afterNoun = /^(?:(?:please|can you|could you)\s+)?(?:turn|switch)\s+(?:proactivity|proactive(?:\s+(?:suggestions?|checks?))?)\s+(?<state>off|on)[.!?]?$/iu.exec(normalized);
  if (afterNoun?.groups?.state) return { paused: afterNoun.groups.state.toLowerCase() === 'off' };
  const match = /^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?:(?<pause>pause|stop|turn off|disable|sæt .+? på pause|slå .+? fra)|(?<resume>resume|start|turn on|enable|genoptag|slå .+? til))\s+(?:automatic\s+)?(?:proactive(?:\s+(?:suggestions?|checks?))?|proactivity)[.!?]?$/iu.exec(normalized) ??
    /^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?<verb>sæt|slå|genoptag)\s+(?:proaktive?\s+)?(?:forslag|kontroller|tjek)(?:\s+(?<ending>på pause|fra|til))?[.!?]?$/iu.exec(normalized);
  if (!match) return undefined;
  const verb = (match.groups?.pause ?? match.groups?.resume ?? match.groups?.verb ?? '').toLowerCase();
  const ending = match.groups?.ending?.toLowerCase();
  const paused = ending === 'på pause' || ending === 'fra' ||
    /^(?:pause|stop|turn off|disable|sæt)$/u.test(verb) ||
    verb.startsWith('sæt ');
  return { paused };
}

export function explicitProactivePreferenceIntent(text: string): ProactivePreferenceIntent | undefined {
  const normalized = text.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const paused = pauseIntent(normalized);
  if (paused) return paused;

  const scope = /^(?:(?:please|i want|i only want|i'd like)\s+)?(?:(?:show|keep|give me)\s+(?:me\s+)?(?:only\s+)?|only\s+)(?<scope>personal|private|work|all)(?:\s+(?:proactive\s+)?suggestions)?[.!?]?$/iu.exec(normalized) ??
    /^(?:(?:i would like(?: for you)?|i'd like(?: for you)?)\s+)?(?:you\s+to\s+)?(?:only\s+)?(?:suggest|show|give me)\s+(?:only\s+)?(?<scope>personal|private|work)\s+(?:things|suggestions)(?:\s+(?:going forward|from now on))?[.!?]?$/iu.exec(normalized) ??
    /^(?:jeg vil gerne have, at du kun foreslår|jeg vil gerne have, at du kun viser|jeg vil gerne have, at du kun giver mig)\s+(?<scope>personlige?|private|arbejdsrelaterede|arbejde)\s+(?:ting|forslag)(?:\s+fremover)?[.!?]?$/iu.exec(normalized) ??
    /^(?:(?:vis(?: mig)?|giv mig|hold dig til)\s+(?:kun\s+)?|kun\s+)(?<scope>personlige?|private|arbejde|arbejdsrelaterede|alle|al)(?:\s+(?:proaktive?\s+)?forslag)?[.!?]?$/iu.exec(normalized);
  if (scope?.groups?.scope) {
    const value = scope.groups.scope.toLowerCase();
    return { suggestionScope: value === 'personal' || value === 'private' || value.startsWith('personlig') ? 'personal'
      : value === 'work' || value === 'arbejde' || value === 'arbejdsrelaterede' ? 'work' : 'all' };
  }

  const categoryPattern = /^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?<verb>stop|disable|turn off|hide|mute|don't show|do not show|enable|re-enable|turn on|show|start showing|hold op med|deaktiver|deaktivér|slå fra|skjul|vis ikke|aktiver|aktivér|slå til|vis)\s+(?:(?:showing|med|at)\s+)?(?:the\s+|de\s+)?(?<category>deadlines?|frists?|calendar clashes?|clashes?|konflikter?|kalenderkonflikter?|travel|trips?|rejser?|todos?|tasks?|opgaver?|prep|preparation|forberedelser?|news|nyheder?|weather|vejr|status)(?:\s+(?:proactive\s+)?suggestions?|\s+forslag|forslag)(?:\s+again|\s+igen)?[.!?]?$/iu.exec(normalized);
  const value = categoryPattern?.groups?.category?.toLowerCase();
  const matchedVerb = categoryPattern?.groups?.verb?.toLowerCase();
  if (!value || !matchedVerb) return undefined;
  const category: FindingCategory = /^(?:deadline|deadlines|frist|frists)$/u.test(value) ? 'deadline'
    : /^(?:calendar clashes?|clashes?|konflikter?|kalenderkonflikter?)$/u.test(value) ? 'clash'
      : /^(?:travel|trips?|rejser?)$/u.test(value) ? 'travel'
        : /^(?:todos?|tasks?|opgaver?)$/u.test(value) ? 'todo'
          : /^(?:prep|preparation|forberedelser?)$/u.test(value) ? 'prep'
            : /^(?:news|nyheder?)$/u.test(value) ? 'news'
              : /^(?:weather|vejr)$/u.test(value) ? 'weather' : 'status';
  const enabled = /^(?:enable|re-enable|turn on|show|start showing|aktiver|aktivér|slå til|vis)$/u.test(matchedVerb);
  return { category, enabled };
}

function words(text: string): Set<string> {
  return new Set(text.normalize('NFC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Returns bounded candidate changes for semantic verification, never an inferred change by itself. */
export function proactivePreferenceCandidates(text: string): ProactivePreferenceIntent[] {
  const tokens = words(text);
  const groups: ProactivePreferenceIntent[][] = [];
  const personal = ['personal', 'private', 'personlig', 'personlige', 'privat', 'privatliv']
    .some((token) => tokens.has(token));
  const work = ['work', 'arbejde', 'arbejdsrelateret', 'arbejdsrelaterede']
    .some((token) => tokens.has(token));
  const all = /\b(?:all|both|alle|begge)\b(?:\s+\w+){0,3}\s+\b(?:suggestions?|forslag)\b/iu.test(text);
  if (Number(personal) + Number(work) + Number(all) === 1) {
    groups.push([{ suggestionScope: personal ? 'personal' : work ? 'work' : 'all' }]);
  }

  const categoryTerms: readonly [FindingCategory, readonly string[]][] = [
    ['deadline', ['deadline', 'deadlines', 'frist', 'frister']],
    ['clash', ['clash', 'clashes', 'conflict', 'conflicts', 'kalenderkonflikt', 'kalenderkonflikter']],
    ['travel', ['travel', 'trip', 'trips', 'journey', 'rejse', 'rejser', 'rejseforslag']],
    ['todo', ['todo', 'task', 'tasks', 'opgave', 'opgaver']],
    ['prep', ['preparation', 'prep', 'forberedelse', 'forberedelser']],
    ['news', ['news', 'nyhed', 'nyheder']],
    ['weather', ['weather', 'vejr', 'vejret']],
    ['status', ['status']],
  ];
  for (const [category, terms] of categoryTerms) {
    if (terms.some((term) => tokens.has(term))) {
      groups.push([{ category, enabled: false }, { category, enabled: true }]);
    }
  }

  const proactiveContext = ['proactive', 'proactivity', 'automatic', 'automatically', 'suggestion',
    'suggestions', 'nudge', 'nudges', 'forslag', 'proaktiv', 'proaktive', 'automatisk', 'automatiske']
    .some((token) => tokens.has(token));
  const pauseLanguage = ['pause', 'stop', 'disable', 'turn', 'off', 'resume', 'enable', 'hold',
    'pause', 'slå', 'fra', 'til', 'genoptag', 'sæt', 'stoppe', 'forslag']
    .some((token) => tokens.has(token));
  if (groups.length === 0 && proactiveContext && pauseLanguage) {
    groups.push([{ paused: true }, { paused: false }]);
  }

  return groups.length === 1 ? groups[0]! : [];
}

export async function resolveProactivePreferenceIntent(
  text: string,
  candidates: readonly ProactivePreferenceIntent[],
  decide: ApprovalDecider,
  context: { messageId: string; sessionId?: string },
  signal: AbortSignal,
): Promise<ProactivePreferenceIntent | undefined> {
  const explicit = explicitProactivePreferenceIntent(text);
  if (explicit) {
    return candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(explicit)) ? explicit : undefined;
  }
  for (const intent of candidates) {
    if (signal.aborted) return undefined;
    const verdict = await safeDecision(decide, {
      family: 'proactive_preferences',
      ...context,
      reply: text,
      summary: JSON.stringify(intent),
    }, signal);
    if (signal.aborted) return undefined;
    if (verdict === 'approve') return intent;
  }
  return undefined;
}

export function patchForProactivePreference(intent: ProactivePreferenceIntent): ProactiveSettingsPatch {
  if ('paused' in intent) return { paused: intent.paused };
  if ('category' in intent) return { categories: { [intent.category]: intent.enabled } };
  return { suggestionScope: intent.suggestionScope };
}

export class ProactiveSettingsConflictError extends Error {
  constructor() {
    super('Proactive settings changed before the update could be saved.');
    this.name = 'ProactiveSettingsConflictError';
  }
}

import type { FindingCategory, ProactiveSettings, SourceFact, SourceId, SuggestionScope } from './types.js';

const personalScopePattern = /\b(?:personal|private|home|household|family|doctor|dentist|groceries|grocery|shopping|school|kids|children|birthday|rent|utilities|medicine|cleaning|laundry|privat|hjem(?:met)?|familie(?:n)?|læge(?:aftale|besøg)?|tandlæge|indkøb|dagligvarer|børn|fødselsdag|husleje|regninger|medicin|rengøring|vasketøj)\b/iu;
const workScopePattern = /\b(?:work|office|job|manager|colleague|coworker|client|customer|supplier|business|workplace|professional|invoice|agenda|arbejde|kontor|leder|kollega|klient|kunde|leverandør|virksomhed|faktura|dagsorden|professionel)\b/iu;
const travelPattern = /\b(?:travel|trip|flight|airline|airport|hotel|booking|reservation|itinerary|vacation|holiday|rejse|rejser|fly|flyrejse|lufthavn|hotellet|ferie|reservation|rejseplan)\b/iu;

export function classifySuggestionScope(
  text: string,
  facts: readonly Pick<SourceFact, 'taskScope' | 'text'>[],
): SuggestionScope {
  const explicit = new Set(facts.flatMap(({ taskScope }) => taskScope ? [taskScope] : []));
  if (explicit.size > 1) return 'unknown';
  const context = `${text} ${facts.map(({ text: factText }) => factText).join(' ')}`;
  const personal = personalScopePattern.test(context);
  const work = workScopePattern.test(context);
  if (personal && work) return 'unknown';
  const established = [...explicit][0];
  if (established !== undefined) {
    return (personal && established !== 'personal') || (work && established !== 'work')
      ? 'unknown' : established;
  }
  return personal ? 'personal' : work ? 'work' : 'unknown';
}

export function hasTravelEvidence(
  text: string,
  facts: readonly Pick<SourceFact, 'text'>[],
): boolean {
  return travelPattern.test(`${text} ${facts.map(({ text: factText }) => factText).join(' ')}`);
}

export function findingAllowed(
  settings: ProactiveSettings,
  category: FindingCategory,
  suggestionScope: SuggestionScope,
  relatedCategories: readonly FindingCategory[] = [],
): boolean {
  return settings.categories[category] &&
    relatedCategories.every((related) => settings.categories[related]) &&
    (settings.suggestionScope === 'all' || suggestionScope === settings.suggestionScope);
}

export function automaticProactiveWorkAllowed(settings: ProactiveSettings): boolean {
  return !settings.paused && Object.values(settings.sources).some(Boolean);
}

export function proactiveSourceAllowed(settings: ProactiveSettings, source: SourceId): boolean {
  return automaticProactiveWorkAllowed(settings) && settings.sources[source];
}

export function proactiveEvidenceSourcesAllowed(
  settings: ProactiveSettings,
  sources: readonly SourceId[],
): boolean {
  return automaticProactiveWorkAllowed(settings) && sources.every((source) => settings.sources[source]);
}

export function itemAllowed(settings: ProactiveSettings, item: {
  kind: 'finding' | 'test';
  category: FindingCategory | null;
  ownerRequested?: boolean;
  suggestionScope?: SuggestionScope;
  relatedCategories?: readonly FindingCategory[];
}): boolean {
  if (item.kind === 'test' || item.category === null) return true;
  if (item.ownerRequested === true) return true;
  return findingAllowed(settings, item.category, item.suggestionScope ?? 'unknown', item.relatedCategories);
}

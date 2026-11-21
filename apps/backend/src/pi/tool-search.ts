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
 * English and Danish wording for the common intents, as a plain table. A query word that equals a stem adds the row's `terms`
 * to the search, so "vejr" finds `weather`. A stem can end in `*` ("kalender*": starts with), begin with `*` ("*kalender":
 * ends with, for Danish compounds such as "mødekalender"), or both ("*opgave*": contains). Words are split on hyphens too,
 * so "github-issues" is "github" and "issues". A `phrase` is matched as written inside the whole query ("don't forget"), for
 * wording no single word carries. A `light` row is a verb: it breaks ties between the tools of one subject. A row with a
 * `provider` also names that remote provider (`gh_` GitHub, `az_` Azure): only then is its catalogue loaded for the search.
 */
interface IntentAlias {
  readonly stems: readonly string[];
  readonly terms: readonly string[];
  readonly phrases?: readonly string[];
  /** A verb row ("show", "create"): its terms count half, so they pick between the tools of one noun instead of outranking it. */
  readonly light?: true;
  readonly provider?: 'gh_' | 'az_';
}

export const intentAliases: readonly IntentAlias[] = [
  // Nouns: what the request is about.
  { stems: ['vejr*', '*vejr', 'weather', 'forecast*', 'prognose*', 'temperatur*', 'regn*', 'rain*', 'snow*', 'sne', 'wind*', 'blæst*', 'storm*', 'solskin*', 'paraply*'], terms: ['weather'] },
  { stems: ['remember', 'memory', 'memories', 'hukommelse*', 'erindring*'], terms: ['memory'] },
  { stems: ['husk'], terms: ['memory', 'remember'] },
  { stems: ['husker', 'husket', 'recall'], phrases: ['what do you remember', 'do you remember', 'what you remember', 'can you remember'], terms: ['memory', 'search'] },
  { stems: ['forget', 'forgot', 'glem*'], terms: ['memory', 'forget'] },
  { stems: [], phrases: ['don’t forget', "don't forget", 'do not forget', 'dont forget', 'never forget', 'glem ikke', 'lad være med at glemme'], terms: ['memory', 'remember'] },
  { stems: ['remind*', 'paaminde*', 'paamindelse*', 'påmind*', 'mind', 'snooze', 'udskyd*'], terms: ['reminders'] },
  { stems: ['calendar*', 'kalender*', '*kalender', 'aftale*', '*aftale', 'appointment*', 'meeting*', 'møde*', 'møder', 'moede*', '*tid', 'tidspunkt*'], terms: ['calendar'] },
  { stems: ['tid', 'ledig*', 'free', 'available', 'tilgængelig*'], terms: ['calendar', 'free', 'slots'] },
  { stems: ['næste', 'next'], terms: ['next'] },
  { stems: ['dag', 'idag', 'today'], terms: ['today'] },
  { stems: ['uge', 'ugen', 'uger', 'week*', 'weekend*', 'måned*', 'month*'], light: true, terms: ['list', 'events'] },
  { stems: ['*mail*'], terms: ['mail'] },
  { stems: ['draft*', 'udkast*', '*udkast'], terms: ['mail', 'draft'] },
  { stems: ['svar*', 'reply', 'replying', 'besvar*'], terms: ['reply'] },
  { stems: ['task', 'tasks', '*opgave*'], terms: ['task'] },
  { stems: ['todo*', 'dos', 'huskeliste*', 'checklist*'], phrases: ['to-do', 'to do'], terms: ['task', 'vault', 'search'] },
  { stems: ['due', 'overdue', 'deadline*', 'forfald*'],
    phrases: ['skal jeg have lavet', 'skal jeg lave', 'skal jeg nå', 'have to do', 'need to do', 'on my list', 'på min liste'], terms: ['vault', 'search'] },
  { stems: ['running', 'kører', 'igangværende'], light: true, terms: ['list', 'status'] },
  { stems: ['note', 'notes', 'noter*', '*note', '*noter', 'vault', 'notat*'], terms: ['vault', 'notes'] },
  { stems: ['knowledge', 'viden*', 'vidensgraf*'], phrases: ['notes as a graph', 'noter som en graf', 'notes graph', 'noter som graf'], terms: ['knowledge'] },
  { stems: ['idé*', 'ide', 'ideer*', 'idea*', 'inbox', 'indbakke*', 'loose'], terms: ['inbox'] },
  { stems: ['health*', 'sundhed*'], terms: ['health'] },
  { stems: ['sleep', 'søvn', 'soevn', 'sov', 'sovet', 'sover', 'skridt', 'steps', 'puls*', 'hvilepuls*', 'pulse', 'heart*', 'hjerte*', 'weight', 'vægt', 'blodtryk'], terms: ['health', 'query'] },
  { stems: ['gym', 'lift*', 'løft*', 'bænk*', 'squat*', 'deadlift*', 'styrketræning*', 'strength', 'rep', 'reps', 'gentagelse*'], terms: ['gym', 'lifts'] },
  { stems: ['workout*', 'træning*', 'session*', 'løbetur*', 'løb*', 'run', 'running', 'jog*', 'cardio', 'cykeltur*', 'yoga', 'svømning*'], terms: ['gym', 'sessions'] },
  { stems: ['calorie*', 'kalori*', 'protein*', 'kcal', 'macro*', 'fedt', 'carb*', 'kulhydrat*', 'nutrition*', 'ernæring*', 'kost', 'diet', 'måltid*', 'meal*', 'morgenmad*', 'frokost*', 'aftensmad*', 'breakfast', 'lunch', 'dinner', 'snack*', 'mad', 'food*', 'spis*', 'spist', 'eat*', 'ate'], terms: ['nutrition', 'food'] },
  { stems: ['left', 'remaining', 'tilbage', 'resterende', 'mangler', 'need', 'needed'], light: true, terms: ['suggest'] },
  { stems: ['favourite*', 'favorite*', 'favorit*'], phrases: ['saved food', 'saved meal', 'gemt mad', 'gemte måltid'], terms: ['saved', 'food'] },
  { stems: [], phrases: ['saved report', 'saved research', 'saved html', 'gemte research', 'gemt research', 'gemte rapport', 'gemt rapport'], terms: ['workspaces', 'folio'] },
  { stems: ['target*', 'goal*', '*mål', 'mål'], terms: ['targets'] },
  { stems: ['github*', 'git', 'gh', 'issue*', 'pull', 'pullrequest*', 'pullanmodning*', 'pr', 'prs', 'commit*', 'branch*',
    'repo', 'repos', 'repositor*', 'workflow*', 'arbejdsgang*'],
  terms: ['github', 'issue', 'pull'], provider: 'gh_' },
  { stems: ['repo', 'repos', 'repositor*'], terms: ['repo'] },
  { stems: ['pr', 'prs', 'pull', 'pullrequest*', 'pullanmodning*', 'request*'], phrases: ['pull request'], terms: ['pr'] },
  { stems: ['azure*', 'az', 'ressource*', 'resource*', 'subscription*', 'abonnement*', 'container*'],
    terms: ['azure', 'resource'], provider: 'az_' },
  { stems: ['group*', 'gruppe*', 'ressourcegrupp*', 'ressourcegruppe*'], terms: ['group'], provider: 'az_' },
  { stems: ['workspace*', 'arbejdsområde*', 'arbejdsomraade*', 'folio'], terms: ['workspace', 'workspaces', 'folio'] },
  { stems: ['diagram*', 'chart*', 'graf*', 'graph*', 'plot*', 'visualis*', 'figur*'], terms: ['chart'] },
  { stems: ['setting*', 'indstilling*', 'konfigur*', 'config*', 'præference*', 'preference*'], terms: ['settings'] },
  { stems: ['tema*', 'theme', 'farve*', 'colour*', 'color*', 'mørk*', 'dark'], terms: ['theme'] },
  { stems: ['væk*', 'away', 'tilstand*', 'mode', 'presence'], terms: ['presence', 'away', 'mode'] },
  { stems: ['model*', 'modeller'], terms: ['model', 'settings'] },
  { stems: ['pc', 'pcen', 'computer*', 'windows', 'laptop'], terms: ['pc'] },
  { stems: ['vindue*', 'window*'], terms: ['window'] },
  { stems: ['musik*', 'music', 'sang*', 'song*', 'spotify', 'afspil*', 'play*', 'lyd*', 'volume*', 'volumen', 'mute'], terms: ['media', 'pc'] },
  { stems: ['research*', 'undersøg*', 'undersoeg*', 'udforsk*', 'investigat*'], terms: ['research'] },
  { stems: ['web*', 'nettet', 'internet*', 'online'], terms: ['web'] },
  { stems: ['usage', 'brugt*', 'forbrug*', 'spend', 'spent', 'spending', 'cost*', 'pris*', 'udgift*', 'budget*', 'penge', 'money', 'dkk'], terms: ['usage'] },
  { stems: ['working', 'virker', 'fungerer', 'status', 'operational'], terms: ['status', 'system'] },
  { stems: ['job*', 'baggrund*', 'background'], terms: ['jobs'] },
  { stems: ['conversation*', 'samtale*', 'talk*', 'snakke*', 'snakket', 'sagde', 'said', 'chatten'], terms: ['conversation'] },
  { stems: ['billede*', 'image*', 'foto*', 'picture*', 'generate*', 'generer*', 'tegn*'], terms: ['image', 'generation'] },
  { stems: ['kamera*', 'camera*', 'overvåg*', 'watch*'], terms: ['watch'] },
  { stems: ['project*', 'projekt*'], terms: ['projects'] },
  { stems: ['worker*', 'workers'], terms: ['task', 'work', 'status'] },
  { stems: [], phrases: ['status på mit arbejde', 'status of my work', 'my work', 'mit arbejde', 'arbejdsstatus', 'work status'], terms: ['work', 'status'] },
  { stems: ['release*', 'deploy*', 'udgivelse*'], terms: ['release', 'deployment'] },
  // Verbs: what is asked of it.
  { stems: ['søg*', 'soeg*', 'find*', 'finde', 'look', 'lookup', 'tjek*', 'check*'], light: true, terms: ['search'] },
  { stems: ['opret*', 'tilføj*', 'tilfoej*', 'add', 'create*', 'ny', 'nyt', 'new', 'make', 'lav*'], light: true, terms: ['create'] },
  { stems: ['slet*', 'fjern*', 'delete*', 'remove*'], light: true, terms: ['delete'] },
  { stems: ['gem*', 'save*', 'skriv*', 'write'], light: true, terms: ['write', 'save'] },
  { stems: ['ret', 'rette*', 'ændr*', 'aendr*', 'rediger*', 'opdater*', 'update*', 'edit*', 'modify'], light: true, terms: ['edit', 'update'] },
  { stems: ['titel*', 'title*', 'overskrift*', 'heading*', 'omdøb*', 'rename*'], light: true, terms: ['write', 'title'] },
  { stems: ['afslut*', 'færdig*', 'done', 'complete*', 'finish*', 'udført', 'marker*', 'mark'], light: true, terms: ['complete'] },
  { stems: ['flyt*', 'move', 'moving', 'postpone', 'reschedule'], light: true, terms: ['move', 'edit'] },
  { stems: ['læs*', 'laes*', 'read'], light: true, terms: ['read'] },
  { stems: ['åbn*', 'aabn*', 'open', 'åbne', 'åben'], light: true, terms: ['open'] },
  { stems: ['luk*', 'close', 'quit'], light: true, terms: ['close'] },
  { stems: ['vis*', 'show', 'display', 'fremvis*'], light: true, terms: ['show', 'list'] },
  { stems: ['liste*', 'list', 'oversigt*', 'overview', 'hvilke'], light: true, terms: ['list'] },
  { stems: ['start*', 'begynd*', 'påbegynd*'], light: true, terms: ['start'] },
  { stems: ['pause*'], light: true, terms: ['pause'] },
  { stems: ['stop*', 'afbryd*', 'cancel*', 'annuller*', 'aflys*'], light: true, terms: ['cancel', 'stop'] },
  { stems: ['send*', 'sende*'], light: true, terms: ['send'] },
  { stems: ['log', 'logg*', 'registrer*'], light: true, terms: ['health'] },
];

const normalizePhrase = (value: string): string => value.toLowerCase().replace(/[’']/gu, '');
const tokensOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function stemMatches(token: string, stem: string): boolean {
  const leading = stem.startsWith('*');
  const trailing = stem.endsWith('*');
  const core = stem.slice(leading ? 1 : 0, trailing ? -1 : undefined);
  if (core.length === 0) return false;
  if (leading && trailing) return token.includes(core);
  if (leading) return token.endsWith(core);
  return trailing ? token.startsWith(core) : token === core;
}

const aliasesFor = (query: string): IntentAlias[] => {
  const found = tokensOf(query);
  const whole = normalizePhrase(query);
  return intentAliases.filter((alias) => alias.stems.some((stem) => found.some((token) => stemMatches(token, stem)))
    || (alias.phrases ?? []).some((phrase) => whole.includes(normalizePhrase(phrase))));
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

/**
 * Words that carry no tool meaning in either language. They are dropped from the query before it is matched against names and
 * descriptions (an English description contains "en" and "min" inside other words, so a Danish stop word would otherwise score
 * every long description). Alias stems still see the whole query.
 */
const stopWords: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'about', 'is', 'are', 'was', 'were', 'be',
  'been', 'am', 'do', 'does', 'did', 'have', 'has', 'had', 'me', 'my', 'mine', 'you', 'your', 'he', 'she', 'it', 'we', 'us', 'our',
  'they', 'them', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'must', 'please', 'just', 'also', 'so', 'if', 'then', 'than', 'there', 'here', 'not',
  'no', 'yes', 'as', 'into', 'out', 'up', 'down', 'over', 'under', 'again', 'more', 'some', 'any', 'all', 'each', 'every', 'other',
  'such', 'only', 'own', 'same', 'too', 'very', 'now', 'much', 'many', 'still', 'last', 'tell', 'give', 'get', 'let', 'its',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'en', 'to', 'tre', 'fire', 'fem',
  'og', 'i', 'jeg', 'det', 'at', 'en', 'den', 'til', 'er', 'som', 'på', 'de', 'med', 'han', 'af', 'ikke', 'der', 'var', 'mig', 'sig',
  'men', 'et', 'har', 'om', 'vi', 'min', 'havde', 'ham', 'hun', 'nu', 'da', 'fra', 'du', 'ud', 'sin', 'dem', 'os', 'op', 'man',
  'hans', 'hvor', 'eller', 'hvad', 'skal', 'selv', 'her', 'alle', 'vil', 'blev', 'kunne', 'ind', 'når', 'være', 'dog', 'noget',
  'ville', 'jo', 'deres', 'efter', 'ned', 'skulle', 'denne', 'end', 'dette', 'mit', 'også', 'have', 'dig', 'anden', 'hvem', 'mine',
  'hende', 'mange', 'hvis', 'vores', 'hvordan', 'hvilken', 'hvornår', 'hvorfor', 'kan', 'lige', 'nogen', 'fik', 'gør', 'får', 'tak',
  'venligst', 'bare', 'dine', 'jeres', 'der', 'ha', 'kom', 'komme', 'sidste', 'gerne', 'helst', 'lidt', 'meget', 'stadig',
]);

/** Stems for comparing a query word with a description word: "reminders" and "reminder", "creating" and "creates" meet. */
function stem(word: string): string {
  let result = word;
  if (result.length > 4) result = result.replace(/(?:ing|ed|es)$/u, '');
  if (result.length > 3) result = result.replace(/s$/u, '');
  if (result.length > 3) result = result.replace(/e$/u, '');
  return result;
}

export function searchJarvisTools(
  tools: ToolRegistry,
  query: string,
  visible: (name: string) => boolean = isCurrentAssistantTool,
): RegisteredTool[] {
  const queryWords = [...new Set(
    tokensOf(query).filter((word) => word.length >= 2 && !stopWords.has(word) && !/^\d+$/u.test(word)),
  )].slice(0, 8);
  // "tasks" and the alias term "task" are one signal, not two; the strongest weight wins.
  const weighted = new Map<string, { word: string; weight: number }>();
  const addWord = (word: string, weight: number) => {
    const key = stem(word);
    const known = weighted.get(key);
    if (!known || known.weight < weight) weighted.set(key, { word: known?.word ?? word, weight });
  };
  for (const word of queryWords) addWord(word, 1);
  for (const alias of aliasesFor(query)) for (const term of alias.terms) addWord(term, alias.light ? 0.5 : 1);
  if (weighted.size === 0) return [];
  // A query that contains a tool's exact name ranks that tool first.
  const exactNames = new Set(query.toLowerCase().split(/[^a-z0-9_-]+/u).filter(Boolean));
  const wordStems = [...weighted.entries()].map(([wordStem, { word, weight }]) => ({ word, stem: wordStem, weight }));
  return tools.list()
    .filter((tool) => visible(tool.name))
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const segments = name.split('_');
      const segmentStems = new Set(segments.map(stem));
      const description = tool.description.toLowerCase();
      const descriptionStems = new Set(tokensOf(description).map(stem));
      let score = exactNames.has(name) ? 1_000 : 0;
      for (const { word, stem: wordStem, weight } of wordStems) {
        if (segments.includes(word) || segmentStems.has(wordStem)) score += 4 * weight;
        else if (word.length >= 3 && name.includes(word)) score += 2 * weight;
        if (descriptionStems.has(wordStem) || (word.length >= 6 && description.includes(word))) score += 1 * weight;
      }
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .map((entry) => entry.tool);
}

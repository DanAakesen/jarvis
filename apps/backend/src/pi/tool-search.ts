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
  /** The row applies only when the query also holds one of these stems: a verb that means one thing for a note and another for a task. */
  readonly also?: readonly string[];
  /** A verb row ("show", "create"): its terms count half, so they pick between the tools of one noun instead of outranking it. */
  readonly light?: true;
  readonly provider?: 'gh_' | 'az_';
}

export const intentAliases: readonly IntentAlias[] = [
  // Nouns: what the request is about.
  { stems: ['vejr*', '*vejr', 'weather', 'forecast*', 'prognose*', 'temperatur*', 'regn*', 'rain*', 'snow*', 'sne', 'wind*', 'blæst*', 'storm*', 'solskin*', 'paraply*', 'varm*', 'kold*', 'kulde', 'udenfor', 'warm', 'cold', 'hot', 'outside'], terms: ['weather'] },
  { stems: ['remember', 'memory', 'memories', 'hukommelse*', 'erindring*', 'huskeregel*', 'huskeseddel*', 'huskesedl*'], terms: ['memory'] },
  // The forms of "husk" are listed, not `husk*`: that would also match huskeliste*, a to-do list (below).
  { stems: ['husk', 'huske', 'huskede', 'huskes'], terms: ['memory', 'remember'] },
  { stems: ['husker', 'husket', 'recall'], phrases: ['what do you remember', 'do you remember', 'what you remember', 'can you remember', 'huske hvad', 'huske hvem', 'huske hvor', 'huske om', 'huske noget'], terms: ['memory', 'search'] },
  { stems: [], phrases: ['know about me', 'ved du om mig', 'husker du om mig', 'remember about me'], terms: ['memory', 'search'] },
  { stems: ['forget', 'forgot', 'glem*'], terms: ['memory', 'forget'] },
  { stems: [], phrases: ['don’t forget', "don't forget", 'do not forget', 'dont forget', 'never forget', 'glem ikke', 'lad være med at glemme'], terms: ['memory', 'remember'] },
  { stems: ['remind*', 'paaminde*', 'paamindelse*', 'påmind*', 'mind', 'snooze', 'udskyd*'], terms: ['reminders'] },
  { stems: ['calendar*', 'kalender*', '*kalender', 'aftale*', '*aftale', 'appointment*', 'meeting*', 'møde*', 'møder', 'moede*', '*tid', 'tidspunkt*'], terms: ['calendar'] },
  { stems: ['schedule*', 'agenda*', 'skema*', 'dagsorden'], terms: ['calendar', 'agenda'] },
  { stems: [], phrases: ['rename the event', 'rename the meeting', 'omdøb aftalen', 'omdøb mødet', 'change the location', 'add anna to', 'add to the meeting', 'ændre aftalen', 'rediger aftalen', 'opdater aftalen'], terms: ['calendar', 'update'] },
  { stems: [], phrases: ['udskyd aftalen', 'udskyd mødet', 'postpone the meeting', 'reschedule the meeting', 'flyt aftalen', 'flyt mødet'], terms: ['calendar', 'move'] },
  { stems: ['dagens'], terms: ['today'] },
  { stems: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], light: true, terms: ['list', 'events'] },
  { stems: [], phrases: ['hvad har jeg på', 'what do i have on'], terms: ['calendar', 'list', 'events'] },
  { stems: ['tid', 'ledig*', 'free', 'available', 'tilgængelig*'], terms: ['calendar', 'free', 'slots'] },
  { stems: ['næste', 'next'], terms: ['next'] },
  { stems: ['dag', 'idag', 'today'], terms: ['today'] },
  { stems: ['uge', 'ugen', 'uger', 'week*', 'tomorrow', 'morgen', 'imorgen'], light: true, terms: ['list', 'events'] },
  { stems: ['*mail*'], terms: ['mail'] },
  { stems: ['*mail*'], light: true, terms: ['search'] },
  { stems: ['unread', 'ulæst*'], phrases: ['nye mails', 'nye emails', 'new mail', 'new email'], terms: ['mail', 'search'] },
  { stems: ['draft*', 'udkast*', '*udkast', 'kladde*', 'kladder'], terms: ['mail', 'draft'] },
  { stems: [], phrases: ['change my draft', 'edit my draft', 'ret mit udkast', 'rediger udkastet', 'rediger min kladde'], terms: ['mail', 'draft', 'update'] },
  { stems: [], phrases: ['as read', 'som læst', 'tag this mail', 'tag the mail', 'tag this email', 'mærk mailen', 'mærk denne mail'], terms: ['mail', 'label'] },
  { stems: ['svar*', 'reply', 'replying', 'besvar*'], terms: ['reply'] },
  { stems: ['task', 'tasks', '*opgave*', 'grocer*', '*liste', '*listen'], phrases: ['shopping list', 'grocery list'], terms: ['task'] },
  { stems: ['todo*', 'dos', 'huskeliste*', 'checklist*'], phrases: ['to-do', 'to do'], terms: ['task', 'vault', 'search'] },
  { stems: ['due', 'overdue', 'deadline*', 'forfald*'],
    phrases: ['skal jeg have lavet', 'skal jeg lave', 'skal jeg nå', 'have to do', 'need to do', 'on my list', 'på min liste'], terms: ['vault', 'search'] },
  { stems: ['running', 'kører', 'igangværende'], light: true, terms: ['list', 'status'] },
  { stems: ['note', 'notes', 'noter*', '*note', '*noter', 'vault', 'notat*'], terms: ['vault', 'notes'] },
  { stems: ['note', 'notes', 'noter*', '*note', '*noter', 'notat*'], light: true, terms: ['search'] },
  { stems: [], phrases: ['new note', 'a note', 'make a note', 'create a note', 'write a note', 'add a note', 'ny note', 'en note', 'opret en note', 'skriv en note', 'tilføj en note', 'gem en note', 'noten'], terms: ['vault', 'write'] },
  { stems: ['knowledge', 'viden*', 'vidensgraf*'], phrases: ['notes as a graph', 'noter som en graf', 'notes graph', 'noter som graf'], terms: ['knowledge'] },
  { stems: ['idé*', 'ide', 'ideer*', 'idea*', 'inbox', 'indbakke*', 'loose', 'thought*', 'tanke*'], terms: ['inbox'] },
  { stems: ['health*', 'sundhed*'], terms: ['health'] },
  { stems: ['sleep', 'søvn', 'soevn', 'sov', 'sovet', 'sover', 'skridt', 'steps', 'puls*', 'hvilepuls*', 'pulse', 'heart*', 'hjerte*', 'weight', 'vægt', 'blodtryk'], terms: ['health', 'query'] },
  { stems: ['gym', 'lift*', 'løft*', 'bænk*', 'bench', 'benchpress', 'curl', 'curls', 'squat*', 'deadlift*', 'styrketræning*', 'strength', 'rep', 'reps', 'gentagelse*', 'kilos'], terms: ['gym', 'lifts'] },
  { stems: ['workout*', 'træn*', 'train', 'trained', 'training', 'session*', 'løbetur*', 'løb*', 'running', 'ran', 'jog*', 'cardio', 'cykeltur*', 'yoga', 'svømning*'], terms: ['gym', 'sessions'] },
  { stems: [], phrases: ['my run', 'last run', 'min løbetur', 'min sidste løbetur'], terms: ['gym', 'sessions'] },
  { stems: ['recover*', 'recovered', 'restitution*', 'sick', 'syg', 'sygdom*', 'ill'], terms: ['health', 'coach', 'status'] },
  { stems: ['overview', 'oversigt*', 'summary', 'sammendrag'], light: true, terms: ['summary'] },
  { stems: [], phrases: ['step goal', 'step target', 'daily step', 'skridtmål', 'steps target'], terms: ['health', 'coach', 'status'] },
  { stems: ['calorie*', 'kalori*', 'protein*', 'kcal', 'macro*', 'fedt', 'carb*', 'kulhydrat*', 'nutrition*', 'ernæring*', 'kost', 'diet', 'måltid*', 'meal*', 'morgenmad*', 'frokost*', 'aftensmad*', 'breakfast', 'lunch', 'dinner', 'snack*', 'mad', 'food*', 'spis*', 'spist', 'eat*', 'ate'], terms: ['nutrition', 'food'] },
  { stems: ['left', 'remaining', 'tilbage', 'resterende', 'mangler', 'need', 'needed'], light: true, terms: ['suggest'] },
  { stems: ['spist', 'spiste', 'eaten', 'eat', 'ate', 'logged'], light: true, terms: ['history', 'query'] },
  { stems: [], phrases: ['i ate', 'i drank', 'jeg har spist', 'jeg spiste', 'jeg drak', 'for breakfast', 'til morgenmad', 'for lunch', 'til frokost', 'for dinner', 'til aftensmad'], terms: ['nutrition', 'food'] },
  { stems: ['favourite*', 'favorite*', 'favorit*'], phrases: ['saved food', 'saved meal', 'gemt mad', 'gemte måltid'], terms: ['saved', 'food'] },
  { stems: [], phrases: ['saved report', 'saved research', 'saved html', 'gemte research', 'gemt research', 'gemte rapport', 'gemt rapport'], terms: ['workspaces', 'folio'] },
  { stems: ['target*', 'goal*', '*mål', 'mål'], terms: ['targets'] },
  { stems: ['github*', 'git', 'gh', 'repo', 'repos', 'repoet', 'repoer', 'repoerne', 'repositor*'], terms: ['github'], provider: 'gh_' },
  { stems: ['issue*'], terms: ['github', 'issue'], provider: 'gh_' },
  { stems: ['pull', 'pullrequest*', 'pullanmodning*', 'pr', 'prs'], terms: ['github', 'pull'], provider: 'gh_' },
  { stems: ['commit*'], terms: ['github', 'commit'], provider: 'gh_' },
  { stems: ['branch*'], terms: ['github', 'branch'], provider: 'gh_' },
  { stems: ['workflow*', 'arbejdsgang*'], terms: ['github', 'workflow', 'actions'], provider: 'gh_' },
  { stems: ['repo', 'repos', 'repoet', 'repoer', 'repoerne', 'repositor*'], terms: ['repo'] },
  { stems: ['kildekode*', 'kodegennemgang*'], phrases: ['source code', 'code review', 'review the code', 'read the code', 'gennemgå koden', 'læs koden'], terms: ['repo', 'read'] },
  { stems: ['changed', 'changes', 'ændret', 'ændringer'], light: true, terms: ['commits'] },
  { stems: ['pr', 'prs', 'pull', 'pullrequest*', 'pullanmodning*', 'request*'], phrases: ['pull request'], terms: ['pr'] },
  { stems: ['azure*', 'az', 'ressource*', 'resource*', 'subscription*', 'abonnement*', 'container*'],
    terms: ['azure', 'resource'], provider: 'az_' },
  { stems: ['ressourcegrupp*'], phrases: ['resource group'], terms: ['group'], provider: 'az_' },
  { stems: ['workspace*', 'arbejdsområde*', 'arbejdsomraade*', 'folio'], terms: ['workspace', 'workspaces', 'folio'] },
  { stems: ['pin', 'pins', 'pinned', 'pinnede', 'unpin', 'fastgør*', 'fastgjort*', 'fastgjorte'], terms: ['pins'] },
  { stems: ['pin', 'unpin', 'fastgør*'], terms: ['workspaces', 'manage', 'folio'] },
  { stems: ['gendan*', 'restore'], terms: ['restore'] },
  { stems: ['report*', 'rapport*', 'reports', 'rapporter'], light: true, terms: ['workspaces', 'folio'] },
  { stems: ['genåbn*', 'reopen'], phrases: ['bring up'], terms: ['open', 'workspaces', 'folio'] },
  { stems: ['diagram*', 'chart*', 'graf*', 'graph*', 'plot*', 'visualis*', 'figur*'], terms: ['chart'] },
  { stems: ['setting*', 'indstilling*', 'konfigur*', 'config*', 'præference*', 'preference*'], terms: ['settings'] },
  { stems: ['tema*', 'theme', 'farve*', 'colour*', 'color*', 'mørk*', 'dark', 'animation*', 'motion'], terms: ['theme'] },
  { stems: ['væk*', 'away', 'tilstand*', 'presence'],
    phrases: ['leaving the house', 'i am leaving', 'heading out', 'on the move', 'kører bil', 'på farten', 'hjemme igen', 'back home', 'jeg er tilbage'],
    terms: ['presence', 'away', 'mode'] },
  { stems: ['model*', 'modeller', 'reasoning', 'tænkning*'], terms: ['model', 'settings'] },
  { stems: ['personality', 'personlighed*', 'tone', 'tonen'], phrases: ['home city', 'home location', 'hjemby'], terms: ['settings'] },
  { stems: [], phrases: ['where am i', 'my location', 'my current location', 'device location', 'hvor er jeg', 'min placering', 'min position'], terms: ['get_settings'] },
  { stems: ['maps', 'directions', 'rute*', 'kørselsvejledning', 'gangrute', 'eta'], phrases: ['near me', 'nearby', 'the nearest', 'the closest', 'den nærmeste', 'how long to drive', 'when should i leave', 'i nærheden', 'tæt på mig', 'hvornår skal jeg køre'], terms: ['apple_maps'] },
  { stems: ['pc', 'pcen', 'computer*', 'windows', 'laptop'], terms: ['pc'] },
  { stems: ['vindue*', 'window*'], terms: ['window'] },
  { stems: ['clipboard', 'udklipsholder*', 'udklip*'], terms: ['clipboard', 'pc'] },
  { stems: ['chrome'], terms: ['browser', 'pc'] },
  { stems: ['fane', 'faner', 'fanen', 'tab', 'tabs'], terms: ['browser', 'tabs'] },
  { stems: ['klik*', 'click*', 'tryk*'], light: true, terms: ['act', 'click'] },
  { stems: [], phrases: ['.dk', '.com', '.org', '.net', 'http'], terms: ['pc', 'open'] },
  { stems: [], phrases: ['go to', 'gå til', 'søg på google', 'fill in', 'udfyld', 'fill out'], terms: ['browser', 'do'] },
  { stems: [], phrases: ['jeg deler', 'i am sharing', 'i\u2019m sharing', 'shared screen', 'delte skærm', 'siden jeg deler', 'this page', 'denne side'], terms: ['browser', 'shared'] },
  { stems: ['musik*', 'music', 'sang*', 'song*', 'spotify', 'afspil*', 'play*', 'lyd*', 'volume*', 'volumen', 'mute'], terms: ['media', 'pc'] },
  { stems: ['research*', 'undersøg*', 'undersoeg*', 'udforsk*', 'investigat*'], terms: ['research'] },
  { stems: ['web*', 'nettet', 'internet*', 'online'], terms: ['web'] },
  { stems: ['google'], light: true, terms: ['web'] },
  { stems: ['retry'], phrases: ['try again', 'prøv igen', 'prøv research igen'], terms: ['retry', 'job'] },
  { stems: ['usage', 'brugt*', 'forbrug*', 'spend', 'spent', 'spending', 'budget*', 'penge', 'money', 'dkk'], terms: ['usage'] },
  { stems: ['cost*', 'koster', 'koste*', 'pris*', 'udgift*'], terms: ['usage', 'cost'] },
  { stems: ['working', 'virker', 'fungerer', 'status', 'operational'], terms: ['status', 'system'] },
  { stems: ['backend', 'system*', 'server*', 'services', 'tjenester', 'healthy', 'broken', 'ødelagt'],
    phrases: ['something wrong', 'noget galt', 'virker ikke', 'er noget'], terms: ['system', 'status'] },
  { stems: ['fejlede', 'fejl'], phrases: ['why did you fail', 'why did it fail', 'why did that request fail', 'what went wrong', 'hvad gik galt', 'your errors', 'dine fejl', 'backend logs'], terms: ['backend', 'logs'] },
  { stems: [], phrases: ['tidy up', 'ryd op', 'arrange windows', 'close all windows', 'side by side', 'minimise', 'minimize', 'luk alle vinduer', 'ordne vinduer'], terms: ['workspace', 'command'] },
  { stems: [], phrases: ['research going', 'how is the research', 'går det med research', 'research job', 'status of the research'], terms: ['jobs', 'job'] },
  { stems: [], phrases: ['stop research', 'cancel research', 'stop den research', 'afbryd research', 'stop the research'], terms: ['cancel', 'job'] },
  { stems: ['*rutine*', 'routine*', 'recipe*'], terms: ['routines'] },
  { stems: [], phrases: ['what can you do', 'what can you', 'hvad kan du', 'what are you able', 'your capabilities', 'dine funktioner', 'hvilke værktøjer', 'which tools'], terms: ['capabilities'] },
  { stems: ['sprog', 'language'], phrases: ['the voice', 'stemmen', 'turn off voice', 'end voice'], terms: ['workspace', 'command'] },
  { stems: ['job*', 'baggrund*', 'background'], terms: ['jobs'] },
  { stems: ['conversation*', 'samtale*', 'talk*', 'snakke*', 'snakket', 'sagde', 'said', 'chatten'],
    phrases: ['hvad lavede vi', 'what did we', 'last time we', 'sidste gang vi', 'did i say', 'earlier today', 'tidligere i dag'], terms: ['conversation'] },
  { stems: ['billede*', 'image*', 'foto*', 'picture*', 'generate*', 'generer*', 'tegn*'], terms: ['image', 'generation'] },
  { stems: ['overvåg*', 'watch*'], terms: ['watch'] },
  { stems: ['kamera*', 'camera*'], terms: ['watch', 'for'] },
  { stems: [], phrases: ['at the door', 'ved døren', 'hele tiden', 'what you see', 'hvad du ser'], terms: ['watch', 'for'] },
  { stems: [], phrases: ['stoppe med at kigge', 'stop looking', 'stop kigge', 'ikke kigge mere', 'stop watching the camera'], terms: ['stop', 'watching', 'for'] },
  { stems: [], phrases: ['keep me updated', 'keep me posted', 'hold mig opdateret', 'let me know when', 'tell me when', 'sig til når', 'giv mig besked når', 'hold øje med'], terms: ['watch', 'create'] },
  { stems: [], phrases: ['watching for me', 'you watching', 'holder du øje med', 'my watches', 'mine watches'], terms: ['watch', 'list'] },
  { stems: [], phrases: ['hold op med', 'stop following', 'stop watching', 'stop med at følge', 'stop tracking'], terms: ['watch', 'stop'] },
  { stems: ['project*', 'projekt*'], terms: ['projects'] },
  { stems: ['worker*', 'workers', 'arbejder*'], terms: ['task', 'work', 'status'] },
  { stems: [], phrases: ['status på mit arbejde', 'status of my work', 'my work', 'mit arbejde', 'arbejdsstatus', 'work status'], terms: ['work', 'status'] },
  { stems: ['release*', 'deploy*', 'udgivelse*'], terms: ['release', 'deployment'] },
  { stems: ['testflight'], phrases: ['latest release', 'seneste release', 'seneste udgivelse'], terms: ['repo', 'read', 'testflight'] },
  // How Dan asks for his daily-core things, in wording one stem cannot carry. A row with `also` counts only next to its noun, so a
  // verb that edits a note does not drag in the task tools, and "tick off" means a task only when a task is named.
  // Memory
  { stems: [], phrases: ['keep in mind', 'bear in mind', 'husk på', 'tænk på'], terms: ['memory', 'remember'] },
  { stems: [], phrases: ['did i tell you', 'have i told you', 'told you about', 'har jeg fortalt', 'fortalte jeg dig', 'fortalt dig'], terms: ['memory', 'search'] },
  { stems: [], phrases: ['stop remembering', 'stop with remembering', 'hold op med at huske', 'stop med at huske', 'forget my', 'glem min', 'glem mit'], terms: ['memory', 'forget'] },
  // Notes: a verb that adds to or edits the note he named finds vault_write.
  { stems: ['add', 'tilføj*', 'tilfoej*', 'append', 'føj*', 'edit*', 'ret', 'rette*', 'ændr*', 'aendr*', 'rediger*', 'opdater*', 'update*', 'change', 'modify', 'rename*', 'omdøb*', 'title*', 'titel*', 'overskrift*', 'heading*'],
    also: ['note', 'notes', 'noter*', '*note', '*noter', '*noten', 'notat*'], terms: ['vault', 'write'] },
  { stems: [], phrases: ['what did i write', 'what did i note', 'what did i save', 'did i write', 'have i written', 'hvad skrev jeg', 'hvad har jeg skrevet', 'hvad noterede jeg', 'har jeg skrevet'], terms: ['vault', 'search', 'notes'] },
  // Tasks: his own list is the vault's; the Factory's tasks are the worker's. "tick off", "reopen" and "rename" name a vault task.
  { stems: [], phrases: ['my tasks', 'my task list', 'my open tasks', 'open tasks', 'tasks due', 'tasks today', 'mine opgaver', 'min opgaveliste', 'mine åbne opgaver', 'åbne opgaver', 'opgaver i dag', 'opgaver der skal'], terms: ['vault', 'search'] },
  { stems: ['tick', 'afkryds*', 'reopen*', 'genåbn*'], phrases: ['check off', 'cross off', 'sæt kryds', 'kryds af'],
    also: ['task', 'tasks', '*opgave*', 'todo*', 'to-do'], terms: ['vault', 'task', 'complete'] },
  { stems: ['rename*', 'omdøb*', 'reprioritize*', 'prioriter*', 'important', 'vigtig*', 'urgent', 'haster*', 'reschedule*'],
    also: ['task', 'tasks', '*opgave*', 'todo*', 'to-do'], terms: ['vault', 'task', 'edit'] },
  // The Jarvis project: its status, an issue, a worker.
  { stems: [], phrases: ['status of the', 'status on the', 'status for the', 'status på', 'how is the', 'hvordan går det med'], also: ['project*', 'projekt*', 'factory', 'work', 'arbejde*', 'worker*'], terms: ['work', 'status'] },
  { stems: [], phrases: ['open an issue', 'open a new issue', 'file an issue', 'file a bug', 'report a bug', 'report an issue', 'raise an issue', 'log an issue', 'new issue', 'åbn et issue', 'åbn et nyt issue', 'opret et issue', 'lav et issue', 'nyt issue', 'indrapportér', 'indrapporter', 'rapportér en fejl', 'rapporter en fejl', 'meld en fejl'], terms: ['create', 'issue'] },
  { stems: [], phrases: ['start work on', 'begin work on', 'work on issue', 'start on issue', 'pick up issue', 'begynd arbejdet', 'start arbejdet', 'begynd på issue', 'gå i gang med issue', 'kom i gang med issue', 'start issue'], terms: ['start', 'issue'] },
  { stems: [], phrases: ['tell the worker', 'use the other approach', 'sig til worker', 'sig til workeren', 'redirect the worker', 'ret workeren'], terms: ['steer', 'task'] },
  { stems: [], phrases: ['cancel the worker', 'stop the worker', 'annullér worker', 'annuller worker', 'stop workeren', 'afbryd workeren'], terms: ['cancel', 'task'] },
  { stems: ['udrulning*', 'udrul*'], terms: ['release', 'deployment'] },
  { stems: [], phrases: ['pull request summary', 'summary of the pull request', 'pr summary', 'oversigt over pull request', 'pull request-oversigt', 'pr-oversigt', 'linked issues', 'tilknyttede issues'], terms: ['pr', 'get'] },
  { stems: [], phrases: ['open a pull request', 'open a pr', 'create a pull request', 'new pull request', 'åbn en pull request', 'opret en pull request', 'lav en pull request', 'åbn en pr', 'opret en pr'], terms: ['github', 'pull', 'create'], provider: 'gh_' },
  // Workouts and food
  { stems: ['dødløft*', 'knæbøjning*', 'militærpres*'], terms: ['gym', 'lifts'] },
  { stems: ['madbudget*'], terms: ['nutrition', 'suggest'] },
  { stems: [], phrases: ['totals today', 'nutrition totals', 'calories logged', 'calories so far', 'kalorier i dag', 'kalorier hidtil', 'ernæring i dag', 'what have i eaten', 'hvad har jeg spist'], terms: ['nutrition', 'history'] },
  { stems: [], phrases: ['min gemte', 'mine gemte', 'my saved', 'my favourite', 'my favorite'], terms: ['saved', 'food'] },
  // Calendar, in Danish too
  { stems: ['begivenhed*', 'event', 'events'], terms: ['calendar', 'list', 'events'] },
  { stems: ['fri', 'frie'], terms: ['calendar', 'free', 'slots'] },
  { stems: ['planlæg*', 'planlaeg*'], terms: ['calendar', 'create'] },
  { stems: [], phrases: ['plan lunch with', 'plan dinner with', 'plan a lunch', 'plan a dinner', 'plan a meeting', 'plan an appointment', 'plan a call', 'book lunch', 'book dinner', 'book a meeting', 'schedule lunch', 'schedule dinner', 'schedule a meeting'], terms: ['calendar', 'create'] },
  { stems: [], phrases: ['har jeg en', 'har jeg noget', 'do i have', 'am i meeting'], also: ['*aftale*', 'aftale*', 'møde*', '*møde*', 'begivenhed*', 'calendar*', 'kalender*', '*kalender', 'appointment*', 'meeting*'], light: true, terms: ['list', 'events'] },
  { stems: ['change', 'ændr*', 'aendr*', 'omlæg*', 'omlaeg*'], also: ['*aftale*', 'aftale*', '*møde*', 'møde*', 'meeting*', 'appointment*', 'calendar*', 'kalender*'], terms: ['calendar', 'update'] },
  { stems: ['omlæg*', 'omlaeg*', 'ryk*'], also: ['*aftale*', 'aftale*', '*møde*', 'møde*', 'meeting*', 'appointment*'], terms: ['calendar', 'move'] },
  { stems: [], phrases: ['i min indbakke efter', 'indbakke efter', 'search my inbox', 'my inbox for', 'find i min indbakke', 'søg i min indbakke'], terms: ['mail', 'search'] },
  { stems: ['put', 'sæt', 'læg'], also: ['task', 'tasks', '*opgave*', 'todo*', 'to-do', 'huskeliste*'], terms: ['vault', 'task', 'create'] },
  { stems: ['factory'], terms: ['list', 'task', 'work', 'status'] },
  // Looking things up, research jobs, and where a result is shown
  { stems: [], phrases: ['look up', 'latest news', 'news about', 'seneste nyheder', 'nyheder om', 'opening hours', 'åbningstider'], terms: ['web', 'research'] },
  { stems: ['researchjob*'], terms: ['jobs', 'job'] },
  { stems: [], phrases: ['fejlede research', 'failed research', 'prøv den fejlede', 'try the failed', 'annullér research', 'annuller research'], terms: ['retry', 'job'] },
  { stems: [], phrases: ['i chatten', 'in the chat', 'in chat'], terms: ['show', 'chat'] },
  { stems: ['præsenter*', 'present*'], light: true, terms: ['show', 'list', 'read'] },
  { stems: [], phrases: ['open the settings', 'settings page', 'åbn indstillinger', 'siden med indstillinger', 'indstillingssiden', 'on the screen', 'on my screen', 'as a window', 'på skærmen', 'på min skærm', 'som et vindue', 'i et vindue'], terms: ['workspace', 'command'] },
  // Dan's PC and browser
  { stems: ['launch*'], phrases: ['start program', 'start the program', 'start programmet', 'start et program', 'start the app', 'start app', 'åbn programmet', 'åbn appen'], terms: ['pc', 'open'] },
  { stems: [], phrases: ['press a button', 'press the button', 'click a button', 'tryk på en knap', 'tryk på knappen', 'klik på knappen', 'in the program', 'i programmet'], terms: ['pc', 'act'] },
  { stems: [], phrases: ['do something in', 'gør noget i', 'use the browser', 'use chrome', 'brug browseren', 'brug chrome', 'in the browser', 'i browseren'], terms: ['browser', 'do'] },
  // Watches
  { stems: [], phrases: ['keeping an eye on', 'keep an eye on', 'what am i watching', 'what are you watching', 'what are you monitoring', 'hvad overvåger du', 'hvad holder du øje med'], terms: ['watch', 'list'] },
  { stems: [], phrases: ['less often', 'more often', 'sjældnere', 'oftere', 'change how often', 'skift hvor ofte'], also: ['watch*', 'overvåg*', 'price', 'prisen', 'pris*', 'camera*', 'kamera*'], terms: ['watch', 'update'] },
  { stems: [], phrases: ['afslut overvågning', 'stop overvågning', 'end the watch', 'stop the watch'], terms: ['watch', 'stop'] },
  { stems: ['monitor*'], phrases: ['følg med'], terms: ['watch', 'create'] },
  // Settings, presence, loose ends, proactive findings
  { stems: ['*model*'], terms: ['model', 'settings'] },
  { stems: ['skift*', 'switch'], light: true, terms: ['update', 'set'] },
  { stems: ['fravær*', 'fraevaer*'], phrases: ['back at my desk', 'at my desk', 'i am back', 'away mode'], terms: ['presence', 'away', 'mode'] },
  { stems: [], phrases: ['løse ender', 'løse tanker', 'loose ends'], terms: ['inbox', 'capture'] },
  { stems: ['proactive*', 'proaktiv*', 'finding*', 'fund', 'observation*'], terms: ['proactive'] },
  { stems: [], phrases: ['not useful', 'ikke nyttig', 'was wrong', 'var forkert', 'not helpful', 'ikke hjælpsom'], also: ['finding*', 'fund', 'observation*', 'proactive*', 'proaktiv*', 'suggestion*', 'forslag*', 'item*'], terms: ['proactive', 'item', 'feedback'] },
  { stems: [], phrases: ['var nyttig', 'var forkert', 'til ingen nytte'], also: ['besked*', 'notifikation*', 'advarsel*'], terms: ['proactive', 'message', 'feedback'] },
  // Verbs: what is asked of it.
  { stems: ['søg*', 'soeg*', 'find*', 'finde', 'look', 'lookup', 'tjek*', 'check*'], light: true, terms: ['search'] },
  { stems: ['opret*', 'tilføj*', 'tilfoej*', 'add', 'create*', 'ny', 'nyt', 'new', 'make', 'lav', 'lave'], light: true, terms: ['create'] },
  { stems: ['arkiv*', 'archive*'], light: true, terms: ['archive'] },
  { stems: ['slet*', 'fjern*', 'delete*', 'remove*'], light: true, terms: ['delete'] },
  { stems: ['gem*', 'save*', 'skriv*', 'write'], light: true, terms: ['write'] },
  { stems: ['ret', 'rette*', 'ændr*', 'aendr*', 'rediger*', 'opdater*', 'update*', 'edit*', 'modify'], light: true, terms: ['edit', 'update'] },
  { stems: ['titel*', 'title*', 'overskrift*', 'heading*', 'omdøb*', 'rename*'], light: true, terms: ['write', 'title'] },
  { stems: ['afslut*', 'færdig*', 'done', 'complete*', 'finish*', 'udført', 'marker*', 'mark'], light: true, terms: ['complete'] },
  { stems: ['flyt*', 'move', 'moving', 'postpone', 'reschedule'], light: true, terms: ['move', 'edit'] },
  { stems: ['læs*', 'laes*', 'read'], light: true, terms: ['read'] },
  { stems: ['åbn*', 'aabn*', 'open', 'åbne', 'åben'], light: true, terms: ['open', 'read'] },
  { stems: ['luk*', 'close', 'quit'], light: true, terms: ['close'] },
  { stems: ['vis*', 'show', 'display', 'fremvis*'], light: true, terms: ['show', 'list', 'read'] },
  { stems: ['liste*', 'list', 'oversigt*', 'overview', 'hvilke'], light: true, terms: ['list'] },
  { stems: ['start*', 'begynd*', 'påbegynd*'], light: true, terms: ['start'] },
  { stems: ['pause*'], light: true, terms: ['pause'] },
  { stems: ['stop*', 'afbryd*', 'cancel*', 'annuller*', 'aflys*'], light: true, terms: ['cancel', 'stop', 'delete'] },
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
  const holds = (stems: readonly string[]) => stems.some((stem) => found.some((token) => stemMatches(token, stem)));
  return intentAliases.filter((alias) => (holds(alias.stems) || (alias.phrases ?? []).some((phrase) => whole.includes(normalizePhrase(phrase))))
    && (alias.also === undefined || holds(alias.also)));
};

/** A request for repository contents that the local reader can answer while GitHub starts. */
export function asksToReadRepositoryFile(query: string): boolean {
  if (/(?:^|[^a-z0-9])gh_/iu.test(query)) return false;
  const words = tokensOf(query);
  return /(?:^|[^a-z0-9])repo_read(?:$|[^a-z0-9])/iu.test(query) ||
    (words.some(word => ['read', 'show', 'inspect', 'review', 'læs', 'vis', 'gennemgå'].includes(word)) &&
     words.some(word => ['file', 'files', 'code', 'contents', 'fil', 'filen', 'filer', 'kode', 'koden', 'kildekode', 'kildekoden'].includes(word)));
}

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
  if (result.length > 5) result = result.replace(/(?:ing|ed|es)$/u, '');
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

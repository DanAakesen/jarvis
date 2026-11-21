/**
 * What Dan actually says, in English and Danish, and the tool that must come back in the top 3 of the FIRST `find_tools` search.
 * A row passes when any tool in `tools` is in the top 3 (several tools can serve one request). Add rows for every new main
 * intent; a tool that no row names is found through a query derived from its own description (see tool-conformance.test.ts).
 */
export interface PhraseRow {
  readonly intent: string;
  readonly en: string;
  readonly da: string;
  readonly tools: readonly string[];
}

export const phraseTable: readonly PhraseRow[] = [
  // Weather
  { intent: 'weather', en: 'what is the weather in Aarhus tomorrow', da: 'hvordan er vejret i Aarhus i morgen', tools: ['weather'] },
  { intent: 'weather', en: 'will it rain this weekend', da: 'bliver det regnvejr i weekenden', tools: ['weather'] },
  // Memory
  { intent: 'remember', en: 'remember that I prefer my coffee black', da: 'husk at jeg helst vil have sort kaffe', tools: ['memory_remember'] },
  { intent: 'remember', en: 'do not forget that my sister’s birthday is on 3 March', da: 'glem ikke at min søsters fødselsdag er den 3. marts', tools: ['memory_remember'] },
  { intent: 'memory search', en: 'what do you remember about my sister', da: 'hvad husker du om min søster', tools: ['memory_search'] },
  { intent: 'memory search', en: 'search my memory for the bike', da: 'søg i min hukommelse efter cyklen', tools: ['memory_search'] },
  { intent: 'forget', en: 'forget that I like my coffee black', da: 'glem at jeg helst vil have sort kaffe', tools: ['memory_forget'] },
  // Reminders
  { intent: 'reminder', en: 'remind me in 20 minutes to call mum', da: 'påmind mig om 20 minutter om at ringe til mor', tools: ['owner_reminders'] },
  { intent: 'reminder', en: 'set a reminder for tomorrow at 9', da: 'sæt en påmindelse til i morgen klokken 9', tools: ['owner_reminders'] },
  { intent: 'reminder', en: 'snooze the reminder for an hour', da: 'udskyd påmindelsen en time', tools: ['owner_reminders'] },
  // Calendar
  { intent: 'calendar', en: 'what is on my calendar today', da: 'hvad er der i min kalender i dag', tools: ['calendar_today_agenda', 'calendar_list_events'] },
  { intent: 'calendar', en: 'when is my next meeting', da: 'hvornår er mit næste møde', tools: ['calendar_next_event'] },
  { intent: 'calendar', en: 'add a meeting with Anna tomorrow at 10 to my calendar', da: 'opret en aftale med Anna i morgen klokken 10', tools: ['calendar_create_event'] },
  { intent: 'calendar', en: 'when am I free on Friday', da: 'hvornår har jeg tid på fredag', tools: ['calendar_find_free_slots'] },
  { intent: 'calendar', en: 'move my dentist appointment to Monday', da: 'flyt min tandlægetid til mandag', tools: ['calendar_move_event', 'calendar_update_event'] },
  { intent: 'calendar', en: 'what is on my calendar next week', da: 'hvad har jeg i kalenderen i næste uge', tools: ['calendar_list_events'] },
  // Mail
  { intent: 'mail', en: 'check my email', da: 'tjek min mail', tools: ['mail_search'] },
  { intent: 'mail', en: 'find the email from Anna about the invoice', da: 'find mailen fra Anna om fakturaen', tools: ['mail_search'] },
  { intent: 'mail', en: 'reply to the email from Anna', da: 'svar på mailen fra Anna', tools: ['mail_draft_reply'] },
  { intent: 'mail', en: 'send an email to Anna', da: 'send en mail til Anna', tools: ['mail_send'] },
  { intent: 'mail', en: 'show my email drafts', da: 'vis mine mailudkast', tools: ['mail_list_drafts'] },
  // Tasks
  { intent: 'tasks', en: 'add a task to buy milk', da: 'tilføj en opgave om at købe mælk', tools: ['vault_task_create'] },
  { intent: 'tasks', en: 'mark the milk task as done', da: 'marker mælk-opgaven som færdig', tools: ['vault_task_complete'] },
  { intent: 'tasks', en: 'move the milk task to Friday', da: 'flyt mælk-opgaven til fredag', tools: ['vault_task_edit'] },
  { intent: 'tasks', en: 'what tasks are due today', da: 'hvilke opgaver skal jeg have lavet i dag', tools: ['vault_search'] },
  { intent: 'tasks', en: 'show my open to-dos', da: 'vis mine åbne to-dos', tools: ['vault_search'] },
  // Notes
  { intent: 'notes', en: 'save a note about the garden plan', da: 'gem en note om havplanen', tools: ['vault_write'] },
  { intent: 'notes', en: 'find my note about the garden', da: 'find min note om haven', tools: ['vault_search'] },
  { intent: 'notes', en: 'read my garden plan note', da: 'læs min note om havplanen', tools: ['vault_read', 'vault_search'] },
  { intent: 'notes', en: 'change the title of my garden note', da: 'ret titlen på min havenote', tools: ['vault_write', 'vault_read'] },
  { intent: 'notes', en: 'show my notes as a graph', da: 'vis mine noter som en graf', tools: ['show_knowledge'] },
  { intent: 'notes', en: 'delete my old shopping note', da: 'slet min gamle indkøbsnote', tools: ['vault_delete'] },
  { intent: 'inbox', en: 'save this idea for later', da: 'gem den idé til senere', tools: ['inbox_capture'] },
  { intent: 'inbox', en: 'what is in my inbox', da: 'hvad ligger der i min indbakke af ideer', tools: ['inbox_items'] },
  // Health
  { intent: 'health', en: 'how did I sleep last night', da: 'hvordan sov jeg i nat', tools: ['health_query'] },
  { intent: 'health', en: 'how many steps did I take today', da: 'hvor mange skridt har jeg gået i dag', tools: ['health_query'] },
  { intent: 'health', en: 'what is my resting heart rate', da: 'hvad er min hvilepuls', tools: ['health_query'] },
  { intent: 'health', en: 'show me a chart of my sleep', da: 'vis mig et diagram over min søvn', tools: ['health_show', 'show_in_chat', 'workspace_command', 'create_html_view'] },
  // Workouts
  { intent: 'workouts', en: 'log a bench press of 80 kg for 5 reps', da: 'log en bænkpres på 80 kg i 5 gentagelser', tools: ['gym_lifts'] },
  { intent: 'workouts', en: 'log a 45 minute running workout', da: 'log en løbetur på 45 minutter', tools: ['gym_sessions'] },
  { intent: 'workouts', en: 'what did I lift last week', da: 'hvad løftede jeg i sidste uge', tools: ['gym_lifts', 'health_query'] },
  { intent: 'workouts', en: 'how many workouts did I do this month', da: 'hvor mange træninger har jeg lavet denne måned', tools: ['gym_sessions', 'health_query'] },
  // Nutrition
  { intent: 'nutrition', en: 'log two eggs and toast for breakfast', da: 'log to æg og toast til morgenmad', tools: ['health_food', 'health_food_review'] },
  { intent: 'nutrition', en: 'how many calories have I logged today', da: 'hvor mange kalorier har jeg spist i dag', tools: ['health_query', 'health_nutrition_suggest'] },
  { intent: 'nutrition', en: 'how many calories do I have left today', da: 'hvor mange kalorier har jeg tilbage i dag', tools: ['health_nutrition_suggest', 'health_query'] },
  { intent: 'nutrition', en: 'how much protein do I still need today', da: 'hvor meget protein mangler jeg i dag', tools: ['health_nutrition_suggest', 'health_nutrition_targets', 'health_query'] },
  { intent: 'nutrition', en: 'save this as a favourite meal', da: 'gem det som et favoritmåltid', tools: ['health_saved_food'] },
  { intent: 'nutrition', en: 'how many calories are in a banana', da: 'hvor mange kalorier er der i en banan', tools: ['health_food_review', 'health_food'] },
  { intent: 'nutrition', en: 'set my protein target to 160 grams', da: 'sæt mit proteinmål til 160 gram', tools: ['health_nutrition_targets'] },
  // GitHub and Azure (remote bridges)
  { intent: 'github', en: 'list my open pull requests on github', da: 'vis mine åbne pull requests på github', tools: ['gh_list_pull_requests', 'gh_search_pull_requests'] },
  { intent: 'github', en: 'show issue 12 on github', da: 'vis issue 12 på github', tools: ['gh_issue_read', 'github_read'] },
  { intent: 'github', en: 'search github issues about the login bug', da: 'søg i github issues efter login-fejlen', tools: ['gh_search_issues', 'gh_list_issues'] },
  { intent: 'azure', en: 'list my azure resource groups', da: 'vis mine azure ressourcegrupper', tools: ['az_group_list'] },
  { intent: 'azure', en: 'what resources are running in azure', da: 'hvilke ressourcer kører der i azure', tools: ['az_group_resource_list', 'az_group_list', 'az_containerapps_list'] },
  // Research
  { intent: 'research', en: 'research the best noise cancelling headphones', da: 'undersøg de bedste støjreducerende hovedtelefoner', tools: ['research', 'web_research'] },
  { intent: 'research', en: 'search the web for the library opening hours', da: 'søg på nettet efter bibliotekets åbningstider', tools: ['web_research', 'research'] },
  // Factory
  { intent: 'factory', en: 'create an issue for the login bug in jarvis', da: 'opret et issue om login-fejlen i jarvis', tools: ['create_issue'] },
  { intent: 'factory', en: 'start work on issue 12', da: 'start arbejdet på issue 12', tools: ['start_issue'] },
  { intent: 'factory', en: 'create a coding task to update the docs', da: 'opret en kodeopgave til at opdatere dokumentationen', tools: ['create_task', 'create_issue'] },
  { intent: 'factory', en: 'what is the status of my work', da: 'hvad er status på mit arbejde', tools: ['get_work_status', 'list_tasks'] },
  { intent: 'factory', en: 'which tasks are running', da: 'hvilke opgaver kører lige nu', tools: ['list_tasks', 'get_work_status'] },
  { intent: 'factory', en: 'how is the worker doing on task 5', da: 'hvordan går det med worker på task 5', tools: ['get_task', 'get_work_status'] },
  { intent: 'factory', en: 'pause task 5', da: 'sæt task 5 på pause', tools: ['pause_task'] },
  { intent: 'factory', en: 'list my projects', da: 'vis mine projekter', tools: ['list_projects'] },
  { intent: 'factory', en: 'show me the pull request of the worker on task 5', da: 'vis mig pull requesten fra worker på task 5', tools: ['pr_get', 'get_work_status', 'get_task', 'github_read'] },
  // Workspace and visuals
  { intent: 'workspace', en: 'show me a chart of my spending', da: 'vis mig et diagram over mit forbrug', tools: ['show_in_chat', 'workspace_command', 'create_html_view'] },
  { intent: 'workspace', en: 'open the workspace', da: 'åbn arbejdsområdet', tools: ['workspace_command', 'workspaces_open'] },
  { intent: 'workspace', en: 'go to the settings page', da: 'gå til indstillinger', tools: ['workspace_command', 'get_settings'] },
  { intent: 'workspace', en: 'find my saved research report', da: 'find min gemte research rapport', tools: ['workspaces_search', 'folio_search'] },
  { intent: 'workspace', en: 'make an interactive html page', da: 'lav en interaktiv html side', tools: ['create_html_view'] },
  { intent: 'workspace', en: 'generate an image of a red bicycle', da: 'lav et billede af en rød cykel', tools: ['image_generation'] },
  // PC
  { intent: 'pc', en: 'open Spotify on my PC', da: 'åbn Spotify på min pc', tools: ['pc_open'] },
  { intent: 'pc', en: 'pause the music on my computer', da: 'sæt musikken på pause på min computer', tools: ['pc_media'] },
  { intent: 'pc', en: 'close Spotify on my computer', da: 'luk Spotify på min computer', tools: ['pc_close'] },
  { intent: 'pc', en: 'what is the active window on my pc', da: 'hvad er det aktive vindue på min pc', tools: ['pc_active_window'] },
  { intent: 'pc', en: 'open google.com in Chrome on my pc', da: 'åbn google.com i Chrome på min pc', tools: ['pc_open', 'browser_do'] },
  // Settings and system
  { intent: 'settings', en: 'switch to away mode', da: 'skift til væk-tilstand', tools: ['set_presence_mode', 'set_away_mode'] },
  { intent: 'settings', en: 'change my settings', da: 'ændr mine indstillinger', tools: ['update_settings', 'get_settings'] },
  { intent: 'settings', en: 'which model are you using', da: 'hvilken model bruger du', tools: ['get_settings'] },
  { intent: 'settings', en: 'change the theme to dark', da: 'skift tema til mørkt', tools: ['set_theme'] },
  { intent: 'system', en: 'how much have I spent on you this month', da: 'hvor meget har jeg brugt denne måned', tools: ['get_usage'] },
  { intent: 'system', en: 'is everything working', da: 'virker alt', tools: ['get_status_summary', 'get_system_health'] },
  { intent: 'system', en: 'what jobs are running in the background', da: 'hvilke jobs kører i baggrunden', tools: ['list_jobs'] },
  { intent: 'conversation', en: 'what did we talk about yesterday', da: 'hvad snakkede vi om i går', tools: ['conversation_search'] },
  { intent: 'vision', en: 'watch my camera and tell me when a package arrives', da: 'hold øje med kameraet og sig til når en pakke kommer', tools: ['watch_for'] },
];

/**
 * The daily-core scenarios Dan named. Each phrase must find the tool on the FIRST search (top 3) and the call must finish in
 * the same turn, with no confirmation step. The calls themselves live with the stubs of each group (`ConformanceGroup.scenarios`);
 * this table pins which tool each spoken step is about, so a stub author cannot weaken the contract.
 */
export const goldenIntents: readonly { readonly scenario: string; readonly step: string; readonly tool: string }[] = [
  { scenario: 'jarvis-project', step: 'status of my work', tool: 'get_work_status' },
  { scenario: 'jarvis-project', step: 'create an issue', tool: 'create_issue' },
  { scenario: 'jarvis-project', step: 'start work on an issue', tool: 'start_issue' },
  { scenario: 'jarvis-project', step: 'follow a worker', tool: 'get_task' },
  { scenario: 'notes', step: 'save a note', tool: 'vault_write' },
  { scenario: 'notes', step: 'find a note', tool: 'vault_search' },
  { scenario: 'notes', step: 'read a note', tool: 'vault_read' },
  { scenario: 'notes', step: 'edit the title', tool: 'vault_write' },
  { scenario: 'tasks', step: 'create a task', tool: 'vault_task_create' },
  { scenario: 'tasks', step: 'complete a task', tool: 'vault_task_complete' },
  { scenario: 'tasks', step: 'edit a task', tool: 'vault_task_edit' },
  { scenario: 'tasks', step: 'what is due today', tool: 'vault_search' },
  { scenario: 'tasks', step: 'a reminder', tool: 'owner_reminders' },
  { scenario: 'workouts', step: 'log a lift', tool: 'gym_lifts' },
  { scenario: 'workouts', step: 'log a session', tool: 'gym_sessions' },
  { scenario: 'workouts', step: 'what did I lift last week', tool: 'gym_lifts' },
  { scenario: 'nutrition', step: 'log food', tool: 'health_food' },
  { scenario: 'nutrition', step: 'calories logged and left', tool: 'health_nutrition_suggest' },
  { scenario: 'nutrition', step: 'protein still needed', tool: 'health_nutrition_suggest' },
];

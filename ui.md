# Jarvis UI discussion

Started: 4 October 2026.

This file records the UI discussion with Dan. Keep it updated as the discussion
continues. Distinguish Dan's confirmed direction from proposals, examples and
open questions. These notes describe a design under discussion; they do not
claim that the proposed behaviour is implemented.

## Confirmed direction

- Copilot is handling the current issues and PRs. This discussion focuses on
  the Jarvis user experience.
- Capture the UI discussion in this new file, `ui.md`.
- Dan initially requested local notes. On 4 October 2026 he explicitly
  authorized publishing all notes and wireframes in a PR and creating two
  Copilot planning issues: UI implementation breakdown and enabling-logic breakdown.
- Jarvis has a default app shell.
- Jarvis can arrange the interface within that shell according to the current
  work. Dan described this as a shell that Jarvis can "do what it want with".
- Jarvis can place content on the left, right, top or bottom of the screen.
  Its freedom to compose the screen is central to the concept.
- Jarvis can create new views and controls on demand, including UI components
  made for the current request. The exact set of views and controls is not yet
  defined.
- Research results can be presented through a component that shows the returned
  data visually. Spoken and written summaries can be followed by a visual view
  when Dan asks for one.
- Generated views and UI components are temporary and are not saved. This
  decision concerns the generated interface; retention of underlying research
  data or conversation history has not been decided in this discussion.
- Any data Jarvis can access should be available for Dan to see through the UI.
  Dan emphasised the large volume and variety of that data. The UI concept
  must accommodate different kinds of content and combinations of content.
- Dan agreed that the current question should determine the presentation, with
  familiar interaction conventions across generated views.
- In typing mode, the text input stays at the bottom of the screen, horizontally
  centred, while Jarvis rearranges other content. It is hidden during voice
  mode and reappears when Dan exits voice.
- Dan imagines a large orb in the middle of the screen, with an alive,
  communicating presence inspired by Jarvis in the Iron Man films. This is an
  emerging visual direction; its appearance and behaviour are not final.
- Jarvis is always on and available. Typing is the default interaction.
- "Starting Jarvis" means Dan explicitly starts a voice session, opening the
  fuller experience with the living orb. Jarvis must not listen or enter voice
  mode automatically. Its always-on availability does not mean an always-on
  microphone.
- Dan initially described a tiling-window-manager arrangement: opening a new
  view rearranges existing views to make room rather than closing or replacing
  them. This includes the orb as part of the composition.
- In that arrangement, when the orb is centred and Dan opens the first view, the orb moves aside.
  Dan's example places it on the left and the new view on the right. Opening
  another view can split the workspace into three areas. As more views open,
  the layout also splits into rows and uses the vertical space.
- Views stay open within the active workspace as other views are added. This
  does not change the earlier decision that generated views are not saved.
- Dan then expanded the idea: views can also overlap in layers, with content
  brought to the front or pushed to the back on request. The desired experience
  is dynamic; a tiled arrangement alone does not fully describe it. The default
  arrangement and how tiling and overlapping relate remain open.
- Dan can move and resize views himself, as well as asking Jarvis to do so.
- Jarvis decides how to arrange the workspace, including whether views are
  tiled or overlapping. Dan can override that decision by telling Jarvis to
  arrange things differently.
- Jarvis can bring up useful visuals on its own during the conversation; it
  does not need to wait for Dan to request a visual explicitly.
- Dan's presentation preference is visuals first, voice second, text third.
  He prefers visual explanations over large amounts of text.
- Dan clarified that this presentation priority can be added to Jarvis's
  instructions later. It is a behaviour preference, not a requirement to settle
  now as part of the UI layout. The UI should support all three forms.
- On a phone, show one main view at a time. During an active voice session, when
  a content view comes forward, the voice/orb presentation docks at the bottom
  and the content takes the main space. When no content views remain, the orb
  returns to the main space. Docking changes the presentation, not whether the
  voice session is active. The exact dock appearance remains open.
- On the phone, Dan can switch between open views by swiping or by telling
  Jarvis which view to show.
- For the orb, Dan leans between calm/fluid and energetic/mechanical. The main
  requirement is that it feels alive and visibly changes state according to
  Jarvis's activity, including listening, speaking, thinking and calling tools.
  The orb's behaviour is driven by Jarvis's actual runtime state; this is the
  agreed way to communicate its activity in the voice experience. Exact motion,
  visual treatment and the complete set of states can be designed later.
- During voice sessions, message history is hidden by default. Dan can ask
  Jarvis to bring it up like other content.
- In typing mode without voice, the conversation appears automatically so Dan
  can see Jarvis's responses.
- On the phone, typing mode does not show the large central orb. Dan clarified
  that a small orb can appear inside the chat-input component, maintaining
  Jarvis's visual identity and serving as the button to start voice mode.
  Pressing it starts the voice session and opens the fuller orb experience.
  The inactive orb's presentation elsewhere on desktop remains open.
- Dan ends voice mode by speaking naturally, such as saying goodbye or asking
  Jarvis to end the session. Tapping the orb is not his chosen way to end voice;
  the small input orb is the entry point for starting it.
- Dan also wants a manual way to end voice. He suggested the Escape key as a
  possible desktop shortcut and some kind of button, whose form and placement
  are not yet decided. Escape is a candidate, not a final keyboard rule.
- Ending voice leaves the open content views on screen so Dan can continue
  through typing. Stopping voice does not close or save those views.
- Support both light and dark appearance through a theme system.
- Jarvis can supply or change theme variables on demand. Theme customisation
  is dynamic, rather than limited to a fixed list of presets.
- Dan's concrete example: while in dark mode, ask Jarvis to change the primary
  colour from green to red. Jarvis updates that variable immediately without
  leaving dark mode. These colours illustrate an edit, not a chosen default
  palette.
- Preset themes may also be available. Dan mentioned five themes in other apps
  as an example; five presets is not an agreed requirement for Jarvis.
- Theme state persists across visits. The latest values remain in effect until
  Jarvis changes them again. This does not change the rule that generated
  content views are not saved. Whether Jarvis changes themes without a request
  has not been decided.
- Dan wants one default application shell and layout for use outside voice mode.
  Decide that layout together, step by step, before designing the voice mode.
- Starting voice should transform the whole experience. Dan described wanting
  "everything to change" on entering voice. What changes, and how the transition
  works, remain to be designed after the default layout.
- The default shell is inspired by the ChatGPT layout Dan described. This
  reference has not been visually inspected in this discussion.
- Default shell structure:
  - A narrow icon rail on the far left.
  - A separate left sidebar that opens when an icon in the rail is pressed.
    It can also be closed.
  - A thin top bar for contextual information and compact controls, including
    "Share my screen" and Camera as icons or pills. Exact styling and other contents are
    undecided.
  - A very thin bottom bar; its contents and relationship to the previously
    discussed chat-input component are undecided.
  - A right panel that can be opened and closed.
  - Small panel-toggle icons in the upper corners for opening/closing the left
    and right side panels. Their precise placement and appearance remain open.
  - Main content in the middle.
- Rail icons select the main application areas. Each area's navigation opens
  in the left sidebar; Dan confirmed this role split.
- The shared shell will also include Dan's Banking application and Fitness and
  Health application alongside Jarvis and Software Factory. Jarvis needs access
  to the data across these areas. Their detailed UI and integrations are to be
  designed later; this discussion does not start that implementation work.
- Dan reconfirmed that the rail, sidebars, bars and central content define the
  default typing experience. The discussion now moves to how entering voice
  transforms that layout; the remaining panel-content details can wait.
- Entering voice fades the default app shell out of sight. A voice-mode
  background takes over the whole page and the orb comes forward. When no
  content views are open, the large orb occupies the middle. The navigation
  rail, sidebars and default shell are no longer visible.
- Content views already open in typing mode carry into the voice workspace.
  Layout logic keeps the orb and those windows within the screen, arranging
  them together instead of starting with an empty workspace. Windows may stack
  behind each other; they do not all need to be in the foreground. Changing
  modes does not close or save these temporary views. The phone still uses one
  foreground content view with the active orb docked, as described above.
- On desktop in voice mode, the orb stays centred when there are no content
  windows. When windows are present, the orb moves to the left and the windows
  occupy the right, where they may overlap or stack. This refines the earlier
  general proposal that the orb could move aside anywhere on desktop; the
  phone's bottom dock remains unchanged.
- Returning from voice to typing restores the previous default-shell layout.
  Open views remain available, including those brought up during voice, and
  the text input returns. Restoration does not save the temporary content views.
- In voice mode, minimised windows have a small visible tab strip. Dan can
  restore a window by clicking its tab or asking Jarvis. This belongs to the
  voice workspace and does not bring back the hidden default app shell; its
  precise position and styling remain to be designed.
- Add a Settings toggle for "Minimise all windows when starting voice."
  With this enabled, entering voice minimises existing windows into their tabs
  and starts with just the centred orb. Jarvis can bring windows forward during
  the conversation; minimising never closes or saves their content. On returning
  to typing, the shell reappears with the session's windows docked as tabs,
  rather than automatically reopening their earlier arrangement. This is the
  exception to the restoration behaviour above. With the toggle off,
  the previously agreed behaviour carries open windows into voice and restores
  the prior shell layout on exit. Dan agreed to this option and confirmed that
  the toggle is off by default.
- On opening Jarvis in typing mode, show the conversation in the centre, ready
  to type, with the other application areas accessible from the left rail. Dan
  confirmed this opening-screen direction.
- Voice mode opens immediately. Animation can accompany the transition, but
  there should be no wait for an animation to finish before entering the mode.
- In typing mode, Jarvis can open the right panel to show relevant information
  or an answer while preserving the main content. It is not limited to urgent
  notifications or details of a selected item.
- Jarvis can toggle the right panel itself, opening or closing it and changing
  what it shows as relevant to the conversation. Dan can also operate it directly.
  The trigger is relevance, not only importance.
- Dan selected displayed wireframe option 3 (Visual Workspace) as the direction
  to refine. Make its left icon rail thinner and put Settings in the top-right
  corner. What belongs at the bottom of the rail remains undecided.
- Add top-tab support inside the main workspace/window, distinct from the app's
  global top bar. Dan should be able to say "minimise window X" for an open view.
  Minimising hides that view without closing or saving it; its tab remains
  available to bring it back within the active workspace.
- The full-page voice experience is the workspace for the dynamic views already
  discussed. Dan can bring up whatever accessible content he wants on demand,
  and Jarvis can bring up helpful views itself. The orb moves aside or docks as
  those views appear, according to the desktop/phone behaviours recorded above.

## Starting point discussed

The existing design brief describes a conversation-first main page, with
current activity and detailed area views. Its final visual direction remains
open. The feature inventory in `docs/features.md` is a source for the content
and actions the interface needs to support.

The assistant proposed a conversation with Jarvis that brings relevant work
into view: Dan gives direction, agents work, Jarvis reports changes, and Dan
steps in when needed. Dan's clarification adds a default shell whose layout
Jarvis can compose dynamically.

## Proposals to explore

These ideas have been discussed but are not individually approved:

- Directing work: conversation, current work and decisions needing Dan.
- Working together: a preview, document, shared screen or task board appears
  alongside the conversation when useful.
- Being away: a phone experience with short updates, voice and approval actions.
- Decide what stays visible and what appears when relevant before choosing
  colours or detailed visual layouts.
- Voice supports quick direction; the screen provides concrete work Dan can
  inspect, correct and act on.
- A generated research view could support follow-up requests such as comparing
  options, filtering the results or changing the presentation. Whether such
  controls are required, and how they work, remains to be discussed.
- Select the presentation from the data and Dan's current question. Examples
  include tables or charts for measurements, timelines for events, comparison
  views for research, document or code viewers for text, and image or media
  viewers for visual/audio material. These examples describe presentation
  possibilities, not newly authorised integrations.
- Combine different representations in one workspace when a question needs
  several kinds of evidence. Support both a useful summary and inspection of
  the underlying detail for large datasets.
- Keep interaction conventions consistent across generated views so Dan can
  recognise how to inspect, filter, expand or dismiss content. Controls that
  perform actions should correspond to capabilities Jarvis actually has.
- The assistant initially proposed a compact left navigation sidebar, main
  workspace and bottom-centred input. Dan refined that into the rail plus
  expandable sidebar and other shell regions recorded above. Phone navigation
  would need a separate arrangement.
- The assistant initially suggested a details panel, then an activity/attention
  panel with a switch to selected-item details. Dan clarified that Jarvis can
  use the right panel more generally to show relevant information in typing
  mode while preserving the main content. A fixed default activity view has
  not been confirmed.
- Dan confirmed Camera alongside screen sharing in the top bar. An active
  sharing control could show "Sharing screen" and provide
  a direct way to stop; the detailed active state remains to be discussed.

## Dan's research scenario

1. Dan asks Jarvis to research a subject.
2. Jarvis researches it and brings back the data.
3. Jarvis may first say, "The research shows A, B, C."
4. Dan says, "Okay, show me in a visual way."
5. Jarvis creates a component to show that research data and displays it within
   the app shell.

This is a confirmed use case for the UI concept. The component type, layout and
controls depend on the subject and remain undefined. The scenario establishes
that the response can become a visual component after the initial conversation.

## Illustrative experience

The assistant used "Build a small app for tracking my workouts" as an example:
Jarvis discusses the idea, shows a project brief, surfaces task and agent
progress, then brings forward a preview and decisions. This is an illustration
of the proposed experience, not an agreed layout or implemented workflow.

With the dynamic-shell direction, an example could place conversation on the
left and an app preview on the right, then bring a task board or document into
the main workspace when the subject changes. Exact arrangements remain open.

## Feature placement proposals

Reviewed against the current `docs/features.md` on 4 October 2026. These are
placement recommendations for all 61 inventory rows, not new implementation
work or claims that planned features are available. Confirmed choices are in
the direction section above; additional placements below remain proposals.
Banking and Fitness and Health are future areas
already recorded above; their detailed design remains deferred.

### Top bar recommendation

- Current area/page context.
- Screen sharing and Camera (confirmed).
- Danish/English language selector.
- Present/away control.
- Attention/notifications entry opening current activity and decisions.
- A compact More menu for model/reasoning, light/dark appearance and sleep/wake.

Keep detailed settings and task-specific actions in their own views. Connection,
reconnection and database-waking status can use the very thin bottom bar instead
of adding more permanent top-bar controls. The right panel's use for activity
and selected-item detail remains a proposal for specific content; its broader
role as a Jarvis-controlled contextual panel is confirmed. These shell controls are
not automatically assumed visible in voice mode, where the shell disappears;
voice-mode access and mobile overflow need separate design.

### Complete feature mapping

| Feature in `docs/features.md` | Suggested home |
| --- | --- |
| Sign-in | Sign-in screen; account-control placement remains undecided. |
| Chat | Main workspace in typing mode; fixed bottom-centred input. |
| English voice | Full-page voice workspace, started with the input's small orb. |
| Danish voice | Same voice workspace; language selected through the top bar or Settings. |
| Interrupt and reconnect | Voice workspace and orb state; manual controls remain to be designed. |
| Language toggle | Top bar: compact Danish/English selector; detailed preferences in Settings. |
| Voice transcripts | Conversation view on request during voice; session history in typing mode. |
| Task context | Background capability; relevant context can appear in requested/generated views. |
| Honest confirmations | Outcome beside the action or in its generated view; spoken confirmation in voice. |
| Software Factory tools | Global input and voice; resulting task/project views in the main workspace. |
| Model switching by voice | Global input and voice; model details in Settings and task views. |
| Live status by voice | Voice announcements; matching activity in the Now/attention view. |
| Live voice test | Manual verification work; no permanent dedicated shell control. |
| Reflex layer | Background behaviour reflected in responsiveness; no dedicated shell control. |
| Now panel | Proposed right-panel activity view, opened by the top-bar attention control. |
| Sleep switch | Top-bar More menu or Settings; current state in the bottom status bar. |
| Database waking | Bottom status bar and nearby pending-content feedback. |
| Task board | Software Factory navigation in the left sidebar; board in the main workspace. |
| Create task | Task-board action and global input/voice; creation UI in the workspace. |
| Task detail | Main workspace; selected-detail previews can use the right panel. |
| Task controls | Beside the relevant task in the board/detail view; also input/voice. |
| Recover crashed task | Needs-attention entry and task detail, with the relevant recovery action. |
| Sandbox per task | Task detail/session view; status surfaced through activity. |
| Agent and model per task | Task creation/detail controls; defaults in Settings. |
| Repository workspace | Task detail and generated repository/code views; questions in attention. |
| Frequent pushes | Task timeline and project/release views; relevant milestones in activity. |
| GitHub App tokens | Credential status in Settings; relevant failures in attention, never token values. |
| Heartbeat and crash detection | Task state/detail and Now/attention; no standalone top-bar control. |
| Disk headroom | Task detail; low-disk warning in attention. |
| Codex limit handling | Affected task detail and attention; no standalone shell control. |
| Parallel tasks | Settings for limits; task board and activity for current work. |
| Projects list | Software Factory left-sidebar navigation; projects in the main workspace. |
| All repositories | Projects/repository workspace; management actions beside each repository. |
| New project by voice | Global input/voice; generated project brief and scaffolding progress. |
| New projects defaults | Settings workspace. |
| Webhook receiver | Background integration; resulting events appear in activity and task/project views. |
| PR, run, release and deploy records | Project/release workspace and selected-record details. |
| Checks loop | Task/PR detail and activity for failures and subsequent work. |
| Project policy and merge | Project settings and relevant PR/task detail. |
| Release records | Release workspace; important changes in Now/attention. |
| Release view | Software Factory left-sidebar navigation; graph and release data in the workspace. |
| Workflow templates | Project setup/settings and repository views; no standalone top-bar control. |
| Settings | Confirmed top-right entry opening Settings in the main workspace. |
| Jarvis model per session | Top-bar More menu for next-session selection; full preferences in Settings. |
| Credentials status | Settings; actionable warnings in Now/attention. |
| Codex login renewal | Background operation; status in Settings, failures in attention. |
| Usage and cost | Software Factory Usage navigation; task-level usage in task detail. |
| Event archive | Existing task timeline/history; no separate archive shell control. |
| Alerts | Top-bar attention entry/right-panel activity; phone delivery as planned. |
| Backup drill | Operations/runbook documentation; no permanent top-bar control. |
| Runbook | Help/operations navigation; document shown in the workspace when requested. |
| Teams calling | Teams phone experience; related setup in Settings. |
| Away mode | Top bar: compact present/away control; details in Settings. |
| Phone confirmations | Teams approval cards and related attention items. |
| Screen sharing | Confirmed top-bar control; active sharing/stop treatment still a proposal. |
| Local PC bridge | Existing feature's connection status in the bottom bar or a requested status view; integration design deferred. |
| Computer use | Voice/input action; progress and stop feedback in the relevant view; implementation design deferred. |
| Camera | Confirmed top-bar control; active camera/stop treatment still to be designed. |
| Calendar and mail | Requested/generated workspace views; future area navigation to be decided. |
| Second brain | Requested/generated search results and note views; dedicated navigation undecided. |
| Complete Jarvis front end | The shared shell, typing experience, voice workspace and area views as a whole. |

## Open questions

- How are errors and decisions requiring Dan's input presented? The orb already
  communicates runtime activity in voice through state-driven behaviour; its
  exact appearance is deferred. Any further feedback in typing remains to be
  designed where needed.
- What should the full-page voice background look like, and how does it relate
  to the current theme?
- What manual end-voice button is available on each device, and should Escape
  end voice on desktop? Details remain undecided.
- What specific navigation items belong to each area's left sidebar? Detailed
  Banking and Fitness and Health navigation is deferred.
- What specific defaults and additional controls belong in the thin top and
  bottom bars? The right panel can show context relevant to the conversation.
  Screen sharing and Camera are confirmed top-bar controls; the additional
  recommendations in the feature-placement section are awaiting discussion.
- What visual character should the default shell have? Decide its structure
  first, then its appearance, then the transformation into voice mode.
- Which theme variables should be adjustable? Colours, typography and spacing
  are examples to explore, not a final variable list.
- Which elements, if any, should always remain easy to find as the layout changes?
- How should Dan override or return to the default layout?
- Should a single "clear workspace" action close the content views and return
  to the default shell without ending an active voice session? This is an
  assistant proposal only. Dan did not understand the question and redirected
  the discussion to the phone's typing mode; leave it undecided for now.
- What specific motion and appearance communicate each orb state?
- How should the workspace accommodate more views than fit legibly on screen?

## Proposed visual review process

Dan asked how wireframes would actually be produced and made visible to him.
The assistant proposes using image generation to produce three simple visual
wireframe variations of the default desktop shell, based on these notes. Show
each image directly in the chat so Dan can inspect and comment on the layout.
After a layout is chosen, explore the voice and phone states. An interactive
prototype can follow to test opening panels, switching modes and arranging views;
its delivery and verification method will be established before implementation.
Dan approved producing visible wireframes. Three independent grayscale desktop
wireframe images have now been generated and shown in this chat. They explore
the same agreed shell with different main-workspace arrangements. No direction
was selected at the initial generation stage and no interactive prototype has been created. Content is
illustrative research, not production data; proposed navigation and feature
placement shown in the images still await review.

The option numbers below follow the order the images appeared in this chat,
not the order their generation was requested:

| Visible option | Concept | Repository image |
| --- | --- | --- |
| 1 | Open Conversation | [Wireframe](docs/ui/wireframes/typing-01-conversation.png) |
| 2 | Layered Desk | [Wireframe](docs/ui/wireframes/typing-02-layered-desk.png) |
| 3 | Visual Workspace | [Wireframe](docs/ui/wireframes/typing-03-visual-workspace.png) |

The small voice-start control is represented with a microphone icon in two
wireframes; the agreed small-orb identity remains the requirement for refinement.
The three subsequent voice wireframes are recorded below.

Dan reported that he could not see the first wireframe. Opening a separate
Codex image panel was unavailable, so the same first image was reattached as a
standard inline image and supplied as a direct local-file link. This is the
same option 1, not a new variation; Dan subsequently confirmed seeing all three.

Dan subsequently confirmed seeing all three images and chose visible option 3
(Visual Workspace, `typing-03-visual-workspace.png`). His requested
refinements are a thinner left rail and Settings at the top right; the bottom
of the left rail is undecided. Generate a revised image of that selected target
before considering an interactive prototype. No code implementation has begun.
Dan said the rest of the selected layout looks good; preserve it during this
refinement rather than redesigning nearby regions.
Dan subsequently requested a tab strip at the top inside the main workspace,
with support for "minimise window X" and restoration through the retained tab.
Include this in the next image refinement.

Two refinement images have now been generated:

- [Narrow rail and top-right Settings](docs/ui/wireframes/typing-03-refined-rail.png).
- [Latest revision with workspace tabs](docs/ui/wireframes/typing-03-refined-tabs.png).

The latest image retains the selected layout, narrows the icon-only rail, puts
Settings at the top right, corrects the small orb start button and adds tabs
inside the central workspace. It illustrates active, background and minimised
views with compact controls. These are static wireframes, not working window
controls. The latest refinement has not yet been approved by Dan. No prototype
has been built. Dan subsequently authorized publishing the documentation and images.

## Voice wireframes

Dan requested three voice UI wireframes after the default-shell refinement.
Three independent images have been generated, showing complementary states
of the agreed voice experience rather than three mutually exclusive app designs.
Their numbering follows the order displayed in this chat:

| Voice frame | Scene | Repository image |
| --- | --- | --- |
| 1 | Desktop: centred orb, listening, no content views | [Wireframe](docs/ui/wireframes/voice-01-centred-orb.png) |
| 2 | Phone: one research view, small orb docked at the bottom | [Wireframe](docs/ui/wireframes/voice-02-phone-dock.png) |
| 3 | Desktop: orb moved left, research and source views layered at the right | [Wireframe](docs/ui/wireframes/voice-03-layered-workspace.png) |

All three hide the default app shell, text input and conversation history.
They use monochrome orb/background treatments and illustrate a separate manual
End voice control. Exact background styling, exit-control placement and orb
animation remain proposals. The research content is illustrative; the images
do not demonstrate live voice or working controls. No prototype has been built.
These static artifacts are included with the notes for repository review.

### Visual direction after the voice wireframes

Dan confirmed that the three voice scenes are very close to what he imagined.
Keep the wireframes unchanged as the structural reference. Their plain white
windows and monochrome treatment do not define the final visual styling.
The desired finished experience should feel futuristic and have a strong wow
effect. Glass-like, translucent or transparent content windows are directions
to explore, not yet a chosen treatment. The next design stage is polished image
mockups showing how the actual interface could look while retaining the agreed
layout and behaviour. No visual treatment has been selected or implemented.

## Discussion approach and remaining topics

Dan is at the gym and asked the assistant to guide the conversation. Ask one
short question at a time rather than presenting a long questionnaire. Continue
recording decisions here. Dan has now authorized repository publication.
Dan asked for less repetition: give new recommendations without recapping each
previous decision. He requested a review of `docs/features.md` to suggest feature
placement, with particular attention to the top bar.

Suggested order for the remaining discussion (not decided requirements):

1. The default shell and any controls that stay in a predictable place.
2. When Jarvis brings up or rearranges views on its own.
3. How Dan switches focus, dismisses content or returns to the default shell.
4. How several views coexist and large or mixed datasets are explored.
5. Voice, touch and keyboard interaction, including the phone experience.
6. Visual character and motion, followed by a few concrete scenarios to test
   the proposed experience.

## Implementation planning handoff

Dan approved the structural direction and asked for two Copilot planning tasks:

1. Break the UI requirements into implementation issues: shell/navigation, window
   and tab management, default typing experience, fullscreen voice, phone views,
   orb state presentation, contextual panels, theme settings and feature controls.
2. Break the enabling capabilities into implementation issues: backend tools and
   contracts, agent-driven UI composition and layout, runtime state/events,
   business logic, theme persistence, data access and integration requirements.

Both planning tasks must cover the confirmed requirements in this document,
inspect existing code and issues to avoid duplicates, add missing work to PLAN.md,
create matching GitHub issues and dependency links, and distinguish open design
questions from implementation-ready requirements. They do not authorize building
all features or resolving Dan's deferred choices without him. Styling comes after
shell behaviour; glass/transparency remains a visual direction to explore.
The separately discussed PC vendor integration was explicitly excluded by Dan;
do not create a new issue for it from this UI discussion.

Planning issues: [UI breakdown #230](https://github.com/DanAakesen/jarvis/issues/230) and [enabling logic #231](https://github.com/DanAakesen/jarvis/issues/231).

## Accepted feature additions from video review (4 October 2026)

Dan selected long-term memory, web research, image/video generation and editable
personality for Jarvis. These are planned capabilities, distinct from the existing
ability to display data or create temporary views. Research results and generated
media should use the existing dynamic workspace; the exact renderer catalogue
remains the existing #256 decision. Long-term memory persists relevant knowledge
and does not change the rule that generated UI views are unsaved.

Recommended personality placement: **Settings → Jarvis → Personality**, accessed
from top-right Settings, with tone/response style, custom instructions, save/reset
and new-session application feedback. Dan accepted the capability; this proposed
placement and field arrangement have not been separately reviewed. Do not conflate
personality preferences with visual themes or model/voice selection.

The detailed implementation tasks are in PLAN.md (P7-13–P7-16 and P8-19). Memory
policy and research/media providers, costs and artifact retention remain open.

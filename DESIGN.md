# Design

No visual direction is chosen yet. Dan designs each page by giving an image generator the page's data points and actions from [PRODUCT.md](PRODUCT.md#page-requirements), then picks a direction. Record the chosen direction, references, and findings here. Requirements stay in PRODUCT.md; token values go in code.

## Design goals

- **Conversation first.** Jarvis's main page is the conversation (chat and voice) with an overview of what is happening now. It may be the only page Dan uses day to day; area pages hold the details.
- **One app, many areas.** One app shell with area navigation. The Software Factory is the first area; later areas (Banking, Health and fitness, Calendar) must fit without redesigning the shell.
- **Live and honest.** State changes appear without refresh. Stale or disconnected data is shown as such; progress uses observed milestones, not invented percentages.
- **Full transparency.** Every task shows what the agent did, what it used, and what it cost.

## Page set (phase 1)

| Page | Focus |
| --- | --- |
| Jarvis (main) | Conversation, voice state, "now" activity, sleep switch |
| Task view | Kanban columns by task state |
| Task detail | Header, event timeline, sandbox sessions, usage |
| Release view | Horizontal git graph per project (branches as lines, commits as dots), releases, workflow runs, deployments |
| Projects | Project list and settings |
| Settings | Models, reasoning, voices, limits, credential status |
| Usage and cost | Usage by task, project, and period |

The repository `PLAN.md` status workflow is GitHub metadata; it does not add a Jarvis UI control or visual state.

## Interactions to design

- **Voice states:** listening, thinking, speaking, interrupted, reconnecting. Show what Jarvis heard. English uses Ryan HD and a British butler persona; action confirmations reflect backend tool results.
- **Language toggle:** Danish ↔ English, visible wherever voice is active.
- **Task controls:** steer, pause, resume, cancel, and recover, each with a clear pending state (for example, "Pausing…" until the turn has stopped).
- **Sleep switch:** the main page shows configured awake/asleep state (minimum replicas 1/0), pending and failure feedback, and explains a refusal while any task is Ready or Running. Settings links to the main-page control.
- **Live updates:** cards and timeline entries change state without layout jumps; a visible marker for a disconnected or stale event stream. Only committed task updates are presented as current.

## Visual direction

Not chosen. Add the selected direction, reference images, and findings here.

## Foundation shell (P0-02)

The temporary shell uses system typography, neutral surfaces, one content column
and a compact Jarvis home link. It establishes responsive and keyboard behavior
without choosing the future product identity. Canonical styles live in
`apps/web/src/styles.css`. The signed-out page states that sign-in and deployment
are pending; no fake task data is shown. P1-07 shows unbuilt actions as explained,
disabled controls; see below. Unknown addresses have a return link. A skip link
and visible keyboard focus support navigation. Dan's page designs remain to be selected.

## Sign-in (P0-09)

The home page keeps the neutral, single-column shell and presents one Microsoft
sign-in action. Disable it with an explanation until the backend is configured;
show pending and refusal feedback beside the action. After `/me` verifies the
session, show the returned name as the page headline. Do not expose account
tokens, email addresses, or unverified identity claims in the interface.

## App shell (P1-07)

The shell keeps the neutral foundation and adds structure only, without a
visual direction. The header contains the Jarvis home link, area navigation
(Software Factory only) and a separate Settings entry. The current page is marked with a
surface fill and full outline, never a lone edge. Navigation appears only after
sign-in; the header wraps on narrow screens.

- **Main page:** the verified name is the headline. Conversation (chat,
  language, voice, and persisted history) is the wide column; "Now" and Backend
  sit beside it from 900 px and stack below it on narrower screens.
- **Unavailable features:** each data area says what it will show. Each action
  stays visible but disabled, and is linked to that explanation with
  `aria-describedby`. No sample messages, tasks or states are shown.
- **Activity panel:** Running tasks, Needs attention, Releases and deployments,
  and Credential warnings, each with an empty state. Item titles open their
  task, release or project. Dismiss shows "Dismissing…", keeps the item and
  explains a failure, and returns focus to the Now heading after removal.
- **Area pages:** the Software Factory has its own Tasks and Projects
  navigation. Unbuilt task and release pages explain what is unavailable.
  Project management is implemented below; record pages link back to their list.
- The P1-07 shell was checked in headless Chromium at 300, 390, 768 and 1280 px
  with a stubbed sign-in: no horizontal overflow, and controls are at least 44 px high.

## Settings (P1-11)

Keep the Settings route within the shell's neutral foundation. Use one page
headline and distinct form sections for Jarvis, Voice, Coding agents, Global,
and Credentials. Two columns make related controls easy to scan on wide screens;
the form stacks on narrow screens. Save feedback stays beside the save action,
and loading, recovery, and unavailable actions remain explicit. Credentials show text status, expiry, and last-updated dates without secret
values; manual renewal and reseed controls remain disabled with an explanation.
The sleep control also remains disabled until its owning workflow exists; no
new visual direction or palette is introduced. Checked in Chromium at
390 and 1280 px with mock auth/settings: no horizontal overflow, controls at
least 44 px high, and save/disabled states visible. Live backend behavior remains
unverified.

## Projects (P1-10)

Keep the neutral foundation. The list uses one compact project panel per
repository, with its settings, running-task count, last-release availability,
and edit action grouped for scanning. Project settings use labelled form
sections; create, save, archive confirmation, loading, retry, conflict, and
success feedback stay close to the relevant actions. Archive messaging explains
that history remains and the repository stays reserved. Counts refresh manually
until live updates exist; missing release data is stated, not fabricated.
Checked in Chromium 154 at 390 and 1280 px with scratch-only auth and API mocks:
list, create, update, and archive worked; neither width overflowed, controls
were at least 44 px high, and the project form stacked on mobile. Live Entra and
Azure SQL behavior remains unverified.

## Conversation history (P4-03)

After sign-in, the main page shows the persisted conversation in chronological
order across chat and voice sessions. Each message has its speaker and time;
tool calls show the tool and outcome, with a task link when available.
History loads in bounded pages, with older entries requested explicitly. Loading,
empty, and retryable failure states remain within the conversation panel. This is
an interim implementation, not a selected visual direction.

## Chat (P4-06)

The conversation panel keeps one message list, a Danish/English selector, and a
labelled text composer. Sending saves Dan's message first, then streams Jarvis's
reply in place. Pending state keeps the Send control disabled; failures remain
beside the composer, preserve partial text as interrupted, and warn that a task
action may have completed. A delivered reply is saved and history refreshes so
tool outcomes and valid task IDs appear as labelled chips and links. The list and
composer stay in the existing single-column conversation panel at mobile widths;
the selected visual direction remains open. P4-09 routes chat through Foundry
Invocations; live Azure streaming and tool-call linkage remain a post-merge check.

## Browser voice (P5-04)

The Voice section uses the existing neutral panel and replaces unavailable
actions with Start voice, Stop voice, and Mute/Unmute. Connection, listening,
thinking, speaking, reconnecting, and failure feedback stays beside those controls; the
mute action is unavailable until a session is ready. The microphone opens only
after session setup and the Danish no-model warm-up complete. Speaking
interrupts playback. Controls wrap on narrow screens and use the shared 44 px
button and visible-focus styles. Language selection and voice settings remain
with P5-05; no new visual direction is chosen. A headless Chromium check at
390 px and 1280 px verified the layout and start, speaking, interruption,
reconnect, mute, and stop states with mocked relay/audio APIs. Physical
microphone and speaker behavior remains unverified.

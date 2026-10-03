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

- **Voice states:** listening, thinking, speaking, interrupted, reconnecting. Show what Jarvis heard.
- **Language toggle:** Danish ↔ English, visible wherever voice is active.
- **Task controls:** steer, pause, resume, cancel, and recover, each with a clear pending state (for example, "Pausing…" until the turn has stopped).
- **Sleep switch:** shows awake or asleep; refused with an explanation while tasks run.
- **Live updates:** cards and timeline entries change state without layout jumps; a visible marker for disconnected or stale data.

## Visual direction

Not chosen. Add the selected direction, reference images, and findings here.

## Foundation shell (P0-02)

The temporary shell uses system typography, neutral surfaces, one content column
and a compact Jarvis home link. It establishes responsive and keyboard behavior
without choosing the future product identity. Canonical styles live in
`apps/web/src/styles.css`. The home page states that sign-in and deployment are
pending; no fake task data is shown. P1-07 shows unbuilt actions as explained,
disabled controls; see below. Unknown addresses
have a return link. A skip link and visible keyboard focus support navigation.
Dan's page designs remain to be selected.

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
  language, voice) is the wide column; "Now" and Backend sit beside it from
  900 px and stack below it on narrower screens.
- **Unavailable features:** each data area says what it will show. Each action
  stays visible but disabled, and is linked to that explanation with
  `aria-describedby`. No sample messages, tasks or states are shown.
- **Activity panel:** Running tasks, Needs attention, Releases and deployments,
  and Credential warnings, each with an empty state. Item titles open their
  task, release or project. Dismiss shows "Dismissing…", keeps the item and
  explains a failure, and returns focus to the Now heading after removal.
- **Area pages:** the Software Factory has its own Tasks and Projects
  navigation. Placeholder pages state that the page isn't available yet.
  Record pages link back to their list.
- Checked in headless Chromium at 300, 390, 768 and 1280 px with a stubbed
  sign-in: no horizontal overflow, and controls are at least 44 px high.

## Settings (P1-11)

Keep the Settings route within the shell's neutral foundation. Use one page
headline and distinct form sections for Jarvis, Voice, Coding agents, Global,
and Credentials. Two columns make related controls easy to scan on wide screens;
the form stacks on narrow screens. Save feedback stays beside the save action,
and loading, recovery, and unavailable actions remain explicit. Credential and
sleep actions are disabled with their explanation until their owning services
exist; no new visual direction or palette is introduced. Checked in Chromium at
390 and 1280 px with mock auth/settings: no horizontal overflow, controls at
least 44 px high, and save/disabled states visible. Live backend behavior remains
unverified.

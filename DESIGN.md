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

## Interactions to design

- **Voice states:** listening, thinking, speaking, interrupted, reconnecting. Show what Jarvis heard.
- **Language toggle:** Danish ↔ English, visible wherever voice is active.
- **Task controls:** steer, pause, resume, cancel, and recover, each with a clear pending state (for example, "Pausing…" until the turn has stopped).
- **Sleep switch:** shows awake or asleep; refused with an explanation while tasks run.
- **Live updates:** cards and timeline entries change state without layout jumps; a visible marker for disconnected or stale data.

## Visual direction

Not chosen. Add the selected direction, reference images, and findings here.

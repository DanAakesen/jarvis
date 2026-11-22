# Jarvis UI map

Every screen Jarvis has today, by surface. [DESIGN.md](DESIGN.md) says how each should behave, the [style guide](docs/ui/style-guide.md) says how it looks, [PRODUCT.md](PRODUCT.md) says what it must do, and [PLAN.md](PLAN.md) says what has been accepted on a device. The code is the source of truth for what exists: this page was checked against `apps/ios`, `apps/web` and the shared `JarvisDestination` list on 22 November 2026. Merged means in source. It does not mean accepted on a phone or Watch.

Update this page in the same change that adds, removes, renames or retires a screen. Do not record designs here until they exist.

## iPhone

The sidebar lists the destinations of `JarvisDestination` (`apps/ios/Packages/JarvisCore`). Shared controls, orb and page header come from `JarvisControls.swift` and `JarvisPageHeader.swift`; screens never draw their own.

| Destination | What it shows | Main code |
| --- | --- | --- |
| **Home** | The brief and next action, today's activity card, tasks and the iPhone Gym sheet. The activity stays usable when the brief is unavailable. | `JarvisTodayScreen`, `JarvisTodayActivityCard`, `JarvisTodayGymSheet` |
| **Chat** | The one PI conversation: streaming replies, composer with plus menu and dictation, grouped tool activity, generated blocks and charts, photos, reply targets from pushes, follow-latest, and the live Voice state when Voice is active. | `JarvisChatScreen`, `JarvisComposerBar`, `JarvisChatToolActivityList`, `JarvisChatBlockView`, `JarvisChatFollowLatest` |
| **Voice** | Live GPT-Live call: orb, captions, mute and end, a bottom panel for generated visuals, and a Live Activity. The current Voice backend is audio-only; camera and screen controls do not imply live visual input. | `VoiceScreen`, `VoiceContentPanel`, `VoiceAudioEngine`, `VoiceLiveActivityController` |
| **Notes** | One area with a Notes, Tasks and Graph switch: library with folders, pins and ordering, reader, editor with editable title, task sheets and the 3D Vault graph. | `JarvisNotesArea`, `JarvisNoteReaderView`, `JarvisNoteEditorView`, `JarvisNotesGraphView` |
| **Health** | Daily dashboard, body chart, workouts and the iPhone Gym lift log and editor, goals, and HealthKit sync. Nutrition totals live here. | `JarvisHealthArea`, `JarvisHealthLiftLog`, `JarvisLiftEditorSheet`, `JarvisHealthKitSync` |
| **Workspaces** | Results Jarvis generates and Dan opens: generated HTML apps and workspaces. | `WorkspacesView`, `GeneratedHTMLAppView`, `GeneratedWorkspaceView` |
| **Software Factory** | Projects, tasks, workers, PRs and releases, task detail, new task and request views, and a Live Activity. | `JarvisFactoryArea`, `JarvisFactoryTaskDetailView`, `JarvisFactoryReleaseViews` |
| **Usage** | What Jarvis has used and cost. | `JarvisUsageArea` |
| **Status** | The backend checks, the Vault mirror and the smoke summary, from `GET /status`. | `JarvisStatusArea` |
| **Proactive** | Proactive items, sources and detailed preferences. | `JarvisProactiveArea`, `JarvisProactiveSettingsSheet` |
| **Settings** | The **Proactive suggestions** switch, saved values, editors, deployment and resource views, and sign-out. | `JarvisSettingsArea` and its views |
| **Banking** | Listed in the sidebar but not navigable. Out of scope until Dan sets its approval rules ([PLAN decision F](PLAN.md#open-decisions-af)). | `JarvisDestination.banking` |

Around the destinations: the opening screen (`JarvisOpeningView`, startup only), the lock and sign-in gate (`JarvisGateRootView`), the activity sheet, approval notifications and the shared task row (`JarvisTaskListRow`, used in Notes and Home).

## Apple Watch

One app (`apps/ios/Watch`) with these screens: **Chat** (one entry point with an adaptive composer, dictation and the Voice orb), **Voice** (focused call with Mute and End), **menu**, **Tasks** (list, detail, edit, new), **Health**, **workouts**, **lifts** and lift capture, **Factory** and new task, **Agenda**, **body fat**, **Notes**, **Home** brief and **Nutrition**. Complications show steps and the Gym lift entry.

## Widgets and Live Activities

- **Home screen widgets** (`apps/ios/Widgets`): Gym (steps, workouts, medium, large), Software Factory (status, done, medium, large) and Notes (small).
- **Live Activities:** Software Factory task and Voice call.
- **Watch widgets** (`apps/ios/WatchWidgets`).

Widgets and Live Activities are glanceable summaries and routes back into the real screen. They are not second editors.

## Web

`apps/web` is the browser surface: a centred Jarvis stage for Chat and Voice, with these areas: **Notes**, **Health** (with its own pages), **Software Factory** (kanban, tasks, release), **Usage**, **Status** and **Settings**, plus **Proactive** items when the proactive source is enabled. The old `/daily` path redirects to Health, and `/knowledge` redirects to Notes.

## CarPlay

Not built. Apple granted the Voice Based Conversation entitlement on 21 November 2026, but the capability is not configured in the app or tested in a car. In-car use is voice-first. See [PRODUCT.md](PRODUCT.md#carplay) and [Apple capabilities](docs/ios/apple-capabilities.md).

## Open UI items

| Item | State |
| --- | --- |
| Map and route card in Chat and Voice | Design brief only: [docs/ui/map-route-card/brief.md](docs/ui/map-route-card/brief.md). Dan chooses the layout, then it is built. |
| Manual kcal entry on the Nutrition screen | Approved. Device acceptance is pending. |
| Device acceptance of Chat typing, follow-latest, Voice state labels, Notes titles and Watch recovery | Build 124 testing is underway. [PLAN.md](PLAN.md) tracks the results of each check. |
| CarPlay scenes | Not started. |

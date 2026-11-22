# Jarvis UI map

Screens and widgets in source, by surface. [DESIGN.md](DESIGN.md) owns behaviour, the [style guide](docs/ui/style-guide.md) owns appearance, [PRODUCT.md](PRODUCT.md) owns requirements, and [PLAN.md](PLAN.md) owns device acceptance. In source does not mean accepted on a phone or Watch.

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
| **Proactive** | Proactive items and the single **Proactive suggestions** switch with its settings sheet. | `JarvisProactiveArea`, `JarvisProactiveSettingsSheet` |
| **Settings** | Saved values, editors, deployment and resource views, and sign-out. | `JarvisSettingsArea` and its views |
| **Banking** | Listed in the sidebar but not navigable. Out of scope until Dan sets its approval rules ([PLAN decision F](PLAN.md#open-decisions-af)). | `JarvisDestination.banking` |

Around the destinations: the opening screen (`JarvisOpeningView`, startup only), the lock and sign-in gate (`JarvisGateRootView`), the activity sheet, approval notifications and the shared task row (`JarvisTaskListRow`, used in Notes and Home).

## Apple Watch

One app (`apps/ios/Watch`) with these screens: **Chat** (one entry point with an adaptive composer, dictation and the Voice orb), **Voice** (focused call with Mute and End), **menu**, **Tasks** (list, detail, edit, new), **Health**, **workouts**, **lifts** and lift capture, **Factory** and new task, **Agenda**, **body fat**, **Notes**, **Home** brief and **Nutrition**.

## Widgets and Live Activities

- **iPhone Home screen widgets** ([bundle](apps/ios/Widgets/JarvisWidgets.swift)): Gym (small Steps and Workouts, plus medium and large), Software Factory (small Status and Done, plus medium and large), Notes and Home (each in small, medium and large).
- **Live Activities:** Software Factory task and Voice call.
- **Watch complications** ([bundle](apps/ios/WatchWidgets/JarvisWatchWidgets.swift)): rectangular Steps, Nutrition, Home, task list and Body Fat; circular Tasks Today, Dictate, Voice Session and Log Lift. Dictate opens a draft; it does not send a message.

Widgets and Live Activities are glanceable summaries and routes back into the real screen. They are not second editors.

## Web

`apps/web` is the browser surface: a centred Jarvis stage for Chat and Voice, plus **Notes**, **Software Factory** (kanban, tasks, releases), **Usage** and **Status**. **Health** and **Proactive** are feature-gated areas. **Settings** has its own route; an exact Proactive item link is available when push or Proactive is enabled. The old `/daily` path redirects to Health, and `/knowledge` redirects to Notes.

## CarPlay

No CarPlay scene in source; **not accepted on device**. See [Apple capabilities](docs/ios/apple-capabilities.md) for the grant and [PRODUCT.md](PRODUCT.md#carplay) for the voice-first requirement.

## Open UI items

| Item | State |
| --- | --- |
| Map and route card in Chat and Voice | Design brief only: [docs/ui/map-route-card/brief.md](docs/ui/map-route-card/brief.md). Dan chooses the layout, then it is built. |
| Manual kcal entry on the Nutrition screen | Not built; waiting for [decision B](PLAN.md#open-decisions-af). |
| Follow-latest, Voice state labels, Notes titles, Watch dictation and recovery | Not accepted on device. See [PLAN.md](PLAN.md) for the current build and checks. |

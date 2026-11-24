# Jarvis UI map

Screens and widgets in source, by surface. [DESIGN.md](DESIGN.md) owns behaviour, the [style guide](docs/ui/style-guide.md) owns appearance, [PRODUCT.md](PRODUCT.md) owns requirements, and [PLAN.md](PLAN.md) owns device acceptance. In source does not mean accepted on a phone or Watch.

Update this page in the same change that adds, removes, renames or retires a screen. Do not record designs here until they exist.

## iPhone

The sidebar lists the destinations of `JarvisDestination` (`apps/ios/Packages/JarvisCore`). Shared controls, orb and page header come from `JarvisControls.swift` and `JarvisPageHeader.swift`; screens never draw their own.

| Destination | What it shows | Main code |
| --- | --- | --- |
| **Home** | The brief and next action, today's activity card, tasks and the iPhone Gym sheet. The activity stays usable when the brief is unavailable. The + menu beside Upcoming opens New task, New note, Log workout and Log lift. | `JarvisTodayScreen`, `JarvisTodayActivityCard`, `JarvisTodayGymSheet` |
| **Chat** | The one PI conversation: resumable replies, composer with plus menu and dictation, grouped tool activity, generated blocks (including charts and Apple Maps), photos, exact reply targets from pushes, follow-latest and live Voice state. The plus menu's **Test a reply** sheet uses a separate conversation; it does not test normal Chat. | `JarvisChatScreen`, `JarvisChatModel`, `JarvisComposerBar`, `JarvisChatBlockView`, `JarvisAppleMapsCard`, `JarvisRuntimeTestSheet` |
| **Voice** | Live GPT-Live call: orb, captions, mute and end, a bottom panel for generated visuals, and a Live Activity. The current Voice backend is audio-only; camera and screen controls do not imply live visual input. | `VoiceScreen`, `VoiceContentPanel`, `VoiceAudioEngine`, `VoiceLiveActivityController` |
| **Notes** | One area with a Notes, Tasks and Graph switch: library with folders, pins and ordering, reader, editor with editable title, task sheets and the 3D Vault graph. | `JarvisNotesArea`, `JarvisNoteReaderView`, `JarvisNoteEditorView`, `JarvisNotesGraphView` |
| **Health** | Daily dashboard, body chart, workouts, iPhone Gym lifts, goals and HealthKit sync. Nutrition → Today shows kcal left, resting target, active kcal and deficit. **Log meal** takes kcal and optional protein. | `JarvisHealthArea`, `JarvisHealthLiftLog`, `JarvisLiftEditorSheet`, `JarvisHealthKitSync` |
| **Workspaces** | Results Jarvis generates and Dan opens: generated HTML apps and workspaces. | `WorkspacesView`, `GeneratedHTMLAppView`, `GeneratedWorkspaceView` |
| **Software Factory** | Projects, tasks, workers, PRs and releases, task detail, new task and request views, and a Live Activity. | `JarvisFactoryArea`, `JarvisFactoryTaskDetailView`, `JarvisFactoryReleaseViews` |
| **Usage** | Estimated spend for the selected period. Tap a chart bar for its UTC dates and cost. Factory turns count coding-agent work. | `JarvisUsageArea` |
| **Status** | The backend checks, the Vault mirror and the smoke summary, from `GET /status`. | `JarvisStatusArea` |
| **Proactive** | Proactive items, sources and detailed preferences. | `JarvisProactiveArea`, `JarvisProactiveSettingsSheet` |
| **Settings** | Appearance with primary and secondary colours for iPhone and Watch, the **Proactive suggestions** switch, Training and Nutrition target editors, deployment and resource views, and sign-out. | `JarvisSettingsArea` and its views |
| **Banking** | Listed in the sidebar but not navigable. Out of scope until Dan sets its approval rules ([PLAN decision F](PLAN.md#open-decisions-af)). | `JarvisDestination.banking` |

Around the destinations: the opening screen (`JarvisOpeningView`, startup only), the lock and sign-in gate (`JarvisGateRootView`), the activity sheet, approval notifications and the shared task row (`JarvisTaskListRow`, used in Notes and Home).

## Apple Watch

The Watch dashboard opens Chat or an adaptive tile Menu in one tap, above the agenda, workouts, body fat, tasks and recent notes. **Chat** has an editable draft up to three lines with dictation; Send replaces the audio controls when the draft contains text. **Voice** has a focused call with Mute and End. Other destinations are **Tasks** (list, detail, edit, new), **Health**, **Workouts**, **Lifts** and lift capture, **Factory** and new task, **Agenda**, **Body Fat**, **Notes**, **Home** brief and **Nutrition**.

## Widgets and Live Activities

- **iPhone Home screen widgets** ([bundle](apps/ios/Widgets/JarvisWidgets.swift)): Gym (small Steps and Workouts, plus medium and large), Software Factory (small Status and Done, plus medium and large), Notes and Home (each in small, medium and large).
- **Live Activities:** Software Factory task and Voice call.
- **Watch complications** ([bundle](apps/ios/WatchWidgets/JarvisWatchWidgets.swift)): rectangular Steps, Nutrition, Home, task list and Body Fat; circular Tasks Today, Dictate, Voice Session and Log Lift. Dictate opens a draft; it does not send a message.

Widgets and Live Activities are glanceable summaries and routes back into the real screen. They are not second editors.

## Web

`apps/web` is the browser surface: a centred Jarvis stage for Chat and Voice, plus **Notes**, **Software Factory** (kanban, tasks, releases), **Usage**, **Status** and **Settings**. **Health** and **Proactive** are feature-gated. With push on but Proactive off, the Proactive item route opens only test items. `/daily` redirects to Health, `/knowledge` to Notes and `/tasks` to the task list in Notes.

## CarPlay

No CarPlay scene in source; **not accepted on device**. See [Apple capabilities](docs/ios/apple-capabilities.md) for the grant and [PRODUCT.md](PRODUCT.md#carplay) for the voice-first requirement.

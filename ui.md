# Jarvis UI map

Screens and widgets in source, by surface. [DESIGN.md](DESIGN.md) owns behaviour, the [style guide](docs/ui/style-guide.md) owns appearance, [PRODUCT.md](PRODUCT.md) owns requirements, and [PLAN.md](PLAN.md) owns device acceptance. In source does not mean accepted on a phone or Watch.

Update this page in the same change that adds, removes, renames or retires a screen. Do not record designs here until they exist.

## iPhone

Sidebar rows come from `JarvisDestination.sidebarItems`. Settings opens from the header gear; Voice and Workspaces are not sidebar rows. Shared controls and the orb come from `JarvisControls.swift`; page chrome comes from `JarvisPageHeader.swift`.

| Destination | What it shows | Main code |
| --- | --- | --- |
| **Home** | Up Next, Activity and Schedule. Schedule opens Calendar. Quick add sits to the right of the one-row composer and hides while typing or dictating. | `JarvisTodayScreen`, `JarvisTodayActivityCard`, `JarvisTodayGymSheet` |
| **Calendar** | From Home Schedule or the sidebar above Chat. Day and week timelines, day dividers in Week, month browsing and inline event cards for the primary Google Calendar. | `JarvisCalendarPage`, `JarvisCalendarTimeline` |
| **Chat** | The one PI conversation: resumable replies, a folding composer with plus menu and dictation, tool activity, generated blocks (charts and Apple Maps), photos, exact reply targets from pushes, follow-latest and live Voice state. **Test a reply** in the plus menu uses a separate conversation. | `JarvisChatScreen`, `JarvisChatModel`, `JarvisComposerBar`, `JarvisChatBlockView`, `JarvisAppleMapsCard`, `JarvisRuntimeTestSheet` |
| **Voice** | Live GPT-Live call: stationary background orb, captions, Mute, Speaker and End, swipeable result cards with resize and per-call reopening, and a Live Activity. The current Voice backend is audio-only; camera and screen controls do not imply live visual input. | `VoiceScreen`, `VoiceContentPanel`, `VoiceAudioEngine`, `VoiceLiveActivityController` |
| **Notes** | Notes, Tasks and Graph switch: pinned tiles, a folder grid, a direct Markdown editor with linked notes, editable tables and folder moves, task sheets and the 3D Vault graph. | `JarvisNotesArea`, `JarvisNoteEditorSheet`, `JarvisNotesGraphView` |
| **Health** | Training, Steps, Sleep and Nutrition with independent periods and monthly All history. Body trend has its own metric and period and shows individual measurements. Also shows saved max lifts. Log a meal or photograph it for the Chat draft. | `JarvisHealthArea`, `JarvisHealthCards`, `JarvisHealthBodyChart`, `JarvisHealthKitSync` |
| **Workspaces** | Results Jarvis generates and Dan opens: generated HTML apps and workspaces. | `WorkspacesView`, `GeneratedHTMLAppView`, `GeneratedWorkspaceView` |
| **Software Factory** | Needs you, grouped pipeline, search and releases, with task detail, creation and Live Activities. | `JarvisFactoryArea`, `JarvisFactoryTaskDetailView`, `JarvisFactoryReleaseViews` |
| **Usage** | Spend and source breakdown for the selected period, with expandable resources, linked Factory tasks and tool counts. Tap a chart bar for its UTC dates and cost. Factory turns count coding-agent work. | `JarvisUsageArea` |
| **Status** | Service checks grouped by issues, unconfirmed and healthy, with mirror and smoke reports under Maintenance, from `GET /status`. | `JarvisStatusArea` |
| **Proactive** | Findings, reviews and the shared suggestions switch. Edit and save scope, sources, limits, feeds and guidance inline. | `JarvisProactiveArea`, `JarvisProactiveInlineSettings` |
| **Settings** | Appearance with shared iPhone and Watch accents, Gradient, Frost and Glass sliders, plus orb themes, shared Card glow and iPhone per-card colours, **Proactive suggestions**, Training and Nutrition targets, deployment and resource views, and sign-out. | `JarvisSettingsArea`, `JarvisSettingsEditorView` |
| **Banking** | Listed in the sidebar but not navigable. Out of scope until Dan sets its approval rules ([PLAN decision F](PLAN.md#open-decisions-af)). | `JarvisDestination.banking` |

Around the destinations: the opening screen (`JarvisOpeningView`, startup only), the lock and sign-in gate (`JarvisGateRootView`), the activity sheet, approval notifications and the shared task row (`JarvisTaskListRow`, used in Notes and Home).

Home and Chat share the folding `JarvisComposerBar`.

## Apple Watch

The Watch dashboard opens Chat or an adaptive tile Menu in one tap, above the agenda, workouts, body fat, tasks and recent notes. **Chat** previews up to three lines of the draft; tapping the field opens native editing and dictation appends to the draft. Send replaces the audio controls when the draft contains text. **Voice** has a focused call with Mute and End. Other destinations are **Tasks** (list, detail, edit, new), **Health**, **Workouts**, **Lifts** and lift capture, **Factory** and new task, **Agenda**, **Body Fat**, **Notes**, **Home** brief and **Nutrition**.

## Widgets and Live Activities

- **iPhone Home screen widgets** ([bundle](apps/ios/Widgets/JarvisWidgets.swift)): Gym (small Steps and Workouts, plus medium and large), Software Factory (small Status and Done, plus medium and large), Notes and Home (each in small, medium and large).
- **Live Activities:** Software Factory task and Voice call.
- **Watch complications** ([bundle](apps/ios/WatchWidgets/JarvisWatchWidgets.swift)): rectangular Daily steps, Nutrition, Home, Tasks and Body Fat; circular Tasks Today, Dictate, Voice Session and Log lift. Dictate opens Chat for capture into a draft; it does not send a message.

Widgets and Live Activities are glanceable summaries and routes back into the real screen. They are not second editors.

## Web

`apps/web` is the browser surface: a centred Jarvis stage for Chat and Voice, plus **Notes**, **Software Factory** (kanban, tasks, releases), **Usage**, **Status** and **Settings**. **Health** and **Proactive** are feature-gated. With push on but Proactive off, the Proactive item route opens only test items. `/daily` redirects to Health, `/knowledge` to Notes and `/tasks` to the task list in Notes.

## CarPlay

CarPlay uses a native list with three coastal image cards for Schedule, Notes and Tasks. Tap a card to change its filter, or a note to expand it. Talk presents an animated voice indicator with the actual call state and native controls. End returns to the dashboard. The system determines layout and text limits. [Apple capabilities](docs/ios/apple-capabilities.md)

# Jarvis design direction

Use the [UI style guide](docs/ui/style-guide.md) for tokens, shared components, motion, accessibility and hard rules. This page sets composition and behaviour for each surface; it does not define a second palette. [Product requirements](PRODUCT.md), [current work and device acceptance](PLAN.md), and [decisions](docs/decisions.md) are separate. Build feedback and superseded concepts remain in the [3 October–22 November 2026 archive](docs/archive/design-2026-10-03-to-2026-11-22.md).

## Shared control geometry

Use the shared Jarvis controls for equivalent actions. The web action classes and iOS glass controls own their geometry, focus, disabled and pending states; space them with the parent layout. Rows share the row surface, not a hero-card treatment. Keep buttons in a stable place while pending. Never introduce per-screen glass or draw a second orb.

## One living neural background

Use the shared orb and network, not a screen-specific effect. Chat, Voice and the opening may show a more active state. Other pages keep a calm backdrop; forms and sheets do not need another orb. The opening means startup, never listening. On iPhone, pushed pages keep the back gesture **and** an accessible Back control; the opposite edge opens the sidebar where supported. Shared page chrome must not clip focus, the last scroll row or the bottom safe area.

## Chat

- **Turn first.** Keep the draft and focus while a reply streams. Follow the latest content when already at the end. Reading earlier text pauses following; show **Jump to latest**, and never pull an exact notification target away from the reader. A queued typed turn during Voice is still one message, not a second speculative answer.
- **Follow Voice without replaying it.** iPhone Chat displays the current Voice state when relevant and follows new Voice transcript/reply content using the same follow-latest rules. Show real work rather than a lingering Speaking label. This is in source after [#2034](https://github.com/DanAakesen/jarvis/pull/2034); physical-device scroll, status and input latency remain to be checked.
- **Make status truthful.** Name a known step. Don't infer an error from a slow stream or infer success from a click. Use the shared failure sentence; distinguish a failed tool, an interrupted response and a write that may have completed.
- **Compact tool tree.** Use the [tool-activity handoff](docs/ui/tool-activity/HANDOFF.md): icon, action label, inline disclosure for groups, and no counts or filler. Pending reads as working. Success is distinct from “Didn't work” and “Not done”. Child status must remain readable without colour or motion.
- **Blocks stay in the conversation.** Use the [approved conversational blocks](docs/ui/approved-handover-2026-11-16.md) for generated results, not a sheet. Blocks scroll as part of the assistant message and stay in history. Keep date, place, units, source and issue time with the relevant result. Charts use one scale per unit and provide View data and Copy data. Missing values are gaps, not zeros. Unsupported content keeps a text alternative. Keep ordinary assistant prose unboxed.

## Voice

Use the established Voice screen and controls; no provider selector, engine badge or split speech settings. Connecting, Listening, Thinking, Speaking, Reconnecting and Ended reflect evidence from the session. Speaking is audio playback, not proof that the mic is off; captions have stable speaker/order and must not jump backwards on reconnect. The GPT-Live backend is audio-only: after an unsupported camera or screen response, stop capture and explain why.

**Voice only:** generated visuals open in the [bottom panel](docs/ui/jarvis-window-sheet/voice-bottom-panel-reference.png), between the captions and call controls. There is no panel without content. The newest visual takes focus and earlier ones remain to its left. Use the panel grabber to expand/collapse; make it operable in VoiceOver and keep Close at top right. Keep the mic and End reachable. A downward gesture in the orb/status region minimises Voice; a gesture in captions or content only scrolls it. Reduce Motion removes the transition, not the affordance. Speech, capture recovery and gestures on a real device are not verified by this guide.

## Notes, Tasks and Graph

| Surface | Current direction |
| --- | --- |
| Library | [Vault Folders](docs/ui/notes-subpages-2026-11-15/HANDOFF.md): title row, folder/sort actions in the header menu, content, then the fixed Notes/Tasks/Graph switch and Search/+ row. No Recent section. A query swaps the mode switch for search scopes; clearing it restores the previous context. |
| Reader and editor | Title and folder provenance before the body. Do not render the title twice. Title is editable; a note without a title heading starts with the readable filename. Saving an edited title must not eat the first body line. One editor for new and existing notes, with Cancel/Save and formatting controls at the bottom. Protect actual unsaved edits; on failure keep the draft. Delete asks first. |
| Pins and order | Folder order and pins use the same reordering sheet shape, including VoiceOver move actions. Choosing a new folder order activates Manual order; if save fails, show the stored order and the error. Do not use a stale filename or response as the visible title after an edit. |
| Tasks | Distinguish reading task detail, editing the task, choosing a date/time and choosing options. Preserve scope and edits while moving between them. Reuse the shared task row in Notes and Home. |
| Graph | [Folder clusters](docs/ui/graph-3d/brief.md): project actual Vault nodes and links in 3D with labelled top-level folders. Depth and opacity carry hierarchy; explicit links are stronger than similarity. Use the selected-note preview above the same dock to open the reader. Pan, rotate and zoom under user control; never rotate the whole camera by itself. |

## Proactive and notification opening

- **One iPhone switch**, **Proactive suggestions**. Save on change, preserve the last confirmed state while pending, and offer Retry. **Background suggestions** is detail, not another engine toggle. Keep source controls and guidance in their editor. This is the iPhone direction after [#2028](https://github.com/DanAakesen/jarvis/pull/2028); do not copy the old two-switch layout to it.
- **A reply push opens existing Chat.** Show one useful preview, not an approval summary. In Chat open the exact committed message without animating away from the target; allow Jump to latest. Watch waits until an active turn, dictation or Voice is idle and keeps the pending target across refresh. Proactive items and approval actions have distinct routes. If the target cannot load, show Chat's retry state, not another message.

## Watch

[Adaptive Chat composer](docs/ui/watch-chat/HANDOFF.md) and [focused Voice](docs/ui/watch-voice/HANDOFF.md) are the references. Keep one Chat entry point. At rest the composer has a short Message/dictation path and voice orb; with text, preserve editing, clear/send and keyboard access. Give transient dictation/capture status its own clearance, not an overlay on the action row.

Voice uses a focused conversation-sized layout with state/captions and accessible End. Return to the same Chat rather than opening a parallel transcript. Recovery must keep the draft; a new attempt must not inherit a prior capture or deceptively stay at Starting. Show a reconnect/error and a way back to typing. Keep complications glanceable; steps show today's evidence, never an invented progress value. Native controls and small-screen evidence are indexed in the [Watch handoff](docs/ios/design/watch/README.md).

## Home, workspaces and utility pages

- **Home** puts the brief and next action first. Keep the daily activity projection independently usable; an unavailable brief must not hide confirmed task/activity data. Use shared rows and visibly distinct stale/loading states. Widgets and Live Activities are glanceable summaries and routes back into the real screen, not alternate editors.
- **Web stage and workspaces** keep the centred Jarvis stage on conversational surfaces, and reserve the workspace for user-opened results. On a phone keep a single primary surface; don't crowd Chat with a second desktop column or cover the composer with a floating menu. Opening or closing a Voice/Chat presentation should preserve workspace state, not delete work.
- **Factory** makes project/task status, next action and failure visible before auxiliary diagnostics. Keep task selection and actions scoped to the project; don't show a previous task's result while a new one loads. See the [composition reference](docs/ui/software-factory/README.md).
- **Health and insights** describe the source, period and units in context. Distinguish logged from estimated, missing from zero, and current from stale. Make drill-down and data alternatives usable without colour. Keep capture and correction flows separate from read-only summaries. Do not infer support for a new entry action from a design board.
- **Settings and status** show saved values, actionable errors and evidence freshness; don't repeat a row's status in a second card. Respect sign-in and lock/privacy cover; a pending response must not turn a locked view into a notification bypass.

## Evidence and design history

The [current documentation index](docs/README.md) separates operating references, accepted visual handoffs and historical checks. Concepts, fixture captures, source review, simulator build and physical-device acceptance are different evidence. Native follow-latest, Voice and Watch recovery, title visibility after sync, and push taps require device confirmation after a build lands. CarPlay is a voice-first direction, not a claim that the in-car interface is shipped or device-tested; see [Apple capabilities](docs/ios/apple-capabilities.md).

<a name="stage-glass-shell-and-docked-conversation--6-october-2026-local-ui-session-with-dan"></a>

The [6 October stage and docked conversation record](docs/archive/design-2026-10-03-to-2026-11-22.md#stage-glass-shell-and-docked-conversation--6-october-2026-local-ui-session-with-dan) is historical.

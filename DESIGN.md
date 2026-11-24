# Jarvis design direction

Use the [UI style guide](docs/ui/style-guide.md) for tokens, shared components, motion, accessibility and hard rules. This page sets composition and behaviour for each surface; it does not define a second palette. [Product requirements](PRODUCT.md), [current work and device acceptance](PLAN.md), and [decisions](docs/decisions.md) are separate. Screens and their code live in [the UI map](ui.md).

## Shared control geometry

Use the shared Jarvis controls for equivalent actions. The web action classes and iOS glass controls own their geometry, focus, disabled and pending states; space them with the parent layout. Rows share the row surface, not a hero-card treatment. Keep buttons in a stable place while pending. Never introduce per-screen glass or draw a second orb.

## One living neural background

Use the shared orb and network, not a screen-specific effect. Chat, Voice and the opening may show a more active state. Other pages keep a calm backdrop; forms and sheets do not need another orb. The opening means startup, never listening. On iPhone, pushed pages keep the back gesture **and** an accessible Back control; the opposite edge opens the sidebar where supported. Shared page chrome must not clip focus, the last scroll row or the bottom safe area.

## Chat

- **iPhone Home and Chat composers.** At rest, the draft and controls share one row. Focus moves the editor above the controls. Dismissing the keyboard folds the draft back to one line. Dictation keeps the waveform visible, and Reduce Motion skips the transition.
- **Turn first.** Keep draft edits local to the composer; typing should not re-layout the transcript. On return from the background, show the active reply or the saved answer, without a second send. Follow the latest content when already at the end. Reading earlier text pauses following; show **Jump to latest**, and never pull an exact notification target away from the reader. A queued typed turn during Voice is still one message, not a second speculative answer.
- **Follow Voice without replaying it.** iPhone Chat displays the current Voice state when relevant and follows new Voice transcript/reply content using the same follow-latest rules. Show real work rather than a lingering Speaking label.
- **Make status truthful.** Name a known step. Don't infer an error from a slow stream or infer success from a click. Use the shared failure sentence; distinguish a failed tool, an interrupted response and a write that may have completed.
- **Compact tool tree.** Use an icon, an action label and inline disclosure for grouped calls. While running, trace a moving highlight around the icon outline and shimmer the label; don't pulse the icon. A group shows the worst child state: running while any child runs, then failure before refusal, then success only if every child succeeded. Child status must remain readable without colour or motion. Omit counts and filler.
- **Blocks stay in the conversation.** Generated results scroll as part of the assistant message and stay in history, not in a sheet. Keep date, place, units, source and issue time with the relevant result. Charts use one scale per unit and provide View data and Copy data. Missing values are gaps, not zeros. Unsupported content keeps a text alternative. Keep ordinary assistant prose unboxed.

The Apple Maps card shows the native map with each place or route, a labelled estimate and one Directions action. Nearby store searches show verified local businesses or an explicit no-match result. Multiple matches are selectable. The owner can repeat an expired lookup. Voice can read the estimate while the phone shows the same card.

## Voice

Use the established Voice screen and controls; no provider selector, engine badge or split speech settings. Connecting, Listening, Thinking, Speaking, Reconnecting and Ended reflect evidence from the session. Speaking tracks playback, not whether the mic is off. An old reply must not keep Speaking on during a later turn. Keep caption order stable on reconnect. The GPT-Live backend is audio-only: after an unsupported camera or screen response, stop capture and explain why.

**Voice only:** generated visuals open in the bottom panel, between the captions and call controls. There is no panel without content. The newest visual takes focus and earlier ones remain to its left. Use the panel grabber to expand/collapse; make it operable in VoiceOver and keep a plain × at top right with a full tap target. Fade the scrolling content at both edges and give the first and last lines room to clear the fade. Short text results fit their content. On iPhone, Speaking follows audible playback. During silence, return to Listening or show Thinking if Jarvis is still working. Keep Mute, Speaker and End reachable on iPhone. Speaker shows the active output and switches between speakerphone and the system call route. A downward gesture in the orb/status region minimises Voice; a gesture in captions or content only scrolls it. Reduce Motion removes the transition, not the affordance. Speech, capture recovery and gestures on a real device are not verified by this guide.

## Notes, Tasks and Graph

| Surface | Current direction |
| --- | --- |
| Library | Title row, folder/sort actions in the header menu, content, then the fixed Notes/Tasks/Graph switch and Search/+ row. No Recent section. A query swaps the mode switch for search scopes; clearing it restores the previous context. On reopen, show the last available rows while fetching fresh results. |
| Reader and editor | Show the title and folder before the body. Use the same title in the list, reader, pins and generated links; preserve explicit link aliases. Hide only repeated leading copies of the same H1 in the reader, not later sections or editable Markdown. The title is editable and falls back to a readable filename. Saving it must not eat the first body line. Keep a draft on failure. Delete asks first. |
| Pins and order | Folder order and pins use the same reordering sheet and VoiceOver move actions. Changing folder order selects Manual; on failure show the stored order and the error. An unresolved pin shows its Vault path and labelled Unpin in the same row, with no Open or Delete. |
| Tasks | Distinguish reading task detail, editing the task, choosing a date/time and choosing options. Preserve scope and edits while moving between them. Reuse the shared task row in Notes and Home. |
| Graph | Project actual Vault nodes and links in 3D. Label top-level folder clusters, ring notes with open tasks, and show the actual open-task count in the selected-note preview when known. Depth and opacity carry hierarchy; explicit links are stronger than similarity. The preview opens the reader. Pan, rotate and zoom under user control; never rotate the whole camera by itself. |

## Proactive and notification opening

- Show the single **Proactive suggestions** switch directly in the main iPhone Settings list. Save on change, preserve the last confirmed state while pending, and offer Retry. **Background suggestions** is detail, not another engine toggle. Keep source controls and guidance in their editor.
- **Background suggestions** shows the check cadence, Copenhagen review times and the next queued check when one is due.
- **A reply push opens existing Chat.** Show one useful preview, not an approval summary. In Chat open the exact committed message without animating away from the target; allow Jump to latest. Watch waits until an active turn, dictation or Voice is idle and keeps the pending target across refresh. Proactive items and approval actions have distinct routes. If the target cannot load, show Chat's retry state, not another message.

## Watch

Chat (or Resume) and Menu share a slim gradient surface aligned with Up Next. Each gets half the row and a full tap target. At accessibility text sizes the actions stack. As a section heading scrolls out of view, its name appears at the leading edge of the toolbar beside the system clock. At the bottom, the title is Recent Notes. Whole section headings open their details.

Menu uses labelled symbol tiles that adapt to text size. Agenda and Notes show each date once. Factory groups work by status and opens long titles on tap. Home uses the Today screen’s amber accent for Up Next and the Log lift action.

Keep one Chat entry point. When reading history, collapse the composer to **Reply** only if it will not interrupt a draft, dictation or a call. **Reply** reopens the composer. At rest show Message, dictation and the Voice orb. Dictation appends to the editable Chat draft. An empty composer takes one control row. The draft wraps to at most three lines. With text, Send replaces both audio controls beside the draft. Send, Dictate and Voice each use their full 44 × 44 pt tap area. Tapping the field opens native editing directly. Give transient status its own space above the action row.

In a focused Voice call, replace the composer and Start control with **Mute/Unmute** and **End**, keeping state and captions visible. End returns to the same Chat and reloads the stored turn; a partial live caption is not the saved reply. Recovery keeps the draft; a new attempt must not inherit a prior capture or get stuck at Starting. Show a reconnect/error and a way back to typing.

Circular complications draw their symbols and task count on a clear background. Voice uses the orb in full colour and a waveform on tinted or dimmed faces. The steps complication shows today's measured progress.

## Home, workspaces and utility pages

- **Home** puts the brief and next action first. Keep the daily activity projection independently usable; an unavailable brief must not hide confirmed task/activity data. Use shared rows and visibly distinct stale/loading states. Widgets and Live Activities are glanceable summaries and routes back into the real screen, not alternate editors.
- **Web stage and workspaces** keep the centred Jarvis stage on conversational surfaces, and reserve the workspace for user-opened results. On a phone keep a single primary surface; don't crowd Chat with a second desktop column or cover the composer with a floating menu. Opening or closing a Voice/Chat presentation should preserve workspace state, not delete work.
- **Factory** makes project/task status, next action and failure visible before auxiliary diagnostics. Keep task selection and actions scoped to the project; don't show a previous task's result while a new one loads.
- **Health and insights** describe the source, period and units in context. Distinguish logged from estimated, missing from zero, and current from stale. Make drill-down and data alternatives usable without colour. Keep capture and correction flows separate from read-only summaries. Nutrition’s **Log meal** sheet takes kcal and optional protein in grams. Today shows the resting target, active kcal and calorie deficit directly below the remaining balance shared with Chat. Longer periods show the daily average intake. Save adds one meal for today, regardless of the chart period.
- **Settings and status** show saved values, actionable errors and evidence freshness; don't repeat a row's status in a second card. Respect sign-in and lock/privacy cover; a pending response must not turn a locked view into a notification bypass.

## Acceptance

Concepts, source review and simulator results do not establish physical-device acceptance. Follow [the plan](PLAN.md) for device checks. CarPlay is a voice-first direction, not a shipped interface; see [Apple capabilities](docs/ios/apple-capabilities.md).

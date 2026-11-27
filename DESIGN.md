# Jarvis design direction

Composition and behaviour. See the [style guide](docs/ui/style-guide.md) for appearance and controls and the [UI map](ui.md) for screens and code.

## Shared control geometry

The Watch Up Next card sets the reference for depth. iPhone dashboard cards share a 16 pt content inset and 24 pt continuous corners. Use the [shared finish](docs/ui/style-guide.md#3-glass-and-surfaces) instead of a fixed gradient or rim. Card glow applies the same upper-left highlight across pages. Watch uses compact geometry. Keep icons and labels aligned inside the hit target.

Use shared controls for equivalent actions and space them in the parent layout. Rows use the row surface, not a hero card. Keep pending buttons in place. Never introduce per-screen glass or draw a second orb.

## One living neural background

Use the shared orb and network, not a screen-specific effect. Chat, Voice and the opening may show a more active state. Other pages keep a calm backdrop; forms and sheets do not need another orb. The opening means startup, never listening. On iPhone, pushed pages keep the back gesture **and** an accessible Back control; the opposite edge opens the sidebar where supported. Shared page chrome must not clip focus, the last scroll row or the bottom safe area.

## Chat

- **iPhone Home and Chat composers.** At rest, the draft and controls share one row. Focus moves the editor above the controls. Dismissing the keyboard folds the draft back to one line. Dictation keeps the waveform visible, and Reduce Motion skips the transition.
- **Turn first.** Keep draft edits local so typing doesn't re-layout the transcript. On return from the background, show the active or saved reply without a second send. Follow only at the end; show **Jump to latest** when reading back. A queued typed turn during Voice is still one message.
- **Follow Voice without replaying it.** iPhone Chat displays the current Voice state when relevant and follows new Voice transcript/reply content using the same follow-latest rules. Show real work rather than a lingering Speaking label.
- **Make status truthful.** Name a known step. Don't infer an error from a slow stream or infer success from a click. Use the shared failure sentence; distinguish a failed tool, an interrupted response and a write that may have completed.
- **Compact tool tree.** Use an icon, an action label and inline disclosure for grouped calls. While running, trace a moving highlight around the icon outline and shimmer the label; don't pulse the icon. A group shows the worst child state: running while any child runs, then failure before refusal, then success only if every child succeeded. Child status must remain readable without colour or motion. Omit counts and filler.
- **Blocks stay in the conversation.** Generated results scroll as part of the assistant message and stay in history, not in a sheet. Keep date, place, units, source and issue time with the relevant result. Charts use one scale per unit and provide View data and Copy data. Missing values are gaps, not zeros. Unsupported content keeps a text alternative. Keep ordinary assistant prose unboxed.

The Apple Maps card shows the native map with each place or route, a labelled estimate and one Directions action. Nearby store searches show verified local businesses or an explicit no-match result. Multiple matches are selectable. The owner can repeat an expired lookup. In Voice, the iPhone speaks the estimate locally when audio is available.

## Voice

Use the established Voice screen and controls; no provider selector, engine badge or split speech settings. Connecting, Listening, Thinking, Speaking, Reconnecting and Ended reflect evidence from the session. Speaking tracks playback, not whether the mic is off. An old reply must not keep Speaking on during a later turn. Keep caption order stable on reconnect. The GPT-Live backend is audio-only: after an unsupported camera or screen response, stop capture and explain why.

**iPhone Voice.** Keep the orb fixed behind captions and windows. Swipe between full result cards; neighbouring cards sharpen on entry. The headline scrolls with the content. Swipe across the card to page, swipe up on it to expand, or swipe down from the top of its content to collapse. Tapping the grip also changes size. Charts show their full range within the card. The floating × dismisses the selected window. **+ → Windows** reopens it in the same call; a new call starts empty. Results stay in Chat. Spoken previous, next and close follow the same selection. Show Thinking while a settled request awaits an answer and Listening when the owner continues. Live Activity actions use the primary accent; the state label uses the secondary. Keep Mute, Speaker and End reachable. Speaker shows the active output and switches between speakerphone and the system call route. A downward status gesture minimises Voice; captions scroll independently. Reduce Motion removes the transition, not the affordance.

## Notes, Tasks and Graph

| Surface | Current direction |
| --- | --- |
| Library | Title row, folder/sort actions in the header menu, content, then the fixed Notes/Tasks/Graph switch and Search/+ row. No Recent section. A query swaps the mode switch for search scopes; clearing it restores the previous context. On reopen, show the last available rows while fetching fresh results. |
| Editor | Open directly into a draft with Cancel and Done in the header. Render headings, emphasis, highlights, inline code and lists in place. Reveal Markdown markers on the line being edited. Keep linked notes and formatting tools above the keyboard. Return continues lists and ends them on an empty item. Insert table adds an editable two-by-two grid with row and column controls. Save pipe tables as separate Markdown paragraphs so Obsidian renders them. Done saves content and any folder move together. Preserve frontmatter, explicit aliases and the draft on conflict. |
| Pins and order | Folder order and pins use the same reordering sheet and VoiceOver move actions. Changing folder order selects Manual; on failure show the stored order and the error. An unresolved pin shows its Vault path and labelled Unpin in the same row, with no Open or Delete. |
| Tasks | Distinguish reading task detail, editing the task, choosing a date/time and choosing options. Preserve scope and edits while moving between them. Reuse the shared task row in Notes and Home. |
| Graph | Project actual Vault nodes and links in 3D. Label top-level folder clusters, ring notes with open tasks, and show the actual open-task count in the selected-note preview when known. Depth and opacity carry hierarchy; explicit links are stronger than similarity. The preview opens the note. Pan, rotate and zoom under user control; never rotate the whole camera by itself. |

## Proactive and notification opening

- Findings precede Reviews: shared switch, next check, last outcome and expandable history. Edit preferences inline, with My preferences first for standing interests and the collapsed Advanced review routine last. The existing vault p0.md holds current priorities. Reload saved values on conflict, retaining the draft; offer Retry on failure.
- **A reply push opens existing Chat.** Show one useful preview, not an approval summary. In Chat open the exact committed message without animating away from the target; allow Jump to latest. Watch waits until an active turn, dictation or Voice is idle and keeps the pending target across refresh. Proactive items and approval actions have distinct routes. If the target cannot load, show Chat's retry state, not another message.

## Watch

Chat (or Resume) and Menu share a slim surface with the saved finish, aligned with Up Next. Each gets half the row and a full tap target. At accessibility text sizes the actions stack. As a section heading scrolls out of view, its name appears at the leading edge of the toolbar beside the system clock. At the bottom, the title is Recent Notes. Whole section headings open their details.

Menu uses labelled symbol tiles that adapt to text size. Agenda and Notes show each date once. Factory groups work by status and opens long titles on tap. Up Next and Log lift use the saved primary accent.

Keep one Chat entry point. When reading history, collapse the composer to **Reply** only if it will not interrupt a draft, dictation or a call. **Reply** reopens the composer. At rest show Message, dictation and the Voice orb. Dictation appends to the editable Chat draft. An empty composer takes one control row. The draft wraps to at most three lines. With text, Send replaces both audio controls beside the draft. Send, Dictate and Voice each use their full 44 × 44 pt tap area. Tapping the field opens native editing directly. Give transient status its own space above the action row.

In a focused Voice call, replace the composer and Start control with **Mute/Unmute** and **End**, keeping state and captions visible. End returns to the same Chat and reloads the stored turn; a partial live caption is not the saved reply. Recovery keeps the draft; a new attempt must not inherit a prior capture or get stuck at Starting. Show a reconnect/error and a way back to typing.

Circular complications draw their symbols and task count on a clear background. Voice uses the orb in full colour and a waveform on tinted or dimmed faces. The steps complication shows today's measured progress.

## Home, workspaces and utility pages

- **Home** opens with Up Next. Its date tile and relative time identify the next appointment or task. Expand Activity to inspect workouts and Schedule to see more tasks and appointments. The compact disclosure row stays tappable across its width. Pinned notes follow Schedule in Notes pin order and open the editor directly. Each card can show data while another source is unavailable.
- **Calendar** opens the day at 07:00 with ten hours in view. Scroll for earlier or later appointments. Day and Week share a time scale; the grid, agenda and date headings use one time zone. Hold an appointment to move it or expand its agenda row to edit. Hold an empty slot to preview a one-hour appointment, drag to adjust it in 15-minute steps, and release to open its draft. Day, Week, Month and Today sit directly above search and add in the footer.
- **Web stage and workspaces** keep the centred Jarvis stage on conversational surfaces, and reserve the workspace for user-opened results. On a phone keep a single primary surface; don't crowd Chat with a second desktop column or cover the composer with a floating menu. Opening or closing a Voice/Chat presentation should preserve workspace state, not delete work.
- **Factory** leads with Needs you, then the grouped pipeline. Keep actions scoped to the project and never show a previous task's result while a new one loads.
- **Usage and Status** put the summary first. Usage breaks down the selected period and discloses resource details; Status separates issues from unconfirmed checks and discloses healthy checks and maintenance. Keep the latest snapshot on refresh failure and show the error.
- **Health** stacks Training, Steps, Sleep and Nutrition. Each card owns its period. All shows synced history by month. Body trend filters readings by metric and period, including All. Lift and workout sheets open at content height, with weight, reps and sets together or session types in a compact grid. Training shows its selected period once and lists walks separately when present. Tap a training day for sessions and expand Saved max lifts for personal records. Nutrition uses the same calorie allowance as Chat. Scan meal attaches a photo to the Chat draft without sending.
- **Settings** shows saved values and actionable errors. Appearance shares the Gradient, Frost and Glass finish; per-card overrides change colour only. Keep the sign-in and lock cover in effect during a pending response.

## CarPlay

Use Apple's native list and voice templates. Image cards switch filters and notes expand in place. Talk shows the actual call state and animates unless Reduce Motion is on. End returns to the dashboard. CarPlay sets layout and text limits.

## Acceptance

Source and simulator results do not establish [device acceptance](PLAN.md#next-steps-and-blockers).

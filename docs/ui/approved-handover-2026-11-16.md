# Jarvis approved design handover

Prepared 16 November 2026 for implementation of #1924 and #1925. These are approved visual directions and required behaviors, not a claim that rendering, persistence or native interactions have been implemented. Images contain illustrative content. Follow the requirements below when a generated image is ambiguous.

## Approved references

| Area | Selected design | Reference |
| --- | --- | --- |
| 3D vault graph — #1924 | Graph 2: Folder clusters | [Approved graph](graph-3d/approved-folder-clusters.png) |
| Voice generated content — #1925 | Option 1: Bottom panel | [Reference board](jarvis-window-sheet/voice-bottom-panel-reference.png): **right-hand Voice phone only** |
| Chat generated content — #1925 | Conversational blocks | [Approved Chat](chat-generative/approved-conversational-blocks.png) |

Selection clarification: Dan wrote “number 2 conversation blocks”. The named Conversational blocks image has a heading numbered 3. The name identifies the selected design; the chart-led alternative is not selected. The Chat sheet shown on the left of the Voice board is superseded by inline Chat blocks.

Earlier approved Notes overview, note/task detail pages, editors and creation sheets remain in [the Notes handoff](notes-subpages-2026-11-15/HANDOFF.md). This handover extends that work; it does not reopen its choices or claim all earlier concepts are implemented.

## Shared visual contract

- Retain the near-black navy neural background and cognitive lattice orb. Reuse the existing background and orb components; no replacement drawing or baked screenshot UI.
- Use neutral smoked Apple glass for controls. No yellow, orange or gold button fills. Use amber text/icons for primary actions, neutral secondary labels and muted disabled states. The existing softly warm user message bubbles remain.
- Preserve the current Chat composer and Voice control bar. Keep primary actions reachable with the right hand and protect safe areas, keyboard space and scroll insets.
- Reuse `JarvisIconButton`, `JarvisLabelledButton`, `JarvisMenuButton`, `JarvisSheetConfirmButton`, `JarvisSheetCloseButton`, `JarvisComposerIconButton`, `JarvisOrb`, `JarvisPageScaffold` and `JarvisPageHeader` where applicable. Apply surfaces through `jarvisGlassSurface`; do not add screen-local button styles or glass effects.
- Assistant prose remains unboxed. Structured forecast/chart content may use the approved neutral surfaces. Use one heading per block; normal body text carries supporting context.
- Follow [the style guide](style-guide.md) and shared tokens. Mockup dimensions, device frames and sample status-bar artifacts are not implementation specifications.

## Graph: Folder clusters

Show actual vault notes and links in spatial groups by folder. Preserve the overview and focused-cluster compositions in the reference: Work in amber, Personal in green, General in muted violet, with labels as well as color. Use perspective, size and fading for depth; keep connecting lines quiet enough to distinguish nodes. Orange rings identify notes with open tasks; the preview provides the actual task count.

Selecting a note exposes its title, vault path and task context in a compact preview above the dock. Opening it leads to the existing note reader. The graph must reflect the vault's real relationships and task data, not generated sample nodes.

Keep the equal-width Notes / Tasks / Graph switch above the fixed Search field and separate + button. Header ellipsis remains beside the right navigation button. Preserve search, navigation and creation behavior while exploring the graph.

Implementation checks: selection and navigation work; filtering/search preserve coherent context; overlapping nodes remain selectable; loading, empty and failed graph states are readable; motion can be reduced; actual node counts and device performance are tested. Gesture details and performance limits must be reconciled with #1924 and existing code rather than inferred from this static image.

## Voice: Bottom panel

Present generated content on the active Voice page, below the lattice orb and status, above the existing microphone, plus, CC and hang-up buttons. The panel uses neutral glass with a readable surface. Its title and content change with the result Jarvis is presenting; Moving plan is only the example.

Keep the orb/status visible and the four Voice controls usable. Close dismisses the content panel without ending the voice session. Internal scrolling must not hide essential call controls. Preserve the illustrated close and open-detail affordances only when their actions are supported; opening a detail must retain the voice session. Any expanded presentation must preserve a clear return path.

Implementation checks: opening/dismissing content during listening, thinking and speaking; long content; CC visible; microphone and hang-up still operable; interrupted animations; errors or unavailable content. The reference says Connecting, but production must display actual session state.

## Chat: Conversational blocks

Jarvis chooses the appropriate supported UI block for its answer. Generated content belongs to the assistant message in the conversation, not a modal sheet or a single temporary window slot.

Example flow:

1. User asks for Friday's Copenhagen forecast.
2. Jarvis replies with a short sentence and an inline forecast block containing place/date, conditions, high/low temperature, source and issue time.
3. User asks for temperature and rain through the day.
4. Jarvis adds a new reply with a short interpretation and a chart block: temperature line and rain-probability bars, with labelled units and time axes.
5. The user continues chatting, scrolls back, leaves and reopens the conversation. Both original blocks remain attached to their original replies and retain their original data.

The forecast and chart are examples of generative UI, not a permanent weather dashboard or the only permitted result types. Prefer existing supported renderers and data contracts after inspecting the repository. The model chooses content within supported components; implementation must not equate generative UI with executing arbitrary model-produced code.

Keep the current composer pinned and usable. Blocks scroll with messages; allow a block to grow without moving a reader away from older content. New replies should follow the existing chat scroll behavior. There is no sheet handle, close button or modal dimming around Chat blocks.

Historical results are snapshots. Preserve forecast date, location, units, source and issue time. Returning to history must not silently fetch a new forecast and overwrite what was originally said. An explicit new request may create a fresh result. Sample values in the design must never become production defaults.

For charts, provide meaningful axis labels, series identity beyond color, selected-point values and an accessible textual/data alternative. Temperature is in degrees Celsius; rain probability is a percentage, not rainfall volume. Preserve separate scales. The reference ellipsis is for supported block actions, such as viewing the underlying data; do not ship an inert menu.

Implementation checks:

- Forecast creation and a follow-up generated chart both appear inline and in the correct message order.
- Both results survive scrolling, navigation away, app restart and conversation-history reload, without duplicating or regenerating historical content.
- Rendered values match the stored source data. Missing values and partial results remain explicit; failures show local recovery without fabricated success.
- An unavailable or unsupported block has a readable fallback in its original message; ordinary chat remains usable.
- Long replies, keyboard display, larger text, VoiceOver and Reduce Motion/Transparency are handled. Controls remain reachable and content never overlaps the composer.

## Delivery and verification

Inspect the existing #1924/#1925 briefs, renderer support and persistence before implementation. The latest approved split here supersedes any older requirement to show a sheet in typed Chat. Keep the same existing conversation and vault sources; avoid parallel storage models unless the required durable blocks demonstrably need an extension.

Implement each surface with its loading, empty, error/recovery and populated states. Validate shared-component guard tests and appropriate logic/persistence checks, then inspect the actual iOS UI at relevant sizes and with long content. Record native screenshots and verify motion on a simulator or device; static concepts alone do not prove interactions or performance.

This handover and its three reference images were checked locally. No app code, service, database, vault content, GitHub issue or deployment was changed for this handover. No runtime, simulator or persistence validation is claimed.

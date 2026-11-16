# Jarvis Notes subpages

Owner-approved visual extension of the Vault Folders overview, 15 November 2026. Dan accepted the subpage layouts with one correction: remove yellow filled button backgrounds and use yellow text where needed. These boards show one consistent design across the detail pages and sheets. All content and relationships are illustrative. No app or vault changes have been made. Visual approval does not establish backend support or runtime verification.

## Visual and navigation contract

Retain the approved dark navy network background, orange task rings, quiet document/list surfaces and Apple glass controls. All action buttons use neutral dark smoked glass: no yellow/orange/gold fill or warm gradient. Primary labels such as Save, Done, Continue to note, Choose folder, Retry and Review changes use yellow/amber text; secondary labels stay neutral and disabled labels muted. Preserve semantic colors on native switches, selection indicators and task rings. Apply glass through shared Jarvis controls and `jarvisGlassSurface`. Keep header ellipsis beside the right navigation button. No Recent section or permanent context toolbar above the main view switch. Search and separate + remain fixed on browsing pages, with adequate scroll insets and an opaque-enough background to prevent text collisions.

Readers use a reachable lower Edit/Close row. A modal sheet covers and disables the underlying Search/+ rather than duplicating them. In a keyboard-focused editor, a compact accessory puts Cancel on the left and Save on the right; the editing surface replaces browsing controls until dismissed. Preserve native back navigation and interactive dismissal, with draft protection only after actual edits. Body content uses readable native text and can scroll without moving the action controls offscreen.

## Boards and flows

| Board | States |
| --- | --- |
| Notes | Read a note; edit with keyboard; note actions; incoming/outgoing linked notes |
| Tasks | Task detail; edit with keyboard; date/time; scope and priority |
| Create | Bottom + menu; new note; new task; staged new folder |
| Find & organise | Folder contents; destination picker; scoped search; header sort/filter menu |
| Edit & recover | Rename; reorder pins; save conflict; save failure |

### Notes

Tap a note row or the graph preview's title to open the reader. Show the title, compact folder provenance and rendered Markdown; retain headings, checklists and clickable internal links. Properties are hidden in reading view and preserved in source. The lower-right Edit action opens the same document editor used for creation, with title/body immediately editable and formatting tools near the keyboard. Explicit Save uses the version obtained when reading. Cancel preserves or discards only after an actual draft change.

The note ellipsis contains Pin/Unpin, Rename, Move to folder, View connections and Delete note. Rename is a focused name sheet. Move reuses Choose folder with the final action labeled Move; identify the source and destination and check link handling before applying it. Neither action may silently break source identity or linked tasks. Backend support must be verified; these controls describe requested behavior, not existing route availability.

Linked notes is a compact list sheet separating outgoing links from notes linking here. Each row shows its real path and opens that note. The graph's List command opens the same accessible connection list with a graph-scope heading; recenter and folder selection remain in its header menu. Do not infer new graph links from the mockups.

### Tasks

Task detail shows one completion circle, title, source note, due date/time, priority, scope and supported task text. Tapping the source row opens its containing note. Tapping Edit or an editable field opens the editor or relevant option sheet. Completing/reopening is separate from editing and deletion; failures remain visible beside the affected action.

The schedule sheet offers a native date selector, optional time and a clear remove-date action. A one-hour-before reminder is a proposed default only if the integration supports reminders; do not advertise an operational reminder without that capability. Priority uses Normal, Medium and High labels, not color alone.

Scope for new tasks is explicit Work or Personal. For an existing task, scope comes from its source location: changing scope requires an explicit source/destination change supported by the backend. Do not relabel a Work task Personal while leaving it in the Work source note. The options board illustrates the controls rather than authorizing this mismatch. Task source identity and the selected occurrence in Markdown must survive updates.

### Plus and creation

The + opens a short menu anchored above the bottom-right button: New note nearest the thumb, New task and New folder. In Tasks, New task takes the nearest position. Graph creation offers the same actions without automatically linking a new note to the selected node.

New note opens directly into a focused writing sheet with a visible destination row. Use the selected folder, otherwise the last valid destination. Show title and body without giant form cards. Save remains disabled with a clear accessible explanation until inputs are valid. Drafts remain available after recoverable failures; never mark unsaved content saved.

New task opens a focused title with visible scope/source and compact optional date and priority controls. The schedule and options sheets return to the same draft without clearing its title. Saving updates the vault-backed task representation, not a separate notes database.

New folder chooses a parent and name, then Continue to note opens a new note in that proposed destination. Current vault behavior persists a folder only when its first note is saved. Canceling the note leaves no empty folder behind. A future standalone folder implementation would need its own confirmed storage behavior.

### Browsing and organisation

Folder contents use the same compact note rows and fixed browsing dock. The destination picker exposes root notes and all normal folders, including nested ones, while preserving hidden-folder restrictions. Separate expansion and selection targets and show the chosen destination with a checkmark. Folder inventory errors provide Retry rather than substituting a fabricated tree.

Search uses the existing bottom field. While searching, All/Notes/Tasks search scopes replace the ordinary mode switch; show current scope in the placeholder/accessibility name and retain query while changing scope. Keyboard dismissal expands the result list. Clearing/exiting search restores the previous folder, mode and scroll position. In Graph, search focuses real matching nodes and provides matching rows as an alternative.

The Notes header menu holds folder scope, Updated/Title/Manual sort, Reorder pins and Select items. Tasks uses appropriate due-date/priority/manual sorting. Graph uses folder scope, List and Recenter. Reordering pins is display metadata, never a file move or a rewrite of the task order inside Markdown. Provide drag handles plus Move up/down accessibility actions; preserve focus after moving.

Select items is a proposed bulk-selection state: each row gains a selection control and a lower action row replaces normal navigation while selecting. Only expose operations supported for every selected item. State how many items an operation affects. Pin/unpin and moving notes are appropriate when supported; task completion and note deletion remain distinct. Cancel restores ordinary browsing without mutations.

## Deletion and recovery

Keep the approved short-left-swipe Pin / long-left-swipe Delete interaction. A deep swipe deletes the identified item through the actual vault service, not merely by hiding the row. Note actions delete the source note; task actions delete only the selected task occurrence. Never silently delete its containing note. Preserve actual backend conflict and authorization requirements. Display Undo only if restoration is genuinely supported and tested; otherwise do not promise it. Provide an accessible menu alternative to every swipe action.

Save conflict retains the draft, explains that the source changed, and offers Keep editing or Review changes. Review changes compares draft and latest version before an explicit resolution. Never auto-overwrite or resolve a conflict through retry. A save/network failure keeps the draft and offers Retry. Avoid claiming durable offline drafts unless persistence exists; protect in-memory drafts during the current session and clearly report any storage limitation.

Additional states use the same layout: empty folder says No notes here with the existing + available; empty task list says No open tasks; zero search results show the query/scope and Clear search; loading uses quiet native activity/row placeholders without fabricated note content; unavailable graph shows Retry and any genuinely available list fallback. Hidden/inactive sheets do not announce or intercept controls.

## Implementation and acceptance boundaries

Use current shared scaffolds, controls, localized Danish/English strings and vault clients. Inspect current routes before implementing proposed rename/move/delete, sorting, pin order, bulk operations and reminders. Older project documentation does not necessarily describe the screenshot build. Do not assume feature availability from artwork.

Verify keyboard appearance/dismissal, safe areas, large text, VoiceOver order/actions, orange-ring contrast, Reduce Transparency, Reduced Motion, small screens, interrupted saves, source conflicts, failed writes, back navigation and repeated taps. Rendering these concept boards is not browser, simulator or device verification. The compositions and neutral-glass action styling are owner-approved; no implementation is performed by this design delivery.

## Package files

- `00-approved-overview.png`: selected baseline, included for continuity.
- `01-notes.png`: corrected note editor with Save/Cancel by the keyboard.
- `02-tasks-glass-v2.png`: detail, editing, schedule and task options, corrected button surfaces.
- `03-create-glass-v2.png`: plus menu and creation sheets, corrected button surfaces.
- `04-find-and-organise-glass-v2.png`: folders, picker, search and header menu, corrected button surfaces.
- `05-edit-and-recover-glass-v2.png`: rename, reorder, conflict and failed-save states, corrected button surfaces.
- `prompts.json`: generation instructions for traceability.
- `glass-v2-prompts.json`: button styling revision instructions.

Use actual native keyboards and a single active insertion caret; keyboard artwork and incidental caret marks in the concepts are illustrative. Apply the same keyboard-accessory Save/Cancel placement across every editor, including recovery views. The selected source-note scope is authoritative even where a concept shows an options control.

The earlier unversioned boards remain historical originals. Use the corrected `glass-v2` images and `jarvis-notes-subpages-glass-v2.zip` for handoff. The original approved overview and refinement brief remain in `../2026-11-15-notes/` in the workspace.

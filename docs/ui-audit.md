# Web UI style audit (P14-01)

This audit records the recurring UI forms across the web app and the canonical
treatments selected from the existing Jarvis design system. The shared source
of truth is `apps/web/src/styles.css`; route stylesheets own workflow layout,
not parallel palettes or control systems.

## Phone top bar at 320px and the phone menu (P14-16; 19 October 2026)

The 320px overflow (A1) was the phone top bar needing 353px of the 300px content
box a 320px phone leaves: the context title (47px), the job tabs (122px), four
44px actions (windows, presence, Menu, Settings) and two 4px gaps. The Settings
link ended at x=365, so `document.scrollWidth` was 365 against a `clientWidth`
of 320 on every route (45px, 38 of 38 light and dark measurements at 320). With
the database-waking mark (32px) the bar also overflowed at 375 and 390px (22px
and 7px); that case was not in the first report.

The Settings gear is now hidden on phones, because the Menu already has a
Settings row, and the presence chip is hidden at 380px and narrower, because
Settings, Presence still switches the mode. Hidden controls leave the tab order
and the accessibility tree; the markup, handlers and names are unchanged. The
focus fallback that runs when the last attention item is dismissed now tries the
Menu button before the Settings link and takes the first control that accepts
focus, because focusing a hidden control does nothing. The
issue proposed 360px for the presence rule, but `styles.test.tsx` allows only the
380, 700, 900 and 1200px breakpoints, so 380px is used and presence is also
hidden from 361 to 380px.

The phone Menu now lists Proactive exactly when the Proactive flag is on, in the
rail's position (after Daily, or after Jarvis when Daily is off), and keeps it
current on `/proactive/<id>` (A35). An App test compares the Menu with the rail
for three flag combinations.

After the change all 148 measurements (19 scenarios at 320, 375, 390 and 768 in
light and dark) have `document.scrollWidth` equal to `clientWidth`, including the
waking case, and the top bar actions end at x=312 at 320px (365 before). The
shell, main and overlay touch-target counts are identical to the baseline in all
93 shared measurements. Not covered: three-digit job counts together with the
waking mark at 320px (about 3px to spare), and real devices.

## Whole-app visual QA pass (19 October 2026)

Rendered the real app at `b02eeb66` in headless Chromium with sign-in stubbed
and synthetic fixtures only. 72 scenarios across chat, Tasks, Notes, Settings,
the Factory pages, Proactive, Usage, Status and the shared overlays produced
369 screenshots and 355 measurement files. Scenarios were measured at 320, 390,
768, 1024 and 1440 in light (1440 also in dark) and screenshotted at 390 and
1440 in light and dark; coarse pointers were emulated at 768 and below. The
findings were judged against `DESIGN.md` and this audit.

Measured clean: no horizontal overflow at 768, 1024 or 1440; no page, render
or console errors; select text clears the arrow on every Settings and Factory
select; primary and secondary buttons are 44px high with a 10px radius; shell
and overlay touch targets at 320 and 390 are at least 44px; every H1 is 40px at
weight 650.

The pass found 50 defects (3 High, 21 Medium, 26 Low). The most visible: at
320px every route is 45px wider than the viewport because of the top bar; the
Snooze menu overflows the viewport by 114px at 390px; several blocks (the
Proactive page, Usage, Status, the 404 page, project settings and the release
header) put muted text directly on the 3D scene, which is close to unreadable in
light; and the Settings deep links to Projects, Proactive and Nutrition targets
neither open nor scroll to their section.

| Task | Defects |
| --- | --- |
| P14-14 | A29 to A34, A36 to A38, A40, A42 (Proactive, Usage, Status, 404, overlays) |
| P14-15 | A44 to A47, A50 (Settings and task window) |
| P14-16 | A1, A35 (top bar at 320px, mobile menu) |
| P14-17 | A22, A49 (state messages and skeleton loaders) |
| P14-18 | A7, A13 to A16 (the whole destructive-button change, including Routines Delete), A48 (Settings) |
| P14-19 | A2, A3, A8, A43 (chat and composer) |
| P14-20 | A5, A6, A9 to A12 (Tasks and Notes) |
| P14-21 | A17 to A21, A23 to A25 (Factory board and task window) |
| P14-22 | A26 to A28, A39 (Factory projects and releases) |
| Follow-up | A4: one shared date-time format; it touches call sites owned by the tasks above, so it follows them |
| Not fixed | A41: title position alignment is a design decision, not a defect fix |

Not checked: hover, pressed and focus states, voice, signed-out screens, real
devices, the Presence and More menus, generic modals, views created through a
stream, `html_app` and chart views, and the Factory board and task window
skeleton loaders. The harness is not part of the repository.

## Daily visual QA pass (P12-38; 18 October 2026)

Rendered the parent revision and the corrected Daily page in synthetic Chromium
fixtures. The parent pass covered Overview, Workouts, Nutrition, Body & sleep,
Briefs and Data at 390×844, 1440×900, 320×844 and 720×450, in light and dark,
with en-US and en-GB (96 combinations). At 390×844, the parent reproduced
separate “About this data” placement and missing disclosures in Briefs and Data,
three Body legend entries for three alternate-day readings, and the inset,
text-only Data detail action. The corrected pass checked the same matrix:
document and body widths matched the viewport throughout, and no console or
page errors were reported.

At 390×844, both locales exercised Workouts detail, Nutrition’s Trend/Day tabs,
Body/Sleep tabs and a 30-day Body selection, Briefs detail, and Data’s
Table/Chart and record-detail controls. The alternate-day Body fixture retained
all seven readings as points under one legend entry. The Data Chart choice
retained its borderless pill styling, numeric header and cells both computed to
right alignment, and keyboard focus on Chart showed a visible 3px outline.
For the same synthetic instant, the corrected page showed “Oct 18, 2026,
10:30 AM” in en-US and “18 Oct 2026, 10:30” in en-GB; Workouts list and detail
used the same locale-specific value.

The 720px-wide render is the CSS viewport equivalent of 1440px at 200% zoom;
headless Chromium keyboard zoom did not alter its CSS viewport, so true browser
zoom was not directly verified. No personal records or original-site data were
used, and the screenshots and fixture results remain in the scratch harness,
not in the repository.

## Daily accessibility and keyboard audit (18 October 2026; P12-37)

The Daily keyboard, focus, naming, state-announcement and table/chart semantics
were audited across the shell, each section and the shared Daily kit. Three
confirmed defects were corrected: sparklines now name short series as ordered
observations with explicit missing points and longer series as a bounded
summary; record tables use row headers;
and closed record-detail triggers retain a valid hidden `aria-controls` target.
Other reviewed controls retain their existing names and behavior. Tests guard
roving tab navigation, period keyboard order, record focus return, table/chart
semantics, live-region roles and reduced motion.

Synthetic Chromium checks covered 390×844 and 1440×900 in light/dark and
320×844 in light. All six sections were reached using the section tab strip;
workout/brief details, Nutrition views, Body view/measurement, record details,
Escape focus return, Data chart choice and the scroll region were exercised.
The Body measurement/chart check re-entered the synthetic page at its `view=body`
URL after the nested-tab keyboard check to avoid an unsettled fixture transition.
The runs reported a visible 3px focus outline, no document-width overflow and no
console/page errors. The browser used scratch-only auth and synthetic responses;
no physical screen-reader speech, physical-device output or live records were
verified. The full matrix and named-role evidence are in
[`ui/p12-37/audit.md`](ui/p12-37/audit.md).

## Daily visual QA pass (18 October 2026; P12-39)

A rendered pass over every Daily section on main (`3dde6be3`) used synthetic
fixtures at 320, 390, 768 and 1440 px in light and dark. It found no horizontal
overflow, failed request or render error, and 21 layout and consistency
defects. P12-39 corrects the 14 stylesheet-level defects below. The other
seven are structural or data-presentation changes (section header order, one
date-locale source, the Data row action and view switch, numeric cell
alignment, workout type glyphs and the sparse-data chart legend) tracked in
P12-38.

| # | View | Change |
| --- | --- | --- |
| 1 | Section tab strip, phones | The selected tab was scrolled out of view, so on Briefs and Data no tab looked selected. The strip now scrolls to centre the selected tab. Only the strip scrolls, instantly on first paint, while availability loads and under reduced motion. Centring moves the strip, so the edge fade became a mask driven by scroll position; as a pseudo-element it would have scrolled over the tabs. |
| 2 | Section tab strip, 481 px and wider | The 88 px minimum width padded short labels unevenly. Tabs now size to their label with a 44 px minimum. |
| 3 | Body & sleep stat tiles | Tiles in one row had different heights. They now stretch to the row height. |
| 4 | Sleep and Brief detail | Three headings used the section size. They now use `--type-subsection`. |
| 5 | Nutrition heading | The heading's bottom margin sat on top of the grid gap. The margin is zeroed. |
| 6 | Nutrition Day, open meal | The disclosure body used body type and browser-default list margins. It now uses the small type role and a tight rhythm. |
| 7 | Nutrition Day, other nutrients | A lone tile was content-width and left-aligned. The tiles follow the meter grid (two columns, four from 900 px; an odd final tile fills its row). |
| 8 | Nutrition Day date row | Previous, Next and Today were 44 px tall beside a 38 px field on fine pointers. They now match the field; coarse pointers keep 44 px. |
| 9 | Nutrition Day meal summary and group subtotal | Title, time and macro text had three left edges, and the subtotal wrapped at the paragraph maximum width. The macro text aligns to the title edge and the subtotal lifts the maximum width. |
| 10 | Briefs month | The month heading sat about 2 px above its first row. The month block is now a grid, so its gap applies. |
| 11 | Brief detail | "Back to brief history" stretched to the full width. It is content-width, as "Back to workouts" is. |
| 12 | Overview tiles | A tile mixed three line sizes. Its secondary lines share the small size. |
| 13 | Daily links | The Body and Sleep tile links were under 44 px wide. Daily links have a 44 px minimum width, as they have for height. |
| 14 | Workouts list, 320 px | "High-intensity interval training" was ellipsised. The type name now wraps. |

Behaviour, copy, routes and accessible names are unchanged. Tests guard the
tab centring (including the instant moves), the scroll-driven edge flags and
the mask rules, alongside the existing stylesheet ratchets.

The headless Edge harness rendered the changed sections on the branch at 320,
390 and 1440 px in light and dark and measured them again. It found no document
or main-element overflow, no Daily touch target under 44 px at widths up to
768 px, no text clipped by an ellipsis, no alert or error notice and no failed
request, and every tab at 1440 px had equal padding. The data is synthetic.
No live records, physical device or human review were involved, and the section
tab focus rings were not re-inspected in this pass.

## Tasks and Notes corrections (P14-20; 19 October 2026)

Tasks now use the same en-GB 24-hour clock for due times and vault freshness;
the source-note and task-results links reach 44px on coarse pointers. Notes
search announces settled no-match queries without an empty results shell. Note
body padding is balanced, popup titles clamp to two lines while retaining the
full accessible/hover title, and the phone search count is visually clipped
but remains a live status for assistive technology.

Synthetic Chromium checks covered 320×640, 390×844, 768×1024 and 1440×900 in
light and dark, with coarse-pointer checks at 390 and 768. Times, empty-search
announcement, title/padding, placeholder width and touch-target heights were
verified; no horizontal overflow or browser console errors were found.

## Field clearance (P12-40, 19 October 2026)

A states pass over Daily (empty, loading and error at 390 and 1440 px) found one
more defect in Body & sleep: at phone widths the Search placeholder and the
Measurement select text were clipped, and the select's arrow was drawn over the
last letters. The cause was global, not Daily-specific. The shared field rule's
`:is()` list takes the specificity of its most specific entry (the input type
exclusions), so its `padding` shorthand out-ranked every per-control
`padding-left` and `padding-right`. Arrow and icon clearance written that way
was never applied.

| # | View | Change |
| --- | --- | --- |
| 1 | Every select inside the shared field containers (Settings, Tasks filters, Usage, Role controls, Kanban, Notes, Daily) | Long option text ran under the CSS arrow. Clearance is now the `--field-padding-end` custom property (`--space-6`) that the shared padding consumes, and the selected text ends in an ellipsis before the arrow. |
| 2 | Tasks board search | The magnifier overlapped the placeholder and typed text. Clearance is the `--field-padding-start` custom property (`--space-7`). |
| 3 | Body & sleep picker, 520 px and narrower | Search, Measurement and Period shared two columns of about 160 px at 390 px. The controls now stack in one column; two columns remain from 521 to 900 px. |

Rendered checks with the headless Edge harness covered the Body picker with a
filtered-out selection at 390, 540, 600 and 768 px, the Data, Workouts and
Nutrition selects at 390 px, and the Tasks search and project select from the
shared stylesheet on a static page. A run of the committed change over Body,
Sleep and Workouts at 320, 390, 768 and 1440 px (measured in light, rendered in
light and dark, plus the empty state) found no horizontal overflow, no element
wider than its container, no text clipped by an ellipsis and no Daily touch
target under 44 px. The data is synthetic; no live records, physical device or
human review were involved. Tests guard the custom properties and the stacked
picker.

## Proactive, Usage, Status, 404 and overlay readability (P14-14, 19 October 2026)

The whole-app QA pass above found four views that put muted text directly on the
3D scene (Proactive, the Status intro, the 404 page and the Usage range switch),
a Snooze menu that ran past the phone viewport, and overlay, hierarchy and
touch-target slips beside them. Each now uses the shared surfaces, type roles
and button system.

| # | View | Change |
| --- | --- | --- |
| 1 | Proactive page, detail page and their empty, loading and paused states (A29) | The page takes the shared translucent panel surface, border and radius. On phones the dock clearance is a margin rather than padding, so the panel ends above the dock. |
| 2 | Snooze menu (A30, A42) | On phones it is right-aligned and two buttons wide, inside the viewport. From 701 px it is a column sized to its longest option, so every option fits on one line. On phones the long Tomorrow option wraps onto two lines inside its own button, and the time never breaks. |
| 3 | Snooze trigger (A37) | It is a secondary button like Dismiss, Useful and Wrong, and the four sit in an even 2 × 2 grid on phones. |
| 4 | Usage range switch (A32) | A border and the translucent surface replace a 6% tint. |
| 5 | Status intro (A33) | It is a panel of its own above System checks. Only the page intro is a panel; the smoke-check timestamp inside its own panel stays plain text. |
| 6 | 404 page (A34) | It uses the standard panel. |
| 7 | Attention, Background work, context and menu overlays in dark (A31) | They take the shared backdrop blur, so the page behind no longer shows through the 90% surface. |
| 8 | Attention rows at phone widths (A36) | Titles, Dismiss and the confirmation buttons share one left edge. |
| 9 | Popover titles (A38) | "Needs attention" and "Background work" use the subheading size, above the 17 px section headings. |
| 10 | Usage rank links and the Proactive budget link (A40) | They are 44 px high with a coarse pointer. |

Rendered checks used the whole-app headless Edge harness on synthetic data. The
group covers 17 scenarios (Usage, Status, Proactive with its items and open
Snooze menus, the 404 page, the knowledge redirect and the overlays), measured
on 79 pages at 320, 390, 768, 1024 and 1440 px (light; 1440 also dark) and
captured in 84 screenshots at 390 and 1440 px in light and dark, with the empty,
loading and error states of the main views. Text contrast was sampled from
pixels in the 1440 px light screenshots; the before values are from `b02eeb66`.

| Text | Before | After |
| --- | ---: | ---: |
| Proactive "Last check" line | about 1.9:1 | 6.1:1 |
| Status intro | about 1.8:1 | 6.1:1 |
| 404 body | about 1.6:1 | 6.0:1 |
| Usage unselected range label | about 1.4:1 | 6.1:1 light, 9.6:1 dark |

The shared tokens give muted text on the panel at least 5.5:1 in light and
9.1:1 in dark over both stage extremes. The harness contrast probe reads
ancestor background colours and cannot see the 3D scene, so it reported no
failures before or after; the pixel samples are the evidence.

With the Snooze menu open, `document.scrollWidth` fell from 504 to 390 px at 390
px and from 434 to 365 px at 320 px; the 45 px that remains at 320 px is the top
bar (P14-16). Elements wider than their container fell from 42 to 0 on Proactive
at 320 and 390 px, and from 7 to 0 on the item page. With a coarse pointer, touch
targets under 44 px fell from 1 to 0 on Proactive and from 4 to 0 on Usage at 390
px. The menu is a column on purpose: sized with `max-content`, a wrapping row adds
every option together (713 px at 768 and 1440 px), so a test pins the column. The
data is synthetic; no live records, physical device or human review were
involved.

## Settings save row, nested sections, feed rows and task window targets (P14-15; 19 October 2026)

Five findings from the whole-app pass (A44 to A47 and A50) were all in
`styles.css`; no markup changed.

- Save settings (A47): `.settings-page > .settings-save` reset padding, radius,
  background and shadow but not the 1px border of the base `.settings-save`
  block, so a frame surrounded the button in every Settings state. It now sets
  `border: 0` and stays the plain end-of-page row.
- Nested section title (A45): inside another section the title was `flex: none`
  and its chevron sat in a clipped box, so at 320px "Defaults for new projects"
  read "Defaults for new projec" with no visible chevron. A title inside a nested
  section now shrinks and wraps, and nested toggles use the subsection size (17px
  against 22px for top-level titles) so the nested heading reads as a child.
- Folded nested section (A50): the padding under an open section matched every
  descendant inner, so a folded section nested in an open one kept about 24px of
  dead space under its title. The rule now matches only a section's own inner
  (`> .collapsible-body > .collapsible-inner`). With Projects open the 390px page
  is 26px shorter (3963px to 3937px: the 24px plus the 2px save row frame).
- News feeds (A46): the URL input was top-aligned beside the 44px Remove button
  and "Add feed" stretched to the panel width. The row now stretches its controls
  to one height and "Add feed" keeps its content width at the start of the row.
- Task window (A44): the 44px coarse-pointer minimum for "View event payload" was
  undone by an override fused onto the end of another rule, and the project and
  branch chips kept a 28px minimum. The fused rule is on its own line and
  `(pointer: coarse)` restores 44px for both; fine pointers keep the compact sizes.

Rendered with the whole-app harness on the base (b02eeb66) and on this change.
Of the 29 scenario and width measurements present in both runs, 6 differ and 23
are identical. At 320px `settings`, `projects-defaults` and `projects-open` each
lose their 2 wide elements and their one hidden-clip entry. At 390px the three
task windows drop from 43, 43 and 44 targets under 44px to 34 each; the
remaining 34 are the board and release links of A25 and A26 (P14-21, P14-22).
The screenshots confirm the Save row has no frame at 390px, the nested title
wraps beside its chevron at 320px, the folded Defaults section flows straight
into Nutrition targets, "Add feed" is content width, and the payload disclosure
and chips are 44px tall. Not covered: the 1440px captures stop at 1600px, so the
News feeds row and the Save row were not rendered at 1440px by this change (the
QA pass rendered the same rules there), and real touch devices.

## Colour and contrast (P14-12, 18 October 2026)

The contrast ratchet reads the canonical tokens and measures 197 shared-token
pairings in light and dark against both black and white stage extremes, plus
four Kanban helper/status/empty-state pairings against worst sampled hero pixels
in each theme (201 labels, 796 measurements total). It covers body, muted,
caption and placeholder text; links; status and selected
states; button variants and states; fields, boundaries and focus; Daily and
generated chart marks and text; graph marks; and disabled controls. Normal text
uses a 4.5:1 threshold; large text and meaningful non-text use 3:1. The complete
before/after results, thresholds, disposition, both backdrop ratios, and all
16 changed-token values and ratios are in
[`contrast-table.json`](ui/p14-12/contrast-table.json). Run the measurement with
`P14_CONTRAST_REPORT=1 npm test --workspace @jarvis/web -- --run src/contrast-audit.test.ts`.

The original token matrix had 102 unallowlisted failing measurements. After
token-level fixes, none remain. The 28 below-threshold measurements are
reasoned exceptions: low-opacity chart area/range fills have readable series
marks, labels and accessible value tables; `--rule` separates content and is
not used as a control boundary. Disabled text and surfaces are checked for
legibility and distinction from enabled controls.

| Pairing changed | Before | After |
| --- | ---: | ---: |
| Light success text on its wash | 3.84:1 | 5.20:1 |
| Light danger button, pressed | 4.19:1 | 4.74:1 |
| Dark danger button, pressed | 4.29:1 | 4.62:1 |
| Light Daily warm-series line | 2.23:1 | 4.20:1 |
| Light Daily warm-series bar at 82% | 1.92:1 | 3.15:1 |
| Light Knowledge graph Work mark on stage floor | 2.24:1 | 3.23:1 |

The four text-bearing stage surfaces now alias `--surface-translucent` (92%
light, 90% dark); the top bar no longer fades to a low-contrast stop. The light
graph People, Work and Personal tokens are darkened only enough to reach 3:1.
The new `--chart-series-warm` is a chart role: light changes from decorative
amber `#c98a3a` to `#985a18`; dark retains `#ffb45c`.

The Kanban source/fetched helper and live-update caption previously sat directly
over the moving scene. A 150-pixel sample of each synthetic 1440×2732 theme
capture found worst text ratios of 1.02:1 (light muted text) and 1.09:1 (dark
body text). The helper and status now use `--surface-translucent`; empty-state
copy remains on the existing `--board-slab`. All sampled pairings pass 4.5:1;
coordinates, pixel colors, and before/after ratios are in the
`heroSceneMeasurements` table. The guard test checks these selectors and
measures the shared surfaces against each recorded worst-case pixel.

The pairing list is identical in both themes. Explicit theme-only rules change
colors for light presence indicators and the done icon; the dark-only
`.app-shell::before` rule animates decorative ambience and changes neither
layout nor state coverage. `prefers-contrast: more` strengthens focus and
control boundaries, while forced-colors maps fields, focus, switches and
native choices to system colors. Chromium emulation verified both modes at
390×844 and 1440×900. System reduced motion now disables the active voice
status glyph animation, guarded by the contrast test.

Status, error, selected, new and chart states retain a second cue: readable
labels and icons, semantic state text, selected weight and `aria-current`, and
series patterns/legends/tables. Existing permission tests cover synthetic
camera and microphone denial; no physical camera, microphone or connected
voice session was used. Keyboard scrolling of wide generated tables remains
open follow-up. Synthetic browser screenshots and emulation details are
indexed in [`screenshots.md`](ui/p14-12/screenshots.md).

## Surface coverage

The audit covered the shared shell, desktop rail and mobile navigation, header
controls and popovers, workspace/chat composer and voice controls, Settings,
Factory project and task pages, Daily overview and records, Proactive list,
item and settings, shared dialogs, and the loading, empty and error patterns
used by those routes. Style families in the remaining CSS modules were
inventoried to identify route-specific exceptions.

## Canonical forms

| Recurring element | Variants found (source and selector/component) | Canonical form and reason |
| --- | --- | --- |
| Button | `styles.css`: `.primary-button`, `.secondary-button`, `.ghost-button`, `.danger-button`, `.danger-button--filled`, `.button-group`, `.settings-back`, `.jobs-action`, `.workspace-control`; `ConversationHistory.css`: `.composer-send`, `.conversation-latest`; `proactive.css`: `.proactive-text-toggle`, `.proactive-snooze > summary`; Factory task/release actions; Daily keeps `.daily-page button` | Primary and filled danger use token-based tonal fills, real tinted borders and one restrained accent shadow; secondary and unfilled danger have visible boundaries; ghost stays text-only until hover/press. Shared focus, disabled, busy and reduced-motion states live in `styles.css`. The composer send and `.jobs-action-primary` alias shared primary styling while keeping their classes and compact geometry; Factory Create task and Settings save already use shared primary. Factory Create project uses shared secondary. `.conversation-latest` stays a contextual utility with the same radius and focus. Action rows own spacing and wrap/stack at phone widths. Compact actions are 36px on fine pointers and at least 44px on coarse pointers. |
| Icon button | `styles.css`: `.rail-button`, `.topbar-icon-button`, `.workspace-icon-control`, `.workspace-tab-close`, `.modal-close`, `.folio-action`, `.release-trail-button`; `ConversationToast.css`: toast dismiss; `CameraPreview.css`: camera controls | Use the shared quiet surface treatment, `--radius-control` and visible focus. Icon-only actions remain at least 44px on touch layouts and keep an accessible name. Drag handles and media controls remain semantic exceptions. |
| Text input | `styles.css`: `.settings-field`, `.project-form`, `.task-form-field`, `.task-filter-field`, `.task-create-form`, `.task-control-form`, `.kanban-search`, `.usage-field`, `.role-controls`, `.folio-rename`; `.proactive-feed-input`; `.daily-page`; `NotesArea.css`: note title and folder-name fields | The shared field rule uses `--surface`, `--control-rule`, `--radius-control`, `--type-body`, one placeholder treatment and the `--focus` visible outline. Fine-pointer fields are 38px minimum; coarse-pointer fields are 44px minimum with 16px text. Integrated Knowledge, Folio and chat searches keep their transparent inner fields and host-provided boundary/focus. |
| Select | `styles.css`: `.settings-field select`, `.timeline-toolbar select`, `.usage-field select`, `.role-controls select`, `.kanban-select select`; `.daily-page select` | Use the text-field height, surface, neutral boundary, radius and focus. A CSS arrow replaces browser-specific arrow geometry; inherited `color-scheme` follows light/dark themes while native option semantics and route widths remain. |
| Textarea | `styles.css`: settings, project/task forms, task controls, and Daily fields; `NotesArea.css`: title-adjacent fields and source editor | Form textareas share the field surface and boundary, have a 120px minimum height and resize vertically. The Notes source editor retains its editor-specific font and layout; the chat composer retains its integrated surface. |
| Checkbox and radio | `styles.css`: `.choice`, `.theme-choice-group`, `.project-policy-choice`; `SettingsPage.tsx` and `ProjectsPage.tsx` | Keep native semantics and checked marks, use a common 18px visual size and focus outline, and preserve a 44px coarse-pointer hit area through the labelled choice. Selected project policy remains explained in plain language. |
| Switch and segmented choice | `styles.css`: `.advanced-toggle input[role="switch"]`, `.advanced-segmented`, `.usage-segmented`; `ProactiveSettings.tsx`; `Presence.tsx` mode choices; `daily/daily.css`: `.daily-view-switch` | Switches share a 44×26px track and moving thumb. Segmented choices retain the selected surface and weight, use the common focus treatment, wrap at narrow widths, and reach 44px on coarse pointers. Native radio/switch semantics and existing selection behavior remain. |
| Surface or card | `styles.css`: `.panel`, `.workspace`, `.settings-section`, `.project-item`, `.kanban-column`, `.kanban-card`, `.jobs-popover`, `.modal`; `daily/daily.css`: `.daily-page`, `.daily-records`; `proactive.css` and `styles.css`: `.proactive-item`, `.proactive-block` | Content panels use existing surface roles, `--rule`, panel geometry and `--panel-shadow`. Settings sections now use the same shared panel treatment as project cards; the sticky save bar uses a panel shape instead of a capsule. Stage-backed conversation glass remains distinct because it is part of the accepted workspace composition. |
| List row | `styles.css`: `.activity-list`, `.jobs-list`, `.jobs-item`, `.kanban-card`; `daily/daily-overview.css`: `.daily-overview-row`; `daily/daily.css`: `.daily-table`; `proactive.css`: `.proactive-item-row`, `.proactive-source-row`, `.proactive-runs-list` | Scannable collections use neutral `--rule` separators and consistent spacing. Keep cards only for distinct units of work or context; tables retain their real tabular structure. |
| Chip or badge | `styles.css`: `.task-chip`, `.task-state-chip`, `.jobs-outcome`; `daily/daily-overview.css`: `.daily-status`; `proactive.css`: `.proactive-new`, `.proactive-urgency` | Reserve `--radius-pill` for compact status and category marks. Keep a readable label, icon or other non-colour signal with status colour. Interactive tabs, filters and actions use `--radius-control`. |
| Popover or sheet | `styles.css`: `.jobs-popover`, `.more-menu-list`, `.more-menu-flyout`, `.modal`; `MobileShell.tsx` / `styles.css`: `.mobile-menu-sheet`; mobile `.context-panel` detail sheet | P14-09 shares `--surface`, `--rule`, `--radius-panel`, `--panel-shadow` and the named `--z-*` stack. Dialogs use a heading, internally scrolling body and grouped footer actions. Modal focus is trapped and restored; nested modals share background inertness and scroll locking. Implicit dismissal preserves edited forms and pending work. Sheets respect safe areas and dynamic viewport bounds; nonmodal menus retain their keyboard navigation and focus return. |
| Section heading | `styles.css`: `h1`, `h2`, `h3`; `SettingsPage.tsx` sections; `daily/daily.css` record heading; `proactive.css` block heading | Follow the existing heading scale and one-headline hierarchy. Route-specific heading size remains where it expresses a real level in the content structure; no eyebrow or subtitle is added. |
| Body and caption text | `styles.css`: `--type-body`, `--type-small`, `--type-caption`; `daily/daily.css`: `.daily-meta`, `.daily-evidence`; `proactive.css`: `.proactive-item-meta`; `styles.css`: `.jobs-item-meta`, `.activity-meta` | Use the existing type roles and `--text` / `--text-muted`. Metadata may be smaller, but long or actionable text remains readable and wraps rather than clipping. |
| Empty state | `StateMessage` (`empty`); `styles.css`: `.project-empty`, `.workspace-empty`, `.task-column-empty`, `.usage-empty`; `daily/daily.css`: `.daily-empty`; `daily/DailyOverview.tsx`; Proactive page lists | Explain the actual empty condition in the state or nearby body text, use the existing surface and typography roles, and show only a relevant working action. Shared non-Daily states use polite status announcements; Daily remains on its own component. Do not invent counts or sample content. |
| Error banner and inline error | `StateMessage` (`error`); `styles.css`: `.workspace-feedback-host`, `.workspace-pin-feedback`, `.settings-feedback`, `.projects-feedback`, `.project-policy-feedback`, `.task-control-error`, `.release-feedback`, `.usage-feedback`; `ConversationHistory.css`: `.conversation-history-error`, `.chat-error`; `daily/daily.css`: `.daily-notice[role="alert"]`; `proactive.css`: `[role="alert"]`; `JobsChip.tsx`: `.jobs-item-error` | P14-09 moves workspace pin alerts and retry feedback into normal page flow before route content, never over page rows. Keep field/action-local validation inline. Shared block-level non-Daily errors use a safe sentence, `role="alert"`, `--error-surface`, `--error` and neutral structure, with at most one relevant recovery action. Daily and field-local treatments retain their owners. Do not encode error meaning in border colour alone or display raw error text, IDs or codes. |
| Loading state | `StateMessage` (`loading`) wraps `Loader.tsx`; `Loader` variants `dots`, `rows` and `orb`; Daily pending states | Reuse `StateMessage` for non-Daily loading and the existing `Loader` for internal button activity. Use skeleton rows only when the final layout is known; otherwise use concise Loader text. Preserve existing content during refresh and honor reduced motion without hiding essential state. |
| Partial state | `StateMessage` (`partial`); Factory, Usage, release and status surfaces | Name stale, partial or capped data, explain how to refresh, and preserve already loaded content when the workflow supports it. |

## Rendered checks

Compared the pre-change and current app in headless Chromium at 390×844 with
touch emulation and 1440×900, in light and dark. The isolated Vite/auth harness
used synthetic settings and project data. Inspected Settings, the empty Factory
board, the project completion-policy control, Daily and Proactive page/item error states,
the Background work popover, and the chat composer. Exercised policy save,
Daily and Proactive retry, popover open, and composer focus. Neither version
emitted browser console errors. Reduced-motion emulation was also checked: the
Background work popover animation resolves to `none` and Settings content
remains available.

The Daily and Proactive APIs intentionally returned synthetic 503 responses,
so only their error and retry states were verified, not healthy-data states.
The attention popover could not be opened because the harness had no synthetic
attention event; its shared popover surface is used by the inspected Background
work popover. Screenshots were captured locally but could not be attached to the
PR with the available tools. No live backend or real sign-in was used.

### State messages (P14-11)

The before/after fixture gallery and synthetic screen examples are in
[`docs/ui/p14-11/`](ui/p14-11/). The shared component is documented in
`DESIGN.md`; it does not change Daily's parallel `DailyState`.

Chromium checks covered 390×844 with touch emulation and 1440×900, light and
dark, using synthetic content only. Loading, empty and partial states exposed
polite status roles; errors exposed alerts. Retry became disabled and
`aria-busy` while active, then returned to idle. Loading-to-error kept a 160px
state slot with 0px content shift at both sizes. At 320px there was no horizontal
overflow; reduced motion removed the Loader animation, and the gallery emitted
no console errors. This measures the shared gallery transition, not route-level
loading-to-ready transitions or live backend behavior.

## Bounded follow-up

The app has more than 40 independently styled route and component surfaces, so
this pass prioritized the shell/header popovers, shared chat controls, Settings,
Factory project policy, Daily, and Proactive as requested. The global shared
button and shell tokens continue to style existing consumers, but this pass did
not recast the distinct layouts and component-specific states for Knowledge and
Folio, Notes editing, Usage and Status, camera/voice panels, Factory release and
task-detail histories, or embedded generated views. Their workflow-specific
geometry and behavior were not changed; they remain candidates for a separate
visual review rather than being folded into this bounded patch.

This is local rendered evidence, not live or human acceptance. Before/after
screenshots remain unattached; the uninspected attention popover and healthy
Daily/Proactive data states are also open visual follow-up.

## Pass 2

This pass follows the canonical forms above and the bounded follow-up from
P14-01. The shared source remains `apps/web/src/styles.css`; component styles
keep their workflow layout and consume its existing tokens.

| Recurring element | Variants found (source and selector/component) | Pass 1 match? | Pass 2 change |
| --- | --- | --- | --- |
| Panels and cards | `styles.css`: `.usage-hero`, `.usage-card`, `.usage-details`, `.usage-empty`, `.system-status-panel`, `.release-section`, `.task-meta`, `.task-detail-section`; `notes/NotesArea.css`: `.notes-conflict`, `.notes-comparison pre` | Partial. Usage and Status used stage slabs with oversized radii; Factory history used 8px panels; Notes comparison used unstructured one-off surfaces. | Moved Usage, Status, release and task panels to the shared translucent surface, neutral `--rule`, `--radius-panel`, `--panel-shadow`, and spacing tokens. Notes conflict/comparison now use structural rules and panel/control radii. |
| Search, fields, and actions | `styles.css`: `.folio-search`, `.folio-rename input`, `.folio-action`, `.folio-kind`, `.knowledge-results`; `CameraPreview.tsx`: preview/camera retry buttons; `CameraPreview.css`: `.camera-status-control`; Usage segmented buttons | Partial. Shared button treatment was already present in most controls, but Folio search/rename were below 44px, Folio actions lacked a focus rule, and camera retries had a parallel style. | Raised Folio search/rename controls to 44px, added explicit Folio action focus, and reused `.secondary-button` for both camera retries. The Knowledge results surface now uses `--radius-panel`. Existing Usage selected, hover, pressed, and focus states remain. |
| Graph and timeline surfaces | `styles.css`: `.release-graph-scroll`, `.timeline-payload pre`, `.knowledge-results` | Partial. Graph scrolling had a hard-coded light background and 6px radius; timeline payloads used a second 6px radius. | The graph scroll surface now uses `--surface` and `--radius-control`; timeline payloads use the same control radius. Existing contained horizontal scrolling and focus indication remain. |
| Typography and spacing | `styles.css`: Usage/Status headings, `.usage-page`, `.usage-results`, `.usage-grid`, `.usage-tiles li`; `CameraPreview.css`: `.camera-preview-live`; `VoiceControls.css`: `.voice-status-label` | Partial. Several Usage/Status sizes and gaps were raw values; camera status text used a one-off size; voice arrival used a fixed duration. | Reused the existing `--type-lead`, `--type-caption`, `--space-*`, and `--motion-state` tokens. Other text and spacing already use the canonical type roles and were left unchanged. |
| Status, rows, and recovery | `daily/DailyOverview.tsx` / `daily-overview.css`: `.daily-overview-row`, `.daily-status`; `ProactiveArea.tsx` / `proactive.css`: `.proactive-item`, `.proactive-block`; `status/StatusPage.tsx`: `.system-status-row`, `.system-status-feedback`; `usage/UsagePage.tsx`: `.usage-empty` | Mostly. Daily and Proactive already use the shared status, row, empty/error, and tokenized control forms; Status feedback and Usage surfaces were the exception. | Status feedback now uses a neutral structural rule and `--error-surface` with an explicit error-text role. Usage empty/loading treatment is unchanged apart from its shared panel surface. Healthy Daily and Proactive states required no CSS changes. |
| Camera and voice states | `CameraPreview.tsx` / `CameraPreview.css`: `.camera-preview-picture`, `.camera-preview-live`, `.camera-status-control`, retry actions; `VoiceControls.css`: `.voice-status-label` | Partial. Preview/status geometry and retry actions diverged; voice typography and motion were raw values. | Reused panel/pill radii and caption typography, shared retry buttons, visible control focus, and tokenized voice type/motion. Camera status controls retain their explicit hover, pressed, disabled, and focus treatments. |
| Release and task history | `factory/ReleasePage.tsx`: `.release-section`, `.release-graph-scroll`; `factory/TaskDetailPage.tsx`: `.task-meta`, `.task-detail-section`, `.timeline-payload pre` | Partial. Release/task action controls already matched; panel, graph, and payload geometry did not. | Updated only the mismatched panel, graph, and payload surfaces as described above; retained release/task interactions and scroll behavior. |
| Attention popover | `AttentionPopover.tsx`: `.attention-popover`; `JobsChip.tsx`: `.jobs-popover` | Yes. The attention popover already shares the canonical opaque `--surface`, neutral boundary, and panel radius used by Background work. | No CSS change. Opened it with a synthetic attention event and verified the activity item and close behavior. |
| Generated views | `GeneratedViewRenderer.tsx`: table, detail, timeline, chart and source-note renderers; `styles.css`: `.generated-view-table`, `.generated-view-details`, `.generated-view-timeline`, `.generated-chart`, `.chart-legend`, `.generated-view-source-note` | Partial. PR #953's source note, contained table scrolling and whole-cell values already use shared text, spacing and neutral rule tokens; timeline/chart spacing and axis text were still raw, and table headers lacked a muted surface. | Added the shared muted surface and weight to table headers; moved chart/timeline spacing and chart axis text to existing tokens. Preserved #953's source note and inner table scroll behavior. |

The patch changes seven web files and this audit plus one plan row, staying below
the 40-file bound. `DESIGN.md` and `docs/decisions.md` remain unchanged because
the work reuses visual choices already recorded by Pass 1.

## Pass 2 rendered checks

Compared the pre-change and current app in headless Chromium using scratch-only
auth and API fixtures at 390×844 with touch emulation and 1440×900, in light and
dark. Inspected Knowledge/Folio, Notes, Usage, Status, healthy Daily and
Proactive data, Factory release, and the attention popover at both sizes and
themes. The fixtures used only synthetic notes, events, usage entries, status
checks, Daily rows, Proactive findings, release records, and task history.

Opened the Notes conflict/comparison and task-history workspace with synthetic
responses in the same viewport/theme matrix. Exercised Folio open, Usage
grouping, Status refresh, opening a Daily record, expanding a Proactive finding,
release details, and the attention popover. The expected synthetic Notes 409
response produced the conflict state; no other page or browser-console errors
were observed, and document width stayed within each viewport.

For generated views, compared the merged #953 baseline with the current build
using a scratch component harness containing the real `Workspace` and
`GeneratedViewRenderer`. A synthetic table and source note were checked at both
sizes and themes; the table remains contained and scrollable within its window
on the phone, with no document-width overflow. A synthetic chart was also
checked in both themes at phone width. The shared muted table header is
theme-aware, and chart labels resolve to the shared caption size.

The real `CameraPreview` and `VoiceControls` components were also rendered in a
scratch workspace harness at both sizes and themes. The synthetic camera error
and retry action remained visible; keyboard activation of Start voice reached
the browser's microphone-unavailable recovery state. No camera, microphone
stream, or connected voice session was used. Reduced-motion emulation was
checked on Daily and Proactive, where essential content remained available.
Screenshots were captured locally under `/tmp/jarvis-p14-browser/`; the
available tools could not attach them to the PR. These are local rendered
checks, not live-backend or human acceptance.

## Pass 2 not done

- Physical camera output, microphone input, and a connected voice session were
  not verified; no real media device was used.
- Keyboard scrolling of a wide generated table was not verified.
- P14-12 adds a `prefers-reduced-motion` rule and a unit guard for the active
  voice-status glyph. A connected voice session was not run in Chromium.

## Pass 3: responsive and overflow (18 October 2026; P14-05)

### Method and coverage

Used a scratch-only Vite configuration and headless Chromium over the local
DevTools protocol. The signed-in profile and every API response were synthetic;
unmatched endpoints returned synthetic 503 responses. No repository test
dependency or browser harness was added. The probe recorded document width,
visible boxes without a scrolling ancestor, clipped controls, coarse-pointer
target sizes, and fixed/sticky bounds. On emulated phones it used the narrowest
of `innerWidth`, the visual viewport, and the document client width: content
intrinsics can make Chromium report a wider layout viewport than the emulated
screen.

The settled matrix covered 14 entry paths × seven viewports × light and dark
(196 samples): `/`, `/settings`, `/factory/kanban`, `/factory/tasks/12345`,
`/factory/projects/7`, `/factory/projects/7/releases`,
`/factory/projects/7/releases/9`, `/notes`, `/usage`, `/status`, `/daily`,
`/proactive`, `/proactive/11111111-1111-4111-8111-111111111111`, and an
unknown path. The task link redirects to Kanban and opens its workspace
window. The viewports were 320×844, 375×812, 390×844, 768×1024, 1024×768,
1440×900, and 844×390 with touch emulation. Settings, Usage, Status, Notes,
and release data included synthetic populated and long-text content. Also
opened the mobile navigation sheet and Background work popover at 320×844.

Three repeatable overflow causes were fixed. The matrix found no document
horizontal overflow at any width after the fixes. A single 320×844 dark
task-window sample caught its action row outside the viewport during the
window's opening transition; a focused 2.5-second settled check found the
window and its actions within the viewport. This transient is not counted as a
stable overflow defect.

| Route or state | Viewport | Selector | Cause | Fix |
| --- | --- | --- | --- | --- |
| Usage, populated Top tasks | 320×844; the same unbroken title also exceeded its parent at wider samples | `.usage-rank-label a` | An inline task link had a 4,031px box inside a 185px ellipsis label. | Make the link a block constrained to its label, retaining the existing ellipsis. The full task title remains in the usage table. See [before](ui/p14-05/usage-rank-before.png) and [after](ui/p14-05/usage-rank-after.png). |
| Factory release detail, populated long version | 320×844 | `.selected-release h2` | The unbroken release version had no wrapping rule; its section's scroll width grew to 452px and Chromium's layout viewport to 469px on a 320px screen. | Add `overflow-wrap: anywhere` to release headings. See [before](ui/p14-05/release-heading-before.png) and [after](ui/p14-05/release-heading-after.png). |
| Factory release context on Kanban | 320×844 | `.release-trail-pipeline li`, `.release-trail-pipeline a` | A long release version forced a 261px flex item into a 194px project track and widened the mobile layout viewport. | Allow pipeline items to shrink and links to wrap. See [before](ui/p14-05/release-trail-before.png) and [after](ui/p14-05/release-trail-after.png). |
| Conversation composer, coarse pointer | 320×844 | `.conversation-history .composer textarea` | The stylesheet's minimum height was 40px, below the 44px target. | Raise its minimum height to 44px; the style contract pins this rule. |
| Task deep-link window opening | 320×844 dark, during the opening transition | `.workspace-window-actions` | The intermediate window-width transition briefly placed the actions beyond the viewport; the settled window fits. | No persistent overflow remained after settling. This is recorded as a transition-only observation, not a stable defect. |
| Mobile menu and Background work popover | 320×844 coarse pointer | `.mobile-menu-button`, `.mobile-windows-button`, `.jobs-action`, `.workspace-tab-close`, `.composer-send` | Several existing buttons measure under 44px in the open/closed states (including 36px-high top-bar controls and 32px-high popover actions). | Not changed: button geometry is explicitly excluded from P14-05 and belongs to P14-03. The menu sheet and popover themselves fit the viewport without document overflow. |

The small-target scan excluded the off-screen-until-focused skip link and the
visually hidden file input. The Usage ranking label's intentional ellipsis is
not an unrecoverable clipping defect: its full title is also present in the
scrollable usage table. The generated-view table scroll region is now named and
keyboard focusable; its focus outline is covered by a renderer test. The
textarea height and responsive CSS signatures are pinned in `styles.test.tsx`.

### Breakpoint boundary comparisons

The boundary script measured computed styles at the pixel immediately below,
at, and above each old and replacement threshold. For the ranges shown, the
tested widths were:

| Change | Styles compared | Before/after boundary result |
| --- | --- | --- |
| 360px → 380px | Voice-bar gap and padding at 359, 360, 361, 379, 380, 381 | Compact 4px gap/6px padding now remains through 380px; default 6px/7px begins at 381px. |
| 600px → 700px | Chat page/composer, attachment text, Proactive page, and release trail at 599, 600, 601, 699, 700, 701 | Phone spacing and 11rem attachment width now remain through 700px; desktop/tablet values begin at 701px. |
| 640px → above 700px | Task-board columns at 639, 640, 641, 699, 700, 701 | The board stays one column through phone width and becomes two at 701px; the old rule made it two columns at 640px. |
| 701px → above 700px | Desktop shell rules at 700 and 701 | The integer-width rendering is unchanged: phone at 700px, desktop rules from 701px. |
| 900/901px → above 900px | Usage layout, task-release time, and skeleton columns at 899, 900, 901 | Tablet rendering remains at 900px; desktop two-column usage, hidden compact timestamps, and four skeleton columns begin at 901px. |
| 980px → 900px | Sidebar sizing and skeleton columns at 899, 900, 901, 979, 980, 981 | Compact sizing now ends at 900px instead of 980px; the desktop sidebar size and four-column skeleton begin at 901px. |
| 1100px → 1200px | Release-trail columns at 1099, 1100, 1101, 1199, 1200, 1201 | The compact release trail now remains through the wide breakpoint; the full track layout begins at 1201px. |

Equivalent integer ranges (`min-width: 701px` and `701px–900px`) were compared
at 700/701 and 900/901 before replacing them with CSS range syntax. The
720px task-detail and 1099px task-board thresholds remain container queries:
their layout follows allocated component width, not viewport width. Daily's
640px and 760px queries were left untouched as requested.

### Final results and limits

| Viewport | Samples | Document horizontal overflow | Stable uncontained overflow |
| --- | ---: | --- | --- |
| 320×844 touch | 28 | None | None |
| 375×812 touch | 28 | None | None |
| 390×844 touch | 28 | None | None |
| 768×1024 | 28 | None | None |
| 1024×768 | 28 | None | None |
| 1440×900 | 28 | None | None |
| 844×390 touch landscape | 28 | None | None |

The 28 samples per width are 14 entry paths in two themes. The focused
long-text check also passed for Usage, Kanban, the task window, and release
detail at all seven widths and both themes (56 additional samples).

The healthy Kanban/task fixture was rejected by the app's strict response
validator, so the board and task-history content could not be verified as
populated; their error and workspace-window states were reachable. Daily's
healthy state was not reachable and remains unmodified. Proactive healthy data
and the attention-event popover were also not reached; the mobile menu and
Background work popover were. The synthetic responses made loading brief, so
loading was not retained as a separate stable matrix state. Chromium supplied
zero safe-area insets and no operating-system keyboard; physical notch,
on-screen-keyboard, and live-device behavior remain unverified. Only three
distinct, persistent overflow causes were reproduced, so the screenshot set
contains three before/after pairs rather than fabricating five defects.

## Pass 3: button system (18 October 2026; P14-03)

Removed the shared primary button's 32px layout margin. Existing row and form
spacing stays on its action container; the deployment form uses a 42px grid
row-gap (the former 10px gap plus the removed 32px button margin). Secondary
recovery actions that had their own top margin now use spaced `.button-group`
wrappers. No button behavior, route or accessible name was intentionally
changed.

The unclassed Knowledge, SettingsAdvanced, Usage and Notes buttons now use the
ghost level. `styles.test.tsx` guards the shared variants' margin, radius,
focus, coarse-pointer target and no-decorative-rim contracts, and checks that
production TSX buttons have a class. The Daily CSS tree remains untouched.

## Pass 3 rendered checks

The scratch Vite harness stubbed auth only in `/tmp`, used synthetic API
responses, and ran the actual app in Chromium. Before/after contact sheets show
the same nine workflows—Settings, destructive confirmation, Factory board,
task window, Proactive, Notes/Knowledge toolbar, chat, empty state, and busy/
disabled—at 390×844 and 1440×900 in both themes:

| Viewport | Light before | Light after | Dark before | Dark after |
| --- | --- | --- | --- | --- |
| 390×844 | [WebP](ui/p14-03/before-light-390x844-workflows.webp) | [WebP](ui/p14-03/after-light-390x844-workflows.webp) | [WebP](ui/p14-03/before-dark-390x844-workflows.webp) | [WebP](ui/p14-03/after-dark-390x844-workflows.webp) |
| 1440×900 | [WebP](ui/p14-03/before-light-1440x900-workflows.webp) | [WebP](ui/p14-03/after-light-1440x900-workflows.webp) | [WebP](ui/p14-03/before-dark-1440x900-workflows.webp) | [WebP](ui/p14-03/after-dark-1440x900-workflows.webp) |

Standalone Settings captures are included in the same folder. The rendered
checks reported no browser console errors. Keyboard traversal showed a visible
3px focus outline on all 12 shared/specialized button probes; touch emulation
reported coarse pointers and 44px-or-larger targets. The Check now busy state
kept its width unchanged at both viewport sizes. Reduced-motion emulation was
active during the checks and retained the existing motion-token behavior.

The 320px board check found the same pre-existing 384px document width before
and after; overflow comes from the Kanban board's issue-list item, not from a
button. The parallel P14-05 overflow sweep owns that non-button layout, so this
button pass leaves it unchanged. Other checked pages had no new document-width
increase.

## Pass 3 (borders, radii, surfaces)

Counts below compare the web stylesheet state at the start of this pass with the
final state. PostCSS counted literal-radius declarations (excluding tokens,
keywords, `0` and `50%`), `999px` declarations, visible side borders, inset
`box-shadow` declarations, and each raw hex/RGB/HSL color occurrence outside a
custom property. The issue's filing inventory predates this branch baseline;
these measurements use the same parser and scope before and after.

| Stylesheet | Literal radii | `999px` | Visible side borders | Inset shadows | Raw color literals |
| --- | ---: | ---: | ---: | ---: | ---: |
| `styles.css` | 51 → 1 | 11 → 0 | 23 → 24 | 29 → 0 | 36 → 0 |
| `ConversationHistory.css` | 6 → 0 | 0 → 0 | 0 → 0 | 14 → 7 | 13 → 3 |
| `ChatAttachments.css` | 3 → 0 | 0 → 0 | 0 → 0 | 1 → 0 | 0 → 0 |
| `JarvisStage.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 0 |
| `VoiceControls.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 0 |
| `CameraPreview.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `ConversationToast.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `PushNotifications.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `daily/daily-overview.css` | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 | 0 → 0 |
| `daily/daily.css` | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 | 0 → 0 |
| `daily/nutrition-targets.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `notes/NotesArea.css` | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| `proactive.css` | 0 → 0 | 0 → 0 | 2 → 2 | 0 → 0 | 0 → 0 |
| **Total** | **60 → 1** | **11 → 0** | **27 → 28** | **44 → 7** | **57 → 3** |

The lone remaining radius is `.deployment-add` (`14px`), a P14-03-owned button
exception. Seven inset-shadow declarations and three color literals remain only
in the reasoned P14-03 button/voice-control exceptions listed below. The four
Daily border declarations already used `--rule`; `apps/web/src/daily/**` was not
changed. One existing `.app-topbar` reset became a 1px `--rule` separator; the
total side-border declaration count remains 31 (27 visible plus four resets
before, 28 visible plus three resets after).

### Side-border classification

Every visible side border is structural, a row separator, or the resize-grip
glyph; all use a single 1px `--rule` line. The `.app-topbar` entry occurs in two
rules and is counted twice. Zero/reset declarations are listed separately.

| File | Selector | Property | Decision |
| --- | --- | --- | --- |
| `styles.css` | `.area-rail` | `border-right` | Navigation/page structural separator; neutral `--rule`. |
| `styles.css` | `.area-sidebar` | `border-right` | Desktop sidebar/page structural separator; neutral `--rule`. |
| `styles.css` | `.app-topbar` (two declarations) | `border-bottom` | Shared header separator; replaced the second rule's inset imitation with neutral `--rule`. |
| `styles.css` | `.context-panel` | `border-left` | Desktop context-panel boundary; neutral `--rule`. |
| `styles.css` | `.setup-status > div + div` | `border-top` | Separates status rows; neutral `--rule`. |
| `styles.css` | `.workspace-resize-edge-corner::after` | `border-right`, `border-bottom` | Functional resize-grip glyph; retained at 1px in neutral `--rule`. |
| `styles.css` | `.generated-view-table th, .generated-view-table td` | `border-bottom` | Structural table-row separator; neutral `--rule`. |
| `styles.css` | `.activity-list > li + li` | `border-top` | Separates activity rows; neutral `--rule`. |
| `styles.css` | `.repository-list` | `border-top` | Separates the list from its preceding section; neutral `--rule`. |
| `styles.css` | `.repository-list > li + li` | `border-top` | Separates repository rows; neutral `--rule`. |
| `styles.css` | `.project-archive` | `border-top` | Separates the archive action from the project list; neutral `--rule`. |
| `styles.css` | `.release-record-list, .release-run-list, .release-deployment-list` | `border-top` | Separates release lists from their headings; neutral `--rule`. |
| `styles.css` | `.release-record, .release-run-list > li, .release-deployment-list > li` | `border-bottom` | Separates release-history rows; neutral `--rule`. |
| `styles.css` | `.task-usage-table th, .task-usage-table td` | `border-top` | Separates task-usage rows; neutral `--rule`. |
| `styles.css` | `.usage-group` | `border-top` | Separates usage groups; neutral `--rule`. |
| `styles.css` | `.usage-tool-counts` | `border-top` | Separates tool counts; neutral `--rule`. |
| `styles.css` | `.usage-tool-counts dl > div` | `border-top` | Separates tool-count rows; neutral `--rule`. |
| `styles.css` | `.usage-table th, .usage-table td` | `border-top` | Structural usage-table separator; neutral `--rule`. |
| `styles.css` | `.area-sidebar` | `border-bottom` | Mobile sidebar/page structural separator; neutral `--rule`. |
| `styles.css` | `.context-panel` | `border-bottom` | Mobile context-panel boundary; neutral `--rule`. |
| `styles.css` | `.mobile-menu-actions` | `border-top` | Separates navigation from menu actions; neutral `--rule`. |
| `styles.css` | `.system-status-row + .system-status-row` | `border-top` | Separates status rows; neutral `--rule`. |
| `daily/daily-overview.css` | `.daily-overview-row` | `border-top` | Daily row separator; existing neutral `--rule`, unchanged. |
| `daily/daily.css` | `.daily-table th, .daily-table td` | `border-bottom` | Daily table separator; existing neutral `--rule`, unchanged. |
| `proactive.css` | `.proactive-block` | `border-bottom` | Separates Proactive sections; neutral `--rule`. |
| `proactive.css` | `.proactive-item-row, .proactive-source-row, .proactive-runs-list > li` | `border-bottom` | Separates Proactive rows; neutral `--rule`. |
| `styles.css` | `.area-sidebar` | `border-right: 0` | Mobile reset prevents a duplicate desktop-side separator. |
| `daily/daily.css` | `.daily-table tr:last-child td` | `border-bottom: 0` | Suppresses a trailing rule after the final table row; unchanged. |
| `proactive.css` | `.proactive-item-row:last-child, .proactive-source-row:last-child, .proactive-runs-list > li:last-child` | `border-bottom: 0` | Suppresses a trailing rule after each final row. |

### Ratchet exceptions and shared surfaces

`apps/web/src/stylesheets.test.tsx` parses every CSS file recursively. Its
reasoned exceptions are value-pinned so a changed border or shadow cannot inherit
an unrelated selector's exemption.

| Measure | Allow-listed form | Reason |
| --- | --- | --- |
| Radius | `0`; `50%`; `.deployment-add` at `14px` | Square edges and true circles are intentional; the deployment button is owned by P14-03. |
| Side borders | Entries in the classification table above | Structural separators and functional grip glyph only; 1px neutral `--rule`. |
| Inset shadows | Two `.input-orb span` states | The inset shading is part of the genuine circular voice orb, not a button border. |
| Raw colors | `.input-orb span` background | The highlight and stage surface belong to the semantic voice orb; button hierarchy colors use tokens. |

Shared panels, dialogs, popovers, cards, selected rows and hover states now use
the established surface roles, neutral `--rule`, and `--panel-shadow`. Selected
items use a complete selected surface rather than a colored edge. Chat bubbles
and stage glass retain their existing role-specific surfaces. Light and dark
themes use the same semantic tokens.

### Pass 3 rendered checks

Captured 24 synthetic before/after WebP images (1.1 MB total) for Settings with
the Presence popover open, the Factory task window, and conversation history
with an attachment. Each view was rendered at 390×844 with touch emulation and
1440×900 in light and dark. Chromium reported no console errors or horizontal
overflow; the task, attachment, settings and popover content rendered from
synthetic fixtures. Files are in [`docs/ui/p14-04/`](ui/p14-04/).

The keyboard focus check at 390×844 showed a visible 3px focus outline on the
skip link. Reduced-motion emulation kept the page content available. These are
local synthetic Chromium checks, not live-service or human acceptance. Usage,
Status, Knowledge, Notes, and a separate healthy Factory board view were not
captured in this bounded screenshot set.

### P14-07 rendered checks (18 October 2026)

Captured the five button variants in rest, hover, pressed, focus-visible,
disabled and busy states in the scratch gallery at 390×844 (touch) and
1440×900, light and dark. The gallery also shows Settings save, Factory task
actions, a danger confirmation, an empty-state action and the chat composer.
Four actual-app composites add Settings, the Factory board and chat at each
viewport/theme. All samples use synthetic data:

| View | Light | Dark |
| --- | --- | --- |
| Gallery, 1440×900 | [before](ui/p14-07/before-light-desktop.webp) · [after](ui/p14-07/after-light-desktop.webp) | [before](ui/p14-07/before-dark-desktop.webp) · [after](ui/p14-07/after-dark-desktop.webp) |
| Gallery, 390×844 touch | [before](ui/p14-07/before-light-touch.webp) · [after](ui/p14-07/after-light-touch.webp) | [before](ui/p14-07/before-dark-touch.webp) · [after](ui/p14-07/after-dark-touch.webp) |
| Actual app composite, 1440×900 | [Settings, Factory and chat](ui/p14-07/after-app-light-desktop.webp) | [Settings, Factory and chat](ui/p14-07/after-app-dark-desktop.webp) |
| Actual app composite, 390×844 touch | [Settings, Factory and chat](ui/p14-07/after-app-light-touch.webp) | [Settings, Factory and chat](ui/p14-07/after-app-dark-touch.webp) |

Chromium contrast ratios below are the minimum of top and bottom interior
samples after state transitions settled; the tonal gradients are vertical.
Busy labels are visually hidden beneath the inline Loader, so there is no
visible label sample for that state; the accessible name remains unchanged.

| Theme | Primary | Secondary | Ghost | Danger | Filled danger |
| --- | ---: | ---: | ---: | ---: | ---: |
| Light | 4.63:1 | 12.02:1 | 12.15:1 | 5.53:1 | 5.92:1 |
| Dark | 6.96:1 | 12.25:1 | 16.13:1 | 6.32:1 | 6.24:1 |

The outer focus outline measured 4.62:1 against the light page and 14.40:1
against the dark page. The weakest of the two visible focus bands, measured
against both its page and button, was 4.49:1 in light and 9.25:1 in dark.
Forced-colours emulation removed gradients and resolved the boundary and focus
to system colours ([capture](ui/p14-07/forced-colors.webp)). More-contrast
emulation removed gradients; reduced-motion emulation produced no button
transition or press transform, while state colours remained. Coarse-pointer
button targets, including the composer send action, were 44px high (44×44px
for the send action). No horizontal overflow was found at 320px or at the
390px app viewport, and Chromium reported no console errors.

These are local synthetic Chromium results, not live-service, physical-device
or human acceptance.

## Daily responsive and consistency audit (18 October 2026; P12-36)

The Daily equivalent of the Pass 3 responsive/overflow method audited the shell,
Overview, Workouts, Nutrition Day/Trend/Library, Body, Sleep, Briefs and Data.
The full section × width × theme × state findings and consistency table are in
[`docs/ui/p12-36/audit.md`](ui/p12-36/audit.md). It records every reproduced
defect, the pre-fix and post-fix examples, and the remaining chart-label-size
exception.

Headless Chromium used synthetic API responses, the actual Daily components,
Daily stylesheets before the shell stylesheet, and `.app-shell` around the page.
The populated matrix covered 126 view/width/theme combinations (including a
720 CSS-pixel viewport as a 200%-effective-width check); empty, loading and
error coverage added 324 combinations. The final matrices had no document,
Daily panel or section-panel overflow, clipped controls or chart labels,
under-44px touch targets, chart tick overlaps, or console errors. A keyboard
pass found visible focus rings. No live Daily data or original-site parity was
claimed.

The twelve linked synthetic JPEG examples in `docs/ui/p12-36/` total 1.0 MB.
Three “before” examples restore only the old responsive CSS rules over the same
synthetic markup; the tall desktop “after” captures expose the sections' lower
content. No change was made to the parallel Data or Briefs rebuilds, `DailyPage`,
or `PLAN.md`.

## Chat, composer, and generated-table correction (P14-19; 19 October 2026)

The QA pass found the message time tag overlapping short bubbles on touch,
unbalanced spacing above “Interrupted,” undersized coarse-pointer targets, and
left-aligned numeric columns in generated tables. Touch metadata now follows
message text, interrupted-label spacing is balanced, the task link and voice
orb meet the 44px target, and wholly numeric columns use right alignment and
tabular figures.

Compared parent and current styles in a scratch Chromium fixture with synthetic
messages and table rows at 320×640, 390×844, 768×1024, and 1440×900, in light
and dark with coarse-pointer emulation. The timestamp no longer intersects short
or long message text, numeric columns compute to right-aligned tabular figures
while text remains left-aligned, and the interrupted label has 8px above and
below. Task links measured 44px; the voice orb measured 48px on phone widths and
44px at tablet/desktop widths. Composer height was unchanged at 390px and 768px.
The stylesheet ratchet and all 131 web test files (1,804 tests), web lint with
`--max-warnings 0`, and the web build/typecheck passed.

Headless Chromium reported `hover:none` even with fine-pointer emulation. CDP
forced the message `:hover` state and keyboard focus separately; both revealed
the metadata. A physical fine-pointer device was not available.

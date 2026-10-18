# P12-36 Daily responsive and consistency audit

## Scope and method

The audit rendered the current Daily shell and all six sections with synthetic
API responses in headless Chromium. Daily CSS loaded before `styles.css`, inside
`.app-shell`, so the production SVG cascade was represented. The fixture contained
only synthetic dates and records; unmatched requests were not sent to a live
service.

The populated matrix covered Overview, Workouts, Nutrition Day/Trend/Library,
Body, Sleep, Briefs and Data at 320, 360, 390, 720, 768, 1024 and 1440 CSS px in
light and dark (126 samples). The 720 CSS-pixel viewport represents a 1440px
display at 200% effective layout scale; browser zoom itself was not changed.
Empty, loading and error states covered the same nine views at 320, 360, 390,
768, 1024 and 1440 in both themes (324 samples). The 390×844 and 1440×900
viewports were included; taller desktop captures expose content below the first
screen. The 320px checks used coarse-pointer emulation.

| Section | Width | Theme | State | Finding | Before | After |
| --- | --- | --- | --- | --- | --- | --- |
| Daily shell / Overview | 320, 360, 390 | Light and dark | Populated | The summary grid used narrow paired columns, leaving cramped labels; the final tile could leave an empty grid cell. The workout summary repeated its start date. | [Overview, 320](before-overview-phone-320-light.jpg) | [Overview, 320](after-overview-320-light.jpg) |
| Daily shell / section tabs | 320, 360, 390 | Light and dark | Populated | The tab strip overflowed horizontally without a clear cue. | Not captured | A contrasting, visible horizontal scrollbar is present only when the strip overflows; keyboard tab focus remains visible. |
| Daily shell / period control | 320, 360, 390 | Light and dark | Populated | Checked for wrapping, clipping and undersized controls; no additional defect reproduced. | Not reproduced | The shared control remains operable with targets at least 44px high. |
| Workouts | All seven populated widths | Light and dark | Populated | No section-local overflow, clipping, unequal tile, or target defect reproduced. Shared chart-axis fixes apply to its charts. | Not reproduced | [Workouts, 1440](after-workouts-1440-dark.jpg) |
| Nutrition Day | 320, 360, 390 | Light and dark | Populated | Previous/date/Next/Today wrapped across as many as three rows at phone widths. | [Day controls, 320](before-nutrition-day-320-light.jpg) | A deliberate two-row grid keeps every control visible at 320px; [after](after-nutrition-day-320-light.jpg). |
| Nutrition Trend | All seven populated widths | Light and dark | Populated | No chart-container overflow or clipped/overlapping SVG label reproduced after the shared chart fix. | Not reproduced | [Trend, 1440](after-nutrition-trend-1440-dark.jpg) |
| Nutrition Library | 320 | Light and dark | Populated, empty, loading and error | The nested view tabs widened the panel by 2px. | No separate image | Tabs now stay within the panel and scroll inside their own visible track; panel overflow is 0px. |
| Body | 320, 360, 390 | Light and dark | Populated | Shortcut tiles were uneven and the horizontal strip had no visible scroll affordance. Long stat notes could force excess tile space. | [Body shortcuts, 320](before-body-shortcuts-320-light.jpg) | Equal-height shortcut buttons, a visible scrollbar and wrapping stat notes; [after](after-body-320-light.jpg). |
| Sleep | 320 | Light and dark | Populated | The “Nights recorded” tile note forced its content 11px beyond the panel. | No separate image | Shared stat notes wrap at long words; tile and panel remain within their container. [Sleep, 1440](after-sleep-1440-dark.jpg) |
| Every `DailyChart` consumer | 320 | Light and dark | Populated | Long numeric y-axis labels used too little plot margin; Body date ticks overlapped by 1.5px. | No separate image | The left margin follows the formatted y ticks and narrow categorical axes use fewer date labels. No label bounding-box overflow or overlap remained. |
| Briefs | All seven populated widths | Light and dark | Populated | No section-local overflow, clipping or undersized target reproduced. | Not reproduced | [Briefs, 1440](after-briefs-1440-dark.jpg) |
| Data | All seven populated widths | Light and dark | Populated | No section-local overflow, clipping or undersized target reproduced. The current parallel rebuild was inspected without editing `sections/data/**`. | Not reproduced | [Data, 1440](after-data-1440-dark.jpg) |
| All nine views | 320, 360, 390, 768, 1024, 1440 | Light and dark | Empty, loading, error | No document, Daily panel, or section-panel overflow; no clipped text, undersized coarse-pointer target, or browser console error. The 2px Nutrition Library panel overflow above was the only state-matrix defect and is fixed. | Nutrition Library panel: 2px | 0px overflow in all 324 state samples. |

“Before” images for Overview, Nutrition Day and Body were captured from the same
synthetic markup with the pre-fix responsive rule restored in the browser (two
summary columns, wrapping flex controls, and the five-column shortcut strip).
They are not live data or screenshots from the original Daily site. After desktop
captures use a 3200px viewport height so the internal Daily scroll area exposes
lower charts and lists; the matrix itself retained 900px desktop-height samples.

## Cross-section consistency

| Concern | Difference found | Alignment to the Daily kit |
| --- | --- | --- |
| Block spacing | Overview, Workouts, Nutrition, Body & sleep and Briefs use different gaps for cards, lists and chart groups. | Keep density-specific spacing, but use only the established `--space-*` scale. No new spacing token or arbitrary value was introduced. |
| Heading hierarchy | Section headings, analysis headings and record headings have different semantic levels. | Use the shared heading hierarchy and existing `--type-subheading`, `--type-subsection` and `--type-body` roles; do not flatten distinct levels. |
| Freshness position | Freshness sits beside each section's relevant loaded data; Overview has per-source tile freshness, while collection views place it at the group they qualify. | Reuse `FreshnessLine`; keep the line adjacent to the data it qualifies rather than moving it to a page-wide fixed position. |
| Tile padding and radii | Summary and metric tiles vary between standard and compact density; record details are separate surfaces. | Shared `StatTile` geometry uses existing space and panel-radius tokens. Body stat tiles no longer stretch vertically to match a long-text neighbour, and notes wrap inside them. |
| Chips and badges | Macro/stage chips identify categories; Overview status badges identify record/failure states; workout value groups are not status chips. | Keep semantic differences, use the existing pill/control radii and surface/text roles, and never rely on color alone. |
| Disclosure markers | Nutrition records, coverage notes and chart tables share native `<details>` but have different labels. | Keep the shell's common plus/minus disclosure marker, visible focus, and 44px coarse-pointer target; no section-specific marker override was found. |
| Empty-state wording and layout | “No meals”, Health history and unavailable source states describe different facts and recovery actions. | Keep the shared `DailyState` treatment where applicable and retain precise section wording. Health history remains linked to Settings → Health upload; copy was not generalized. |

Across both matrices, the document, `.daily-page` and `.daily-section-panel`
had no horizontal overflow after fixes. No element was clipped outside its own
intentional scroll region; chart text stayed inside SVG viewBoxes and no
categorical tick boxes overlapped. All measured coarse-pointer targets were at
least 44px. The 12px SVG chart labels remained below the 13px caption role in 56
populated samples; this is the existing pixel-sized SVG exception pinned by
`stylesheets.test.tsx`, not CSS scaling, and was left unchanged.

The keyboard pass at 390px confirmed visible 2–3px focus outlines on the Daily
tab, section panel, refresh action and links, with no console errors. The browser
matrix used the current Briefs and Data rebuilds for inspection only; this audit
does not establish live-data or original-site parity.

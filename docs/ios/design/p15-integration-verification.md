# P15 board integration verification

Updated 5 November 2026, 23:22 UTC. Release target: **6 November 06:00
Europe/Copenhagen (05:00 UTC)**. The owner authorised the full non-Chat consistency
pass, merges, required Notes backend deployment and TestFlight upload. Work directly;
do not merge validation-only #1609 or dispatch duplicate simulator runs.

## Delivery and scope

Shared #1604 merged first as `c818a6b3`. Remaining order: **#1605 Notes, #1606
Home/Factory, #1607 Health, #1608 Insights, #1610 Settings**. All now target main.
The Notes `/notes/folders` backend must deploy successfully before TestFlight.
No page PR has merged and no TestFlight build has been submitted yet.

The approved board remains #1603 / main `2522aca2`. Native composition uses the
shared page insets, row padding, line spacing, 24-point surfaces, semantic headings
and shared controls. Meaningful headings cover Notes recent/folder/task groups,
Health Last lifts / Recent sessions / Body trend, Usage ranked tasks and tool calls,
Proactive budget/checks, Notifications groups, Workspaces date groups and Settings
sections. Voice's orb/status/bottom-control composition was inspected; its shared
orb is retained to preserve Chat. No simulated board metric becomes live app data.

ChatModel, ChatScreen and Orb match main exactly. Settings now uses the same
continuous segmented bar as Home/Factory, global search, native details and grouped
rows. Larger text scrolls the section choices and stacks row values. Final capture
review corrected decorative icon overlap and keeps unavailable-state text readable.

## Verified evidence

- Combined `f868f435`: general CI run **42125449379 passed**, including **493/493
  Core tests** (job 127589413993), backend, database, web and other impact checks.
- Local focused backend suite: **137 passed**; backend TypeScript build passed.
  Pipeline checks: **74 passed**. Health sync regressions: **12 passed**.
- Shared `a82c570e`: **46/46 native tests passed**, run 42116847879. Screenshot
  artifact 13461107725 inspected for Workspaces EN/dark, DA/light and shared sheet
  action order. The later standalone sweep hit the job timeout; it is not a green
  overall workflow result.
- Settings `4b823206`: **49/49 native tests passed**, run 42121264726, artifact
  13461059102. English/dark, Danish/light and accessibility XXXL were inspected.
  The captures exposed normal-size tab truncation in its older shared component
  and large-text symbol overlap. The final shared bar and symbol correction still
  require fresh native screenshots; the earlier pass is not visual acceptance.
- Earlier Home/Factory `331702d4`: **48/48 native tests passed**, run 42115728133.
  Corrected Factory EN/dark and DA/light screenshots in artifact 13459666412 show
  the pipeline, task expansion and fixed Board/Releases/search dock.
- Earlier Health `9c8df9a6`: **48/48 native tests passed**, run 42115737406.
  Earlier Insights `7eb90fa0`: **48/48 passed**. These precede later corrections.
- Notes retry `c6ac6d83`: **48/50 passed**. Both failures were traced to native
  evidence and corrected: the folder destination/draft reset and the graph Open
  button's accessibility containment. The assertions were retained. Graph-to-Tasks
  search now reruns and its native test checks matching tasks.

Native page runs for the latest Notes, Factory, Health and Insights sources remain
active; retrieve their logs/artifacts before accepting their results. The previous
combined `f868f435` run is superseded by the Settings/Health accessibility corrections;
use a single final combined run for the updated code rather than a separate Settings
rerun. The final combined suite includes all page interaction and screenshot checks.

## Functional corrections included

Notes creation snapshots its chosen folder and initializes drafts once. Shared
content tile/row controls satisfy the design-system guard. Factory and Usage retain
recovery selectors after failed loads. Workspaces clears old-filter rows/counts and
rejects late responses. Health paginates anchored sample reads, sends complete
Copenhagen days within the existing request bound, rejects an oversized day before
upload, and preserves retained step days absent locally. Regression checks cover
backlogs, anchors, explicit zero and Copenhagen day boundaries. Health's page
indicator is VoiceOver-adjustable; its explicit transition honors Reduce Motion.

## Remaining release gates

Inspect final native screenshots and interaction results, including languages/themes,
large text and any native failure evidence. Then merge the owning PRs in order,
compare final app/test trees with the verified integration, confirm the Notes backend
deployment/readiness, and dispatch the existing `ios-testflight.yml` on main with
`branch=main`. Report upload/build number separately from Apple processing.
Physical HealthKit permissions, live VoiceOver and signed-device acceptance cannot
be established by simulator fixtures. No workflow/project/signing change is required.

# P15 integrated board verification

Historical pre-release checkpoint: **6 November 2026**.
Final outcome: [released build and accepted evidence](p15-release-2026-11-06.md). This record supersedes earlier
pending-state notes in page verification documents. Reference: approved board.html
from #1603, rendered unchanged at 402 × 874 logical points / scale 3. The board is
a composition reference, not evidence of the native app or live backend data.

## Scope and delivery

All non-Chat pages share consistent headings, spacing, grouped rows, controls and
surfaces while retaining their real workflows. Home has a shorter event/task greeting.
Confirmed note creation and task completion show short, nonblocking visual feedback;
lift/workout sheets keep their Saved state. Native success haptics fire after writes.
Transitions are interruptible and honor Reduce Motion. Failed Home completions show
recovery and refresh versions; they do not report success early.

Settings includes General, Models, Health and Account, global search and native
detail/save flows. Voice retains its existing board-like orb/status/control layout;
the shared orb is unchanged to preserve Chat. ChatModel and ChatScreen are unchanged.
No simulated board values become live product data.

Recorded merge order: #1604 shared (`c818a6b3`), #1605 Notes (`70dfe424`), #1606
Home/Factory (`1bb81a44`), #1607 Health (`4ccdad38`), #1608 Insights (`2b865706`),
then #1610 Settings (pending). **#1609 is validation only and must never merge.**

Notes backend deployment **42136945743 passed**, including backend apply,
deterministic runtime readiness and live conversation acceptance. The empty-folder
endpoint dependency is therefore deployed before the iOS release.

## Functional and CI evidence

- Notes final delivery CI **42135284949 passed**, including **476 Core tests**.
- Home/Factory final delivery CI **42137020863 passed**, including **477 Core tests**.
- Health final delivery CI **42137475088 passed**, including **487 Core tests**.
- Insights final delivery CI **42138510164 passed**, including **493 Core tests**.
- Focused local backend suite: **137 passed**, TypeScript build passed. Pipeline
  checks: **74 passed**. Health sync regressions: **12 passed**.
- Combined 4ea30d09: general CI **42129251491 passed** (493 Core), native
  **42129251285 passed all 61 UI tests**. Settings captures in artifact 13465195628
  were inspected in EN/dark, DA/light and AX XXXL, including all sections and search
  detail. Normal labels fit; large text scrolls choices and stacks values.
- Combined 7aa08ec6: **42134678739 compiled, 61/62 native tests passed**. All 27
  ComponentGallery, 19 Sidebar and four ChatComposer tests passed. The single failure
  was the new Home completion test selecting Tasks due for t1/t2, which are due
  today. The recorded failure shows only upcoming t3. Production grouping is correct.
  The test now expands Today and retains both completions and usability assertions.
  This failed run is not final acceptance of the added task feedback.

GitHub's ubuntu-latest moved to Ubuntu 26.04, unsupported by the pinned Swift action.
The Linux Core job alone now uses ubuntu-24.04. Initial setup failures were not test
passes. The necessary compatibility exception was announced under the existing
release authorisation; subsequent CI above passed. Mac execution, project, signing,
TestFlight and test assertions were not weakened or changed to bypass a failure.

## Native visual review

Earlier page suites passed: Notes 50/50 (42125346515), Factory 48/48 (42124893512),
Health 48/48 (42124896873), Insights 50/50 (42124893661). Their later standalone
capture sweeps timed out; these are selected-suite passes, not overall workflow
success. Retained captures cover Notes browsing/Graph/nested creation; Factory
pipeline/expansion/dock; Health Training, Sleep and Nutrition; Usage, Status,
Proactive, Notifications, Workspaces and Settings. Bilingual light/dark and large
text findings were corrected and carried into combined verification.

Artifact **13468046343** from 7aa08ec6 was inspected for:

- Home EN/dark and DA/light: shorter greeting and shared layout accepted.
- Lift Saved state and usable dismissal: accepted; actual appearance was light,
  so the test now explicitly selects dark to match its attachment name.
- Usage, Status and Proactive AX XXXL: readable values, scrolling choices and
  protected header accepted. Settings AX General retains readable labels/symbols.
- Health lower EN/dark and DA/light: Last lifts, Recent sessions, Body trend and
  freshness/layout accepted. Scrolled rows still crossed the normal-size title.
- Monthly Nutrition EN/dark and DA/light: five spaced dates improved the chart,
  but the first/last labels still became ellipses.

Final corrections enable native `.scrollEdgeEffectStyle(.soft, for: .top)` on the
shared non-Chat header, preserving the extra AX material. Monthly labels retain
intrinsic width and inward boundary anchors; seven-day weekday placement remains
native. One new Settings run verifies all combined source and retained interactions.
Do not accept these two corrections until their new native captures are inspected.

## Source and interaction corrections

Notes snapshots the selected folder and initializes drafts once. Graph selection
retains the real Open action; Graph-to-Tasks changes rerun search. Factory and Usage
retain recovery selectors after errors. Workspaces clears stale filter rows/counts
and rejects late responses. Health paginates anchored reads, sends complete
Copenhagen days within the request bound, rejects oversized days before upload and
retains server step days absent locally. Only successful complete sync advances
anchors. Explicit zero replaces prior values. Body-fat units remain fractions for
the existing normalizer. The Health pager supports VoiceOver adjustment and Reduce
Motion. Native controls remain functional; no decorative actions were introduced.

## Apple sources and deliberate composition

Read directly from Apple's Markdown documentation on 6 November:
[sensoryFeedback](https://developer.apple.com/documentation/swiftui/view/sensoryfeedback(_:trigger:condition:)),
[Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics),
[Reduce Motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion),
[AxisMarks](https://developer.apple.com/documentation/charts/axismarks),
[AxisValueLabel](https://developer.apple.com/documentation/charts/axisvaluelabel),
[scrollEdgeEffectStyle](https://developer.apple.com/documentation/swiftui/view/scrolledgeeffectstyle(_:for:)),
and [ScrollEdgeEffectStyle](https://developer.apple.com/documentation/swiftui/scrolledgeeffectstyle).
Settings sources are recorded in its verification file. The shared segmented bar,
brief confirmation geometry and approved ambient composition are app choices; Apple
does not specify those exact dimensions. Native material, controls, feedback and
accessibility behavior support that composition.

## Pre-release gates (historical)

Inspect final native results/captures, pass Settings CI, merge Settings last and
compare the entire released app/test tree with the verified source. Then dispatch
unchanged `ios-testflight.yml` on main with `branch=main` for the authorised
6 November 06:00 Copenhagen target. No upload is yet claimed. Apple processing,
physical haptic feel, live VoiceOver and real HealthKit permissions cannot be
established by simulator fixture evidence.

## 6 November 01:57 UTC — Complete tests; remaining header finding

Settings `93a09531` passed **62/62 native UI tests** in run **42141442953**,
including the corrected Home completion case (17.268 seconds). General CI
**42141443249** passed 493 Core tests and CodeQL passed. The later standalone
capture sweep exceeded the time limit; overall workflow conclusion is cancelled,
not success. Artifact **13470356991** and result bundle **13470945889** were retained.

Inspected Nutrition EN/dark and DA/light: all five dates, including endpoints,
are readable. Task Completed feedback is visible while the second task remains
usable; the dark lift capture shows Saved to vault and an available close action.
Health lower-section image 26747869-4847-4936-BC38-3CEE06448303 still shows rows
behind the title. The soft scroll-edge modifier alone did not correct that finding.

The shared header now observes only the Boolean top-edge crossing and supplies
native regular material when content scrolls beneath it. The board's transparent
resting state and existing accessibility material are preserved. Apple's
[onScrollGeometryChange](https://developer.apple.com/documentation/swiftui/view/onscrollgeometrychange(for:of:action:))
Markdown was read directly; the Boolean transform avoids updating the page on each
offset. One new native run must confirm resting and scrolled appearance. Existing
tests and captures remain intact; no duplicate integration run is required.

## Final acceptance and release

Settings source `0f7c7c199c5e8d9193c6584349a313964d5c6480` passed all 62 native tests in run
42147200343; workflow result: cancelled after the later standalone capture sweep timed out. Artifact
13472647339 was inspected for the corrected chart boundaries, scrolled
headers and task/lift feedback. General CI 42147200262 passed 493 Core tests and
CodeQL passed. The final app/test tree matched main after the last Settings merge.

TestFlight build **75** uploaded successfully in run **42152517098**.
Apple processing: not independently confirmed; no matching Apple processing email was available at 02:55 UTC. See the release record for exact source
and upload time. Earlier pending statements above describe the historical
checkpoint and are superseded by this acceptance. Physical haptic feel, live
VoiceOver and real HealthKit permissions remain device checks.

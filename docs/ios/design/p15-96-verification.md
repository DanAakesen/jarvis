# P15-96 page audit and verification

Reference: `board.html` merged as #1603; Workspaces uses the separate older
`workspaces.html`. Reference values and native fixtures are synthetic.

| Page checked | Resulting change | Native evidence |
| --- | --- | --- |
| Usage | Current API decoding; period-scoped cache/reset; in-hero range; compact numbers; reconciled daily/weekly/monthly chart; three expandable tasks; correctly scoped tool counts | Pending Mac run and image inspection |
| Status | Real failing-check names and stale phrase; concise row details; separate Vault/Smoke group with expandable evidence | Pending Mac run and image inspection |
| Proactive | Real first finding/next check; three expandable findings; two-column sources; missing and stale data remain visible | Pending Mac run and image inspection |
| Notifications | Shared sections/rows; running/failed groups exclude completed jobs; clear-all for one or more updates; dismissal and expiry preserved | Pending bilingual native captures and image inspection |
| Workspaces | Existing hero/filter/search order retained; shared row insets and line spacing; native menus and swipe actions retained | Existing #1604 geometry test passed; this revision's image inspection pending |

The shared page capsule styling is implemented once in #1606. Merge #1604
first; integrate that shared change before final board matching.

Validated locally: 474 Core tests, 23 backend Usage/Now-feed tests, changed Swift
parser checks and whitespace checks. The decoding regression uses the exact
current response field names rather than the obsolete fixture. Every period
has conditional-read coverage; UI cases exercise every period and breakdown
control in the existing selected component suite. Existing captures cover
Usage/Status/Proactive in both languages and themes; additional captures cover
Notifications and the real controls. Backend tests cover seven-day expiry,
success exclusion, group dismissal and clear-all.

Actual native inspection, Dynamic Type fitting and exact screenshot comparison
remain pending. Artifact downloads currently return HTTP 403 from the managed
network policy; the saved GitHub archive is not proof of a visual match.

Apple primary references consulted: [HIG Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls),
[HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables),
and SwiftUI `View.task(id:...)` (cancellation/recreation when selection changes).
Official documentation search excerpts were available. Existing Swift Charts,
shared controls and native list interactions are reused.

CI follow-up: the approval source guard now checks `JarvisSectionHeadline`
while retaining its localized labels, fixture-only disabled actions and bilingual
capture checks. All 74 pipeline tests pass locally. The full script suite has
240 passes and three environment errors because this Linux workspace lacks
PowerShell; GitHub's configured runner supplies it.


## Native image inspection, 5 November 2026

The archive from run 42106346100 was downloaded successfully after a fresh
connector URL used the permitted Poland host. Usage, Status and Proactive were
visually inspected at 402 × 874 logical points. The Status board/native pair
was shown in chat: Foundry voice's long detail squeezed its state label almost
to zero width. The correction reserves the state word's intrinsic width and
places it under the title at accessibility text sizes. Shared spacing tokens
replace the local row gap. Usage now emphasizes the selected or latest bucket,
with neutral other bars, matching the reference's emphasis.

The Notifications attachment `4AB99A94-8D87-4211-AF5A-9AEE581D5504.png` actually
shows the sign-in cover. The test now includes the existing Simulator navigation
argument; its geometry, reachable close action and disabled synthetic-approval
assertions remain intact. Do not count the previous PNG as Notifications visual
acceptance, even though that suite passed 48/48 tests.

Apple Layout/Accessibility guidance used above applies to the adaptive row.
These follow-up corrections are source-reviewed but await native compilation,
new screenshots and visual verification. The continuation is checkpointing them
through the integration branch without interrupting the active Insights run
42106990041 / 127547007531. Push the page follow-up only after refreshing that run.

## Preserve Chat in the release scope

The final diff audit found an inherited change to `JarvisChatModel.shouldShowNowBar`.
The owner explicitly excludes Chat from board alignment, so that predicate is
restored exactly to main. Notifications keeps its page-specific grouping/filtering;
Chat source and shared orb appearance stay unchanged. The earlier statement that
this change also suppresses Chat's Now bar for completed background tasks is
superseded.

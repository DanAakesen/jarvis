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

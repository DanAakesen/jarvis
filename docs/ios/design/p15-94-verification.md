# P15-94 Home and Factory verification

Reference: `board.html` merged in PR #1603. The board is illustrative data.

- Home: one glass Today / Tasks due control, equal touching segments; shared row
  spacing and separators. Keep the board's grouping, without a Yesterday group.
- Factory: Board / Releases only. Board includes Needs Dan tasks; legacy Needs Dan
  fixture entry opens Board and expands/scrolls to the column. Columns otherwise
  start collapsed; outlined/indented task rows and fixed controls remain.
- Pending clarification: the older Delegated wording has no matching section in
  the published Home board. Issue #1600 says the board wins.

Core tests cover both available tabs, old Needs Dan targets, inclusion and search
of Needs Dan cards, default collapsed columns, counts and Home's Today/Due split.
The existing bilingual/light-dark Home captures now assert touching equal-width
segments and 44 pt targets. Two new cases in the already selected component suite
exercise default Board and the old Needs Dan entry and retain native captures.

All 469 JarvisCore tests pass locally on Swift 6.2, including the shared design
guards and Home/Factory behavior checks. Changed app and UI-test Swift files
pass parser checks. Local Swift parsing does not compile SwiftUI. Native tests and actual board/build
image comparison remain pending; no visual match is claimed.

Apple references: HIG Segmented controls (equal-width related choices), and
SwiftUI ScrollViewReader/ScrollViewProxy.scrollTo (reveal the column by identity).
The shared glass bar composes native buttons to preserve the approved surface;
selected traits and touch targets remain explicit. Official search excerpts were
available, but direct Markdown documentation fetches were blocked in this session.

## Native evidence review — 5 November 2026

Downloaded and inspected artifact 13455396644 from run 42105551008. The default
Factory test recording shows the sign-in cover while its accessibility tree
contains the collapsed board underneath. Its launch omitted the existing
Simulator-only `--ui-test-navigation` argument. The legacy-entry tree exposes
`factory.row.github.10` as a Button, not a Link. The corrected test uses that
fixture and observed role, retains the reachability check, and adds the expanded
state, task title and hittability assertions. Production authentication is unchanged.

Home's English/dark attachment 86F40C70-8CFC-4758-8E91-1F1BDC7C7BA2.png was
inspected beside the approved board at 402 × 874 points. The Today/Tasks due
control has one continuous surface and grouped rows have dividers. Fixture data
and native typography differ. Remaining states and fresh native verification are
pending; no final visual acceptance is claimed.

Apple excerpts consulted: [XCUIElement.isHittable](https://developer.apple.com/documentation/xcuiautomation/xcuielement/ishittable)
and [HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
The former distinguishes existence from visibility above another element.
Direct Apple Markdown fetches were unavailable.


5 November recovery review: a failed initial board request keeps the bottom segment and project selector available when projects loaded successfully, allowing a switch to another project or Releases. Native run 42115728133 passed all 48 UI tests at 331702d4, then timed out during the standalone capture sweep; the recovery follow-up still needs native verification.

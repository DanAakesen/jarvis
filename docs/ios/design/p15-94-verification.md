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

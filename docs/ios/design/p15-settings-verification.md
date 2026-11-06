# Settings and Voice board verification

Reference: approved board.html from #1603, rendered unchanged at 402 × 874
logical points / scale 3. Historical native Settings and Voice images were
inspected from Insights artifact 13453588831 (run 42106346100). Settings had
one oversized list and no segments. Voice retains the expected orb/status/bottom
control composition; the native shared orb differs from the web rendering and is
not changed because Chat must remain unchanged.

Settings now uses the board's bottom General/Models/Health/Account segments, shared
section headings and compact rows. Search remains global; detail/save/approval
flows remain native. The root does not copy the board's simulated direct-write
controls or sample settings. Accessibility sizes scroll the tab choices and stack
row values. Three native tests cover segments, cross-tab search and navigation.

Local verification: 53 Settings/localization/design-guard Core tests pass on Swift
6.2.4; changed Swift files pass parser checks. These do not typecheck SwiftUI.
Native run 42121264726 on 4b823206 compiled and passed **49/49** selected UI
tests, including all three Settings cases. The later standalone screenshot sweep
reached the job timeout; screenshot artifact 13461059102 was retained. Native
screenshots revealed truncated normal-size section labels and oversized decorative
row icons at accessibility XXXL. These are corrected with P15-94's
continuous shared segmented bar (still a 44-point target), a scrolling strip above
default text size, and fixed semantic icon geometry. The corrected native result
and screenshot acceptance are pending; the earlier pass is not final visual acceptance.

Apple documentation read: [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls),
[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables),
and [DynamicTypeSize](https://developer.apple.com/documentation/swiftui/dynamictypesize).
The shared segmented bar retains equal choices and selected accessibility traits;
large text uses the existing shared horizontal tab strip to keep labels readable.

## Corrected combined native acceptance — 6 November 2026

Combined 4ea30d09 passed all 61 native UI tests in run 42129251285, including all
three Settings cases. Screenshot artifact 13465195628 was inspected for General in
English/dark, Danish/light and accessibility XXXL; Models, Health and Account in
English/dark were also inspected. Follow-up inspection covered Models, Health and
Account in Danish/light and accessibility XXXL, plus the large-text search detail.
All four normal-size tabs are readable; larger
text uses the scrolling strip. Row symbols stay at the shared size while labels and
values stack and wrap. Search-to-detail and all section navigation assertions pass.
The new shared accessibility header refinement is included in the subsequent full
run; existing Settings screen source is unchanged.

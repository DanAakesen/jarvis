# P15-95 Health verification

Reference: the Health screens in `board.html`, merged as PR #1603. The reference
figures are invented sample data. No live Health values were accessed here.

Implemented: shared three-period headers on all carousel pages; one Training
donut, summary and steps chart; Last lifts with Home's Log sheet; shared sessions
and body rows; labelled 30-day body history with dated latest values. Local steps
use merged HealthKit statistics. Local/synced workouts deduplicate by identity;
older numeric activity names and Copenhagen timestamp fallbacks are handled.
The unchanged sync contract now carries merged step-day totals, not overlapping
raw iPhone/Watch samples. Existing Home vault lift notes are read without rewrite.

Validation so far: all 473 Core tests pass on Swift 6.2; 20 backend device-sync
checks pass, including the doubled raw-source reproduction, corrected merged
total, local-day workout boundary and HealthKit body-fat fraction conversion. Core covers DST boundaries, period choices,
legacy workout classification, distinct/same workout identities and reading back
Home's saved lift format and its bounded Notes API read. The reusable full dashboard fixture type-checks against
Core on Linux. Changed Swift files pass parser checks.

The existing selected component suite has English/dark and Danish/light capture cases for all
three heroes, period placement and section rows. They have not run. Linux cannot
compile SwiftUI/HealthKit or verify Apple source-priority behavior. Actual native
board/build comparison, Dynamic Type fitting and a permitted-device comparison
against Apple Health remain pending. No visual match or live-data correction is
claimed. Backend production code/schema and the logging write path are unchanged.

Apple references used: HIG Segmented controls, Layout and Charts; HealthKit
HKStatistics/HKStatisticsOptions (merged statistics and cumulative sums),
HKWorkoutActivityType, HKUnit.percent and Charts SectorMark. Official documentation/search
excerpts were available; some direct Markdown fetches were blocked. The training
donut uses native Charts SectorMark, and section/period actions reuse shared controls.

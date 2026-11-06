# Body trend and selector feedback — 6 November 2026

The owner rejected build 76's body-measurement rows and requested graphs on the
Health dashboard. The checked-in board has small row sparklines; this later
request replaces that composition with full-width native plots in the existing
Body trend group. Weight, body fat and lean mass each have an independent labelled
scale, a 30-day date axis, measurement points, latest value/date and measurement
count. One reading remains a visible point, with no invented trend or zero days.

The source remains the existing catalog and body-metric queries. The shared
`JarvisBodyTrend` presentation model sorts valid finite observations, preserves
their dates, prefers `value` over `avg_value`, and plots only the latest unit.
Mixed-unit or paginated data is marked partial; retained stale data remains
labelled. These are plots of recorded measurements, with straight segments
between observations, not daily estimates or a smoothed physiological model.

Tapping a plot selects the nearest real measurement and updates its value/date;
tapping the same point restores the latest reading. Vertical scrolling retains
its normal gesture. VoiceOver adjustment selects earlier/later observations.
The metric heading opens the existing records detail, which reuses the same
date-aware plot and lists the real measurements. Back retains dashboard context.

The screenshot also confirmed that the bounded Dashboard/Track workout rail was
too opaque. Joined selectors now use the same content-bearing clear glass as
Search, with a moving tonal selection inside one optical surface. This avoids
nested glass sampling labels. Separate scrolling choices retain their individual
lenses; all variants retain shared padding, immediate activation, spring/press
feedback and Reduce Motion/Transparency behavior. No Chat appearance changes.

Apple references read directly:
[Chart](https://developer.apple.com/documentation/charts/chart),
[glassEffect](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)),
and [chartXSelection](https://developer.apple.com/documentation/swiftui/view/chartxselection(value:)).
The chart uses the existing tap-overlay pattern to preserve page scrolling.

Initial preflight (superseded by the native records below): Core regressions cover sparse dates,
latest-versus-average precedence, single/empty series, mixed units and invalid
values. Synthetic preview data provides sparse Weight/Body fat histories and
single-point Lean mass. Existing native launches will verify chart selection,
detail navigation and bilingual captures alongside the widget/surface changes.
No simulator had been started at that initial checkpoint.

The first combined candidate b7e22951 failed Core and native compilation before
simulator boot: Swift could not type-check the chained conversion expression in
`JarvisBodyTrend`. It is now an explicit typed loop with separate date/value/unit
validation and sorting. No test or visual pass is claimed for that failed source;
the corrected candidate requires fresh qualification with unchanged assertions.

The simplified 0f93aa09 build then exposed the underlying module-boundary error:
JSON convenience accessors are app-local/file-private. The Core converter now
matches JSONValue's public string/number cases directly. No accessor visibility
was broadened. This build also stopped before simulator boot; fresh corrected
qualification is required.

On 5a923e70 all three new BodyTrend tests passed. The full Core run executed502
but failed the new format registry entry and the widget fixture's ambient guard.
The count now uses the established Int/%ld convention and has its required
registry entry. The DEBUG simulator gallery has a tightly guarded host-background
exception; production-page checks remain unchanged. Native build found only the
read-only widgetFamily environment injection in that gallery. The explicit medium
views need no environment override, so it is removed. Fresh whole-candidate
qualification remains required.

## First rendered qualification and corrections

Candidate 7acb5ec5 passed CI 42243718659, all 502 Core tests and CodeQL 42243718445.
Native 42243718420 compiled and ran 68 UI tests: 64 passed and 4 failed. Historical
point selection passed in both languages. The retained English/Danish plots show
real sparse dates, independent scales and visible points; the header and individual
glass dock controls have no full-width material backing.

The Health navigation failures are real: the recording and hierarchy show only a
Back button and blank destination. Detail's initial empty Group mounted neither
content nor its load/navigation modifiers. A concrete ZStack now shows loading
from the initial nil-data state, and retains recovery/empty/loaded states. The
existing test must find the titled navigation bar and loaded Measurements section,
then verify that Back preserves selected reading and dashboard position.

Review also caught compact-number formatting rounding 72.4 kg to 72 kg. Body readings,
axes, detail rows and accessible summaries now use localized decimal formatting
(up to two fraction digits). Both language checks require the fixture's 72.4 kg
reading with the correct decimal separator.

The AX recording shows a full chart fits above the dock, but test swipes coast
past the valid position and oscillate. Bounded slow drags now hold before release;
complete-plot visibility assertions remain. This is a test-gesture correction,
not a reduction of Dynamic Type or plotted information. Failure captures are
retained before assertion. Fresh qualification is still required.

Original evidence artifact 13520459974 exceeded the connector's 512 MiB limit.
Artifact-only extraction 42255492646 retained images/index 13521619175
(SHA256 38b37b862831f8fe058e2e6878cb21ca8c9e74b9ce4044310cc2a01ad929a9be)
and motion 13522686301; extraction 42256149686 retained failed-test recordings
13522028042 (SHA256 e4dc1fea90bf8102e12095d996b7ba56de700e2c9ab7cfad54ed028ec055594e).
These jobs read existing evidence only and did not build or run a simulator.

## Corrected native inspection — df56bcaa

Native 42258268925 checked out f924537b132f4c2f729a2cf034bfb777bc189ab5 with
app/test tree d3f0f3c1c7e71bd0ed0d97b0b7c11520255ad12a. It ran 68 tests: 66 passed
and two failed, in the camera-menu case and a widget AX-width assertion. Both
Health period cases and the accessibility Health case passed. Actual English/dark
and Danish/light captures show 72.4 kg / 72,4 kg, selection of the 8 October
73 kg reading, populated records, sparse Body fat dates and single-point Lean mass.
Back preserves the selected reading and chart position. The complete plot and
its endpoint labels fit above the dock at accessibility text size.

Rendered review also found native measurement-detail section headings remained
secondary gray. All titled Health-detail sections now reuse JarvisSectionHeadline
for the requested primary-color headings and common typography. This composition
change requires fresh native qualification; the passing df56 Health checks are
retained evidence for that source, not acceptance of the new source.

Retained UI artifact 13526639272 has SHA256
713f7c91721629f022b0e3f45e2e0262b24a4a9953c7c1b79d3def26d0e84eff.
The separate screenshot/motion artifact 13527575489 has SHA256
5ec689af0d4465868e4ca2f908ee3edfe0655d94c3f2568a4f36ee34b2363bdf.
Both archives were downloaded and hash-verified; selected evidence remains locally
under /tmp/p15-native-df56 and /tmp/p15-native-df56-motion.

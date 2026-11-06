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

Verification is pending for this source. Core regressions cover sparse dates,
latest-versus-average precedence, single/empty series, mixed units and invalid
values. Synthetic preview data provides sparse Weight/Body fat histories and
single-point Lean mass. Existing native launches will verify chart selection,
detail navigation and bilingual captures alongside the widget/surface changes.
No new simulator has been started for this candidate yet.

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

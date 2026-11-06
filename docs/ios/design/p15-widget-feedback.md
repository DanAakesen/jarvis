# Build 76 Home Screen widget feedback

6 November 2026 — implementation candidate; native capture review pending.

The owner reported three medium-widget defects: Workouts placed its heading in
the right column beside the ring, Factory clipped its heading above oversized
count tiles and two task rows, and Notes showed a summary without a title/icon.
The Workouts values also needed more consistent space between columns and rows.
These causes were confirmed in the existing SwiftUI composition. The supplied
device screenshots are owner evidence; no new device rendering has been observed
for this candidate.

## Change

All three medium widgets use the existing `JarvisWidgetHeader` at the top left.
Workouts places its ring and equal-width two-column metric grid underneath, with
separate row and column spacing. Steps, goals, lift/run counts, distance, calories,
and trained-day dots retain their existing meaning and values.

Factory uses a compact medium-only count layout, with each count beside its
status label, and smaller two-line task text. Both task rows, detail text and
32-point action geometry remain. Larger-family count/row typography is retained.
Notes adds its existing localized title and checklist symbol above the ordinary
summary; stale time moves into the shared header so it does not add a bottom row.
Snapshot/timeline reads, stale handling, App Intents and deep links are unchanged.

The shared header keeps its title ahead of optional freshness text and aligns to
the full content width. No additional title strings or widget kinds are added.
The existing configurations explicitly call `contentMarginsDisabled()` and apply
16-point padding for medium widgets; this patch preserves that inset, rather than
claiming that automatic WidgetKit margins were already enabled.

## Verification

The existing component-gallery UI test now opens a DEBUG, simulator-only layout
gallery during its existing app launch. It compiles the same five widget
view/sample source files into the app target; it does not copy their layouts or
include the widget extension entrypoint/provider. Three actual SwiftUI medium
views render at a constrained 329×155-point size with the production 16-point
inset. The fixture uses the existing synthetic samples and disables actions for
both touch and accessibility. It cannot enqueue a Factory operation.

Native assertions require all titles at the top-left inset, equal Workouts
columns and matching metric baselines, vertical room between metric rows, all
Factory counts and both task rows/actions inside the content bounds, compact
count-cell height, and visible Notes summary/next item. The same launch captures:

- `P15-widgets-medium-dark-en`
- `P15-widgets-medium-light-da`

This adds two attachments and one sheet visit to the existing 68-test suite,
without another test case, app launch, simulator or CI job. The containing test's
existing 120/150-second bounds remain. Its added runtime is unmeasured locally.
The previously agreed 75-minute overall job headroom remains unchanged here.

Local checks passed: project YAML and all five source memberships, shared
glass/button source boundaries, and `git diff --check`. This Linux environment
has no Swift compiler or simulator, so these are not compilation/rendering
results. The combined native build/test run and actual attachment inspection
remain required before release.

The gallery verifies native content geometry, not SpringBoard hosting, automatic
system margins, widget interactivity or tinted/Liquid Glass compositing. Existing
WidgetKit `#Preview` timelines still cover Danish/English and fresh, stale,
loading, empty, error and offline entries. Host appearance and on-device widget
refresh remain separate checks; the gallery makes no claim that they passed.

## Apple references consulted

- [Widgets HIG](https://developer.apple.com/design/human-interface-guidelines/widgets):
  glanceable content, medium-family height, context-dependent appearance.
- [Previewing widgets and Live Activities in Xcode](https://developer.apple.com/documentation/widgetkit/previewing-widgets-and-live-activities-in-xcode):
  real WidgetKit timeline previews for state, family and appearance coverage.
- [Preparing widgets for additional contexts and appearances](https://developer.apple.com/documentation/widgetkit/preparing-widgets-for-additional-contexts-and-appearances):
  full-color, accented and vibrant rendering are distinct contexts.
- [contentMarginsDisabled](https://developer.apple.com/documentation/swiftui/widgetconfiguration/contentmarginsdisabled()):
  disabling default margins leaves padding to the widget; existing padding is preserved.
- [widgetAccentable](https://developer.apple.com/documentation/swiftui/view/widgetaccentable(_:))
  and [Liquid Glass widget rendering](https://developer.apple.com/documentation/widgetkit/optimizing-your-widget-for-accented-rendering-mode-and-liquid-glass):
  preserve primary/accent grouping and the system's widget surface treatment.

The root integration workstream owns the related global design, product, plan,
architecture, agent-context and decision updates, plus CI and release evidence.

The first compile of the combined gallery found that widgetFamily is a read-only
environment value. The gallery explicitly instantiates the medium view types and
none reads widgetFamily, so the unnecessary override is removed. Its intentional
WidgetKit host background now has a named ambient-test exception that asserts the
entire file is one DEBUG-and-simulator conditional with no alternate branch.
This does not relax production page backgrounds. Native rendering is still pending.

## First native review

Run 42243718420 compiled the actual widget views. Its gallery test stopped on a
1.17-point optical text offset within the shared symbol/title header, before its
explicit screenshot. The retained gallery recording (source SHA256
2afd6932dc64a7b8e9fb89336ea0d3627d9c58abd2143b05da1feb37ae80a7f6) was inspected at 27 seconds:
all three English/dark titles, Workouts ring/equal 2×2 grid/week dots, Factory
compact counts/both task rows/actions and Notes summary/next item fit. No widget
production-layout correction was indicated by that image.

The test now permits the observed optical title offset within 2 points of the top
inset, while retaining complete 16-point content-inset checks at 0.5-point precision,
left alignment, card dimensions and all metric/count/action bounds. Captures occur
before assertions so failures retain the visible layout. Danish/light was not
reached and remains required in the corrected native run. This is content-gallery
inspection, not SpringBoard/tint/device acceptance.

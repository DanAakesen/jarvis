# Build 76 surface feedback — 6 November 2026

This candidate addresses the owner's device feedback about broad loading shine,
generic task-source labels, opaque header bands and the Notes/Health bottom docks.
Native verification of this candidate is pending. It does not change the Chat
screen, composer, voice session, backend or managed-runtime implementation.

## Findings and changes

- `JarvisPageLoadingView` applied shimmer to the complete stack, whose mask
  included the material row-group background. The animation now belongs only to
  each small text placeholder. Hero and group surfaces stay still; the highlight
  is narrower, quieter and slower. Reduce Motion, inactive scenes and disappearing
  views still suppress it; scroll visibility also stops individual offscreen bars.
- `VaultTask.heading` comes from the nearest Markdown heading in
  `apps/backend/src/proactive/todo-file.ts`, forwarded by the vault task DTO.
  The iOS row previously displayed that heading or the note basename verbatim.
  Exact generic labels such as Tasks, Actions, Action items, Opgaver and
  Handlingspunkter now fall back to a meaningful note name or project folder
  inside a known Work/Personal scope. Scope names, structural collection names
  and literal dot folders are omitted. Named phrases such as “Actions for Acme”
  remain intact. No stored task, source path, completion identity or API changes.
- The previous task detail did not display source provenance. A localized Source
  section now shows the exact stored path and heading, including generic names
  omitted from the compact row. Existing completion remains available in the
  scrolling form.
- Notes added a Tasks-only, full-width `regularMaterial` rectangle to its bottom
  inset. That backing is removed. The existing safe-area reservation, Search/Plus
  glass and touch targets remain. Automatic bottom scroll-edge effects are hidden.
- The shared non-Chat header previously added material when scrolled and at
  accessibility sizes. It now occupies structural space above clipped scrolling
  content, without a full-width material band. Its title, scaling and controls are
  unchanged. Settings adopts the same composition; top scroll-edge effects are
  hidden so rows cannot need a scrim beneath the title.
- Health has no custom full-width bottom background. Its automatic bottom edge
  effect is hidden. The owner's subsequent screenshot also identified the bounded
  selector's opaque rail. The combined candidate replaces that rail with one
  content-bearing clear glass surface across joined selectors; see
  [Body trend and selector feedback](p15-body-trend-feedback.md).

The retained pre-change native task-group capture was visually inspected:
`/tmp/p15-native-7e5/ui-test-attachments/6D551BA9-577A-4504-A0C4-969E50692A14.png`.
It shows the prior full-width dock backing. It is baseline evidence, not a render
of this candidate. Fresh dark/light, scroll and large-text review is required.

## Qualification

The existing 68 UI-test cases and app launches are retained. Added evidence reuses
their fixtures:

- Existing Usage/Status/Proactive loading visits capture two frames for dark
  motion, light motion and reduced-motion stillness. The reduced-motion case uses
  a DEBUG Simulator-only fixture flag, gated by `--ui-test-navigation`, to exercise the same
  motion suppression branch. The actual system preference is still read normally;
  the fixture does not change simulator accessibility settings.
- Existing shared-page tests add scrolled-header captures for Usage, Status and
  Proactive in EN/DA, dark/light and accessibility text. The accessibility visit
  also navigates to Health, checking header and dock reachability without another
  app launch. Existing Health normal EN-dark/DA-light captures cover its dock.
- Existing Settings visits capture scrolled headers in normal and large text.
- Existing task-board captures retain normal dark/light and accessibility bottom
  clearance checks, assert that generic Tasks metadata is absent, and verify the
  exact path/heading in details. Source-label unit tests cover EN/DA generic names,
  named projects and prevention of vault-root/dot-folder fallback.

This adds approximately 21 screenshots and one Health destination navigation,
with no added UI-test cases or app launches. Estimated extra time is 1–2 minutes;
that estimate has not been measured. The accepted 68-test run 42202162500 took
62m49s against the former 65-minute job cap. The macOS job cap is now 75 minutes
to retain result/export headroom. Per-test limits remain 120/150 seconds, with
all tests and assertions retained.

Local checks passed: diff whitespace checks, unchanged UI-test method count,
unique EN/DA localization keys and Source translations, and the existing macOS
cost-guard test using the installed Node YAML parser because Ruby is unavailable.
There is no local Swift toolchain or simulator. JarvisCore tests, native
compilation, motion/contrast inspection and final rendered acceptance must run
through the single coordinated CI qualification; no simulator run was started
while preparing this candidate.

## Apple references consulted

The official Markdown forms of these pages were read before implementation:

- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion):
  restrained purposeful feedback and optional motion.
- [TimelineView](https://developer.apple.com/documentation/swiftui/timelineview)
  and [Reduce Motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion):
  scheduled rendering and the system's read-only accessibility preference.
- [mask](https://developer.apple.com/documentation/swiftui/view/mask(alignment:_:))
  and [clipped](https://developer.apple.com/documentation/swiftui/view/clipped(antialiased:)):
  confining effects to alpha/bounds instead of adding a covering material.
- [Vertical safeAreaInset](https://developer.apple.com/documentation/swiftui/view/safeareainset(edge:alignment:spacing:content:)-4s51l):
  preserving the existing bottom control clearance.
- [scrollEdgeEffectHidden](https://developer.apple.com/documentation/swiftui/view/scrolledgeeffecthidden(_:for:))
  and [onScrollVisibilityChange](https://developer.apple.com/documentation/swiftui/view/onscrollvisibilitychange(threshold:_:)):
  explicitly suppressing automatic scrims and stopping offscreen motion.

The intentional design choice is transparent shared header space and individually
glassed controls, rather than the default edge treatment. Readability comes from
reserved/clipped content geometry. Existing glass Reduce Transparency fallbacks
remain intact.

The initial a5599089 candidate passed general CI42236611082 and
CodeQL42236610687. Its app compiled in native run42236610739, but that run
was cancelled when the owner added widget and Body trend corrections. No full
native pass or visual acceptance is claimed for that superseded source. The
combined candidate requires one fresh native run after all edits.

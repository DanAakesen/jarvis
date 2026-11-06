# Home hierarchy and transparency follow-up

Status: implemented locally; native qualification pending.

Scope: Home / Quick actions / Upcoming headings; equal hero title insets and
trailing period controls; orange calendar/task icons and native task completion
swipes; transparent system headers and Notes/Factory footer containers. Keep
accepted loading motion, Chat appearance, completion error handling and refresh.

The implementation uses shared JarvisHeroHeader, JarvisPeriodSelector,
jarvisAmbientBackground and JarvisList. The default navigation-bar material and
ambient-background modifier order are the suspected remaining sources of opaque
bands; rendered evidence is required to confirm the correction.

Apple references actually consulted:
- [Default scroll alignment](https://developer.apple.com/documentation/swiftui/view/defaultscrollanchor(_:for:))
- [Scroll edge effect visibility](https://developer.apple.com/documentation/swiftui/view/scrolledgeeffecthidden(_:for:))
- [Native swipe actions](https://developer.apple.com/documentation/swiftui/view/swipeactions(edge:allowsfullswipe:content:))

Verification plan: retain the existing native suite; inspect Home in EN/DA,
light/dark and AX XXXL, partial/full task swipes, hero alignment on Health, and
resting/scrolled headers and Notes/Factory docks. Do not rerun accepted loading
motion separately. Preserve failed receipts and distinguish rendered acceptance
from real device/HealthKit/haptic checks.

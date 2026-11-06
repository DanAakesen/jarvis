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

## Widget tap follow-up

The owner accepts widget layouts. Gym/Factory lacked widgetURL and Info.plist did
not register jarvis-widget. Apply one URL in the shared configuration, remove the
Notes/Home per-view URLs, and register the scheme. Existing navigation and lock
handling remain unchanged. Add native system URL-open checks for cold and warm
launch. This validates routing independently of physical Home Screen host taps.

Apple references consulted: [widgetURL](https://developer.apple.com/documentation/swiftui/view/widgeturl(_:))
(one modifier per hierarchy), [custom schemes](https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app)
and [XCTest URL launch](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/open(_:)).
The app-owned topic scheme is retained; it exposes only allowlisted destinations.

Earlier candidate f2ad1819 passed CI 42291240856 (502 Core tests) and CodeQL
42291240721. Native 42291240849 compiled but was cancelled early as superseded by
the widget routing request. No completed native pass is claimed for that run.

## Combined native result and review

223f966a: CI 42292433828 and CodeQL 42292433724 passed, including 502 Core tests.
Native 42292434058 passed 69/70 cases: all 30 shared-page/gallery cases, all 21
navigation cases (including cold/warm widget links), all six Chat cases and 12/13
Home cases. Native partial/full task swipes passed. The Home board assertion
expected a second 16 pt inset from a glass accessibility content-union frame
(370 vs 354); screenshots show the actual intended 32 pt page-plus-card inset.

Native EN/DA normal Home, shared headers, Notes/Factory docks, Health heroes,
scrolled Usage/Status/Proactive, task swipes and widget destinations were inspected.
Transparent backgrounds and normal hero alignment are correct. AX XXXL Home has
cramped log labels and activity summaries; stack those and wrap action copy before
release. This is a new Home-only correction requiring affected-path verification.

Retained UI evidence 13543438584 SHA256
24ace5d7b218248e3670619c930dec15893157b7d8f9534b19b33031f4c7542a;
stills 13543817999 SHA256
fff9aa5a1fde8802a34d07c6c2c85a18dc2498a08a2402f50e44b01479dfd393.
Both downloads match GitHub digests. A cold Factory capture includes the explicit
Simulator Live Activity failure notice; it does not indicate a navigation failure.

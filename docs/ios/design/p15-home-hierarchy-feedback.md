# Home hierarchy and transparency follow-up

Status: released as build 78. The verification notes below retain the earlier
failed and superseded candidates; the final outcome is recorded first.

## Final accepted release

Build **78 uploaded successfully at 22:48:32 UTC / 23:48:32 Copenhagen on 6 November 2026**
in unchanged TestFlight workflow [42306553415](https://github.com/DanAakesen/jarvis/actions/runs/42306553415),
from main `ca5ca838399be5debe2115c4b2ba6879f3f062a9` (PR #1625). Apple processing and
physical device visibility are not independently confirmed.

Home now has Home / Quick actions / Upcoming headings, aligned hero titles/periods,
distinct orange agenda icons and native task swipe completion. At accessibility
sizes its log actions and activity groups stack with readable labels. Shared
headers and Notes/Factory footer containers are transparent. Every widget family
has one registered topic link: Workouts/Steps → Health, Factory → Software Factory,
Notes → Notes and Home → Home. Accepted loading/widget visuals and Chat appearance
are preserved.

CI 42302597659 passed (502 Core tests) and CodeQL 42302597761 passed. Native coverage
is 55 unchanged cases from 42292434058 plus all 15 Home/widget cases passing in
42302707513 on exact candidate `c4e141551c35c2d6c4c6895112cf1b6ade54f8f7`.
The full run's one incorrect Home geometry assertion remains recorded; it measured
glass accessibility content bounds rather than visual insets. The final focused
run retains unchanged 120/150-second per-test limits and verifies source identity
outside the corrected Home views/Home-only tile. Actual bilingual light/dark,
AX XXXL, native swipe, shared header/dock and widget destination captures were reviewed.

Merged full tree `9ecf8636632db51d8a47768d8b8e51cf5eca65f2` and iOS tree
`169764ccd98da54bbe309ef0766cba9da65df004` exactly match qualification. Automatic main
Simulator 42306089300 was cancelled before boot after proving identity. Normal
Deploy 42306089293 was accepted with readiness and all 15 Current checks passing
before the single TestFlight dispatch. No further Simulator run is needed for this
unchanged app/test tree. Physical widget-host taps, Face ID and haptic feel remain
device checks; native cold/warm URL delivery passed.

Focused evidence artifact 13545477771 has SHA256
30061116eb125530f9a3033a86838bf1071f793614ee377ad664cfc42884b67a.
Its provenance binds the exact candidate/full/iOS trees and proves the unaffected
source used for the 55 retained cases. All 15 selected tests passed, with zero
failures or skips. The final EN/DA normal and AX captures show readable log labels,
stacked activity values and the intended title/period insets. Both partial and full
native completion swipes pass; widget cold and warm routes pass.

CI evidence 13544089609 has SHA256
d999e2fb25e86684026774514ac49e796bd9ea72688a4467d66b6098477d6201.
Accepted deployment evidence 13545319369 has SHA256
89df9b0b300037a8c02701ac9e20fdab998d0afe3205824aaf77c84ca437a74d.
Both downloads were verified. Backend/web/agent/infra reuse their already accepted
versions from 1fb0f908; the deployed Current conversation passes all 15 checks.
Automatic PR Simulator 42302597789 and main Simulator 42306089300 were stopped
before boot. The focused validation branch must never merge.

## Implementation and verification history

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

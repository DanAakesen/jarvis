# P15-93 Notes verification

Reference: `board.html` merged in PR #1603; issue #1599. This branch builds on
the shared controls in #1598 and must merge after that change.

Implemented behavior:
- Notes, Tasks and Graph tabs; the separate List tab and localized label are removed.
- Root folders include Work and implicit ancestors from the complete inventory.
  Each directory shows direct notes, matching count, breadcrumb and one-level Back.
- New note uses the open folder. Its picker stages a child there and explains
  that saving the note persists the folder. New folder has its own sheet and
  shared drill-down picker; the owner-only backend persists an empty marker that
  appears in the folder inventory without adding a note.
- Recent shows successfully opened notes with folder and opening time, ordered
  by that time. Refresh preserves history; sign-out clears it.
- Graph uses shared folder colors, selection/search-only labels and Open actions.
- New task uses shared scope/priority segments; the backend validates and persists
  optional priority using its existing Markdown representation.

Observed local checks on 5 November:
- All 476 JarvisCore tests pass on Swift 6.2, including root-note parsing,
  direct-folder counts, Back, nested path validation and account-bound Recent.
- The 31 task-write tests and 58 vault backend tests pass; backend TypeScript build passes.
- The synthetic preview transport typechecks against JarvisCore. A real client
  flow through that transport passes root browsing, graph loading, nested note
  create/read/save and high-priority task create/read.
- Changed Swift sources pass parser checks. These do not compile SwiftUI.

The existing Mac-selected ComponentGalleryUITests now cover root/count/Back/Recent,
nested folder+note creation, empty-folder creation, graph selection and persisted task priority, with
named P15-93 screenshots. The navigation suite also checks the three-tab contract
and bilingual Recent after opening. Native compilation, UI results, accessibility
inspection and board/build screenshot comparisons are pending. No visual acceptance
is claimed from local checks.

Apple guidance used: [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables),
[Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls),
and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout).
Folder chevrons navigate a hierarchy; Back retains the parent location. Shared
controls provide touch targets and semantic labels.

## Native retry findings, 5 November 2026

Run 42100772453 attempt 2 compiled and ran 50 UI tests: 48 passed, 2 failed.
New note lost the selected parent folder when presenting a Boolean-driven sheet;
the test observed `Research` instead of `Work / Projects / Research`. Presentation
now carries a folder snapshot with SwiftUI's item-driven sheet, and each creation
sheet initializes its draft once so returning from the nested folder picker does
not reset the choice. The existing test checks both the initial and confirmed paths.

The graph failure's native AX dump (`0CCB4F77-2D20-4BA1-B46A-012C56AE77A3.txt`,
screenshot artifact 13458686297) shows the Open button inherited the selection
container's identifier. Explicit child containment preserves the button's own
identity and action. The native assertion is retained. Fresh native validation is
pending; no test-success or visual-acceptance claim is made for these corrections.
Apple's `View.sheet(item:onDismiss:content:)` and `State.init(wrappedValue:)`
documentation was read for sheet source-of-truth and per-instance state lifetime.


5 November continuation: tab identity is part of the search task key, so a Graph query refreshes task results when switching to Tasks. The existing graph/priority native test now exercises that transition. Recent tiles and folder navigation use shared JarvisTileButton/JarvisRowButton controls; page files no longer own their button surface. Native verification of this follow-up is pending.

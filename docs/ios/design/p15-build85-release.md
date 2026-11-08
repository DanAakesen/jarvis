# Build 85 — Notes correction

8 November 2026. PR #1653 merged as df813f348eae27961259c691b526eeadced9ea18 with
complete tree identity to qualified head 2f0fd280d6f999dd01459e97e0f43e9e12882c3e.
Final CI 42511384320 passed. TestFlight run 42511641193 successfully archived, signed and uploaded build 85
from this merge. The owner subsequently confirmed the Notes page is fixed on
8 November. The separate Home Today workout-total bug is tracked in PLAN.md.

## Changes

Build 84 freezes when the owner opens the Notes right sidebar and omits the shared
phrase/Overview. Restore the phrase and overview above Notes/Tasks/Graph. Compute
recency in a cancellable background projection with reusable timestamp parsers;
render individual recent-note rows lazily, keeping the entire inventory available.
The approved carousel, folder sheet and editor remain. Header/footer transparency
was separately accepted by the owner across pages in build 84 and is preserved.

## Qualification

The Notes correction passed full CI 42509929023, including all 530 Core tests,
and native run 42510119801 passed all four selected cases with zero failures/skips.
Qualified source ca107a8b897bdf2eab181ab504cb43bcf1344525 has iOS tree
545ad8d8c08ed50e9507d71cceadab434537fe1e. Actual restored-order, scrolled-sidebar
and light/dark editor captures were reviewed. Artifact 13629821155 has SHA256
9c0a357026019bc40ced7671358d47ed64fe7b120d23b31a969176eb9fff8755.
The 1,003-note library now passes repeated sidebar open/close, scrolling and
return-to-Chat checks. Both themes pass pin/Raw/edit/save/reopen. Existing 120/150
second test limits and every assertion are retained. Physical-device acceptance
of the freeze correction was subsequently confirmed by the owner; TestFlight 85 is uploaded.

The first native candidate 42507483140 passed order but failed large-library
responsiveness and both editor-entry tests. Retained spindump showed expensive
accessibility snapshots; the editor hierarchy showed its target below the dock.
The product now bounds the visible row tree, and the test scrolls the complete
row above the dock before a physical tap. Pin, Raw, saved-content and navigation
assertions remain. The exact physical-device freeze cause is not proven solely
by synthetic data; owner retesting is still required.

## Owner retest after upload

1. Open Notes: confirm the shared phrase and Overview appear above Notes/Tasks/Graph.
2. Open/close the right sidebar, scroll down Notes and repeat; switch to Chat and back.
3. Edit a disposable note, switch Raw on/off, save with Done and reopen; check the
   title-only pinned carousel and folder browsing still work.

The [standing owner checklist](p15-owner-test-checklist.md) retains other pending
checks. Copilot refresh 42510264543 separately passed its new live two-turn canary
and acceptance and is ready for owner retesting. Factory capacity still needs
subscription quota access. Apple Watch remains in secondary draft PR #1652.

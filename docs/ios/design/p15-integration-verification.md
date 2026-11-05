# P15 board integration check

Integration checkpoint only; no GitHub PR has been merged or deployed.

Update at 21:52 UTC on 5 November 2026: Factory `331702d4` and Health `9c8df9a6`
are combined locally, preserving all page tests. Native screenshot/accessibility
review established the corrections documented in the page verification files.
Home/Health comparisons were shown in chat; owner acceptance remains outstanding.
The existing workflow will verify the combined SwiftUI app through a separate
validation-only PR. No workflow or project settings were changed. Notes retry
job `127550185888` and Insights job `127547007531` are active; do not duplicate.
The live workspace still blocks the third Insights archive host. The full local
pipeline attempt is incomplete because Ruby is absent (59 pass, 15 setup errors).
The completed local results below belong to the earlier checkpoint.

Branches combined on the shared #1604 head `da61e4de`:

| Issue | PR | Branch head |
| --- | --- | --- |
| #1599 Notes | #1605 | c6ac6d83 |
| #1600 Home/Factory | #1606 | 8c92b956 |
| #1601 Health | #1607 | 0ef73de0 |
| #1602 Insights | #1608 | 7eb90fa0 |

All 488 combined Core tests, 132 focused backend tests and 74 pipeline checks
pass locally. The combined backend TypeScript build passes. Append conflicts
in the project documents preserve all four follow-ups; the selected component
suite retains the Factory, Health, Notes, Usage and notification test additions.
Swift parsing verifies the resolved test file. These checks do not compile the
combined SwiftUI application or establish its appearance.

Each of Notes, Home/Factory, Health and Insights has passed native compilation
on its own branch. Full CI is green on all five PR heads as of 21:03 UTC on
5 November 2026. The four follow-up native test/capture runs remain active.
Insights compiled in run 42106346100; its subsequent commit only updates the
Python source guard to expect the shared heading, and that commit's automatic
simulator run is pending behind the first run.
The shared #1604 head passed all 46 UI tests and CI/CodeQL. Screenshot capture,
board pairing and both uploads succeeded before cancellation during final cleanup
at the 45-minute job limit. The approved `if: always()` keeps the upload eligible
after failures; this run does not demonstrate an upload after a capture failure.
Artifact downloads remain blocked by the original workspace's cloud allowlist.

Remaining gates: final native test results, actual board/build screenshot
inspection, combined native verification after integration, and owner acceptance.
The new Notes backend must be deployed before the updated client is released.

Update at 21:33 UTC: Home/Factory and Health each pass 46/48 native tests, with
two task-row lookup failures in Factory and two Last lifts Log-button lookup
failures in Health. Both archives uploaded. Insights passes 48/48 native tests
and preserves both archives after later capture cancellation. Notes is cancelled
without a published log/artifact at the last check; no retry has been submitted.
Current run IDs, exact failures, screenshot filenames and handoff ownership are
in `p15-resume.md`. All changes remain unmerged and visually unverified.

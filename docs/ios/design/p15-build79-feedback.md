# Build 79 owner feedback — 7 November 2026

The owner reports these regressions on the released build. Capture each new report
without replacing existing work. Earlier qualification is not owner acceptance of
these failing states. Keep one combined native run for the final changed source;
retain any failures and rerun only changed or unqualified cases.

| Report | State | Required verification |
| --- | --- | --- |
| Headers remain nontransparent on pages other than Home/Chat | Implemented and native-verified; Uploaded in build 80; owner device check pending | Inspect resting and genuinely scrolled Notes, Health, Factory, Settings and shared Insights headers, including after navigating from Chat. |
| Notes and Factory footer containers remain nontransparent | Implemented and native-verified; Uploaded in build 80; owner device check pending | Inspect long content under floating search/Plus and Factory tabs in both themes; exercise the controls after scrolling. |
| Two thinking rows appear for one Chat turn | Single row verified in the scoped native turn; Uploaded in build 80; owner device check pending | Exactly one active progress indicator before acknowledgment, during tools, after steering/interruption, and while streaming/reconnecting; it disappears only when the turn ends. |
| Sent text remains in the composer (“Yes please” screenshot) | Button/Return native checks passed; system dictation needs device acceptance | Test send button and keyboard Return with a focused field; verify clearing, stale input callback rejection and preservation of a newly typed draft. Keep custom/system dictation in scope. |
| Task titles truncate to one line; source labels such as Inbox remain | Two-line titles and no source metadata visually verified; Uploaded in build 80; owner device check pending | Inspect long titles/date-time combinations in both themes; retain scope and priority, with full provenance only in details. |
| Scaffold cannot proceed after “Yes please”: create_issue returns Not allowed, earlier proposal cannot be recovered | Recovery deployed in #1632; owner retest pending | Trace actual project selection and approval/proposal persistence across turns; test prepare → inspect → later approve → one issue/task. Do not weaken own-code approval or require repeated rewording. |

## Current qualification

PR #1631 merged as 294a7929 with exact-tree identity, CI/CodeQL and independent
review complete. All seven scoped native cases are qualified by six unchanged
passes in 42390300501 and the corrected Chat pass in 42392408582. All 22 page
captures and final Chat captures were reviewed. Build 80 uploaded at 17:06:13 UTC in TestFlight 42394179996;
[the build 80 record](p15-build80-release.md) contains the evidence and limits.
Backend PR #1632 is deployed and the owner has been told to retry the prepare
prompt; the actual owner scaffold write is not yet confirmed.

## Separate unresolved work

Copilot remains disabled because trusted dynamic-policy compatibility has not
passed and there is no valid receipt. Keep the receipt gate intact and do not
repeat an unchanged live activation probe. The earlier owner scaffold failure
led to the separately deployed recovery in #1632; only owner confirmation of the
actual prepare/approve/write flow remains pending after that correction.

## Evidence gaps found during this follow-up

The earlier Factory capture labelled “scrolled” still showed its full top phrase:
the short fixture did not require scrolling. A stationary title assertion alone
cannot prove a transparent scrolled header. New coverage must first prove content
actually moved, then inspect the chrome. The previous sent-draft check covered a
button send with synthetic text. The focused native Return check subsequently
passed in 42392408582. Physical-device behavior and system dictation still need
owner acceptance.

At the start of this investigation, no new fix or release was claimed. The baseline was main
9b112afc (product release source 2504bc6a, TestFlight 79). Working branch:
codex/ios-transparent-chrome in /tmp/p15-widget-contrast.

## Initial candidate implementation history

- Page chrome reserves header/footer space in ordinary layout; its ancestor hides
  native bar backgrounds and scroll-edge effects. The ambient scene remains
  visible around individually glassed controls. Factory also reserves activity
  notices without a native safe-area bar.
- One pinned Chat progress row replaces the duplicate transcript placeholder.
  Real acknowledgments and reply text remain in the transcript.
- Composer submissions rotate the editor revision before clearing. Late native
  input edits from the submitted revision cannot restore sent text or overwrite
  the next draft. Home uses the same composer ownership.
- `get_pending_issue` returns the original process-local proposal, code, scope and
  expiry for the verified conversation. Private tool results disappearing from
  later turn context no longer forces a guessed create retry. A mistaken create
  after plain approval returns the saved scope; confirmation remains separate.
  Fresh explicitly named own-code requests can replace stale project clarification,
  but still need later approval. Unavailable/expired stages report none and require
  work-status checking before a new proposal. No persistence migration is included;
  proposals remain process-local and expire after ten minutes, as before.

The native suite now holds the first acknowledgment until the test inspects the
pre-acknowledgment state, exercises keyboard Send for steering, and checks actual
content movement before capturing scrolled chrome. Factory uses 16 synthetic tasks.

## Local candidate checks

Factory/project tests: 71 passed. Capability instruction tests: 18 passed after
compressing existing wording within the unchanged 15,000-code-point budget.
Backend TypeScript build and ESLint completed successfully. These are synthetic
handler-level checks, not a claim that the owner's live scaffold now succeeds.
Native compile, focused UI captures and release qualification remain pending.

The owner added task-row feedback while qualification was building. The title now
wraps to two lines (unlimited at accessibility sizes), and the due column is bounded
so it cannot consume most of the row. All source metadata is removed from the list,
not just generic names. The obsolete source-filter helper/tests were removed;
actual source provenance is still available in task details. Focused run 42385082799
was cancelled during compilation, before Simulator boot, to include these changes
in the same native verification pass. Automatic duplicate 42385111644 was also
cancelled during compilation before boot. No new Simulator test ran in either.

## Review corrections and new Notes exploration

Independent reviews found the runtime-test composer still used the removed String
initializer; hosted compile 42385394473 confirmed that exact failure before any
Simulator boot. The third composer now shares revision ownership. The Python
source guard was updated to assert the same footer placement using the shared
reserved-footer modifier instead of the former safe-area inset.

Review also identified missing-state recovery friction: when no proposal exists,
a bare yes may stage a clearly marked NEW own-repository replacement using the
fresh active registry. It is bound to that current message and requires a different,
later approval; the same yes cannot execute it. External projects retain their
existing selection guard. Live pending proposals are still recovered unchanged.
Work-status checking before replacement is model guidance, not duplicate-proofing
of separate newly approved requests.

The owner also requested design images for Notes browsing, creation and editing,
including a visible Raw button for complete Markdown/metadata. This is design
exploration, not authorization to choose and ship a new Notes design without the
owner's feedback. It does not replace the six implementation reports above.

Notes design feedback: the owner liked the first set's Quiet Library and Clear
Folders styling, wants pinning, a recent view, and folders as an optional browsing
mode. A second set explores Recents with Pins, Library Tabs and Browse Drawer in
that displayed order. Raw must expose the complete note source, including metadata;
the normal reader/editor should render the content. This earlier set was
superseded by the selected Recent Focus refinement recorded in DESIGN.md.
Preserve all underlying vault content and existing task behavior.

Both independent source reviews approved corrected candidate 91c23fc8 with no
remaining source blocker. Native run 42386993715 compiled that candidate and
is executing the selected UI cases, including the runtime-test composer. The
automatic duplicate 42386943370 was cancelled before Simulator boot. CodeQL
42386943361 passed all four analyses. Full CI 42386943336 passed, including
7,397 backend tests (one skipped) and 509 Core tests. Native screenshots are
still required; no new upload is claimed.

Native 42386993715 completed 3/6 cases: runtime isolation and primary-page dark/light
passed. The focused keyboard checks exposed two real input defects: the revision
view replacement dismissed the keyboard, and multiline SwiftUI Return inserted a
newline instead of submitting. Both Factory cases failed before reaching Factory
because the test used `navigation.factory` instead of `navigation.softwareFactory`.
Artifact 13580676157 has SHA256
c0064905b2eea2e7eead393388faa8c7b33e7f570ad96134a0d2939d0249e541.

A stable shared UITextView now reconciles draft revisions without replacing the
first responder and intercepts Return outside composition. Multiline paste, selection,
Dynamic Type, the five-line cap and input identifiers remain. UIKit owns focus via
an ordinary binding. Physical system-keyboard dictation still needs device acceptance.
The next native pass also covers Home handoff. Some app-element captures omitted
chrome despite geometry assertions, so capture the full XCUIScreen and assert header
window containment before accepting visual transparency. Retain these failures.

Scaffold recovery is separated into backend-only PR #1632 so its normal deployment
can proceed while these iOS findings are corrected. The three backend source/test
files are byte-identical to 91c23fc8; fresh exact-head checks still apply.

The owner clarified the Notes concepts must start with the existing Notes / Tasks /
Graph selector. Every option must include pins, a recent view, folder browsing and
Raw, with variations of that same flow. The third displayed set is Compact Library,
Recent Focus and Folder Shortcuts; earlier sets are superseded. The owner then
selected Recent Focus and requested a title-led pinned carousel with its pin icon
in the section heading, plus New folder at the sheet's bottom right. The revised
image was shown; implementation is separate from this bug-fix release.

Native 42390300501 at source 82fe69ca completed 6/7 cases. Runtime isolation, Home
handoff and all four light/dark page cases passed. The only failure was the empty
editor accessibility predicate after keyboard Send. The retained recording at the
failure shows the empty placeholder, focused keyboard, one follow-up bubble and
one progress row; the exact next-draft assertion subsequently passed. The test now
accepts UIKit's nil empty value only for an existing, hittable editor, re-resolves
that editor per poll, records its actual value and captures the Return boundary.
Application sources are unchanged; rerun only this unqualified Chat case. Retain
and visually inspect the six passing cases. Artifact 13581109075 SHA256:
db62f810da9a91aa88bf50490ab6b811cf068408d124a2f2278aba3112557513.

Backend PR #1632 deployed successfully in 42389927724, with readiness and required
live acceptance passing at 16:18:52 UTC. The owner was told they can retry the
prepare prompt without an iOS update. The actual owner scaffold write remains an
owner confirmation; no Copilot activation is claimed.

## New owner reports after build 80 upload

Home prepare showed thinking and then the offline banner; the installed build was
not established. Track the active correction in `p15-home-stream-recovery.md`.
Direct Chat later created issue #1634 / Factory task 23 after yes. Worker execution
and scaffold completion remain unconfirmed. Owner also requests a review and
reduction of repeated approval gates; this is separate from stream recovery.

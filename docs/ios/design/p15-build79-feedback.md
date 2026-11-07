# Build 79 owner feedback — 7 November 2026

The owner reports these regressions on the released build. Capture each new report
without replacing existing work. Earlier qualification is not owner acceptance of
these failing states. Keep one combined native run for the final changed source;
retain any failures and rerun only changed or unqualified cases.

| Report | State | Required verification |
| --- | --- | --- |
| Headers remain nontransparent on pages other than Home/Chat | Investigating | Inspect resting and genuinely scrolled Notes, Health, Factory, Settings and shared Insights headers, including after navigating from Chat. |
| Notes and Factory footer containers remain nontransparent | Investigating | Inspect long content under floating search/Plus and Factory tabs in both themes; exercise the controls after scrolling. |
| Two thinking rows appear for one Chat turn | Shared single progress row implemented; native verification pending | Exactly one active progress indicator before acknowledgment, during tools, after steering/interruption, and while streaming/reconnecting; it disappears only when the turn ends. |
| Sent text remains in the composer (“Yes please” screenshot) | Investigating; prior fix insufficient | Test send button and keyboard Return with a focused field; verify clearing, stale input callback rejection and preservation of a newly typed draft. Keep custom/system dictation in scope. |
| Scaffold cannot proceed after “Yes please”: create_issue returns Not allowed, earlier proposal cannot be recovered | Owner confirmed still broken after backend release | Trace actual project selection and approval/proposal persistence across turns; test prepare → inspect → later approve → one issue/task. Do not weaken own-code approval or require repeated rewording. |

## Separate unresolved work

Copilot remains disabled because the same provider conversation reused the first
turn's policy on turn two. The receipt gate must remain intact; do not repeat an
unchanged live activation probe. The owner retested scaffold preparation
and reported failure after approval. The issue-list correction did not complete
the end-to-end fix; project-selection/refusal and proposal recovery remain open.

## Evidence gaps found during this follow-up

The earlier Factory capture labelled “scrolled” still showed its full top phrase:
the short fixture did not require scrolling. A stationary title assertion alone
cannot prove a transparent scrolled header. New coverage must first prove content
actually moved, then inspect the chrome. The previous sent-draft check covered a
button send with synthetic text; the physical focused-keyboard path remains open until the new native Return test passes.

No new fix or release is claimed by this record. Current source baseline is main
9b112afc (product release source 2504bc6a, TestFlight 79). Working branch:
codex/ios-transparent-chrome in /tmp/p15-widget-contrast.

## Candidate implementation (not released)

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

Factory/project tests: 69 passed. Capability instruction tests: 18 passed after
compressing existing wording within the unchanged 15,000-code-point budget.
Backend TypeScript build and ESLint completed successfully. These are synthetic
handler-level checks, not a claim that the owner's live scaffold now succeeds.
Native compile, focused UI captures and release qualification remain pending.

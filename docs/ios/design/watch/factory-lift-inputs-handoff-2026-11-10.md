# Watch Factory and lift inputs — primary handoff

Primary owner: Jarvis2 primary, session `01a1adc7-aebe-76f2-b63d-a852c887204f`.
PR: https://github.com/DanAakesen/jarvis/pull/1698
Branch: `feature/watch-factory-lift-inputs`.
Base: `cb360ca7ee691bd07a4b028c760a36c4bb5f336e`.
Runtime commit: `e4a5ab28c7c9a53cdf451f6cc6b8a141ca7f34a2`.

## Implemented

- After selecting a Factory project, a plus opens New task. Title/Request support native typing and explicit system mic input; Agent remains a native picker defaulted from that project. Only explicit Start task submits through the existing authenticated phone Factory client.
- Project ID and transport UUID are bound to the typed submission. Requests are bounded to 8 KB; unchanged/revisited drafts retain submission identity, including after an uncertain manual retry. No auto-resend or offline task queue.
- The phone verifies the selected project still exists and reuses existing backend submission idempotency. No project-policy, retry/recover, merge or release controls.
- Shared WatchTextInput/WatchTextEditor cover Exercise, Factory Title/Request and Message draft. Compact form rows open native typing editors, with separate mic actions, avoiding nested field backgrounds. Dictation appends to editable text and does not send. Weight opens a native numeric editor and other selectors remain native.
- Reps/Sets share a compact row opening native swipe/Digital Crown wheel pickers (reps 1–1,000; sets 1–100). Returning preserves exercise/weight and previous entries. Valid stored high-rep values are not clamped: the canonical lift validator is reused, and unsupported/corrupt records are explicitly blocked from Save. Add lift and New task are compact visible plus rows within their lists.
- Empty health history is accepted rather than misreported as an unavailable phone. Health-source failure has distinct copy. Lift/workout reads reload on reachability changes and discard obsolete results.

## Checks

- Actions `swift build` and `swift test`: **555 tests passed**, including eight new WatchInputFlowTests. [Core job](https://github.com/DanAakesen/jarvis/actions/runs/42775121045/job/129692073012).
- CI: [42775121045](https://github.com/DanAakesen/jarvis/actions/runs/42775121045); **passed**.
- CodeQL passed.
- Native: [42775120796](https://github.com/DanAakesen/jarvis/actions/runs/42775120796); **attempt 2 passed** unsigned Watch simulator, physical Watch Release architectures and paired iPhone simulator compilation (job 129703908892). Attempt 1 reached the 30-minute workflow limit during iPhone compilation; no compiler error was reported. The unchanged-source retry passed all three builds.
- Screenshot review: Lifts, New lift, the isolated Reps picker and New task were inspected on an Ultra-family simulator. The plus is visible in Lifts, free-text rows have explicit mic controls without nested field backgrounds, and reps/sets share a readable compact row. The selected-project capture shows startup in both attempts; it is excluded from saved UI evidence and must not be treated as proof that this page was inspected.
- Broader iPhone UI run [42775120772](https://github.com/DanAakesen/jarvis/actions/runs/42775120772) is separate; no full UI pass is claimed.
- DEBUG in-memory WatchPreview intercepts fixture requests before WatchConnectivity. Test captures/fixture submissions do not contact live Factory or create live work.

## Saved screenshots and provenance

- [Lifts](inputs-2026-11-10/lifts.png), [New lift](inputs-2026-11-10/new-lift.png), [Reps picker](inputs-2026-11-10/reps-picker.png), [New task](inputs-2026-11-10/new-task.png).
- These are unaltered actual fixture captures from runtime e4a5ab28, attempt 1, not generated designs or live owner data. [Capture artifact](https://github.com/DanAakesen/jarvis/actions/runs/42775120796/artifacts/13745530844), SHA256 `168f30818ecb43365082dfd99a0a979c49f77f745eb6af165ed9ad7451e9975a`.
- [Successful retry logs/captures](https://github.com/DanAakesen/jarvis/actions/runs/42775120796/artifacts/13745429889), SHA256 `32c36989676e794f051c57d73cdefb3c4670bc21940f679db40baf0c162db7b8`.
- Final handoff commit changes documentation and PNGs only; functional source remains the qualified runtime above.

## Integration and remaining checks

Primary is already integrating the previous steps/startup changes in **#1697**. This branch starts from main and does not duplicate that patch. Preserve both sets of edits in WatchContract, WatchChatView and WatchConnection when combining them; shared documentation additions may need reconciliation. The creation action and health failure are additive paired-wire cases: deliver the updated phone and Watch together. No new backend endpoint, credentials, entitlement, settings migration or infrastructure provisioning.

Secondary has not merged, deployed, released, changed live settings/data or started/recovered a live Factory task. The existing isolated test-capture step is extended only to cover these forms.

Owner/primary device checks remain: actual typing/Scribble/dictation availability and language, cancel/append/edit retention on every free-text field, reps/sets swipe/Crown and large text, selected-project plus visibility/tap and task form navigation, lift save/edit/delete, true empty versus disconnected/unavailable history, reconnect refresh, selected-project creation receipt and unchanged manual retry. Real phone wake/lock/transport behavior is unverified. Do not mistake the corrected empty-state error for proof that all connectivity conditions work.

Weekly workout complication concepts remain deferred; the approved steps design is owned by #1697.

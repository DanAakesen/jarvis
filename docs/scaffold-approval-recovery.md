# Scaffold approval recovery — 7 November 2026

The owner reported `create_issue — Not allowed` after preparing a widget in Jarvis
and replying “Yes please”. Source investigation found that later model turns could
not retrieve the original process-local issue proposal, while project clarification
could reject a fresh explicit own-code request. This is a source/handler diagnosis;
the owner's exact production exception was not retrieved.

`get_pending_issue` returns only the current verified conversation's saved scope,
code and expiry. A mistaken create retry after approval returns that original draft.
Fresh explicit Jarvis requests can replace stale clarification. If no issue proposal
exists, a new replacement is stageable only for the fresh active own repository and
requires another later approval. Session isolation, expiry, single consumption,
permissions and repository revalidation remain enforced. Pending state is still
process-local, with a ten-minute TTL; missing state is never invented as approved.
Checking existing work before replacement is model guidance, not a durable global
deduplication mechanism.

The backend files are byte-identical to independently reviewed 91c23fc8 in PR #1631.
Its focused tests passed 89 cases and full CI 42386943336 passed 7,397 backend tests
with one skipped; TypeScript, ESLint and four CodeQL analyses also passed. Synthetic
tests cover prepare → read → later approval → one issue and Factory handoff,
concurrent confirms, mistaken restaging, session isolation, expiry, missing-state
replacement and external-target refusal. These do not prove a live scaffold write.

PR #1632 merged as `ce652a06d801b1ab4c0f01af50dfab985dcc4350` after exact-head
CI 42389069811, CodeQL 42389069717 and independent review passed. Normal Deploy
[42389927724](https://github.com/DanAakesen/jarvis/actions/runs/42389927724) succeeded.
Readiness passed, and live acceptance completed at 16:18:52 UTC on 7 November:
14 checks were `ok`; the disconnected PC bridge was the existing nonblocking result.
The plain-approval check passed. No Copilot receipt was issued by this deployment.

The owner was told to retry “Prepare the widget in Jarvis”, inspect the proposal,
and approve it once. No TestFlight update is needed for this backend correction.
The actual owner scaffold write still requires owner confirmation; the synthetic
handler tests and service smoke checks do not establish that end-to-end result.

## Owner retest and subsequent policy change

On 7 November at 17:22 UTC, direct Chat followed by yes created issue #1634 and
Factory task 23. The public Factory comment is emitted on task creation; runner
execution and completed delivery are not established by it. The owner then asked
to reduce repeated approvals. `approval-friction-review.md` records the new direct
instruction path, which supersedes the blanket own-code later-reply policy while
preserving missing-state recovery and verified request scope.

Live follow-up: Factory posted `Needs attention: disk_low` on issue #1634 at
17:32:28 UTC. Handoff succeeded but the scaffold is now blocked by runner disk
headroom. Do not report it as running or complete. The recorded task reason does
not identify current free bytes or whether the stop occurred before checkout or
while building; investigate separately from approval policy.

## Verified follow-up

The owner’s later yes created issue #1634 / task 23. Branch `jarvis/task-23`
contains scaffold commit 3ace0ad86092026e99a52f5f791c9fdb376afcc1 at 17:30:31 UTC;
Factory stopped with disk_low at 17:32:28. This proves actual coding and retained
work, not completed validation or delivery. Approval correction #1636 is now
live after Deploy 42398836350; normal direct own-code requests no longer need the
blanket later-yes step. See approval-friction-review.md and the build 81 record.

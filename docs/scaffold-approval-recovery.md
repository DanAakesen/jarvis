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

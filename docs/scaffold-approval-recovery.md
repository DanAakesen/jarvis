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

Release this correction separately from the remaining iOS work. Current-main,
fresh exact-head CI/CodeQL and normal Deploy readiness/live acceptance remain
required. Only then tell the owner to retry “Prepare the widget in Jarvis”, inspect
the resulting scope, and approve it once. No release is claimed yet.

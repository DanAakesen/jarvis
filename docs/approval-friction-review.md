# Approval friction review — 7 November 2026

Dan reported that repeated confirmations prevent useful work. In the observed
flow, “Prepare the widget in Jarvis now” was followed by another approval request;
a later “Yes” created issue #1634 and Factory task 23. The GitHub Factory comment
at 17:22:31 UTC is a task-created event, not proof that a runner began coding.
No scaffold PR or completed delivery was visible at the initial verification.

## Policy review

| Operation | Current behavior and decision |
| --- | --- |
| Read/search/status and ordinary planning | No approval is needed; do the requested preparation. |
| Explicit own-repository build/fix/scaffold/start request | Previously always required a separate later reply. Candidate accepts the verified current owner instruction after checking the requested target and full draft scope. |
| Discuss an idea or show a plan first | Remains a proposal. Do not execute until the owner actually requests or approves the work. |
| Start an issue that already has an active task | Reuse the task and report its actual state; do not ask again or create a duplicate. |
| Later approval of a real pending proposal | Recover the original proposal. A clear directive carrying out exactly that proposal counts; special yes/ja wording is not required. |
| Missing/expired proposal plus bare yes | Does not identify new scope. Retain recovery/status checks; never manufacture an approval. |
| Private/public attachments, project archive, mail/calendar changes, merge/deploy/default-branch writes | Their operation-specific boundaries are unchanged in this first Factory correction. This is not a claim that every approval family was removed. |

## Implementation boundary

The server, not a model-supplied tool flag, selects direct Factory interpretation
for the current verified owner message. The semantic check receives repository,
operation, executor, title and complete scope, with an independent prompt and cache
key. It cannot apply to mail/calendar or interpret a bare yes as a new request.
Clear polite requests are instructions; plan-first, changed target/scope, quoted
instructions, negation and uncertainty are not. The existing bounded interpreter
fails closed; an unavailable decision leaves a reviewable proposal.

Shared instructions distinguish issue creation from verified running work and require fresh work status before progress or completion claims.

Both paths reuse the existing permission checks, fresh active project/repository
validation, single consumption and issue execution. No merge/deploy capability,
role grant, public file publication or new tool argument is added. Repeated direct
create calls from the same owner message share one result (including uncertain
writes) for the existing ten-minute process lifetime; changed scope is refused.
This is not durable global deduplication across restart/expiry. Check work status
before a genuinely new request or uncertain outcome.

## Verification

Targeted tests cover current-message direct execution, concurrent duplicate calls,
plan-only then later yes, permission refusal, uncertain-write replay prevention,
active-task reuse, full-scope interpretation, cache-mode isolation, missing-model
failure, and unchanged calendar/food provenance. 458 targeted backend tests passed; scoped ESLint and TypeScript checks passed.
CI/release and live direct-request acceptance are pending. Issue #1634 verifies the previous later-yes path only; do
not create another widget task to test this correction.

Live follow-up: Factory posted `Needs attention: disk_low` on issue #1634 at
17:32:28 UTC. Handoff succeeded but the scaffold is now blocked by runner disk
headroom. Do not report it as running or complete. The recorded task reason does
not identify current free bytes or whether the stop occurred before checkout or
while building; investigate separately from approval policy.

Read-only branch verification found `jarvis/task-23` at `3ace0ad86092026e99a52f5f791c9fdb376afcc1`, with the Electron/React scaffold committed at 17:30:31 UTC before the disk stop. This proves coding began and work was retained. No delivery PR or completed validation is confirmed.

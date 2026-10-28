# Eight approved review fixes

[Issue #1343](https://github.com/DanAakesen/jarvis/issues/1343) and
[PR #1345](https://github.com/DanAakesen/jarvis/pull/1345) cover the owner's
eight approved findings. The mobile Settings change replaces the original
unsaved-draft proposal. No Settings navigation guard, autosave or draft storage
is included. Optional audit findings and Azure log permissions are outside scope.

| Finding | Implemented behavior | Regression evidence |
| --- | --- | --- |
| Old label delivery starts more work | An accepted label delivery skips its handler; task creation also binds the delivery ID durably, including completed tasks. Failed handling can retry. | Webhook replay/failure tests; issue pickup tests; SQL concurrent-create/restart regression added. |
| Missing completion replies | Issue creation stores the verified chat message before applying the pickup label. Completion message and deduplication receipt commit together; a failed transaction gets one immediate safe retry. | Issue-origin tests; transient notification-write test; SQL rollback/concurrent-delivery regression added. |
| Misleading Gmail receipts | Approval and cancellation say no Gmail change occurred. Uncertain send warnings survive the tool result formatter. Completed receipts retain their existing wording. | Pure receipt tests and synthetic Google tool-boundary regression; no real send. |
| Error warning lost on reload | Terminal errors, partial reply and acknowledgement recover in the same browser tab, scoped to backend/account. | Conversation remount and storage-shape tests; synthetic browser reload. |
| Queued message lost on reload | Unsent text, language and attachment references recover in the same tab. Restored messages wait for explicit Send queued messages. | Queue remount/storage tests; browser proves no automatic request and explicit resumption. |
| Mobile Settings Save hard to reach | At widths up to 700px, heading and the single Save action stay at the top. Desktop retains its footer action. | Responsive component test; inspected 320px/390px phone and 1440px desktop browser captures. |
| Oversized issue startup silently stops | Automatic pickup records a deduplicated Now alert explaining that the issue exists, coding did not start and the issue must be shortened before a new start. | Synthetic oversized-prompt test verifies alert and no task creation. |
| Settings approval lacks values | Approval summary includes each proposed role model/reasoning value and the vision budget in USD per day. | Settings tool summary assertions. |

## Validation

Local runtime is Node 24.19.0/npm 11.9.0. Repository-supported Node 22 CI remains
separate qualification. The integrity-pinned dependency versions are unchanged;
temporary public-registry URL substitution was confined to installation scratch
files after the configured mirror returned HTTP 403. The committed lockfile is
unchanged.

- Web: 156 files, 2,447 tests passed. After the final empty-restored-queue
  correction, ConversationHistory passed all 126 tests, including removing the
  last restored draft and sending a fresh message. Lint and production build passed.
- Contracts: 174 tests passed.
- Backend aggregate: 303 files; 6,776 passed, two failed, one skipped. One failure
  was a stale model-tool expectation for the deliberately changed approval text;
  the other was a 5-second timeout in unchanged workspace-pin coverage. The stale
  assertion is corrected to require the proposed model/reasoning values. Both
  affected suites passed their single-worker rerun: 16 tests, with original
  timeout limits. The aggregate itself did not pass.
  Focused changed-area checks passed, including 68 Gmail/tool receipt tests.
- Backend lint and TypeScript build passed.
- Chromium synthetic browser checks passed, with no uncaught page errors or
  unexpected external requests. All six final captures were visually inspected.
  [Screenshots and measurements](ui/screenshots/fix-eight-1343/README.md).

SQL Server was not configured in this executor. Migration 0068, rollback,
transactional notification delivery and concurrent task creation require the
normal isolated SQL Server CI job; mocks and source inspection do not establish
that SQL execution passed. Two interrupted/overloaded backend attempts were
superseded by the final clean aggregate, not counted as passes.

Browser fixtures stub authentication and backend responses. They use only
synthetic text and do not send real email, start paid workers, change live user
settings or write health data. A shortened focused viewport approximates reduced
keyboard space; physical iPhone/Safari keyboard acceptance remains unverified.
The synthetic Settings fixture emits duplicate-key console warnings and repeats
some Nutrition target rows, so these captures qualify the changed Save placement
and scrolling behavior, not unrelated Settings content. No uncaught page error
occurred.

Chat recovery uses sessionStorage with a 24-hour snapshot limit and bounded
payload size. It preserves reloads in the same browser tab, not cross-device or
new-tab drafts. Notification failure recovery is one bounded immediate retry;
later redelivery can retry because failure does not consume the receipt. This
change adds no background retry scheduler.

The coordinator marked the PR ready after independent source review. The first
hosted SQL run, [40756774334](https://github.com/DanAakesen/jarvis/actions/runs/40756774334),
had 281 passes and two test-setup failures. The catalog query now includes the
issue-delivery index its assertion already required. The Workspaces test now
unwinds migrations newer than 0067 before its second rollback, after reapplying
the full manifest. Assertions and migration implementation remain unchanged.
Qualification must run again on the correction's new head; results are recorded
in the PR without treating the original failed run as passed. No merge, deployment,
Azure grant or production acceptance is claimed.

## Recovery bounds follow-up

CI 40757610202 subsequently passed on `5cf8da23`: SQL 283, backend 6,778 with
one skipped, web 2,448 and contracts 174. A bot review found a separate recovery
regression: a 100,001-character partial reply was saved successfully but rejected
on read, discarding the valid queue too. This is reproduced and corrected within
approved items 4–5.

Writer and reader now share per-entry validation with the backend's 512 KiB
UTF-8 partial-reply limit. Invalid entries are isolated; valid queued messages
and other warnings survive. If partial contexts exceed the existing two-million-
character snapshot bound, saving omits partial context before warning metadata;
if warning metadata alone remains oversized, it preserves the queue alone.
Incomplete saves return failure to the existing visible recovery warning.
Regression tests cover 100,000/100,001 characters, exact and excess 512 KiB ASCII
and multibyte replies, invalid warning fields and snapshot-budget preservation.
The follow-up requires CI on its new head. No retry of the failed PR-description
write is included; qualification results are delivered to the coordinator.

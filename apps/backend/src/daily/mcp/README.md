# Inactive hosted nutrition adapter

P12-09 adds an explicitly composed MCP transport over existing Daily services.
It is not registered by production startup or an environment flag. Normal
`createDailyModules()` stays empty; enabled Daily without a connector keeps
its existing read-only HTTP/internal-tool boundary.

## Composition and authority

Only trusted server composition may pass
`createDailyModules(true, data, connector)`. Supply the existing Daily data,
`createNutritionHandlers` over the same pool/change hub, a canonical HTTPS
resource ending exactly `/daily/mcp`, and the existing root authentication
configuration with an additional separate `dailyConnectorClientId`.
`writesEnabled` defaults false. The root verifier must receive that same
explicit client configuration; normal configuration loading does not set it.

The connector requires a valid signed, owner-bound delegated Entra access
token for the existing API audience and approved client. Only
`Daily.Nutrition.Read` and `Daily.Nutrition.Write` are allowed. Mixed
`access_as_user`, application roles/identity, foreign owners, unknown scopes
and other clients' nutrition scopes are refused. This distinct principal
cannot call ordinary Jarvis, Factory, internal tools, health upload or export.
It is not a new login or permission to create an Entra client/scope/grant.

`/.well-known/oauth-protected-resource/daily/mcp` alone is anonymous.
Metadata/challenges use trusted configuration, not forwarded/caller Host.
The authenticated route validates Host, rejects all browser Origin requests
and query selectors, and limits the body to 96 KiB. This is a server-to-server
connector; the application's existing browser origin/CORS policy is unchanged.
The current transport accepts modern MCP
2026-07-28 and rejects legacy versions.

## Tools and recovery

`read_nutrition` shares bounded meal/favourite/plan queries, provenance,
unknown values and freshness with existing Daily reads. Definitions/plans are
not eaten meals. `lookup_food` accepts exactly one of its original `components`
input (the pinned public Frida adapter) or `savedName` (existing owner-bound
favourite/alias resolution before an exact historical meal name). Saved matches
reuse shared query DTO whitelists, preserve stored quantities/nulls/provenance
and report unknown freshness. Missing/ambiguous matches never fall back to
Frida or create intake; oversized results refuse under the shared read budget.
Historical names outside the smaller favourite-key domain still receive exact
history lookup, including full 2000-character and non-Latin names.
`read_food_preferences` reads at most 50 canonical favourite IDs and distinguishes
missing records (revision 0), stored likes/dislikes and versioned clears.
Write-enabled composition additionally exposes `log_food`, `correct_food`,
`delete_food` and `manage_saved_food`; no Apple Health action follows.
The latter groups favourite/alias saves, owned-favourite plan saves,
plan soft deletion and like/dislike/clear, not additional intake.

Saved changes carry decimal-string expected revisions (0 for a new record).
Favourite/plan creates derive IDs from the owner, client, operation and stable
operation ID; normalized-name reuse still preserves an existing record ID.
Native review includes actual source intake or resolved plan names/components,
provenance, quantities and totals. The same shared plan builder runs under SQL
locks; source revision/fingerprint checks reject races after review.
Favourite saves return actual stored rows and exact repeats do not update or
publish again. Preference clears retain a null tombstone and revision, so a
delayed old like cannot overwrite a newer clear. Feedback uses canonical owned
favourite IDs, not aliases or model-created meal keys.

Every external mutation requires native form review of the exact proposal,
including a photo claiming accurate confidence or an exact-label entry.
Model/client `userConfirmed`, authority/owner/record-ID fields are rejected.
SDK-signed ten-minute request state binds owner, client, tool, canonical
payload digest and trusted time; it contains no food text or credential.
Decline/cancel/unchecked review refuses. Unsupported clients cannot bypass
review. Process-local keys invalidate pending proposals after restart or
replica change: begin a fresh review, never treat an old prompt as approval.

Keep `operationId` identical on a log retry. The server namespaces it to the
approved client, derives the record ID and retains stored occurrence when
the client omitted time, including across Copenhagen midnight. Reusing the
key with changed payload conflicts in the existing SQL writer. Different
operation IDs are different operations; there is no global deduplication of
independently regenerated human messages. Corrections/deletions use exact
owned idempotency keys and decimal-string expected revisions; deletion stays
soft and old history has no seven-day edit cutoff.

Committed receipts expose only whitelisted fields and stringify revisions.
`createToolCallStore.recordDailyMcp` writes only redacted operation/outcome
and UUID request correlation into the existing audit table, not fabricated
conversation message IDs. Migration 0049 preserves ordinary message FKs and
permits message-less rows only for the allowlisted connector tools with UUID
correlation. Additive 0050 extends its constrained allowlist for the two saved-food
tools and adds target-only favourite/feedback revisions and nullable clears.
Deployed 0049 is unchanged. Rollback refuses new audit evidence, used revisions
or retained clears instead of dropping evidence.
No second audit table or conversation is created. Missing connector-capable
audit storage refuses execution. An audit/response failure
after a write may mean it committed: retry the same operation/key/revision,
not a new intake. Existing SQL transactions and post-commit invalidation
remain authoritative; native review does not assert native Health effects.

## Checks and remaining gates

Run backend strict build and changed-file ESLint, then the existing Vitest
runner selecting `src/auth/daily-connector.test.ts`,
`src/daily/mcp/routes.test.ts` and affected auth/Daily regressions. Synthetic
signed JWTs and the real maintained SDK client/server transport through
Fastify inject require no identity/provider/private network calls. Existing
normal Database CI owns real isolated SQL replay/revision evidence.

Exact-head CI qualifies source delivery. Synthetic protocol acceptance is not
actual ChatGPT compatibility, account linking, deployed OAuth or phone proof.
Review supported client protocol/native confirmation and fleet key policy
before any activation. Complete retained nutrition tool/UX parity, protected
export/source reconciliation, real provider/device acceptance, final delta
and rollback/cutover remain separate. Original Daily stays canonical and
Jarvis Daily stays off.

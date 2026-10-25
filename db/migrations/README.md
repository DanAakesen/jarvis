# SQL migration format

Append reviewed files as `NNNN_name.sql`, for example `0001_core_tables.sql`.
Use four unique digits and lowercase letters/underscores in the name. Each file
is one executable SQL Server batch without `GO`, at most 1 MiB. The backend reads
at most 1,000 migration files, in ordinal sequence order. `0001_core_tables.sql`
creates data-model groups 1–3 (issue #15); `0002_sandbox_operations.sql` creates
groups 4 and 6 (issue #27); `0009_github_release_records.sql` creates group 5
(issue #42). `0010_idle_expired_sessions.sql` adds the `idle_expired`
session end reason (P2-14, #226).
`0011_alert_deduplication.sql` adds unique alert activity keys (P6-02, #63).
`0014_teams_notifications.sql` adds the personal Teams conversation and
expiring confirmation records (P7-03, #201).
`0015_screen_frame_usage.sql` adds the screen-frame usage metric and index
(P7-05, #203).
`0017_phone_call_sessions.sql` adds persistent session and confirmation
references for P7-01 phone calls.
`0018_tool_call_refused_outcome.sql` records refused Jarvis tool calls so daily
usage counts include all outcomes. Its down migration refuses to remove the
constraint while refused rows exist, preserving their truthful outcomes.
`0019_workspace_artifacts.sql` adds owner-scoped image artifact metadata for
P7-15; private image bytes remain in the existing `artifacts` Blob container.
`0020_chat_message_steering.sql` adds per-message language overrides and the
persisted interrupted-reply marker (P8-35).
`0024_dismiss_board_deployment_failures.sql` adds deployment failure receipts
for permanent replay protection, including collapsed failures without a release,
and dismisses historical board-sync
deployment failure activity (P6-20). It retains rows and existing owner dismissal
timestamps. Its down batch drops the receipts but never resurrects dismissals;
restoring pre-cleanup visibility requires a reviewed backup restore.
`0027_vault_knowledge_graph.sql` adds index timestamps to vault chunks and
persists parsed note-link targets for the P7-43 knowledge graph.
`0028_json_embeddings_without_vector.sql` stores nullable JSON embeddings for
memories and vault chunks only when SQL Server does not expose the `vector` type.
`0030_foundry_usage_cost_coverage.sql` adds model/role attribution and USD cost
estimates to usage rows; migration 0029 is reserved for P9-14.
`0031_embedding_model_identity.sql` records the deployment name for memory and
vault embeddings and permits durable embedding-reindex background jobs.
`0032_conversation_search.sql` indexes conversation message timestamps for
date-bounded search; its setup batch adds an optional full-text message index.

Every migration has a reverse batch with the same name in `down/`, under the
same format rules. Startup never reads `down/`. Down scripts drop data: only
`revertMigration` runs one, under the same lock and transaction as startup. It
reverts only the latest applied migration and deletes its ledger row with it.

Startup acquires transaction-owned `jarvis.schema-migrations`, creates the
`dbo.schema_migrations` ledger and validates applied names/checksums against an
unchanged prefix of these files. All pending batches and ledger writes commit
together. Concurrent replicas wait for the same lock and cannot apply twice.
Failure or cancellation rolls back the transaction; startup does not listen.

Never edit, remove or reorder a migration that has been applied. Correct it with
a new numbered migration. Never manually edit the ledger. Back up before a
production data change and describe compatibility/restore handling in its PR.
Startup applies forward SQL only; it never performs automatic production down
migrations. CI proves every down script against SQL Server. A production revert
needs a backup and Dan's approval first, and the backend revision that expects
the reverted schema must not be running.

`setup/*.sql` contains idempotent, non-ledger setup batches that run after the
numbered migrations commit. For example, P7-13's `setup/0016_long_term_memory.sql`
creates the optional full-text catalog/index when supported. This must run outside
the migration transaction because Azure SQL does not allow `CREATE FULLTEXT INDEX`
inside an explicit user transaction. Reverting P7-13 drops the memory table and its
index; the now-empty full-text catalog remains available for a later setup run.

`0036_folio_lowercase_ids.sql` lower-cases Folio item ids that 0035 built from upper-case uniqueidentifier text (L124); its down script is a no-op.

`0040_message_visual_context.sql` adds nullable, size-bounded JSON metadata to
messages for visual observations (source, capture time, bounded answered
question, optional turn correlation and description). Existing rows stay null;
deploy the migration before code that reads/writes metadata. The down batch drops the constraint and column,
discarding visual metadata but preserving message text. Revert the dependent
backend revision first and obtain Dan's approval before a production rollback.

`0060_daily_health_processing_state.sql` makes active upload processing visible
as `processing`, with the existing attempt deadline serving as a restart-safe
claim lease. The down batch refuses to run while any claimed row remains in that
state; disable the worker and let each claim complete or expire before rollback.
Pending/quarantined evidence and processed records remain intact.

`0064_owner_sessions.sql` adds `dbo.owner_sessions` for the optional 10-day owner
session (#1217). Rows hold a SHA-256 hash of the session secret, never the
secret, and the owner's object id, display name, optional device label and the
creation, last-use, idle-expiry, absolute-expiry and revoked-at times. The table
is read and written for session requests only when `JARVIS_OWNER_SESSION_ENABLED`
is exactly `true`. With the switch off, verification stops immediately and each
process start with SQL configured attempts one background revoke of active
sessions; without SQL there is no boot revoke. This may wake a paused serverless
database. Its down batch drops the table. Sessions are revocable credentials, not
evidence, so dropping them is the same as revoking every session: the owner signs
in again. Deploy the migration before the backend revision that uses the table.

`0066_research_result_recovery.sql` stores the Folio entry and Workspace delivery
state on completed research jobs. The down batch removes only those references;
saved reports and Folio entries remain untouched.

`0067_workspaces_identifiers.sql` renames the saved-item table to
`dbo.workspace_items` and adds `result_workspace_item_id`. A `dbo.folio_items`
synonym and synchronization trigger preserve existing SQL callers; the down
batch restores the old table/column names without deleting saved items. Updating
one result column mirrors it to the other. Writing NULL to only one result alias
clears both aliases and the delivery status; when both columns are written with
one NULL and a valid delivery status, the trigger synchronizes from the non-NULL
value.

# Jarvis data model

The schema of record is [the ordered SQL migrations](../../db/migrations/), not duplicated DDL. Jarvis uses one Azure SQL database. The backend runs forward-only migrations before serving; read the [migration contract](../../db/migrations/README.md) for checksums, locking, paired down files and the rollback boundary.

## Ownership

| Domain | Source of truth and lifecycle |
| --- | --- |
| Conversation and voice | SQL owns sessions, messages, Voice window snapshots, attachment metadata, tool receipts and audio usage evidence. An archived HTML window references the owner’s artifact version. Blob holds attachment bytes. The Foundry conversation reference and context hash are a separate [PI store](../../db/migrations/0086_pi_chat.sql); a provider reply does not replace the stored app message. |
| Personal Memory | SQL owns owner-scoped memory identity, source history and forget/correction behavior; see [the store](../../apps/backend/src/database/memory-store.ts). Search projections are not new facts. Vault retrieval does not write Memory. |
| Notes and Vault tasks | The Vault's Git revision is authoritative for content and task-line identity. SQL holds search chunks, folder order and the [note inventory](../../db/migrations/0103_vault_note_metadata.sql). Title-only notes have inventory rows; bounded repair matches the blob SHA without changing content dates. The mirror retains its sync base and status separately from Vault content. |
| Loose Ends | Inbox notes live under the Vault's `Inbox/`; SQL indexes state, credential hashes, audit clocks, nudge state and usage. See [activation and acceptance](../inbox-loop/acceptance.md). |
| Software Factory | SQL records projects, tasks, worker sessions, task events and delivery origin. Branch, PR and check facts originate in GitHub; SQL projections can be stale. Large or retained task-event payloads can live in Blob. Start/recovery uses the recorded task identity, not a second inferred task. |
| PI wake and follow-up | [Proactive events](../../db/migrations/0080_proactive_events.sql) dedupe and lease work; [situational state](../../db/migrations/0090_pi_situational_intelligence.sql) is compact, revisioned working memory, not source history. Follow-up changes use a [transactional outbox](../../db/migrations/0098_pi_situation_followup_outbox.sql). |
| Push and reminders | The [reply outbox](../../db/migrations/0093_reply_notification_outbox.sql) tracks an exact committed message and delivery per registration. Scheduled reminders retain each occurrence and its outcome in a [different outbox](../../db/migrations/0102_owner_reminder_delivery_outbox.sql). Schedule, provider receipt and presented notification are distinct. |
| Owner authorization | [Owner sessions](../../db/migrations/0064_owner_sessions.sql) persist the credential hash, expiry and revocation state, not the bearer token. Application and device credentials have separate scope and expiry; do not use a token as a join identifier. |
| Health and nutrition | The `daily` schema stores owner-scoped workout, metric/day and named-meal records. The native Health interface uses the same database and an independent Vault Gym capture path where configured. See the [field mapping](daily/schema-mapping.md) and [upload contract](daily/health-ingestion.md) for units, freshness and replay. |

Keep dates and units explicit at the boundary. Preserve opaque cursors, source identity and transaction/receipt semantics. The [backend stores](../../apps/backend/src/database/README.md) and [architecture](../architecture.md) explain how these records are used.

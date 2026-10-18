# Daily migration owner runbook (P12-22)

This prepares and validates an export; it does not import records, activate
Daily, or close the private export/import gates.
Refs DanAakesen/jarvis#717 and DanAakesen/jarvis#721.
Only synthetic bundles may enter a coding-agent environment.

1. **Owner-only — prepare protected storage.** Use an owner-controlled machine
   and encrypted private storage outside this repository and outside every
   coding-agent environment. Keep exports, reports, temporary storage and
   private notes there. Never upload them to GitHub, Actions artifacts, PRs,
   chat, logs or fixtures. Ensure sufficient private temporary disk space for
   digest indexes and protect the host's temporary directory.
   **Expected:** a private destination and recovery copy, not a repository file.

2. **Owner-only — establish the real source inventory.** With access to the
   original site, record the actual columns/types, all 31 source tables,
   source keys, row counts and retained-object inventory. The supplied
   code-side definitions at source HEAD
   `9e193554c9c8c7c23a788ed3d2b0582580b76c0f` do not prove the live schema.
   Determine the read-only export route privately; this runbook does not
   invent one. Keep the original site canonical and allow its normal use.
   **Expected:** schema evidence and a complete inventory, or a recorded
   blocker. Do not proceed by guessing missing columns.

3. **Owner-only — produce the bundle.** Follow the
   [version 1 format](daily-migration-bundle.md). Export every table without
   pagination loss, row caps or truncation; include zero-row files. Preserve
   keys, padding, times/offsets, signed-64-bit integers, NULLs, revisions and
   tombstones. Record per-table column inventories, counts, exact-byte
   SHA-256s and `complete: true` only after verifying completeness. Include
   retained objects and their index/count/bytes/checksums, with ingestion
   references and expiry evidence. Do not export working credentials.
   Excluded legacy credential records belong only in the separate encrypted
   protected backup, never active migration.
   **Expected:** `manifest.json`, 31 NDJSON files and any retained-object files,
   plus independent source count evidence.

4. **Owner-only — rule on all five mixed-source tables.** Record a
   `manifest.rulings` entry for `attention_runs`,
   `attention_source_snapshots`, `attention_items`, `briefing_runs` and
   `attention_rule_config`. Choose explicit `exclude` or `import-sanitised`,
   with a private `rule` explaining verified source semantics and sanitization.
   Confirm real TickTick discriminator values privately. Migration 0041
   forbids `ticktick` substrings but supplies no positive source allow-list;
   do not infer one from that exclusion. Unknown payloads fail closed. A
   free-text rule cannot bypass classification or authorise TickTick content.
   `owner_email` never selects an identity; `claim_token` never migrates.
   **Expected:** five explicit rulings, or `blocked-needs-ruling`.

5. **Prepare the CLI using repository tools.** Use the repository's supported
   Node 22/npm 10 toolchain on a Linux host with `/proc/self/fd` available.
   Descriptor-anchored bundle reads currently require Linux; Windows/macOS
   execution is not verified or supported by this version. On an owner machine,
   use an owner-controlled Linux environment with encrypted private storage,
   not a cloud coding agent. From the repository root, build the existing
   workspaces in dependency order:

   ```sh
   npm run build --workspace @jarvis/contracts
   npm run build --workspace @jarvis/backend
   node apps/backend/dist/daily/migration/cli.js --help
   ```

   **Expected:** TypeScript compilation succeeds and help lists `generate`
   and `validate`. No server, database or network operation is started by
   either migration command. Dependency installation/build preparation is
   separate from offline validation.

6. **Prove the setup with synthetic data first.** These paths are disposable
   synthetic examples, not locations for a real export:

   ```sh
   node apps/backend/dist/daily/migration/cli.js generate --bundle /tmp/daily-synthetic --seed 22
   node apps/backend/dist/daily/migration/cli.js validate --bundle /tmp/daily-synthetic --report-dir /tmp/daily-synthetic-report --now 2026-10-18T00:00:00Z --memory-budget-bytes 8388608
   ```

   Use `generate --help` for supported negative `--variant` names and
   `--rows` for larger synthetic coverage.
   **Expected:** deterministic files for the same seed/options; the default
   synthetic bundle validates successfully and writes
   `validation-report.json` and `validation-summary.md`.
   Negative fixtures intentionally exit nonzero where appropriate.

7. **Owner-only — validate the private immutable export offline.** On the
   owner-controlled host, replace the example paths with encrypted private
   paths. Do not execute this command on an agent or CI worker with real data:

   ```sh
   node apps/backend/dist/daily/migration/cli.js validate --bundle /PRIVATE/EXPORT --report-dir /PRIVATE/REPORT --now 2026-10-18T00:00:00Z --memory-budget-bytes 8388608
   ```

   Choose the actual validation time, not the example date. Preserve an
   unchanged copy of the bundle throughout validation. The private report
   directory must be separate from, and not nested inside, the bundle;
   validation refuses overlapping destinations.
   **Expected:** exit zero only when all checks and rulings pass; otherwise
   nonzero with fixed, value-free diagnostics. Reports never show source
   keys, row values, free text or credentials. Unknown identifiers appear
   only as counts/digests.

8. **Owner-only — resolve failures privately.** Compare manifest and observed
   counts/checksums per table, blocked rulings, missing-column warnings and
   object coverage/expired counts. Missing optional columns mean NULL, not
   inferred values. Expired objects are not errors or import candidates.
   Correct the exporter or reconcile the source schema; never trim/hash keys,
   remove unexpected data, loosen a rule or edit a checksum merely to obtain
   a pass. Rerun on a fresh immutable bundle and retain failed evidence
   privately.
   After an abrupt process termination, inspect the private report directory
   and remove stale `.daily-index-*` scratch directories privately; normal
   completion/failure cleans them up.
   **Expected:** explained warnings, no errors or blocked tables, and source
   inventory evidence that agrees with the bundle. A pass alone cannot
   establish that the original source query was complete.

9. **Owner-only — retain evidence and stop before import.** Privately record
   exporter/version, source schema reference and inventory, export time and
   method, source counts, manifest/bundle hashes, validation time and CLI
   revision, rulings, report digests, retained/expired object coverage,
   backup location and unresolved differences. Never put actual paths,
   records, rulings or exports into public acceptance notes.
   **Expected:** a recoverable private evidence package. Real source-schema
   parity, source/provider/device behavior, resumable import/reconciliation
   (P12-27), final delta, rollback and cutover remain unverified here.
   The actual export (#717) and import (#721) require the owner's access.
   Passing synthetic validation closes neither issue.

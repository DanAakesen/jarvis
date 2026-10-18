# Daily migration owner runbook (P12-22 / P12-27)

This covers bundle preparation, validation, import and reconciliation. The
commands and tests use synthetic data only. No real records have been imported
or reconciled; this does not activate Daily or close the private export/import
gates.
Refs DanAakesen/jarvis#717 and DanAakesen/jarvis#721.
Only synthetic bundles may enter a coding-agent environment.

1. **Owner-only — prepare protected storage.** Use an owner-controlled machine
   and encrypted private storage outside this repository and outside every
   coding-agent environment. Keep exports, reports, temporary storage and
   private notes there. Never upload them to GitHub, Actions artifacts, PRs,
   chat, logs or fixtures. Ensure private temporary disk space for digest
   indexes, a verified copy of bundle table files and reconciliation sort runs;
   protect the host's temporary directory.
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

   **Expected:** TypeScript compilation succeeds and help lists `generate`,
   `validate`, `import` and `reconcile`. Generation and validation are offline.
   Import/reconcile use only the target SQL connection from existing backend
   configuration. Dependency installation/build preparation is separate from
   offline validation.

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
   and remove stale `.daily-index-*` scratch directories and
   `daily-import-validation-*` directories in the host temporary directory
   privately. The latter may contain source rows. Normal completion/failure
   cleans them up.
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
   parity, source/provider/device behavior, final delta, rollback and cutover
   remain unverified here. The actual export (#717) and import (#721) require
   the owner's access. Passing synthetic validation closes neither issue.

10. **Prove import and reconciliation with synthetic SQL data.** The Database
   CI job creates an isolated loopback SQL database, applies migrations 0041
   through 0050, and exercises a synthetic bundle. Do not point this step at
   production or use a private export in CI. The tests cover dry run,
   idempotency, conflicts, resume, another-owner isolation, padded/max-length
   keys, signed 64-bit values, NULL nutrients, mixed-source exclusions and
   digest-only reconciliation.
   **Expected:** the Database CI integration test passes on its exact tested
   revision. This demonstrates tooling behavior only, not production access or
   source parity.

11. **Owner-only — private dry run after the protected workflow gate.** Only
   after the owner has supplied the private export, made the rulings, and
   protected workflow #721 releases this stage, run the importer without
   `--execute`. Use the existing backend SQL environment configuration; never
   provide credentials on the command line. The owner GUID is mandatory and
   must match the server's configured Daily owner. Optional `--tables`
   accepts comma-separated table names and retains dependency order.

   ```sh
   node apps/backend/dist/daily/migration/cli.js import --bundle /PRIVATE/EXPORT --owner-object-id OWNER_GUID --state-dir /PRIVATE/STATE --batch-size 500 --report /PRIVATE/DRY-RUN-REPORT.json
   ```

   The state directory must be absolute, private, outside the repository and
   outside the bundle. Resume only with the same immutable bundle and batch
   size. Reports and state contain counts/digests only; store them outside the
   repository, bundle and state directory.
   **Expected:** a digest-only report classifying each selected row as
   `wouldInsert`, `wouldSkip` or `wouldConflict`, with no SQL writes. A
   conflict returns exit code 3. A dry-run pass is not authorization to write.

12. **Owner-only — protected execution.** Execute only through the approved
   protected workflow after its owner-only checks pass. The direct CLI option
   below documents the interface; it does not replace or authorize #721:

   ```sh
   node apps/backend/dist/daily/migration/cli.js import --bundle /PRIVATE/EXPORT --owner-object-id OWNER_GUID --state-dir /PRIVATE/STATE --batch-size 500 --execute --report /PRIVATE/IMPORT-REPORT.json
   ```

   Each batch is its own transaction. Identical rows are skipped. A different
   existing row is not overwritten; processing continues through that table,
   checkpoints are preserved, and exit code 3 reports conflicts. After a
   transient failure, resume from the same private state directory only after
   verifying the process lock is stale. The CLI refuses every existing lock;
   after confirming its recorded process is no longer running, remove the stale
   lock manually from the private state directory. Never remove a live lock.
   **Expected:** a digest-only report of committed batch counts, conflicts and
   checksums. The command never prints row content or credentials.

13. **Owner-only — reconcile read-only.** After protected execution, use the
   same immutable bundle and owner. This is also a standalone read-only check:

   ```sh
   node apps/backend/dist/daily/migration/cli.js reconcile --bundle /PRIVATE/EXPORT --owner-object-id OWNER_GUID --batch-size 500 --report /PRIVATE/RECONCILE-REPORT.json
   ```

   **Expected:** zero missing, extra and different rows; matching canonical
   source/target hashes; date-range and meals per-day-total digests. NULL
   nutrients remain distinct from zero. Any difference exits nonzero and
   blocks acceptance/cutover. Reports contain only table names, counts, hashes
   and digests, never row values, free text, dates or raw keys.

14. **Owner-only — retain evidence and stop.** Privately retain the bundle and
   manifest hashes, validation/import/reconcile reports, state/checkpoint
   directory, owner rulings, protected workflow evidence and backup/recovery
   notes. Remove stale private temporary snapshots after a crash. Keep every
   item outside this repository, agent environments and GitHub artifacts.
   **Expected:** no real import is claimed by this issue. No real data,
   export, ruling, credential or report was used or produced here. Final delta,
   rollback and cutover remain separate owner-only gates.

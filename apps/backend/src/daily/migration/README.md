# TEMPORARY offline Daily migration tooling

Remove at **P12-19**, including compiled counterparts in `apps/backend/dist/daily/migration/`.
Files to remove: `README.md`, `cli.ts`, `decisions.ts`, `manifest.ts`, `io.ts`,
`validate.ts`, `generate.ts`, `importer.ts`, `migration.test.ts`,
`importer.test.ts`, and `apps/backend/src/database/daily-migration.integration.test.ts`.
No production entrypoint imports this directory. Import/reconcile connect only to
the configured target SQL database; bundle validation and synthetic generation
remain offline. No deployment, activation, credentials or new dependencies are
added.

Build with the existing backend build, then run:

```sh
node apps/backend/dist/daily/migration/cli.js --help
node apps/backend/dist/daily/migration/cli.js generate --bundle ./SYNTHETIC_BUNDLE --seed 22
node apps/backend/dist/daily/migration/cli.js validate --bundle ./SYNTHETIC_BUNDLE --report-dir ./SYNTHETIC_REPORT --now 2026-10-18T00:00:00Z
```

Only synthetic examples belong in an agent environment. Real bundles/reports
must stay in owner-controlled encrypted private storage, outside this repository,
agent environments and GitHub artifacts. Validation does not accept #717/#721.
`import` and `reconcile` reuse this reader and decision metadata. Real imports
remain gated on the owner's private export and rulings plus protected workflow
#721; this CLI does not supply or replace that workflow.

## Contract and conservative classification

The strict v1 manifest contains `formatVersion`, `createdAt`, `exporter:
{name, version}`, `sourceSchemaRef`, and `tables`, an object keyed by all 31
source names. Each table has exactly `{file, rowCount, sha256, complete: true,
columns}`. The file is exactly `<table>.ndjson`; columns are unique source
column names. Unknown tables and columns fail without echoing their identifiers.
Optional fields: `rulings` and `objects`. Unknown manifest fields fail.
Timestamps use ISO date-time with seconds and an explicit offset.

Every mixed table requires `{decision: 'import-sanitised' | 'exclude', rule}`.
An exclusion ruling excludes the whole table (including unknown sources,
counted separately without authorising them for import).
For candidate imports, `rule` must be exactly `empty-payload-v1`; it is a
machine contract, not an assertion that arbitrary free text has been reviewed.
All present `*_json` values must be strings containing **empty objects or empty
arrays**, or NULL. Brief `preview_text` must be NULL, absent or empty. Nonempty
objects/arrays, scalar JSON and arbitrary bodies/rules fail closed. No JSON is
rewritten, guessed or silently sanitised.

0041's three source CHECKs only reject case-insensitive `%ticktick%`; they
contain **no positive allowed set**. Thus TickTick-containing discriminators are
counted and excluded; every other candidate source discriminator (including
missing/NULL) is unclassified and fails closed. Do not infer real source values
from synthetic labels or treat passing the negative SQL CHECK as classification.
Source-bearing mixed tables can currently pass only via an entire-table
`exclude` ruling or exclusion of every TickTick-tagged row. Source-less runs and
briefs can pass `empty-payload-v1`. Useful nonempty payloads need verified source
semantics and a separately reviewed machine rule before any protected import.

The four credential tables are UTF-8/line bounded, counted and hashed, **never
JSON-decoded**. Their bytes may be arbitrary non-JSON lines. `owner_email` is
excluded from identity selection; `coach_profiles` retains that source-key
metadata but all rows share one target owner, so two different source emails
are duplicate profiles. `nutrition_queue.claim_token` is an accepted excluded
column regardless of value. No excluded value is used or emitted.

## Original objects and retention

`objects` is exactly `{index: 'objects.ndjson', count, totalBytes, sha256}`.
The hash is over exact index bytes; totalBytes sums declared original sizes,
**including expired objects**. Each streamed index line is exactly:

```json
{"file":"objects/SYNTHETIC_OBJECT.bin","ingestionId":"SYNTHETIC_22_0","bytes":25,"sha256":"0000000000000000000000000000000000000000000000000000000000000000","expiresAt":"2099-01-01T00:00:00Z"}
```

This is shape-only, not a valid checksum example. File basenames allow only
ASCII letters/digits/underscore/hyphen and at most one extension. Each ingestion
and path occurs once. The ingestion must exist in `health_ingestions`. Its request
checksum/size need not equal a retained object's checksum/size: these are different
boundaries. If a raw-ledger entry exists, its known non-NULL original checksum,
size and expiration text must match the index; missing/NULL metadata stays
unknown, never fabricated. A historical raw ledger alone does not prove that
retained bytes still exist, so the object index is optional and need not include
every historical ledger row. The owner must establish retained-object coverage
independently. Sanitized checksums stay historical row metadata;
this format validates **original bytes only**, never substitutes sanitized bytes.
Optional `sanitized_checksum` must be 64 hexadecimal characters or NULL; its
case and value remain unchanged. This validates checksum shape, not sanitized
byte existence or integrity.

An entry is expired when `expiresAt <= --now` (default current time).
Its reference, declared metadata and manifest index coverage are still checked; its
bytes are **not opened, hashed, required or imported**, even if present. A
missing expired file is accepted and counted, not an error. A nonexpired file
requires exact streamed byte length and SHA-256. This is a deliberate retention
decision, not evidence that expired originals still exist.

## Bounds, filesystem and reports

Linux/Node 22 is required for descriptor-anchored `/proc/self/fd` reads. Bundle
ancestors, files and traversed directories cannot be symlinks. Relative traversal,
absolute paths, devices and FIFOs are rejected; reads use `O_NOFOLLOW` and anchored
directory descriptors. Work only on a quiescent owner-controlled bundle; a
concurrently modified source cannot be certified by an offline file validator.

Default working-buffer budget is 16 MiB; minimum 64 KiB. This is an algorithmic
buffer budget, **not a process RSS limit** (Node/V8/runtime and bounded manifest/
report objects have overhead). Line limit is min(1 MiB, budget/8); manifest limit
is min(256 KiB, budget/2); reads use at most 16 KiB chunks. Strict UTF-8 decoding
rejects malformed sequences. Missing optional columns/values warn and mean NULL,
not fabricated values. Integer metadata covers every source bigint column,
including non-key values; 0050 target-only revisions are not source columns.

Duplicate membership, FK membership and object coverage use a disk-backed SHA-256
index with no row-proportional in-memory set. Digests retain full 256 bits for
membership (no truncated collisions); equality is cryptographic digest equality.
Private random scratch directories under the report directory contain digests
and minimum ledger metadata, are mode 0700, and are removed on normal completion
or failure. Abrupt process termination can leave scratch: the owner must remove
stale `.daily-index-*` directories privately. Disk usage/inodes grow with rows;
disk exhaustion fails closed. The output directory must be private and trusted, and must be outside the
bundle. Validation refuses an equal/nested report directory before writing.
Report replacement is atomic and refuses existing symlinks or hard-linked files,
so output cannot truncate a source inode through an existing hard link.

Reports `validation-report.json` and `validation-summary.md` contain only fixed
table names/decisions, stable codes, counts, booleans and hashes. Unknown names,
column names, raw keys, row values, exporter/schema text, ruling prose, paths and
exception details are never echoed. CLI prints static help/status/errors and
digest-only import/reconciliation reports.
Reported key/unknown-identifier evidence digests are truncated to 24 hex
characters. File/integrity checksums and private disk-membership digests retain
the full 64-character SHA-256.
Existing report-file symlinks are refused. Warnings are not private-source
schema reconciliation or proof of importability; this tool does not validate
every downstream business invariant or SQL nullability/default/CHECK.

## Import and reconciliation (P12-27)

The importer first validates the complete bundle, checks the explicit owner
against the backend's configured Daily owner, and checks target column types
against the registry. It connects only to the configured target SQL database;
credentials are not CLI arguments. `--tables` accepts a comma-separated subset
and is always reordered by the registry's parent-before-child order.

Import and reconciliation copy the manifest-bound source tables to a private
verified snapshot under the host temporary directory; reconciliation also
creates sorted temporary runs. Protect the temporary directory and reserve disk
space for the table files and sort runs. Remove stale `daily-import-validation-*`
directories privately after a crash because they can contain source rows.

An import requires an absolute `--state-dir` outside this repository. Keep it
private and outside the bundle. Its atomic checkpoint contains only the
manifest digest, batch size, counts and batch digests. Resume with the same
bundle, state directory and batch size. A stale process lock is recovered only
after its recorded process no longer exists. Never remove a live lock.
Each executing batch is one transaction. Identical existing rows are skipped,
different rows are not overwritten, and conflicts are counted while later rows
continue. Exit code 3 means at least one conflict, including in a dry run.

Without `--execute`, every selected importable row is read and classified as
`wouldInsert`, `wouldSkip` or `wouldConflict`; no target row is written. The
digest-only JSON report is printed to standard output, or atomically written to
`--report`. Keep reports outside the repository, bundle and state directory.
Reports contain known table names, counts, hashes and truncated digests only.
They contain no row values, free text or raw keys.

```sh
node apps/backend/dist/daily/migration/cli.js import --bundle /tmp/daily-synthetic --owner-object-id OWNER_GUID --state-dir /tmp/daily-import-state --batch-size 500 --tables health_workouts,nutrition_meals --report /tmp/daily-import-report.json
```

**Expected:** a digest-only report with `status: complete` and per-table
`wouldInsert` counts for a fresh synthetic target. The command exits 3 for any
conflict and does not overwrite it. The actual configured owner ID and SQL
connection must be available through the existing backend configuration, never
as command-line credentials.

`reconcile` is standalone and read-only. It validates the complete bundle,
streams the source and owner-scoped target in key order, and reports source and
target canonical checksums, missing/extra/different counts, date-range digests,
and the meals per-day totals digest. Meal aggregates distinguish NULL nutrients
from zero. Any difference exits nonzero.

```sh
node apps/backend/dist/daily/migration/cli.js reconcile --bundle /tmp/daily-synthetic --owner-object-id OWNER_GUID --batch-size 500 --tables health_workouts,nutrition_meals --report /tmp/daily-reconcile-report.json
```

**Expected:** `status: complete`, zero missing/extra/different rows, matching
canonical source/target hashes, and a digest for meal totals. Reports expose no
meal amounts or dates.

**Owner-only — private dry run.** Only after the owner has supplied and validated
the private export, recorded rulings, and the protected workflow in #721 has
released this stage, run `import` without `--execute` against the configured
Daily target. Keep the bundle, state directory and report in protected private
storage.

**Expected:** a digest-only classification report. A dry run makes no target
writes and is not authorization to execute.

**Owner-only — protected execution.** Execute only through the approved
protected workflow after its owner-only checks pass:

```sh
node apps/backend/dist/daily/migration/cli.js import --bundle /PRIVATE/EXPORT --owner-object-id OWNER_GUID --state-dir /PRIVATE/STATE --batch-size 500 --execute --report /PRIVATE/IMPORT-REPORT.json
```

**Expected:** digest-only batch/table counts and hashes. Exit 3 reports row
conflicts after the table finishes; other failures stop with a value-free
diagnostic and preserve committed checkpoints for a safe resume.

**Owner-only — read-only reconciliation.** After the protected execution, run
`reconcile` on the same immutable bundle and owner-scoped target, writing its
report only to private storage.

**Expected:** zero missing, extra and different rows and matching checksums and
meal totals. Any nonzero difference blocks acceptance and cutover; resolve it
privately and rerun reconciliation.

No private export or ruling has been used here. No real import or
reconciliation has been run; synthetic unit/database tests are not evidence of
source parity, owner approval, protected-workflow completion or cutover.

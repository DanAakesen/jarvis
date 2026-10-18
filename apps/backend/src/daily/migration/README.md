# TEMPORARY offline Daily migration tooling

Remove at **P12-19**, including compiled counterparts in `apps/backend/dist/daily/migration/`.
Files to remove: `README.md`, `cli.ts`, `decisions.ts`, `manifest.ts`, `io.ts`,
`validate.ts`, `generate.ts`, `migration.test.ts`.
No production entrypoint imports this directory. No SQL, network, deployment,
source export/import, activation, credentials or new dependencies.

Build with the existing backend build, then run:

```sh
node apps/backend/dist/daily/migration/cli.js --help
node apps/backend/dist/daily/migration/cli.js generate --bundle ./SYNTHETIC_BUNDLE --seed 22
node apps/backend/dist/daily/migration/cli.js validate --bundle ./SYNTHETIC_BUNDLE --report-dir ./SYNTHETIC_REPORT --now 2026-10-18T00:00:00Z
```

Only synthetic examples belong in an agent environment. Real bundles/reports
must stay in owner-controlled encrypted private storage, outside this repository,
agent environments and GitHub artifacts. Validation does not accept #717/#721.
The reusable reader and decision metadata are for P12-27.

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
and path occurs once. The ingestion must exist in `health_ingestions` and
`health_raw_objects`. The size/original checksum must equal both ledgers;
expiration must exactly equal the raw ledger's text. Every raw-ledger entry
requires index coverage. Sanitized checksums stay historical row metadata;
this format validates **original bytes only**, never substitutes sanitized bytes.

An entry is expired when `expiresAt <= --now` (default current time).
Its reference, declared metadata and index coverage are still checked; its
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
disk exhaustion fails closed. The output directory must be private and trusted.

Reports `validation-report.json` and `validation-summary.md` contain only fixed
table names/decisions, stable codes, counts, booleans and hashes. Unknown names,
column names, raw keys, row values, exporter/schema text, ruling prose, paths and
exception details are never echoed. CLI prints only static help/status/errors.
Existing report-file symlinks are refused. Warnings are not private-source
schema reconciliation or proof of importability; this tool does not validate
every downstream business invariant or SQL nullability/default/CHECK.

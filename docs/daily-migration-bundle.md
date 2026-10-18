# Offline Daily export bundle (P12-22)

Status: version 1 tooling, proven only with synthetic data. This is not an
export, import, source-schema reconciliation or cutover approval.
Refs DanAakesen/jarvis#717 and DanAakesen/jarvis#721.

## Directory and manifest

A bundle is a private directory, outside this repository and any coding-agent
environment. It contains `manifest.json`, exactly one `<table>.ndjson` for each
of the 31 source tables in [the mapping](daily-schema-mapping.md#explicit-table-decisions),
and optionally `objects.ndjson` and `objects/`. Files are regular files, not
symbolic links. Names are relative to the bundle; path traversal is forbidden.
Validation never connects to the source, a database or a network.

The manifest has:

| Field | Meaning |
| --- | --- |
| `formatVersion` | Exactly `1` |
| `createdAt` | An explicit timestamp with timezone |
| `exporter` | `{ name: string, version: string }`, free text, not executable instructions |
| `sourceSchemaRef` | Schema evidence reference, or `unknown`; not proof of the live schema |
| `tables` | All 31 source-table names mapped to the entries below |
| `rulings` | Owner decisions for each of the five mixed-source tables |
| `objects` | Optional retained-object coverage entry |

Each table entry is `{ file, rowCount, sha256, complete: true, columns }`.
`file` is exactly `<table>.ndjson`; `rowCount` is a nonnegative safe integer;
`sha256` is the SHA-256 of the exact file bytes; `columns` lists source column
names, including excluded columns when present. `complete: true` asserts that
the owner/exporter checked for pagination, row limits and truncation. It cannot
make an incomplete source query complete.

The runtime manifest check rejects unsupported versions, malformed fields and
unrecognised structure. A valid manifest alone is not a valid bundle.

## NDJSON values and identity

Use UTF-8, one JSON object per line. Hash exact bytes, including line endings.
Do not pretty-print individual rows across lines. Empty tables have empty files
and a count of zero. Column names must agree with the declared inventory and the
target registry, apart from the explicit source-column exclusions.

- Encode SQLite integers outside JavaScript's safe range as decimal strings,
  within signed 64-bit bounds. Other numeric values are JSON numbers; integer
  columns must not contain unsafe JSON numbers.
- Encode text and JSON columns as strings, not embedded objects. Encode SQL
  unknowns as `null`; never substitute `0`, an empty string or a derived value.
- Preserve original time text and offsets. Date keys must be exact, valid
  `YYYY-MM-DD` calendar dates.
- Preserve binary-distinct text keys and padding. Indexed keys longer than
  256 UTF-16 code units fail; shorter target-specific bounds still apply.
  Never trim, truncate or hash-replace imported keys.
- Preserve tombstones, revisions, nutrient `null` versus `0`, ingestion lineage,
  and retained-object original/sanitized checksum distinctions.
- `owner_email` is source evidence only. It never selects a target identity;
  the later importer must use the single server-resolved owner.
- `nutrition_queue.claim_token` is excluded, even if populated. OAuth tables
  and `widget_auth_attempts` are counted and hashed without decoding their rows;
  they have no active target. Never put working credentials in an export.
  Any protected legacy backup containing credential material remains separate,
  encrypted and owner-only; the validator does not certify absence of secrets.

Missing key columns fail. Missing optional columns produce warnings and mean
NULL, not a guessed value. Unknown columns fail with a digest-only diagnostic:
the owner must reconcile them against the real schema privately, rather than
delete evidence to obtain a pass.

## Mixed-source rulings

Each of `attention_runs`, `attention_source_snapshots`, `attention_items`,
`briefing_runs` and `attention_rule_config` needs its own manifest entry:

```json
{
  "rulings": {
    "attention_runs": {
      "decision": "exclude",
      "rule": "Owner-reviewed exclusion of this entire table"
    }
  }
}
```

The example is incomplete intentionally; make all five decisions. Allowed
decisions are `import-sanitised` and `exclude`. `rule` records the owner's
private rationale and verified classification rule. The validator never prints
it and never executes it. A missing ruling is `blocked-needs-ruling`, including
for an empty table. Exclusion is explicit, not silent dropping.

An `import-sanitised` ruling does not authorise arbitrary JSON or make an
unrecognised source safe. Migration 0041's source CHECKs reject case-insensitive
`ticktick` substrings; they do **not** define a positive discriminator allow-list.
Passing those CHECKs is not evidence of classification.
Unknown/missing discriminators and unclassified mixed JSON fail closed;
rows are counted, never exposed. The real TickTick discriminator spelling is
not known. No spelling is invented as a source fact. Synthetic negative
fixtures exercise rejected tags only. The later importer must not copy
TickTick payloads into active data or execute free-text rulings.

The current executable sanitization rule is deliberately narrow:
`empty-payload-v1` accepts only empty/null mixed JSON in runs and briefs, with
no nonempty brief preview. It is a validator rule identifier, not a real-source
discriminator. Tables carrying a `source` discriminator cannot pass
`import-sanitised` until a verified positive classifier is implemented;
explicitly exclude them or retain the blocker. This prevents an owner's
uninterpreted free-text assertion from blessing unknown historical payloads.

## Retained objects

When objects are included, the manifest has
`objects: { index: "objects.ndjson", count, totalBytes, sha256 }`.
The checksum covers the exact index bytes. The index associates each retained
file under `objects/` with an ingestion ID, byte count, SHA-256 and explicit
expiry timestamp. These values are private source evidence, never report text.
Each entry has exactly this shape (identifiers here are synthetic):

```json
{"file":"objects/synthetic-001.bin","ingestionId":"synthetic-ingestion-001","bytes":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","expiresAt":"2099-01-01T00:00:00Z"}
```

`file` is a flat file under `objects/`, with an ASCII alphanumeric, underscore
or hyphen basename and optional extension; subdirectories are not supported.
`bytes` is a nonnegative safe integer. `sha256` is lowercase hexadecimal.
Version 1 indexes original retained bytes: the file digest corresponds to
`health_raw_objects.checksum`, not `sanitized_checksum`. Preserve the separate
nullable `sanitized_checksum` column as ledger evidence; validation does not
claim to verify a second, sanitized byte stream. Do not substitute sanitized
bytes under an original digest. If only a sanitized copy remains, reconcile
that source/storage fact privately before import rather than relabel it.
Every ingestion reference must exist in `health_ingestions`. Validation checks
known, non-NULL original size/checksum/expiry against a matching raw-object
ledger entry when one exists. The ingestion request checksum and size describe
a different boundary and need not match the retained object. Missing optional
ledger metadata remains unknown. Historical raw-ledger rows do not establish
that bytes still exist: the object index is optional and is not required to
cover every historical row. The owner independently establishes the retained
inventory. Each file path and ingestion occurs once. Validation checks nonexpired
file size and checksum and the index count/total byte coverage; `totalBytes`
includes expired entries' declared sizes. It counts
expired entries separately: expiry at or before validation time is not an
error and never makes an object eligible for import. Expired bytes are not
opened or required; their index/reference metadata is still checked.
An ingestion/raw ledger alone does not prove that retained bytes exist.

Use `--now` to reproduce a validation-time retention decision; otherwise the
validator uses the current time. Preserve the chosen time privately with the
report. A passing bundle says nothing about source objects omitted before the
owner established the inventory.

## Reports, bounds and downstream use

`validate` writes `validation-report.json` and `validation-summary.md` to the
private report directory and exits nonzero for failures or blocked rulings.
The report directory must be outside the bundle, never the bundle itself or
one of its descendants.
Per-table evidence includes the decision, observed/manifest counts, checksum
match, stable warning/error codes and blocked state. Object coverage and
overall counts are separate. Reports contain only known table identifiers,
counts, hashes/digests and fixed diagnostic vocabulary: no row values, raw
keys, unknown identifiers, free-text rulings, exporter text or exception text.
Keys, when identified, use truncated SHA-256 digests.

The reader caps manifest/line sizes and streams table/object bytes. The memory
option limits working buffers, not total Node/V8 process RSS. Duplicate
detection and ingestion membership use temporary disk-backed digest indexes,
not a set growing in memory with source rows. Budget rejection is an explicit
failure, not silent truncation. Allow private temporary disk space proportional
to the row count; protect the validation host and its temporary storage.
Scratch indexes normally disappear on completion or failure. After an abrupt
process termination, remove any stale `.daily-index-*` directories in the
private report directory before retiring the host/storage.
The bundle must remain immutable throughout validation and later import.

The removable implementation is in
`apps/backend/src/daily/migration/`. Its decisions, reader and generator are
reusable by P12-27's resumable importer/reconciliation report. No importer is
included, and production entrypoints must not import this directory. Remove
it at P12-19 following its README. See the
[owner runbook](daily-migration-runbook.md) for commands and evidence gates.

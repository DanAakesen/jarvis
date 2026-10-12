# Protected export preparation (P12-02)

Temporary, source-independent safety primitives with synthetic fixtures only. This is not a verified D1/R2 adapter, export CLI, encrypted archive writer or completed backup. No network, filesystem output, credentials or production records are used by these tests. The internal page shape is an adapter-facing interface, not a claim about provider endpoints or response formats.

Run from the repository root after explicit environment activation:

```sh
source /workspace/.jarvis-tools/activate.sh
node --test tools/daily-migration/export/safety.test.mjs
```

Implemented checks: independent expected count and snapshot identity, complete bounded cursor traversal, duplicate/cycle/truncation rejection, deterministic stable-ID sorting/canonical JSON/SHA-256, bounded transient-only retries with sanitized failures, and exact retained-object coverage with explicit expired-object retention evidence. These checks cannot prove that a provider's count/snapshot evidence is truthful or that a live backup exists. Raw byte checksums must be computed while reading verified provider bytes, not copied from an untrusted listing.

## Required nonsensitive evidence before adapter implementation

- Supported read-only D1 inventory/row export mechanism: schema discovery, table/column types, stable row IDs/composite keys, count source, snapshot consistency across schema/counts/pages and concurrent ordinary food/health writes, pagination/limits, truncation signals and transient error semantics.
- Supported R2 listing/read contract: cursors/end markers, version/generation identity, byte lengths and checksum semantics, retained-object enumeration, retention ledger and how expired originals can be distinguished from missing/unlisted objects.
- Sanitized schema/provider documentation or code references. The old 31-table review is not a current count. Do not provide records, credentials, real object names or source exports here.
- Approved protected operational output/encryption contract: trusted executor, private destination/access/retention, existing key mechanism and atomic authenticated-encrypted completion/verification. Do not provision or copy new keys/passwords into the coding environment.
- Verified table/object inclusion/exclusion policy. TickTick snapshots may belong only to the protected complete-original backup with explicit active-migration exclusion, never an activated integration or active Azure feed.

Until supplied, no live adapter, guessed provider endpoint, encryption format or export-success claim is made. Live schema inventory, protected archive generation, counts/checksums/stable IDs and retained-object completeness are separate coordinator-run acceptance gates. Draft PR must use `Refs #717`; issue remains open/in progress and is not merge-ready. A future `Fixes #717` reference requires those live gates before merge.

Original Daily remains canonical before cutover and continues normal authorized writes. Migration tooling cannot alter its code/schema or rewrite source records. Existing Jarvis authentication/server owner applies; no new login, source-owner request input, production activation, data import, Azure access or paid resource. This tooling is excluded from the production backend Docker context and has no app runtime import.

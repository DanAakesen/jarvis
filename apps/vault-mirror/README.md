# Vault mirror runner

P14-27 adds a one-run runner around the pure P14-26 planner. It uses Obsidian
Headless Sync, GitHub's Git Data API and Azure Key Vault/Blob Storage. The runner
and image are **not deployed or connected to the live vault**; the existing
desktop task remains. Obsidian Headless Sync behavior is **not yet verified
against the live service**.

## Run the checks

From the repository root, using the pinned Node/npm versions:

```sh
npm ci
npm run build:vault-mirror
npm run typecheck:vault-mirror
npm run lint:vault-mirror
npm run test:vault-mirror
docker build --file apps/vault-mirror/Dockerfile --tag jarvis-vault-mirror:local .
```

The reusable component workflow runs the checks, builds the image without
pushing, verifies `ob --version`, and runs the runner against in-memory fakes
inside the image. Mirror-only changes qualify this component; they do not deploy
an existing application or the Azure job.

## Runtime

`node apps/vault-mirror/dist/main.js` performs one run and exits. The image
defaults to that command. Required non-secret environment: `KEY_VAULT_URI`,
`AZURE_CLIENT_ID`, `GITHUB_APP_ID`, and `VAULT_MIRROR_STORAGE_URL`.
`VAULT_MIRROR_WRITE_BACK` is `dry-run` unless its value is exactly `on`.
`VAULT_MIRROR_MAX_CHANGED` defaults to 25 (hard maximum 100) and
`VAULT_MIRROR_MAX_DELETES` defaults to 3 (hard maximum 10).

Each run reads `obsidian-auth-token`, `obsidian-vault`,
`obsidian-vault-password` (optional), `vault-mirror-policy`, and
`github-app-private-key` from Key Vault using the job's managed identity. The
GitHub App installation token is restricted to the vault repository and
`contents:write`. No credentials, Key Vault references or owner policy are part
of the image or repository.

The state container is `vault-mirror-state`; its `state.zip` blob holds the
working copy, Headless Sync configuration, common-base content and pending
write-back. Runs take a blob lease, verify the archive checksum and 64 MiB cap,
and upload state with both the original ETag and active lease. The archive is
preflighted before GitHub or Obsidian writes. An oversized or corrupt archive
reports the existing `state-corrupt` reason with `needs-attention`; the shared
status schema and Status-page explanation remain unchanged. Status is written
to `vault-mirror-status/status.json` using the strict shared contract. Logs use
an explicit allow-list of run ID, outcome, fixed reason, duration and counts.
Conflict paths appear only in private status, never in logs.

The working copy and configuration home use fixed absolute paths below the
container's temp directory on every run. After taking the lease, the runner
removes and recreates them with mode 0700, then restores their archived contents.
This keeps the `vaultPath` saved by `ob sync-setup` matched to the path passed to
later commands; setup is not repeated just to compensate for a changing temp
directory.

At startup, the runner best-effort reads the previous status with a five-second
timeout, 32 KiB limit and strict schema validation. Missing or invalid status is
ignored. Its last-success time and failure count seed outcomes before state loads;
after state loads, the runner retains the later success time and larger failure
count from the status and archive. Busy runs preserve both values, early failures
increment the carried count, and `ok`/`ok-noop` reset it and advance the success
time.

The runner sets `pull-only` before every sync. Each `ob` command uses the
remaining 420-second run budget minus a 90-second reserve for the remaining
snapshot, planning, GitHub, archive and status steps; it is not capped at 60
seconds. If a child times out while the run deadline remains, the runner saves
its current working copy and CLI state. The next invocation starts with another
pull-only sync to reconcile that checkpoint before planning. If the overall run
deadline itself expires, persistence is skipped because its lease signal is
cancelled.

During per-device setup and before each sync, the runner disables attachment
types and synced vault settings, and applies the policy's excluded folders.
The pinned CLI's `--file-types ""` restores its default attachment set, so the
runner explicitly stores an empty `allowTypes` array in that device's CLI config
after `sync-config`; excluded file types are treated as accepted by the source's
filter and are not converted into deletions. `dry-run` never switches to
`bidirectional` and never writes planned changes to the working copy; status
counts show pending write-back. In `on`, it writes planned local files through
temporary files and atomic rename, verifies those paths, uploads, and returns to
`pull-only`. A failed/unconfirmed upload remains pending in state and is retried
before planning on the next `on` run. A retry is applied only if the current file
still matches its saved base; an already-landed write/delete is cleared without
another upload, and a newer edit drops the stale retry so normal planning can
reconcile it. A retry upload runs only when a mutation was applied. Fresh state
suppresses all Obsidian writes even when configured `on`.

The optional vault password is passed to `ob sync-setup` through its argument
array because the pinned CLI exposes no password environment-variable or stdin
input. The container is single-purpose and runs as non-root.

Only HTTP 401/403 and the CLI's explicit invalid/expired-token output are
classified as `auth`. Transient Key Vault or GitHub errors, timeouts and network
failures remain failed outcomes for the next scheduled retry. Windows-invalid
names are counted skips. Upload verification checks only the paths applied by
that run, so an unrelated remote edit downloaded by bidirectional sync does not
create a false upload failure.

The container can be smoke-tested locally with:

```sh
docker run --rm --entrypoint ob jarvis-vault-mirror:local --version
docker run --rm \
  --mount "type=bind,source=$PWD/apps/vault-mirror/test/container-smoke.mjs,target=/tmp/container-smoke.mjs,readonly" \
  --entrypoint node jarvis-vault-mirror:local /tmp/container-smoke.mjs
```

These tests use synthetic values and in-memory services; they do not contact
Azure, GitHub or Obsidian. The pinned CLI's config filters and timeout recovery
are verified from the `0.0.14` package source and tests, not yet verified against
the live service.

## Inputs and policy

`src/engine/index.ts` exports `planReconcile(input): Plan` and `validatePolicy`.
Types and action ordering are documented in `src/engine/types.ts`.
The validator accepts unknown input or JSON and returns a validated policy or
only fixed `policy-missing` / `invalid-policy` / `invalid-pattern` codes. Never log
the policy, a Zod diagnostic or a regular expression. All keys are required;
unknown keys, missing/empty documents, invalid field types and invalid patterns
fail closed. An empty allowlist grants nothing. Extension values include the dot
(for example, `.md`). Policy values used in tests are synthetic, not owner policy.

The engine receives in-memory O (Obsidian), G (GitHub), and B (last common base)
maps, policy, limits, write-back mode, initialization flag, Unix milliseconds,
content readers and a three-way merge function. Content readers and merge must
be pure, synchronous functions over supplied data. They must not do I/O.
The merge implementation must preserve independent changes and be idempotent
when retried against a partially applied merge. A throwing reader/merge is
sanitized to a skipped path, not exposed as an error message.

Inventory paths are vault-relative, slash-separated and normalized to Unicode
NFC. The engine also normalizes incoming keys, retaining original reader keys.
NFC/NFD spellings on different sides represent the same path. Duplicate
normalized keys within one map, or different live NFC spellings that collide under
conservative Unicode caseless comparison, are skipped, never coalesced.
File/descendant collisions across live inventories also skip affected approved paths,
including descendants blocked by an excluded ancestor file.
Stale base-only spellings and file paths do not register live collisions; once
absent from both live sides, those base entries can be forgotten.
Content hashes are SHA-256 over UTF-8 after CRLF → LF; other text is preserved.
Inventory sizes describe original bytes. Read bytes and hashes are checked before
planning outgoing content; output text uses LF with a matching hash and size.
All inventory records must be regular non-executable git mode `100644`.

Approval applies the private policy: no dot-prefixed or `_agent-log` segment,
no excluded prefix, an allowed first directory (root files skip this check),
an allowed extension, and no excluded filename or filename-pattern match.
Comparisons ignore case; regexes compile with only `i`. Unsafe relative paths
are rejected before policy evaluation. Non-approved paths never enter actions
or skipped-path lists.

## Decisions and recovery

Equal sides record B if it is stale or missing; an already-current base needs no
action. Both absent forget B. A one-sided creation propagates to the other side.
A one-sided deletion propagates only when the survivor equals B; if the survivor
was edited, the edit wins and recreates the missing side. With two different
present files, a missing base is a conflict; one unchanged side accepts the
changed side; two changed sides use the injected three-way merge. A clean merge
writes identical merged content to both sides. A conflict skips both.

Skipped conflicts carry a first-seen timestamp persisted in the state archive
without advancing the common content base, including no-base conflicts via
`conflictFirstSeenAt`. At 24 hours an unresolved conflict pushes O to G only.
The GitHub version remains in history; count these resolutions separately.
Clear conflict metadata after successful common-base recording.

The runner applies GitHub actions as one atomic commit and only then applies
planned Obsidian writes. It records a common base only after the required side
writes succeed. A failed write never advances or forgets its base. GitHub's
non-force ref update rejects a moved branch; the runner reads and replans once.
After a crash, the next run reads fresh snapshots and replans rather than
resuming a stale plan. Engine tests exhaust 216 synthetic O/G/B states; runner
tests cover retries and partial completion.

## Write-back and guards

Writing to Obsidian ships **off**. Every `...OnO` action is suppressed and counted
as `pendingWriteBack` in `dry-run`, on freshly initialized/lost base, or after a
guard trip. Do not record/forget that path's base while write-back is pending.
O → G writes are not mode-gated.

Two acceptance-property wordings conflict with the explicit decision table:
“no write action in dry-run” means **no Obsidian write**, not no GitHub upload;
“no path in both directions” excludes the required **clean merge**, which writes
the same content to both. Tests use these explicit semantics.

`maxChanged` counts all proposed file mutations per direction, including deletes;
`maxDeletes` counts deletes per direction. Runner configuration defaults them to
25 / 3 and enforces hard maxima 100 / 10. Limits supplied here must be
nonnegative integers within those maxima. Exceeding either cap, deleting
more than 10% of distinct base paths across both directions, an empty side versus
at least ten approved files, or more than 20% of base paths missing on either
side empties **all** actions, including base updates. Threshold equality is
allowed. Proposed mutations are counted before write-back gating.

If a complete first-run snapshot exceeds a change cap, the owner can raise that
cap **for one run**, within the hard maximum, inspect the result, and restore it.
This cannot override empty-side or ratio guards: restore/verify complete
snapshots rather than bypassing partial-pull protection. No bypass is provided.

Oversized, invalid, non-regular, colliding, unreadable or mismatched paths skip
individually. Outgoing credential-pattern matches skip only that path and flag
`needs-attention` / `secret-match`; the match is never returned. Merged text is
checked too. A guard verdict takes precedence over per-path attention reasons.

## Status and privacy

`@jarvis/contracts` exports the strict `vaultMirrorStatusSchema` and
`VaultMirrorStatus`. Counts are nonnegative integers. `lastSuccessAt` is required
and nullable before any success. Timestamps are offset-aware ISO strings
(64 characters maximum), run IDs are 1–128 characters, and the required
`conflictPaths` array contains at most ten paths of 1–1024 characters.
Only the contract's fixed outcomes/reasons are accepted; unknown keys fail.

Actions contain note text and skipped entries contain private paths. **Never log
or publish a plan.** Only counters, fixed reasons and verdict are log-safe.
Status contains no note text or credential, and permits paths only in
`conflictPaths`; those belong solely in private status storage and the
authenticated Status page. The runner must construct status explicitly, not
spread a plan into it. Tests use synthetic fixtures only.

## Obsidian CLI assumptions

The tools lock pins `obsidian-headless` 0.0.14, whose binary is `ob`. Source and
README findings, including command names, environment authentication, global
configuration location, and mode settings, are recorded in
`docs/decisions.md`. Every interaction assumption remains **not yet verified
against the live service**. The wrapper captures bounded output for internal
classification but never logs it; `ob sync` output may contain local paths.
The pinned README says a password is needed only for end-to-end encrypted vaults,
but the inspected CLI source appears to reject `sync-setup --json` without one
unless the service response supplies it. First setup without the optional
password secret may fail; verify this discrepancy before live use.

The purity test scans every engine source import using the TypeScript AST,
allowing only engine-local imports, Zod and the named SHA-256 `createHash`
primitive. It rejects network, filesystem, subprocess, time/random imports,
dynamic imports and ambient effect APIs. ESLint also denies ambient I/O/time
and randomness. Do not add runtime orchestration to `src/engine`.

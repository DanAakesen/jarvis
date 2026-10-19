# Vault mirror decision engine

P14-26 implements the **pure planning boundary only**. The Azure job, CLI,
network access, state storage, entry point and deployment belong to later issues.
Nothing here can reach the owner's vault. Obsidian Headless Sync and Azure
behavior are **not yet verified against the live service**.

## Run the checks

From the repository root, using the pinned Node/npm versions:

```sh
npm ci
npm run build:vault-mirror
npm run typecheck:vault-mirror
npm run lint:vault-mirror
npm run test:vault-mirror
```

The reusable component workflow runs these checks and the shared contracts tests.
Only mirror + Python qualification is selected for a mirror-only code change.
No production deployment is selected for mirror-only files.

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

Skipped conflicts carry a first-seen timestamp. The future runner must persist
it without advancing the common content base, including no-base conflicts via
`conflictFirstSeenAt`. At 24 hours an unresolved conflict pushes O to G only.
The GitHub version remains in history; count these resolutions separately.
Clear conflict metadata after successful common-base recording.

Apply actions **in their returned order**, persisting each common-base update
only after its preceding writes succeed. A failed write must stop application;
never apply its `recordBase` or `forgetBase`. Use expected snapshots/preconditions
in the future runner to prevent overwriting changes made after planning.
Crash recovery reads fresh snapshots and replans; never blindly resumes a stale
plan. The tests exhaust 216 synthetic O/G/B states and crash after each action,
including between both merged writes and base persistence.

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
`maxDeletes` counts deletes per direction. The future configuration boundary
defaults them to 25 / 3 and enforces hard maxima 100 / 10. Limits supplied here
must be nonnegative integers within those maxima. Exceeding either cap, deleting
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

The purity test scans every engine source import using the TypeScript AST,
allowing only engine-local imports, Zod and the named SHA-256 `createHash`
primitive. It rejects network, filesystem, subprocess, time/random imports,
dynamic imports and ambient effect APIs. ESLint also denies ambient I/O/time
and randomness. Do not add runtime orchestration to `src/engine`.

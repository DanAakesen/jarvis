# P15 continuation and release checkpoint

Updated 5 November 2026, 23:22 UTC. Read AGENTS.md and
`p15-integration-verification.md` for the current scope/evidence. The original
checkpoint was `ab346d91`; that handoff is superseded by this continuation.

The owner requested every non-Chat page follow the approved board, with consistent
spacing, geometry, useful section headings and restrained native Apple glass. They
authorised release for **6 November 2026, 06:00 Europe/Copenhagen = 05:00 UTC**.
Work directly, without subagents, duplicate simulator runs or further confirmation.

Shared #1604 merged first as `c818a6b3`. Deliver **#1605, #1606, #1607, #1608,
#1610**, in that order. #1609 is combined validation only: never merge it. All
owning PRs target main after the shared squash. Resolve squash-history conflicts
without dropping verified source changes. Notes `/notes/folders` must deploy from
main before TestFlight. No page merge or upload has happened yet.

Current native runs: Notes 42125346515, Factory 42124893512, Health 42124896873,
Insights 42124893661. Settings 42121264726 passed 49/49 but screenshots prompted
geometry fixes. The combined f868f435 general CI passed with 493 Core tests. Its
native run and the queued intermediate Settings run are superseded by final
Settings/Health accessibility edits; use one final combined native run. Refresh
GitHub rather than relying on this snapshot.

Local branches include the final corrections. Notes ac3c346b reconciles main with
an identical source tree to 1d8e663f. Health 3757b4a7 adds reduced-motion/VoiceOver
paging after its data corrections. Settings 65ebe24b uses P15-94's final continuous
shared segmented bar, fixed semantic symbols, wrapped disabled-state text and a
scrolling strip above default text size. Integration d662d9a1 contains those changes;
this documentation commit follows it. Preserve ongoing page runs until their
artifacts are retained, then synchronize branches for delivery.

The current public-network workspace works. GitHub access was refreshed through
normal device login; do not reuse the stale injected GH_TOKEN. CLI commands use
`env -u GH_TOKEN GH_CONFIG_DIR=/tmp/p15-gh-auth gh ...`; git uses the same environment
and its gh credential helper. Never print credential values. GitHub's connected
tools can download logs/artifacts when CLI artifact redirects fail.

The original volume filled during local container verification. Live worktrees are
preserved under `/tmp/p15-workspace` and `/workspace/jarvis*` symlinks point there;
original directories remain as `*-before-scratch` backups. Continue using the
normal worktree paths. Native verification runs on GitHub's existing Mac workflow.
Local release evidence is recorded in `/tmp/p15-release-evidence.json`.

After final acceptance, follow `docs/agent-context.md`'s owner-started TestFlight
procedure and the unchanged `.github/workflows/ios-testflight.yml`. Dispatch main
with matching `branch=main`, track signing/archive/upload and report the build
number. Do not claim Apple processing or device acceptance without evidence.

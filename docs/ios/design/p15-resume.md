# P15 continuation and release checkpoint

Updated 6 November 2026, 00:35 UTC. Read AGENTS.md and
`p15-integration-verification.md`. The original checkpoint was `ab346d91`.

The owner authorised the non-Chat consistency pass, merges, required Notes backend
and TestFlight for **6 November 06:00 Europe/Copenhagen = 05:00 UTC**. Work directly,
without subagents or duplicate simulator runs. The owner is sleeping. New explicit
additions are the shorter Home greeting and subtle haptics/interruptible feedback
for confirmed lift saves, task completion and note creation. Other suggestions
remain proposals. ChatModel, ChatScreen and shared orb source remain unchanged.

## Delivery state

The recorded squash order is #1604 → #1605 → #1606 → #1607 → #1608 → #1610.
**Never merge #1609**; it is combined validation only.

- Shared #1604 merged as `c818a6b3`.
- Notes #1605 merged as `70dfe424`, after CI 42135284949 passed, including 476 Core
  tests. Deployment 42136945743 applied the backend and passed deterministic runtime
  readiness (jobs 127627768044 / 127630252947). Live conversation acceptance is pending.
- Home/Factory #1606 merged as `1bb81a44`, after CI 42137020863 passed, including
  477 Core tests. Main is currently this commit.
- Health #1607 is published at `9c7daae4`, reconciled with main. CI 42137475088 has
  passed 487 Core tests; other selected checks remain active.
- Insights #1608 and Settings #1610 still need reconciliation, publication and CI,
  then merge in that order. Local Settings head `98cc6179` adds verification docs.
- No TestFlight workflow has been dispatched. Notes backend readiness and final
  native visual acceptance precede the upload.

## Final native evidence in progress

Combined native run **42134678739**, job **127619694894**, uses source **7aa08ec6**.
It has compiled and is running UI/capture checks. Its entire `apps/ios` tree is
**418a4878b80d8aff940b6d7119f99191f369f590**. Do not push integration again until
this evidence is retained: the PR synchronize event would cancel the active run.
Local integration differs only in documentation and the necessary Linux runner pin.

The prior combined source 4ea30d09 passed 61/61 native tests in 42129251285 and
493/493 Core tests in general CI 42129251491. Corrected Settings captures in artifact
13465195628 were inspected in English/dark, Danish/light and accessibility XXXL,
including sections and search detail. The new run adds the shorter Home greeting,
success feedback and task recovery, sparse monthly Health labels, lower Health
captures and shared/Insights accessibility fixes. The older pass is not proof of
those additions. Existing page evidence and limitations are in the verification file.

GitHub moved ubuntu-latest to Ubuntu 26.04, unsupported by the pinned Swift action.
Notes pins only the Linux Core job to the previously passing ubuntu-24.04 image.
This necessary compatibility exception was announced under the existing direct
release authorisation. No checks, Mac execution, project or signing behavior changed.
Fresh Notes/Home CI passed. The setup failures are not test passes.

## Execution and finishing

Live worktrees are `/workspace/jarvis` and `/workspace/jarvis-{notes,factory,health,
insights,settings}`, symlinked to `/tmp/p15-workspace`. The original volume is full;
backups remain as `*-before-scratch`. Do not start local Docker builds. Artifact ZIPs
and selected native PNGs are under `/tmp/p15-*`; avoid extracting large recordings
without a concrete need. `/tmp/p15-release-evidence.json` retains checkpoints.

GitHub CLI: `env -u GH_TOKEN GH_CONFIG_DIR=/tmp/p15-gh-auth gh ...`.
Git network calls use that environment plus `-c credential.helper=` and
`-c credential.helper='!gh auth git-credential'`. Push now works; never print tokens.
The old `gh pr edit` fails on Projects classic; use REST PATCH with a JSON body file.
Connected GitHub tools retrieve completed job logs and artifact download references.

Each PR push and main merge starts an automatic native workflow. Cancel redundant
ones by exact branch/head, preserving combined run 42134678739. The local helper
`/tmp/p15_cancel_redundant_native.py BRANCH HEAD` handles delayed events and force
cancellation if normal cancellation stalls. Do not dispatch another simulator run.

Finish the current screenshots and assertions, merge remaining owners in order,
and compare the final whole app/test tree with the verified integration. Copy final
resume/verification records into the last delivery PR. Confirm Notes deployment,
then dispatch unchanged `ios-testflight.yml` on main with `branch=main`. Track actual
upload/build number separately from Apple processing and physical-device acceptance.

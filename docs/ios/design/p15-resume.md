# P15 continuation and release checkpoint

Updated 6 November 2026, 01:12 UTC. Read AGENTS.md and
[p15-integration-verification.md](p15-integration-verification.md).
Original checkpoint: `ab346d91` on `codex/p15-board-integration`.

The owner authorised the non-Chat consistency pass, merges, required Notes backend
and TestFlight for **6 November 06:00 Europe/Copenhagen = 05:00 UTC**. Work directly,
without subagents or duplicate simulator runs. The owner is sleeping. Explicit
additions are the shorter Home greeting and subtle haptics/interruptible feedback
for confirmed lift saves, task completion and note creation. Other suggestions
remain proposals. ChatModel, ChatScreen and shared orb source remain unchanged.

## Delivery state

The recorded squash order is #1604 → #1605 → #1606 → #1607 → #1608 → #1610.
**Never merge #1609**; it is combined validation only.

| Delivery | Merged commit | General CI / Core tests |
| --- | --- | --- |
| Shared #1604 | c818a6b3 | Accepted prerequisite |
| Notes #1605 | 70dfe424 | 42135284949 / 476 passed |
| Home/Factory #1606 | 1bb81a44 | 42137020863 / 477 passed |
| Health #1607 | 4ccdad38 | 42137475088 / 487 passed |
| Insights #1608 | 2b865706 | 42138510164 / 493 passed |
| Settings #1610 | Not merged | Final corrections prepared on top of all prerequisites |

Main is `2b865706`. Notes backend deployment **42136945743 succeeded**, including
apply (127627768044), deterministic readiness (127630252947) and live conversation
acceptance (127630421938). No TestFlight workflow has been dispatched.

## Native evidence and next run

Combined run **42134678739**, job **127619694894**, at `7aa08ec6` compiled and
passed **61/62 native tests**. The new task test selected Tasks due while looking
for today's fixture tasks. It now expands Today and retains both completion,
removal and continued-usability assertions. Lift capture now explicitly selects
dark appearance to match its attachment name.

Artifact **13468046343** was inspected for the shorter Home greeting in EN/dark
and DA/light, successful lift save, Health monthly/lower sections, Insights AX and
Settings AX. Monthly edge labels still truncated and normal-size scrolled content
crossed the pinned title. Final corrections anchor monthly end labels inwards,
retain intrinsic date width and enable native soft scroll-edge treatment.

Publish these corrections once through Settings #1610, preserving its automatic
native run as the sole final combined verification. Do not run integration in
parallel. Inspect corrected chart boundaries, scrolled headers and task-success
results before merging Settings. The prior 4ea30d09 pass (61/61, 42129251285)
establishes corrected Settings geometry, not the newer success feedback.

## Execution and release

Worktrees are `/workspace/jarvis` and `/workspace/jarvis-{notes,factory,health,
insights,settings}`, symlinked to `/tmp/p15-workspace`. The original volume is full;
backups remain as `*-before-scratch`. Do not start local Docker builds. Retained
artifacts and selected native PNGs are under `/tmp/p15-*`.

GitHub CLI: `env -u GH_TOKEN GH_CONFIG_DIR=/tmp/p15-gh-auth gh ...`.
Git network calls also use `-c credential.helper=` and
`-c credential.helper='!gh auth git-credential'`. Never print credentials.
Use REST PATCH with a JSON body file for PR metadata; this CLI's `pr edit` fails
on Projects classic. Connected GitHub tools retrieve completed logs and artifacts.

PR pushes and main merges start automatic native workflows. Cancel redundant ones
by exact branch/head, preserving the intended Settings run. Local helper:
`/tmp/p15_cancel_redundant_native.py BRANCH HEAD`. Do not dispatch duplicate runs.
The Linux Core job is pinned to ubuntu-24.04 because ubuntu-latest moved to 26.04,
unsupported by the existing Swift action. This necessary compatibility exception
was announced under the release authorisation; no checks, Mac execution, project,
signing or TestFlight workflow changed. Fresh delivery CI passed.

After accepted native evidence and Settings CI, merge #1610 last. Compare the whole
`apps/ios` tree on main with the verified Settings source, check protected Chat/orb
and project/signing files, then dispatch unchanged `ios-testflight.yml` on main with
`branch=main`. Track upload/build number separately from Apple processing. Close
#1609 without merging once validation is complete. Record the final evidence.

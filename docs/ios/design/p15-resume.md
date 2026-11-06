# P15 continuation and release checkpoint

Updated 6 November 2026, 00:05 UTC. Read AGENTS.md and
`p15-integration-verification.md`. The original checkpoint was `ab346d91`.

The owner authorised the non-Chat board consistency pass, merges, required Notes
backend deployment and TestFlight for **6 November 06:00 Europe/Copenhagen =
05:00 UTC**. Work directly, without subagents or duplicate simulator runs. The owner
is sleeping; existing authorisation is sufficient. New explicit additions are a
shorter Home greeting and subtle haptics/interruptible feedback on successful lift
saves, task completion and note creation. Other suggestions remain proposals.

Shared #1604 merged as `c818a6b3`. Deliver **#1605 Notes, #1606 Home/Factory,
#1607 Health, #1608 Insights, #1610 Settings**, in that order. **Never merge #1609**;
it is combined validation only. Notes `/notes/folders` must deploy successfully
from main before TestFlight. No page PR or TestFlight upload has happened yet.

Integration contains all latest owning-branch changes. Since published `4ea30d09`,
it includes confirmed-action feedback, Home completion recovery, the shorter greeting,
Health's sparse monthly chart dates, extra lower-section captures, and accessibility
header/control/Usage corrections. ChatModel, ChatScreen and Orb remain unchanged.
All branch work is committed locally; publish once run 42129251285 has retained its
Settings/Notes evidence, then use one new combined native pass for the new source.
The current run predates these additions and is not their release proof.

Latest page native results: Notes 42125346515 **50/50**, Factory 42124893512 **48/48**,
Health 42124896873 **48/48**, Insights 42124893661 **50/50**. Later standalone sweeps
hit the 45-minute job limit; these are UI-suite passes, not green overall workflows.
All screenshot artifacts were retained. Factory/Home EN/dark and DA/light, Notes
root/creation/graph, and normal Insights EN/dark and DA/light were inspected. Health's
30-day labels and Insights accessibility captures prompted the new fixes. Settings's
corrected geometry is in the active combined run. Combined general CI 42129251491
passed **493/493 Core tests** on 4ea30d09; new code still needs verification.

Live worktrees are `/workspace/jarvis` and `/workspace/jarvis-{notes,factory,health,
insights,settings}`, symlinked to `/tmp/p15-workspace`. The original volume is full;
backups remain as `*-before-scratch`. Do not start more local Docker builds. Artifact
ZIPs/selected PNGs are under `/tmp/p15-*-final`; avoid extracting large recordings
without a concrete need. `/tmp/p15-release-evidence.json` records checkpoints.

GitHub CLI uses the refreshed OAuth login:
`env -u GH_TOKEN GH_CONFIG_DIR=/tmp/p15-gh-auth gh ...`.
Git uses the same environment with cleared credential helpers and
`-c credential.helper='!gh auth git-credential'`. Never print credentials. Connected
GitHub tools can retrieve completed job logs and artifacts if CLI redirects fail.
A prior git push failed in `commit_refs_rules`; publishing an identical tree through
the Git API worked without force. Preserve local history before any reconciliation.

After native acceptance, merge owning PRs in order, compare the final app/test tree
with the verified integration, confirm Notes backend readiness, and dispatch the
unchanged `ios-testflight.yml` on main with `branch=main`. Track upload/build number;
Apple processing and physical-device behavior require separate evidence.

# Copilot runtime recovery — 7 November 2026

The owner reported a long runtime availability check followed by the message that
Copilot had not passed Jarvis's instruction check. PR
[#1627](https://github.com/DanAakesen/jarvis/pull/1627) corrects the unnecessary
provider lookup when no compatibility receipt exists and implements the documented
structured-input channel for the full current Jarvis policy.

The comparison definition pins `{{jarvis_policy}}` with one required string input
and no default. Every response, including function continuations and mode updates,
supplies the complete trusted policy separately from user/reference/tool input.
Definition readback, fingerprints and the `jarvis-structured-policy-v1` receipt
bind the exact contract. A two-turn live canary must prove both policy precedence
and policy replacement before the runtime becomes selectable.

## Source and qualification

- Candidate: `06df3c3efdfe113f10c8aa978fcc81e9c871f909`.
- Merged main: `4e06a275c025fb1430f668b4f9395cca50b96c2a`.
- Identical qualified/merged full tree: `a2c3df41642eb5ac585f479470ba9f6e5095acb7`.
- Unchanged iOS tree: `169764ccd98da54bbe309ef0766cba9da65df004`.
- [CI 42363816219](https://github.com/DanAakesen/jarvis/actions/runs/42363816219)
  and [CodeQL 42363816092](https://github.com/DanAakesen/jarvis/actions/runs/42363816092)
  passed. CI receipt artifact `13571421383` was downloaded and verified against
  SHA-256 `d0b270d08c8b3eddcbd4290e3e104692ac6c08e37b76c6fe7c780c6066eb9532`.
- Local checks passed: 504 hosted Python tests, 114 backend tests and 48
  provisioning/handoff/diagnostic tests; backend build, scoped ESLint/Ruff and
  whitespace checks. The broader local workflow run had 40 missing-executable
  errors (Ruby/PowerShell), not assertion failures. Hosted CI subsequently passed
  its workflow checks.

No iOS source, simulator qualification or TestFlight upload is part of this fix.
Build 78 remains the app release. Accepted UI and Chat appearance are unchanged.

## Normal production deployment

[Deploy 42364576232](https://github.com/DanAakesen/jarvis/actions/runs/42364576232)
succeeded from exact main `4e06a275`. Infrastructure, backend, hosted agent and web
were applied; readiness and all 15 Current acceptance checks passed. The release
receipt is accepted and not superseded, with the same qualified full tree.

Downloaded artifact digests were verified:

| Evidence | Artifact | SHA-256 |
| --- | --- | --- |
| Release | 13571253008 | `3ce4946b4975b761ec7538870766ecd36066ead64a4ea9a47dadc8eb4bf5ddd8` |
| Acceptance | 13571004992 | `9f98c02a38b28884402a30a5ecdd2948fe6f323e31bcd9f0895c9052ffc6ee89` |

## Copilot activation

[Manual Deploy 42365966747](https://github.com/DanAakesen/jarvis/actions/runs/42365966747)
was dispatched once from the same main with `provision_managed_chat=true` and
`refresh_managed_chat_definition=true`. Inspection and diagnostics are false.
This uses the existing agent and normal handoff; it does not recreate resources,
grant permissions, replay owner turns or bypass the policy canary.

The handoff printed `managed_chat_provisioned` at 10:57:46 UTC, but failed at
10:59:33 with `managed_probe_policy_not_applied` during `response_stream`. The
provider accepted the request and returned completed text that did not satisfy the
exact policy sentinel. The retained diagnostic does not establish which turn or
text classification failed. It does not prove why policy delivery failed. No
compatibility receipt was stamped; Copilot remains disabled. All 15 Current
acceptance checks passed again. The overall manual workflow failed despite its
separate normal release-result job succeeding.

The next correction adds closed diagnostic fields for the failing turn and the
streamed/final text classifications: expected, user override, previous policy,
expected with extra text, overflow, empty or other. No response/prompt text is
returned or logged. This does not weaken the sentinel comparison or enable a
runtime. The follow-up passes 508 hosted Python tests, including unchanged policy acceptance
and new ignored/stale/extra/stream-disagreement cases. Its live diagnostic result
is pending. Reuse the existing version for
that bounded check; do not create another agent or blindly repeat failed inputs.
The previous rejected transport attempts remain historical evidence in
[managed chat provisioning](managed-chat-provisioning.md).

## Owner comparison

Use [Compare Current and Copilot](runtime-comparison-owner-test.md) after live
activation passes. It covers matched settings, separate fresh text conversations,
real notes/tasks with test labels, context, approval boundaries, GitHub, research,
Factory and Health. Score correctness and tool reliability before speed and style.
No owner test notes, tasks, repositories or coding jobs were created for this
release verification; physical-device and functional owner-turn results remain
separate from the synthetic compatibility canary.

## Instrumented activation outcome — initial policy retained on turn 2

PR #1628 merged as b01f5f0306a1b134d4cf633796217a1928fb2b78 with full tree
20e3d1c433349a707a0e578ad3e163f5ecf61962. CI 42366663928 and CodeQL
42366663891 passed. Normal Deploy 42367439515 is accepted, not superseded,
with readiness and all 15 Current checks passing.

Manual activation 42369093453 provisioned at 11:41:14 UTC. At 11:42:01 UTC,
job 128393502221 reported managed_probe_policy_not_applied at response_stream:
probe_turn=2, stream_text=previous_policy, final_text=previous_policy. Turn 1
passed. No provider text or private policy was logged. No compatibility receipt
was stamped. Copilot is still unavailable.

This isolates stale instructions within one Copilot conversation. The official
Foundry Copilot harness guide, read on 7 November, says to save and start a new
chat after instruction changes. A supported per-turn update route that preserves
Jarvis's full policy and conversation is unresolved. Do not weaken the two-turn
check or move trusted instructions into ordinary user content.

Verified artifacts: CI 13572007964, SHA256
c36a81cec95234b1f203c6d20aef6578c9c74fb8aba96cad55f5edeabf6fa2e9;
release 13572579084, SHA256
625b3d0fc9848dfeffa226d49942fa7104c8876140a952b4ac3b717c9884a321;
acceptance 13572866396, SHA256
e1bcbe44e187243a0d10cf1185166e3fceb8795b8b73351fefab69ffea0e5ebb.
